/**
 * BumpChecker.js
 * Daily tier that revisits threads InboxProcessor's regular triage call
 * flagged as open loops (see OpenLoops.js) and are now due for a recheck.
 * Makes one Claude call per due thread — the same draft/flag/no_action
 * decision shape as triage, via AEDILE_BUMP_PROMPT_LIST/_DM (split by
 * InboxProcessor.classifyAudience on the thread's last message, same as
 * triage — see SystemPrompt.js) — and always re-upserts
 * OpenLoops with the model's fresh open_loop/recheck_after_days call,
 * whether or not it decides to actually bump.
 *
 * A draft_reply bump auto-sends under the same allowlist condition as
 * InboxProcessor's auto-send exception (InboxProcessor.isAllowlistEligible)
 * — the allowlist itself is the safety boundary (every participant on the
 * thread has to already be Zach, Tyler, and/or the krewe address), so
 * reusing it here doesn't widen the blast radius, just extends where the
 * same closed-loop condition applies. Runs its own per-run auto-send cap
 * (_autosendCountThisRun / MAX_BUMP_AUTOSEND_PER_RUN below), separate from
 * InboxProcessor's, since checkBumps() fires on its own daily trigger.
 */

const BUMP_ENABLED_PROPERTY = 'BUMP_ENABLED';
// Its own per-run cap, same reasoning as MAX_MESSAGES_PER_RUN /
// MAX_AUTOSEND_PER_RUN in InboxProcessor.js.
const MAX_BUMPS_PER_RUN = 10;
// Auto-send cap for this tier specifically — deliberately separate from
// InboxProcessor's MAX_AUTOSEND_PER_RUN / _autosendCountThisRun, since the
// two tiers run on independent triggers and sharing a counter would make
// one tier's cap depend on unrelated timing from the other.
const MAX_BUMP_AUTOSEND_PER_RUN = 5;

const BumpChecker = (function () {
  let _autosendCountThisRun = 0;

  function isEnabled() {
    return PropertiesService.getScriptProperties().getProperty(BUMP_ENABLED_PROPERTY) === 'true';
  }

  /**
   * Same shape as InboxProcessor's buildUserContent, but framed around a
   * stalled thread rather than a new message — includes how long it's been
   * quiet and whether/when it was last bumped, so the model can weigh
   * "already tried this" instead of nudging on repeat.
   */
  function buildBumpUserContent(thread, loopRow, idleDays) {
    const historyBlock = MessageLog.buildHistoryBlock(MESSAGE_LOG_WINDOW_DAYS);
    const statusBlock = `THREAD STATUS: quiet for ${idleDays} day(s) since the last message. `
      + (loopRow.lastBumpDate ? `Last bumped on ${new Date(loopRow.lastBumpDate).toDateString()}.` : 'Never bumped before.');

    const threadContent = InboxProcessor.buildThreadContent(thread, null);

    return `${historyBlock}\n\n${'='.repeat(20)}\n\n${statusBlock}\n\nTHREAD BEING CHECKED FOR A BUMP:\n\n${threadContent}`;
  }

  /**
   * One due thread: ask Claude whether it's worth a nudge, act on the
   * decision (draft, or auto-send if the thread passes
   * InboxProcessor.isAllowlistEligible and this run is under
   * MAX_BUMP_AUTOSEND_PER_RUN, or flag), and re-upsert OpenLoops either way
   * so a "no, still fine" call still pushes the next check out rather than
   * re-asking every single day.
   */
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

    // Not a new message — LastMessageDate is carried forward unchanged so
    // idleDays keeps counting from the actual last real activity, not from
    // this check.
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

  /**
   * Entry point for the daily trigger. Reads OpenLoops for threads due for
   * a recheck, caps the batch at MAX_BUMPS_PER_RUN (excess picked up next
   * run, not dropped), and reviews each one independently — one thread's
   * failure doesn't stop the rest.
   */
  function checkBumps(dryRun, ignoreDue) {
    if (!isEnabled()) {
      Logger.log('⏸️ Bump checking is disabled (Script Property BUMP_ENABLED is not "true"). Skipping run.');
      return { skipped: 'disabled' };
    }

    // Same guard, same reason as InboxProcessor.scanUnread() — an
    // overlapping run must not get its own fresh _autosendCountThisRun.
    // Shared script lock, so a bump run and a scan run also can't overlap.
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

/**
 * One-time setup: installs a daily time-driven trigger for checkBumps().
 * Safe to re-run — clears any existing checkBumps trigger first so this
 * never creates duplicates. Separate from installTrigger() (InboxProcessor's
 * hourly scanInbox trigger) so the two cadences are independent.
 */
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
