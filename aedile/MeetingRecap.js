// MeetingRecap.js -- turns a meeting transcript into a recap DRAFT addressed to
// the krewe list, for a director to read, edit and send.
// It originates a thread and writes to a recipient outside AUTOSEND_ALLOWLIST;
// both are allowed only because its one Gmail mutation is GmailApp.createDraft().
// Do not add the list address to the allowlist: a Google Group hides its members
// behind one string and would mask the fan-out the allowlist exists to bound.
// It does not call MessageLog.append: the recap is institutional memory, the
// transcript is not.

// The list, not the Workspace account Aedile runs as.
const RECAP_RECIPIENT = 'kreweofvaporwave@googlegroups.com';

// Own kill switch: AEDILE_ENABLED and BUMP_ENABLED do not cover this tier.
// Off/unset means off.
const RECAP_ENABLED_PROPERTY = 'RECAP_ENABLED';

// A recap is a long-form document, not a JSON verdict.
const RECAP_MAX_TOKENS = 4000;

// Floor against an empty or truncated transcript producing a confident recap of nothing.
const MIN_TRANSCRIPT_CHARS = 500;

const MeetingRecap = (function () {

  function isEnabled() {
    return PropertiesService.getScriptProperties().getProperty(RECAP_ENABLED_PROPERTY) === 'true';
  }

  // Renders open_questions into the body so what the meeting did not settle
  // survives into the draft.
  function appendOpenQuestions(body, openQuestions) {
    if (!openQuestions || !openQuestions.length) return body;
    const items = openQuestions.map(q => `  - ${q}`).join('\n');
    const block = `Still open:\n${items}`;

    // The sign-off stays last: the block goes above it.
    const SIGNOFF_LINE = /^(?:(?:<3[ \t]*)+|(?:<3[ \t]*)*SM)$/;
    const lines = body.replace(/\s+$/, '').split('\n');
    const signOff = [];
    // The sign-off can be one line (`<3 SM`) or two (`<3` then `SM`).
    while (lines.length) {
      const last = lines[lines.length - 1].trim();
      if (last === '') { lines.pop(); continue; }
      if (!SIGNOFF_LINE.test(last)) break;
      signOff.unshift(last);
      lines.pop();
    }
    // No sign-off to protect: append as before rather than inventing a position.
    if (!signOff.length) return `${body}\n\n${block}`;
    return `${lines.join('\n').replace(/\s+$/, '')}\n\n${block}\n\n${signOff.join('\n')}`;
  }

  // One transcript in, one Gmail draft out. dryRun runs the model call and creates nothing.
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

    if (!decision.subject || !decision.body) {
      const why = 'model returned no subject or no body';
      Logger.log(`[MeetingRecap] ${why} — nothing drafted.`);
      if (!dryRun) Config.logEvent('', 'recap', RECAP_RECIPIENT, String(decision.subject || ''), 'recap_error', why);
      return { error: why, decision };
    }

    const body = appendOpenQuestions(decision.body, decision.open_questions);

    if (dryRun) {
      Logger.log(`[MeetingRecap] DRY RUN — would GmailApp.createDraft(${RECAP_RECIPIENT}) and nothing else`);
      return { dryRun: true, decision, wouldSendTo: RECAP_RECIPIENT };
    }

    // The ONLY Gmail mutation in this file. Never .send(), never replyAll().
    // Plain body, no htmlBody: `<3` would need escaping.
    GmailApp.createDraft(RECAP_RECIPIENT, decision.subject, body);

    Config.logEvent(
      '', 'recap', RECAP_RECIPIENT, decision.subject,
      `recap_draft_${decision.confidence || 'unknown'}`,
      decision.reasoning || ''
    );

    Logger.log(`✅ Recap drafted for ${RECAP_RECIPIENT}. NOTHING WAS SENT — a director must open the draft and send it.`);
    return { drafted: true, decision, recipient: RECAP_RECIPIENT };
  }

  // appendOpenQuestions is exposed only for aedile/recap/recap-assembly.test.mjs.
  return { draftRecap, isEnabled, appendOpenQuestions };
})();

// Entry point for WriteApi's setRecapEnabled action. One named property, not a
// general setter: RECAP_ENABLED gates a tier that can only createDraft(), while
// a general setter would reach AEDILE_ENABLED and AUTOSEND_ENABLED, which gate
// auto-send and stay editor-only.
function setRecapEnabled(enabled, dryRun) {
  let want;
  try {
    // Strict parse: "true"/"false" and nothing else.
    want = WRITE_API.strictBool(enabled, 'enabled');
  } catch (err) {
    Logger.log(`[setRecapEnabled] ${err.message} — switch not touched.`);
    return { error: String(err.message) };
  }

  const was = MeetingRecap.isEnabled();

  if (dryRun) {
    Logger.log(`[setRecapEnabled] DRY RUN — would set ${RECAP_ENABLED_PROPERTY} ${was} -> ${want}`);
    return { dryRun: true, was, wouldBe: want };
  }

  // Through the existing switches rather than setProperty directly, so the
  // editor route and this one cannot drift apart.
  if (want) enableMeetingRecap();
  else disableMeetingRecap();

  return { was, now: MeetingRecap.isEnabled() };
}

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

// Entry point for WriteApi's draftRecap action. No time-driven trigger.
function draftRecap(transcript, dryRun) {
  return MeetingRecap.draftRecap(transcript, dryRun);
}
