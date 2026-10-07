// InboxProcessor.js -- inbox scanner. Asks Claude whether each unread message
// needs a response and creates a Gmail draft reply rather than sending. The one
// narrow exception is auto-send: see AUTOSEND_ENABLED_PROPERTY below and
// aedile/CLAUDE.md. Never marks a message read.

const AEDILE_REVIEWED_LABEL = 'aedile-reviewed';
// Dedup is by message ID, not this label: the label is thread-level and
// permanent, so filtering on it would hide later replies. A visual marker only.
const AEDILE_FLAGGED_LABEL = 'aedile-flagged';
const SCAN_QUERY = `in:inbox is:unread newer_than:14d`;
const MAX_MESSAGES_PER_RUN = 20;
// How far back MessageLog.getRecentRaw() reaches per triage call, so per-call context stays flat.
const MESSAGE_LOG_WINDOW_DAYS = 365;

// Provisional: distinct To+Cc addresses at or below this reads as a direct ask,
// above it as list-broadcast.
const DM_RECIPIENT_THRESHOLD = 3;

// --- Auto-send exception (see aedile/CLAUDE.md guardrails section) ---
// Both script properties default to off, so the exception is opt-in and fails
// closed to draft-only.
const AUTOSEND_ENABLED_PROPERTY = 'AUTOSEND_ENABLED';
// Comma-separated full addresses or "@domain" suffixes. Must include every
// address expected on an auto-sendable thread, including Aedile's own inbox
// address: there is no self-detection.
const AUTOSEND_ALLOWLIST_PROPERTY = 'AUTOSEND_ALLOWLIST';
// A second, tighter cap: auto-send leaves nothing for a human to catch.
const MAX_AUTOSEND_PER_RUN = 5;

const InboxProcessor = (function () {
  let _GmailApp = GmailApp;
  let _autosendCountThisRun = 0;

  /** Allow test injection of a mock GmailApp */
  function setGmailApp(mock) { _GmailApp = mock; }

  /** Kill switch — either director can flip this off without touching code */
  function isEnabled() {
    return PropertiesService.getScriptProperties().getProperty('AEDILE_ENABLED') === 'true';
  }

  function isAutosendEnabled() {
    return PropertiesService.getScriptProperties().getProperty(AUTOSEND_ENABLED_PROPERTY) === 'true';
  }

  function getAutosendAllowlist() {
    const raw = PropertiesService.getScriptProperties().getProperty(AUTOSEND_ALLOWLIST_PROPERTY) || '';
    return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  function matchesAllowlist(address, allowlist) {
    const addr = address.toLowerCase();
    return allowlist.some(entry => entry.startsWith('@') ? addr.endsWith(entry) : addr === entry);
  }

  // Every From/To/Cc address across every message, lowercased and deduped: the
  // full participant set, broader than what replyAll() addresses. Shared by the
  // eligibility check and recipient completion so the two cannot disagree.
  function getThreadParticipants(thread) {
    const participants = new Set();
    thread.getMessages().forEach(m => {
      participants.add(extractEmail(m.getFrom()));
      (m.getTo() || '').split(',').forEach(a => a.trim() && participants.add(extractEmail(a)));
      (m.getCc() || '').split(',').forEach(a => a.trim() && participants.add(extractEmail(a)));
    });
    return Array.from(participants);
  }

  // True only when every participant on the thread matches AUTOSEND_ALLOWLIST and
  // AUTOSEND_ENABLED is on; one participant outside it disables auto-send for
  // the thread. No per-run cap here: BumpChecker.js reuses this and tracks its own.
  function isAllowlistEligible(thread) {
    if (!isAutosendEnabled()) return false;

    const allowlist = getAutosendAllowlist();
    if (!allowlist.length) return false;

    return getThreadParticipants(thread).every(addr => matchesAllowlist(addr, allowlist));
  }

  // replyAll()/createDraftReply() address only the last message's recipients,
  // but eligibility covers the whole thread. Pass the full participant set
  // (minus this account) as an explicit `cc` so nobody is silently dropped.
  function getRecipientCompletion(thread) {
    const self = Session.getEffectiveUser().getEmail().toLowerCase();
    return getThreadParticipants(thread).filter(addr => addr !== self).join(',');
  }

  /** isAllowlistEligible() plus scanInbox's own per-run cap. */
  function isAutosendEligible(thread) {
    return isAllowlistEligible(thread) && _autosendCountThisRun < MAX_AUTOSEND_PER_RUN;
  }

  function getReviewedLabel() {
    return _GmailApp.getUserLabelByName(AEDILE_REVIEWED_LABEL)
      || _GmailApp.createLabel(AEDILE_REVIEWED_LABEL);
  }

  function getFlaggedLabel() {
    return _GmailApp.getUserLabelByName(AEDILE_FLAGGED_LABEL)
      || _GmailApp.createLabel(AEDILE_FLAGGED_LABEL);
  }

  // The LAST bracketed group, not the first: the real address follows the
  // display name, so a display name containing `<someone@allowlisted>` must not
  // decide the allowlist check.
  function extractEmail(header) {
    const matches = String(header).match(/<([^<>]+)>/g);
    const last = matches && matches[matches.length - 1];
    return (last ? last.slice(1, -1) : header).toLowerCase().trim();
  }

  function formatMessageDate(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }

  // "dm" vs "list" (see DM_RECIPIENT_THRESHOLD). Classifies the message under
  // review, not the whole thread.
  function classifyAudience(msg) {
    const recipients = new Set();
    (msg.getTo() || '').split(',').forEach(a => a.trim() && recipients.add(extractEmail(a)));
    (msg.getCc() || '').split(',').forEach(a => a.trim() && recipients.add(extractEmail(a)));
    return recipients.size <= DM_RECIPIENT_THRESHOLD ? 'dm' : 'list';
  }

  function buildThreadContent(thread, currentMessageId) {
    return thread.getMessages().map((m, i) => {
      const isCurrent = m.getId() === currentMessageId;
      const header = isCurrent
        ? `--- Message ${i + 1} (most recent — this is the message currently under review) ---`
        : `--- Message ${i + 1} ---`;

      return `${header}\nFrom: ${extractEmail(m.getFrom())}\nDate: ${formatMessageDate(m.getDate())}\nSubject: ${m.getSubject()}\n\n${m.getPlainBody()}`;
    }).join('\n\n');
  }

  function buildUserContent(threadContent) {
    const historyBlock = MessageLog.buildHistoryBlock(MESSAGE_LOG_WINDOW_DAYS);
    return `${historyBlock}\n\n${'='.repeat(20)}\n\nTHREAD UNDER REVIEW:\n\n${threadContent}`;
  }

  // Config.logEvent in its own try/catch: one bad Log write must not take down reviewMessage().
  function logResult(threadId, messageId, from, subject, action, notes, dryRun) {
    if (dryRun) {
      Logger.log(`[reviewMessage] DRY RUN — would Config.logEvent(${action}): ${notes}`);
      return;
    }
    try {
      Config.logEvent(threadId, messageId, from, subject, action, notes);
    } catch (err) {
      Logger.log(`[reviewMessage] Config.logEvent(${action}): FAILED — ${err.stack || err}`);
    }
  }

  // OpenLoops.upsert wrapped the same way. Suppressed in dry-run: a real row
  // would contaminate a later real checkBumps().
  function recordOpenLoop(threadId, decision, lastMessageDate, dryRun) {
    if (dryRun) {
      Logger.log(`[reviewMessage] DRY RUN — would OpenLoops.upsert(open=${!!decision.open_loop}, recheckAfterDays=${decision.recheck_after_days})`);
      return;
    }
    try {
      OpenLoops.upsert(threadId, {
        open: !!decision.open_loop,
        lastMessageDate,
        recheckAfterDays: decision.recheck_after_days
      });
    } catch (err) {
      Logger.log(`[reviewMessage] OpenLoops.upsert: FAILED — ${err.stack || err}`);
    }
  }

  function recordRequest(threadId, messageId, from, decision, dryRun) {
    if (dryRun) {
      Logger.log(`[reviewMessage] DRY RUN — would Requests.append(${decision.request_type}): ${decision.request_summary}`);
      return;
    }
    try {
      Requests.append(threadId, messageId, from, decision.request_type, decision.request_summary);
    } catch (err) {
      Logger.log(`[reviewMessage] Requests.append: FAILED — ${err.stack || err}`);
    }
  }

  // Reviews one message. Draft-only except threads that pass isAutosendEligible().
  // Every review is logged, one message's failure never kills the batch, and the
  // message is appended to MessageLog regardless of the triage outcome.
  function reviewMessage(msg, dryRun) {
    let threadId, messageId, from, subject;

    try {
      const thread = msg.getThread();
      threadId = thread.getId();
      messageId = msg.getId();
      from = extractEmail(msg.getFrom());
      subject = msg.getSubject();
      const audience = classifyAudience(msg);
      Logger.log(`[reviewMessage]${dryRun ? ' [DRY RUN]' : ''} messageId=${messageId} threadId=${threadId} from=${from} subject="${subject}" audience=${audience}`);

      if (dryRun) {
        Logger.log('[reviewMessage] DRY RUN — skipping MessageLog.append');
      } else {
        try {
          MessageLog.append(messageId, threadId, from, msg.getDate(), subject, msg.getPlainBody());
        } catch (err) {
          Logger.log(`[reviewMessage] MessageLog.append: FAILED — ${err.stack || err}`);
        }
      }

      const systemPrompt = audience === 'dm' ? AEDILE_SYSTEM_PROMPT_DM : AEDILE_SYSTEM_PROMPT_LIST;
      let decision;
      try {
        decision = AnthropicClient.getJsonDecision(systemPrompt, buildUserContent(buildThreadContent(thread, messageId)));
        Logger.log(`[reviewMessage] decision: ${JSON.stringify(decision)}`);
      } catch (err) {
        Logger.log(`[reviewMessage] AnthropicClient.getJsonDecision: FAILED — ${err.stack || err}`);
        logResult(threadId, messageId, from, subject, 'error', err.message, dryRun);
        return { threadId, messageId, from, subject, error: err.message };
      }

      const autoSend = decision.action === 'draft_reply' && isAutosendEligible(thread);
      if (dryRun) {
        if (autoSend) {
          Logger.log(`[reviewMessage] DRY RUN — would thread.replyAll() (auto-send, eligible+within cap)`);
          _autosendCountThisRun++;
        } else if (decision.action === 'draft_reply') {
          Logger.log('[reviewMessage] DRY RUN — would msg.createDraftReply()');
        } else if (decision.action === 'flag') {
          Logger.log('[reviewMessage] DRY RUN — would thread.addLabel(aedile-flagged)');
        }
      } else {
        if (autoSend) {
          thread.replyAll('', { htmlBody: decision.draft_body, cc: getRecipientCompletion(thread) });
          _autosendCountThisRun++;
        } else if (decision.action === 'draft_reply') {
          msg.createDraftReply('', { htmlBody: decision.draft_body, cc: getRecipientCompletion(thread) });
        } else if (decision.action === 'flag') {
          thread.addLabel(getFlaggedLabel());
        }
      }

      recordOpenLoop(threadId, decision, msg.getDate(), dryRun);
      if (decision.is_request) recordRequest(threadId, messageId, from, decision, dryRun);
      logResult(threadId, messageId, from, subject, autoSend ? 'auto_reply' : decision.action, decision.reasoning, dryRun);

      return { threadId, messageId, from, subject, decision, autoSend: !!autoSend };

    } catch (err) {
      Logger.log(`[reviewMessage] UNCAUGHT — ${err.stack || err}`);
      logResult(threadId, messageId, from, subject, 'error', err.message, dryRun);
      return { threadId, messageId, from, subject, error: err.message };
    }
  }

  // Entry point for the time-driven trigger. A thread is labeled
  // "aedile-reviewed" only once every unread message in it has been logged; one
  // cut off by the cap is left unlabeled for the next run.
  function scanUnread(dryRun) {
    if (!isEnabled()) {
      Logger.log('⏸️ Aedile is disabled (Script Property AEDILE_ENABLED is not "true"). Skipping run.');
      return { skipped: 'disabled' };
    }

    // Without the lock, overlapping runs would each start _autosendCountThisRun
    // at 0 and exceed MAX_AUTOSEND_PER_RUN. Script-wide on purpose: scanInbox and
    // checkBumps append to the same tabs.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      Logger.log('⏸️ scanUnread skipped — could not acquire the script lock (another run is still in progress).');
      return { skipped: 'locked' };
    }

    try {
      _autosendCountThisRun = 0;
      const reviewedLabel = dryRun ? null : getReviewedLabel();
      const threads = _GmailApp.search(SCAN_QUERY);
      let processed = 0;
      const results = [];

      for (const thread of threads) {
        if (processed >= MAX_MESSAGES_PER_RUN) break;

        let sawEveryUnreadMessage = true;

        for (const msg of thread.getMessages()) {
          if (!msg.isUnread()) continue;

          if (processed >= MAX_MESSAGES_PER_RUN) {
            sawEveryUnreadMessage = false;
            break;
          }

          const messageId = msg.getId();
          if (Config.isMessageProcessed(messageId)) continue;

          results.push(reviewMessage(msg, dryRun));
          processed++;
        }

        if (sawEveryUnreadMessage) {
          if (dryRun) {
            Logger.log(`[scanUnread] DRY RUN — would thread.addLabel(aedile-reviewed) on thread ${thread.getId()}`);
          } else {
            thread.addLabel(reviewedLabel);
          }
        }
      }

      Logger.log(`✅${dryRun ? ' [DRY RUN]' : ''} Aedile scan complete. Reviewed ${processed} new message(s), ${_autosendCountThisRun} auto-sent. No message was marked read.`);
      return { dryRun: !!dryRun, processed, autosent: _autosendCountThisRun, results };
    } finally {
      lock.releaseLock();
    }
  }

  return {
    scanUnread,
    reviewMessage,
    setGmailApp,
    extractEmail,
    buildThreadContent,
    getFlaggedLabel,
    isAllowlistEligible,
    classifyAudience,
    getRecipientCompletion
  };
})();

function scanInbox(dryRun) {
  return InboxProcessor.scanUnread(!!dryRun);
}

// One-time setup: installs an hourly trigger for scanInbox(). Safe to re-run.
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scanInbox')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('scanInbox')
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log('✅ Installed hourly trigger for scanInbox().');
}

// Read-only guardrail check: run it from the editor and read the execution log.
function checkGuardrails() {
  const props = PropertiesService.getScriptProperties();
  const aedileEnabled = props.getProperty('AEDILE_ENABLED') === 'true';
  const autosendEnabled = props.getProperty(AUTOSEND_ENABLED_PROPERTY) === 'true';
  const allowlistRaw = props.getProperty(AUTOSEND_ALLOWLIST_PROPERTY) || '';
  const allowlist = allowlistRaw.split(',').map(s => s.trim()).filter(Boolean);

  const bumpEnabled = props.getProperty(BUMP_ENABLED_PROPERTY) === 'true';

  Logger.log(`AEDILE_ENABLED: ${aedileEnabled}`);
  Logger.log(`AUTOSEND_ENABLED: ${autosendEnabled}`);
  Logger.log(`AUTOSEND_ALLOWLIST (${allowlist.length} entries): ${JSON.stringify(allowlist)}`);
  Logger.log(`MAX_AUTOSEND_PER_RUN: ${MAX_AUTOSEND_PER_RUN}`);
  Logger.log(`MAX_MESSAGES_PER_RUN: ${MAX_MESSAGES_PER_RUN}`);
  Logger.log(`BUMP_ENABLED: ${bumpEnabled}`);
  Logger.log(`MAX_BUMPS_PER_RUN: ${MAX_BUMPS_PER_RUN}`);
  Logger.log(`MAX_BUMP_AUTOSEND_PER_RUN: ${MAX_BUMP_AUTOSEND_PER_RUN}`);

  if (autosendEnabled && allowlist.length === 0) {
    Logger.log('⚠️ AUTOSEND_ENABLED is true but AUTOSEND_ALLOWLIST is empty — isAutosendEligible() will always return false, so nothing will actually auto-send.');
  }
  if (!autosendEnabled) {
    Logger.log('ℹ️ Auto-send is off. Every draft_reply decision will create a draft regardless of AUTOSEND_ALLOWLIST.');
  }
  if (!bumpEnabled) {
    Logger.log('ℹ️ Bump checking is off. Open loops will accumulate in OpenLoops but checkBumps() will no-op until BUMP_ENABLED is true.');
  }
  if (bumpEnabled && autosendEnabled && allowlist.length > 0) {
    Logger.log('ℹ️ Bump checking and auto-send are both on — an allowlisted, stale thread can now be auto-sent a bump, not just drafted.');
  }
}

/** Kill switch on — sets the Script Property scanUnread() checks each run */
function enableAedile() {
  PropertiesService.getScriptProperties().setProperty('AEDILE_ENABLED', 'true');
  Logger.log('✅ Aedile enabled.');
}

/** Kill switch off — either director can run this from the editor, no code changes needed */
function disableAedile() {
  PropertiesService.getScriptProperties().setProperty('AEDILE_ENABLED', 'false');
  Logger.log('⏸️ Aedile disabled.');
}

// Temporary testing toggle: suspends dead-season silence for the whitelisted
// director loop. Always run disableTestingMode() when the test is done.
function enableTestingMode() {
  PropertiesService.getScriptProperties().setProperty('TESTING_MODE', 'true');
  Logger.log('🧪 TESTING_MODE on — dead-season restraint suspended for the whitelisted loop. Remember to disable when done.');
}

function disableTestingMode() {
  PropertiesService.getScriptProperties().deleteProperty('TESTING_MODE');
  Logger.log('✅ TESTING_MODE off — normal restraint restored.');
}
