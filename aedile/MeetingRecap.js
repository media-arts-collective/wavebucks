/**
 * MeetingRecap.js
 * Third tier: turns a meeting transcript into a recap DRAFT addressed to the
 * krewe mailing list, for a director to read, edit and send.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE OTHER TWO TIERS, and why it is allowed:
 *
 *   - It ORIGINATES a thread. AEDILE_CONTEXT_CORE forbids that. The carve-out
 *     (Zach, 2026-09-06) is bounded by never sending: this file's only Gmail
 *     mutation is GmailApp.createDraft(). A director opens the draft and
 *     presses send, so the human originates the thread and Aedile drafted it
 *     for them. AEDILE_CONTEXT.recap.md states the same rule to the model, so
 *     it is not left reconciling a contradiction on its own.
 *
 *   - It writes to a recipient outside AUTOSEND_ALLOWLIST. That is fine
 *     precisely because it never sends: the allowlist governs auto-send, and
 *     nothing here can auto-send. Note the allowlist could not evaluate this
 *     recipient anyway — isAllowlistEligible matches every individual
 *     participant, and a Google Group hides its ~40 members behind one string,
 *     so adding the list address to the allowlist would read as "everyone
 *     matches" while masking exactly the fan-out the allowlist exists to
 *     bound. Do not do that.
 *
 *   - It does NOT call MessageLog.append. Every triage and bump call injects a
 *     rolling MESSAGE_LOG_WINDOW_DAYS window of the Messages tab, so anything
 *     logged there is re-read by every model call for a year. A 40-minute
 *     transcript is thousands of tokens of verbatim speech; ten meetings would
 *     be a third of the archive's annual growth, carried forever, for no
 *     benefit. The RECAP is institutional memory. The transcript is not.
 *     (Zach, 2026-09-06.)
 */

// Where a recap is addressed. The list, not the Workspace account Aedile runs
// as — those are different addresses and confusing them sends krewe mail to
// Aedile's own inbox.
const RECAP_RECIPIENT = 'kreweofvaporwave@googlegroups.com';

// Own kill switch. AEDILE_ENABLED gates scanInbox and BUMP_ENABLED gates
// checkBumps; neither covers this tier, so without its own switch a director
// could not stop it without stopping something else. Off/unset means off.
const RECAP_ENABLED_PROPERTY = 'RECAP_ENABLED';

// A recap is a long-form document, not a JSON verdict — the other tiers ask
// for a decision plus a sentence and run comfortably in 1000.
const RECAP_MAX_TOKENS = 4000;

// Guards against an empty or truncated transcript producing a confident recap
// of nothing. A real meeting transcribes to far more than this; the number is
// a floor for "something clearly went wrong upstream", not a quality bar.
const MIN_TRANSCRIPT_CHARS = 500;

const MeetingRecap = (function () {

  function isEnabled() {
    return PropertiesService.getScriptProperties().getProperty(RECAP_ENABLED_PROPERTY) === 'true';
  }

  /**
   * Renders the model's open_questions into the body, so what the meeting did
   * NOT settle survives into the draft instead of being quietly dropped. The
   * recap context tells the model to report these rather than resolve them;
   * dropping them here would undo that.
   */
  function appendOpenQuestions(bodyHtml, openQuestions) {
    if (!openQuestions || !openQuestions.length) return bodyHtml;
    const items = openQuestions.map(q => `<li>${q}</li>`).join('\n');
    return `${bodyHtml}\n<p><strong>Still open:</strong></p>\n<ul>\n${items}\n</ul>`;
  }

  /**
   * One transcript in, one Gmail draft out.
   *
   * dryRun runs the full model call and reports what it would have drafted,
   * without creating the draft or writing to Log — same meaning as WriteApi's
   * dryRun on the other two tiers.
   */
  function draftRecap(transcript, dryRun) {
    if (!isEnabled()) {
      Logger.log(`⏸️ Meeting recap is disabled (Script Property ${RECAP_ENABLED_PROPERTY} is not "true"). Skipping.`);
      return { skipped: 'disabled' };
    }

    const text = String(transcript || '').trim();
    if (text.length < MIN_TRANSCRIPT_CHARS) {
      Logger.log(`⏸️ Transcript is ${text.length} chars, under the ${MIN_TRANSCRIPT_CHARS}-char floor — refusing rather than recapping nothing.`);
      return { skipped: 'transcript too short', length: text.length };
    }

    let decision;
    try {
      decision = AnthropicClient.getJsonDecision(AEDILE_RECAP_PROMPT, text, RECAP_MAX_TOKENS);
      Logger.log(`[MeetingRecap]${dryRun ? ' [DRY RUN]' : ''} confidence=${decision.confidence} subject="${decision.subject}"`);
    } catch (err) {
      Logger.log(`[MeetingRecap] AnthropicClient.getJsonDecision FAILED — ${err.stack || err}`);
      if (!dryRun) Config.logEvent('', 'recap', RECAP_RECIPIENT, '', 'recap_error', err.message);
      return { error: String(err) };
    }

    if (!decision.subject || !decision.body_html) {
      const why = 'model returned no subject or no body_html';
      Logger.log(`[MeetingRecap] ${why} — nothing drafted.`);
      if (!dryRun) Config.logEvent('', 'recap', RECAP_RECIPIENT, String(decision.subject || ''), 'recap_error', why);
      return { error: why, decision };
    }

    const body = appendOpenQuestions(decision.body_html, decision.open_questions);

    if (dryRun) {
      Logger.log(`[MeetingRecap] DRY RUN — would GmailApp.createDraft(${RECAP_RECIPIENT}) and nothing else`);
      return { dryRun: true, decision, wouldSendTo: RECAP_RECIPIENT };
    }

    // The ONLY Gmail mutation in this file. Never .send(), never replyAll().
    GmailApp.createDraft(RECAP_RECIPIENT, decision.subject, '', { htmlBody: body });

    Config.logEvent(
      '', 'recap', RECAP_RECIPIENT, decision.subject,
      `recap_draft_${decision.confidence || 'unknown'}`,
      decision.reasoning || ''
    );

    Logger.log(`✅ Recap drafted for ${RECAP_RECIPIENT}. NOTHING WAS SENT — a director must open the draft and send it.`);
    return { drafted: true, decision, recipient: RECAP_RECIPIENT };
  }

  return { draftRecap, isEnabled };
})();

/** Kill switch on for the recap tier only — independent of AEDILE_ENABLED/BUMP_ENABLED */
function enableMeetingRecap() {
  PropertiesService.getScriptProperties().setProperty(RECAP_ENABLED_PROPERTY, 'true');
  Logger.log('✅ Meeting recap enabled. It drafts only; it can never send.');
}

/** Kill switch off for the recap tier only */
function disableMeetingRecap() {
  PropertiesService.getScriptProperties().setProperty(RECAP_ENABLED_PROPERTY, 'false');
  Logger.log('⏸️ Meeting recap disabled.');
}

/**
 * Entry point for WriteApi's draftRecap action (and for a manual run from the
 * editor, though pasting a 40-minute transcript into the editor is nobody's
 * idea of a good time). No time-driven trigger: meetings are not a cadence.
 */
function draftRecap(transcript, dryRun) {
  return MeetingRecap.draftRecap(transcript, dryRun);
}
