// BumpChecker.js -- daily tier that revisits threads triage flagged as open
// loops (OpenLoops.js) and that are now due. One Claude call per due thread;
// always re-upserts OpenLoops with the fresh decision.
// A draft_reply bump auto-sends only under InboxProcessor.isAllowlistEligible,
// with its own per-run cap (MAX_BUMP_AUTOSEND_PER_RUN).

const BUMP_ENABLED_PROPERTY = 'BUMP_ENABLED';
// Its own per-run cap.
const MAX_BUMPS_PER_RUN = 10;
// Separate from InboxProcessor's auto-send cap: the two tiers run on independent triggers.
const MAX_BUMP_AUTOSEND_PER_RUN = 5;

const BumpChecker = (function () {
  let _autosendCountThisRun = 0;

  function isEnabled() {
    return PropertiesService.getScriptProperties().getProperty(BUMP_ENABLED_PROPERTY) === 'true';
  }

  // Like InboxProcessor's buildUserContent, framed around a stalled thread: how
  // long it has been quiet and whether it was last bumped.
  function buildBumpUserContent(thread, loopRow, idleDays) {
    const historyBlock = MessageLog.buildHistoryBlock(MESSAGE_LOG_WINDOW_DAYS);
    const statusBlock = `THREAD STATUS: quiet for ${idleDays} day(s) since the last message. `
      + (loopRow.lastBumpDate ? `Last bumped on ${new Date(loopRow.lastBumpDate).toDateString()}.` : 'Never bumped before.');

    const threadContent = InboxProcessor.buildThreadContent(thread, null);

    return `${historyBlock}\n\n${'='.repeat(20)}\n\n${statusBlock}\n\nTHREAD BEING CHECKED FOR A BUMP:\n\n${threadContent}`;
  }

  // One due thread: ask whether it is worth a nudge, act (draft, auto-send if
  // allowlist-eligible and under the cap, or flag), and re-upsert OpenLoops
  // either way so the next check is pushed out.
  function reviewForBump(loopRow, dryRun) {
    const threadId = loopRow.threadId;

    let thread;
    try {
      thread = GmailApp.getThreadById(threadId);
    } catch (err) {
      Logger.log(`[BumpChecker] GmailApp.getThreadById(${threadId}) FAILED — ${err.stack || err}`);
      return { threadId, error: String(err) };
    }
    if (!thread) {
      Logger.log(`[BumpChecker] thread ${threadId} not found (deleted?) — skipping.`);
      return { threadId, error: 'thread not found' };
    }

    const idleDays = Math.floor((new Date() - new Date(loopRow.lastMessageDate)) / (24 * 60 * 60 * 1000));

    const messages = thread.getMessages();
    const lastMsg = messages[messages.length - 1];
    const audience = InboxProcessor.classifyAudience(lastMsg);
    const bumpPrompt = audience === 'dm' ? AEDILE_BUMP_PROMPT_DM : AEDILE_BUMP_PROMPT_LIST;

    let decision;
    try {
      decision = AnthropicClient.getJsonDecision(bumpPrompt, buildBumpUserContent(thread, loopRow, idleDays));
      Logger.log(`[BumpChecker]${dryRun ? ' [DRY RUN]' : ''} ${threadId} audience=${audience} decision: ${JSON.stringify(decision)}`);
    } catch (err) {
      Logger.log(`[BumpChecker] AnthropicClient.getJsonDecision FAILED for ${threadId} — ${err.stack || err}`);
      return { threadId, error: String(err) };
    }

    const autoSend = decision.action === 'draft_reply'
      && InboxProcessor.isAllowlistEligible(thread)
      && _autosendCountThisRun < MAX_BUMP_AUTOSEND_PER_RUN;

    if (dryRun) {
      if (autoSend) {
        Logger.log(`[BumpChecker] DRY RUN — would thread.replyAll() (auto-send bump) on ${threadId}`);
        _autosendCountThisRun++;
      } else if (decision.action === 'draft_reply') {
        Logger.log(`[BumpChecker] DRY RUN — would lastMsg.createDraftReply() on ${threadId}`);
      } else if (decision.action === 'flag') {
        Logger.log(`[BumpChecker] DRY RUN — would thread.addLabel(aedile-flagged) on ${threadId}`);
      }
      Logger.log(`[BumpChecker] DRY RUN — would OpenLoops.upsert(open=${!!decision.open_loop}, recheckAfterDays=${decision.recheck_after_days}) on ${threadId}, skipping to avoid contaminating getDue()`);
      Logger.log(`[BumpChecker] DRY RUN — would Config.logEvent(${autoSend ? 'bump_auto_reply' : `bump_${decision.action}`}): ${decision.reasoning}`);
      return { threadId, decision, autoSend: !!autoSend };
    }

    if (autoSend) {
      thread.replyAll('', { htmlBody: decision.draft_body, cc: InboxProcessor.getRecipientCompletion(thread) });
      _autosendCountThisRun++;
      OpenLoops.markBumped(threadId, new Date());
    } else if (decision.action === 'draft_reply') {
      lastMsg.createDraftReply('', { htmlBody: decision.draft_body, cc: InboxProcessor.getRecipientCompletion(thread) });
      OpenLoops.markBumped(threadId, new Date());
    } else if (decision.action === 'flag') {
      thread.addLabel(InboxProcessor.getFlaggedLabel());
    }

    // Not a new message: LastMessageDate is carried forward so idleDays counts
    // from the last real activity.
    OpenLoops.upsert(threadId, {
      open: !!decision.open_loop,
      lastMessageDate: loopRow.lastMessageDate,
      recheckAfterDays: decision.recheck_after_days
    });

    Config.logEvent(
      threadId,
      `bump-${threadId}`,
      InboxProcessor.extractEmail(lastMsg.getFrom()),
      lastMsg.getSubject(),
      autoSend ? 'bump_auto_reply' : `bump_${decision.action}`,
      decision.reasoning
    );

    return { threadId, decision, autoSend: !!autoSend };
  }

  // Entry point for the daily trigger. Caps the batch at MAX_BUMPS_PER_RUN
  // (excess is picked up next run); one thread's failure does not stop the rest.
  function checkBumps(dryRun, ignoreDue) {
    if (!isEnabled()) {
      Logger.log('⏸️ Bump checking is disabled (Script Property BUMP_ENABLED is not "true"). Skipping run.');
      return { skipped: 'disabled' };
    }

    // Same lock as InboxProcessor.scanUnread(): an overlapping run must not get
    // a fresh _autosendCountThisRun.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      Logger.log('⏸️ checkBumps skipped — could not acquire the script lock (another run is still in progress).');
      return { skipped: 'locked' };
    }

    try {
      _autosendCountThisRun = 0;
      const due = OpenLoops.getDue(new Date(), { ignoreDue });
      const toProcess = due.slice(0, MAX_BUMPS_PER_RUN);

      if (due.length > toProcess.length) {
        Logger.log(`⚠️ ${due.length} thread(s) due for a bump check, processing ${toProcess.length} this run (MAX_BUMPS_PER_RUN cap) — the rest will be picked up next run.`);
      }

      const results = toProcess.map(loopRow => {
        try {
          return reviewForBump(loopRow, dryRun);
        } catch (err) {
          Logger.log(`[BumpChecker] UNCAUGHT for ${loopRow.threadId} — ${err.stack || err}`);
          return { threadId: loopRow.threadId, error: String(err) };
        }
      });

      Logger.log(`✅${dryRun ? ' [DRY RUN]' : ''} Bump check complete. Evaluated ${toProcess.length} of ${due.length} due thread(s), ${_autosendCountThisRun} auto-sent.`);
      return { dryRun: !!dryRun, due: due.length, evaluated: toProcess.length, autosent: _autosendCountThisRun, results };
    } finally {
      lock.releaseLock();
    }
  }

  return { checkBumps };
})();

function checkBumps(dryRun, ignoreDue) {
  return BumpChecker.checkBumps(!!dryRun, !!ignoreDue);
}

// One-time setup: installs a daily trigger for checkBumps(). Safe to re-run.
function installBumpTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkBumps')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('checkBumps')
    .timeBased()
    .everyDays(1)
    .create();

  Logger.log('✅ Installed daily trigger for checkBumps().');
}

/** Kill switch on for the bump-check tier only — independent of AEDILE_ENABLED and AUTOSEND_ENABLED */
function enableBumpChecking() {
  PropertiesService.getScriptProperties().setProperty(BUMP_ENABLED_PROPERTY, 'true');
  Logger.log('✅ Bump checking enabled.');
}

/** Kill switch off for the bump-check tier only */
function disableBumpChecking() {
  PropertiesService.getScriptProperties().setProperty(BUMP_ENABLED_PROPERTY, 'false');
  Logger.log('⏸️ Bump checking disabled.');
}
