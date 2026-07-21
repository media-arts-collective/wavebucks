/**
 * InboxProcessor.js
 * Inbox scanner for Aedile. Looks at recent unread mail, asks Claude
 * whether each message needs a response, and — for most threads — creates
 * a Gmail draft reply rather than sending. The one narrow exception is
 * auto-send: see AUTOSEND_ENABLED_PROPERTY below and the "Draft-only, with
 * one narrow exception" section of aedile/CLAUDE.md. Never marks a message
 * read.
 *
 * Institutional memory comes from MessageLog (the raw mailing-list
 * archive), not a model-derived summary tier: every reviewed message is
 * appended there regardless of the triage outcome, and every triage call
 * gets a rolling window of that raw history alongside the thread under
 * review. See aedile/CLAUDE.md for why this replaced the earlier
 * Threads/Shards consolidation pipeline.
 */

const AEDILE_REVIEWED_LABEL = 'aedile-reviewed';
// Dedup is by message ID (Config.isMessageProcessed), not by this label — the label is thread-level
// and permanent, so filtering the search on it would hide a thread forever after its first review,
// even once a brand-new unread reply lands on it later. It's applied to threads purely as a visual
// marker for human eyes in the inbox.
const AEDILE_FLAGGED_LABEL = 'aedile-flagged';
// Applied when the model's decision is "flag" — a thread that needs a director's judgment call.
// Without this, "flag" would be indistinguishable from "no_action" except in the Log tab.
const SCAN_QUERY = `in:inbox is:unread newer_than:14d`;
const MAX_MESSAGES_PER_RUN = 20;
// How far back MessageLog.getRecentRaw() reaches for each triage call — see
// aedile/CLAUDE.md for the reasoning (bounded window instead of the full,
// ever-growing archive, so per-call cost/context stays flat over time).
const MESSAGE_LOG_WINDOW_DAYS = 365;

// Provisional heuristic for AEDILE_SYSTEM_PROMPT_LIST vs. _DM (see
// Context.js / classifyAudience below): total distinct To+Cc addresses at
// or below this reads as a direct ask, above it reads as list-broadcast.
// Recipient count is a blunt signal (doesn't exclude Aedile's own inbox
// address, so a 1:1 exchange plus the krewe address lands around 2) —
// expected to be revisited alongside the DM prompt's real content.
const DM_RECIPIENT_THRESHOLD = 3;

// --- Auto-send exception (see aedile/CLAUDE.md guardrails section) ---
// Both script properties default to unset/off, so the exception is opt-in
// and fails closed to draft-only if either is missing.
const AUTOSEND_ENABLED_PROPERTY = 'AUTOSEND_ENABLED';
// Comma-separated list, set in Project Settings > Script Properties. Each
// entry is either a full address ("zach@nomac.org") or a "@domain" suffix
// ("@nomac.org") matching any address on that domain. Must include every
// address that's expected to appear on an auto-sendable thread, including
// Aedile's own inbox address — there's no separate self-detection.
const AUTOSEND_ALLOWLIST_PROPERTY = 'AUTOSEND_ALLOWLIST';
// A second, independent cap on top of MAX_MESSAGES_PER_RUN — auto-send is
// strictly riskier than drafting (nothing left for a human to catch before
// it goes out), so it gets its own tighter per-run ceiling.
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

  /**
   * True only when every participant on the thread (every From/To/Cc
   * address, across every message) matches AUTOSEND_ALLOWLIST — one
   * participant outside the allowlist (a third party CC'd in, say)
   * disables auto-send for the whole thread, falling back to a draft. Also
   * requires AUTOSEND_ENABLED. Deliberately has NO per-run cap check here —
   * this is the shared safety boundary (the allowlist itself contains the
   * blast radius), reused by BumpChecker.js too, which tracks its own
   * separate per-run cap since it runs on a completely different trigger
   * schedule than scanInbox.
   */
  function isAllowlistEligible(thread) {
    if (!isAutosendEnabled()) return false;

    const allowlist = getAutosendAllowlist();
    if (!allowlist.length) return false;

    const participants = new Set();
    thread.getMessages().forEach(m => {
      participants.add(extractEmail(m.getFrom()));
      (m.getTo() || '').split(',').forEach(a => a.trim() && participants.add(extractEmail(a)));
      (m.getCc() || '').split(',').forEach(a => a.trim() && participants.add(extractEmail(a)));
    });

    return Array.from(participants).every(addr => matchesAllowlist(addr, allowlist));
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

  function extractEmail(header) {
    const match = header.match(/<([^>]+)>/);
    return (match ? match[1] : header).toLowerCase().trim();
  }

  function formatMessageDate(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  }

  /**
   * "dm" (narrow, direct) vs "list" (broadcast) — see DM_RECIPIENT_THRESHOLD
   * above. Picks which system prompt reviewMessage() uses. Classifies the
   * message actually under review, not the whole thread, since a thread's
   * audience can shift message to message.
   */
  function classifyAudience(msg) {
    const recipients = new Set();
    (msg.getTo() || '').split(',').forEach(a => a.trim() && recipients.add(extractEmail(a)));
    (msg.getCc() || '').split(',').forEach(a => a.trim() && recipients.add(extractEmail(a)));
    return recipients.size <= DM_RECIPIENT_THRESHOLD ? 'dm' : 'list';
  }

  /**
   * Renders every message in the thread (oldest first, Gmail's default order)
   * as a single delimited string, so the model can track an ongoing
   * back-and-forth instead of judging one message in isolation. The message
   * actually being reviewed — currentMessageId — is called out explicitly so
   * the model knows what's new versus historical context.
   */
  function buildThreadContent(thread, currentMessageId) {
    return thread.getMessages().map((m, i) => {
      const isCurrent = m.getId() === currentMessageId;
      const header = isCurrent
        ? `--- Message ${i + 1} (most recent — this is the message currently under review) ---`
        : `--- Message ${i + 1} ---`;

      return `${header}\nFrom: ${extractEmail(m.getFrom())}\nDate: ${formatMessageDate(m.getDate())}\nSubject: ${m.getSubject()}\n\n${m.getPlainBody()}`;
    }).join('\n\n');
  }

  /**
   * Combines the rolling raw mailing-list history with the thread actually
   * under review into one user-content block. History is oldest-first and
   * clearly separated from the live thread so the model doesn't confuse
   * "background" with "the thing to decide on."
   */
  function buildUserContent(threadContent) {
    const historyBlock = MessageLog.buildHistoryBlock(MESSAGE_LOG_WINDOW_DAYS);
    return `${historyBlock}\n\n${'='.repeat(20)}\n\nTHREAD UNDER REVIEW:\n\n${threadContent}`;
  }

  /**
   * Config.logEvent wrapped in its own try/catch — one bad write to the
   * Log tab shouldn't take down the rest of reviewMessage(), and a failure
   * here is worth seeing in the execution log even though success isn't.
   */
  function logResult(threadId, messageId, from, subject, action, notes) {
    try {
      Config.logEvent(threadId, messageId, from, subject, action, notes);
    } catch (err) {
      Logger.log(`[reviewMessage] Config.logEvent(${action}): FAILED — ${err.stack || err}`);
    }
  }

  /** OpenLoops.upsert wrapped the same way as logResult. */
  function recordOpenLoop(threadId, decision, lastMessageDate) {
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

  /**
   * Requests.append wrapped the same way as logResult/recordOpenLoop — only
   * called when the triage decision set is_request: true (see Context.js's
   * "Reporting bugs and features" section).
   */
  function recordRequest(threadId, messageId, from, decision) {
    try {
      Requests.append(threadId, messageId, from, decision.request_type, decision.request_summary);
    } catch (err) {
      Logger.log(`[reviewMessage] Requests.append: FAILED — ${err.stack || err}`);
    }
  }

  /**
   * Asks Claude whether this message needs a response and, if so, drafts
   * one. Draft-only for everyone except threads that pass
   * isAutosendEligible() — see the constants above and aedile/CLAUDE.md.
   * Every review is logged regardless of outcome (no_action, draft_reply,
   * auto_reply, flag, or error), and no single message's failure is
   * allowed to propagate up and kill the rest of the batch. The message is
   * appended to MessageLog regardless of the triage outcome — the raw log
   * is ground truth about what arrived, independent of whether the model
   * call itself succeeded.
   */
  function reviewMessage(msg) {
    let threadId, messageId, from, subject;

    try {
      const thread = msg.getThread();
      threadId = thread.getId();
      messageId = msg.getId();
      from = extractEmail(msg.getFrom());
      subject = msg.getSubject();
      const audience = classifyAudience(msg);
      Logger.log(`[reviewMessage] messageId=${messageId} threadId=${threadId} from=${from} subject="${subject}" audience=${audience}`);

      try {
        MessageLog.append(messageId, threadId, from, msg.getDate(), subject, msg.getPlainBody());
      } catch (err) {
        Logger.log(`[reviewMessage] MessageLog.append: FAILED — ${err.stack || err}`);
      }

      const systemPrompt = audience === 'dm' ? AEDILE_SYSTEM_PROMPT_DM : AEDILE_SYSTEM_PROMPT_LIST;
      let decision;
      try {
        decision = AnthropicClient.getJsonDecision(systemPrompt, buildUserContent(buildThreadContent(thread, messageId)));
        Logger.log(`[reviewMessage] decision: ${JSON.stringify(decision)}`);
      } catch (err) {
        Logger.log(`[reviewMessage] AnthropicClient.getJsonDecision: FAILED — ${err.stack || err}`);
        logResult(threadId, messageId, from, subject, 'error', err.message);
        return;
      }

      const autoSend = decision.action === 'draft_reply' && isAutosendEligible(thread);
      if (autoSend) {
        thread.replyAll('', { htmlBody: decision.draft_body });
        _autosendCountThisRun++;
      } else if (decision.action === 'draft_reply') {
        msg.createDraftReply('', { htmlBody: decision.draft_body });
      } else if (decision.action === 'flag') {
        thread.addLabel(getFlaggedLabel());
      }

      recordOpenLoop(threadId, decision, msg.getDate());
      if (decision.is_request) recordRequest(threadId, messageId, from, decision);
      logResult(threadId, messageId, from, subject, autoSend ? 'auto_reply' : decision.action, decision.reasoning);

    } catch (err) {
      Logger.log(`[reviewMessage] UNCAUGHT — ${err.stack || err}`);
      logResult(threadId, messageId, from, subject, 'error', err.message);
    }
  }

  /**
   * Entry point for the time-driven trigger. Scans up to
   * MAX_MESSAGES_PER_RUN unread, not-yet-logged messages and logs each one
   * via reviewMessage(). Labels a thread "aedile-reviewed" only once every
   * unread message in it has been logged this run or a previous one — a
   * thread cut off mid-way by the cap is left unlabeled so it's picked up
   * again next run instead of silently dropped.
   */
  function scanUnread() {
    if (!isEnabled()) {
      Logger.log('⏸️ Aedile is disabled (Script Property AEDILE_ENABLED is not "true"). Skipping run.');
      return;
    }

    // Without this, two overlapping runs (e.g. a slow prior run still
    // in flight when the next trigger fires) would each start from a
    // fresh _autosendCountThisRun of 0, silently exceeding the intended
    // MAX_AUTOSEND_PER_RUN ceiling. See aedile/CLAUDE.md Open items.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      Logger.log('⏸️ scanUnread skipped — could not acquire script lock (another run appears to still be in progress).');
      return;
    }

    try {
      _autosendCountThisRun = 0;
      const reviewedLabel = getReviewedLabel();
      const threads = _GmailApp.search(SCAN_QUERY);
      let processed = 0;

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

          reviewMessage(msg);
          processed++;
        }

        if (sawEveryUnreadMessage) {
          thread.addLabel(reviewedLabel);
        }
      }

      Logger.log(`✅ Aedile scan complete. Reviewed ${processed} new message(s), ${_autosendCountThisRun} auto-sent. No message was marked read.`);
    } finally {
      lock.releaseLock();
    }
  }

  return {
    scanUnread,
    reviewMessage,
    setGmailApp,
    // Shared with BumpChecker.js so it doesn't duplicate thread-rendering /
    // labeling logic, or the auto-send allowlist check, for its own,
    // differently-scheduled Claude calls.
    extractEmail,
    buildThreadContent,
    getFlaggedLabel,
    isAllowlistEligible
  };
})();

function scanInbox() {
  InboxProcessor.scanUnread();
}

/**
 * One-time setup: installs an hourly time-driven trigger for scanInbox().
 * Safe to re-run — clears any existing scanInbox trigger first so this
 * never creates duplicates.
 */
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

/**
 * Read-only guardrail check — select this in the editor's function
 * dropdown, run it, and read the execution log. Doesn't mutate anything;
 * surfaces exactly what the auto-send exception would see on its next
 * run, so a typo'd domain or an accidentally-empty allowlist shows up
 * before it matters rather than during a live test.
 */
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

/**
 * TEMPORARY testing toggle — turns on the AEDILE_CONTEXT_TESTING override
 * (SystemPrompt._testingOverride), which suspends dead-season silence for the
 * whitelisted director loop so the draft/auto-send path can be tested live.
 * Off by default; ALWAYS run disableTestingMode() when the test is done.
 */
function enableTestingMode() {
  PropertiesService.getScriptProperties().setProperty('TESTING_MODE', 'true');
  Logger.log('🧪 TESTING_MODE on — dead-season restraint suspended for the whitelisted loop. Remember to disable when done.');
}

function disableTestingMode() {
  PropertiesService.getScriptProperties().deleteProperty('TESTING_MODE');
  Logger.log('✅ TESTING_MODE off — normal restraint restored.');
}
