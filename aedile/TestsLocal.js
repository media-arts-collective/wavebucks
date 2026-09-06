/**
 * TestsLocal.js
 * Fast local regression suite for Aedile's pure-logic pieces, run with
 * plain `node TestsLocal.js` — no Google Apps Script dependencies, no
 * live ReadApi/WriteApi calls, no secrets. Mirrors the pattern already
 * established in scribaSenatus/TestsLocal.js: self-contained, re-declares
 * the functions under test inline (plain node cannot load Apps Script
 * globals from the real .js files), with mocked GmailApp/PropertiesService/
 * Session objects standing in for the real services.
 *
 * When you change the real logic in InboxProcessor.js (getThreadParticipants,
 * getRecipientCompletion, isAllowlistEligible, classifyAudience), mirror the
 * change here or this suite will silently test stale logic.
 *
 * This is the first piece of the scenario library discussed in
 * .scheduler/FOCUS.md's backlog item 2 — the part that needs no live data
 * or secrets, so it should run on every cycle regardless of network/API
 * availability. Live-data dry-run scenarios (against real OpenLoops/
 * Messages via ReadApi/WriteApi) are a separate, second piece, not yet
 * built — see FOCUS.md.
 */

// --- Inline copies of the functions under test (see InboxProcessor.js) ---

function extractEmail(header) {
  const match = header.match(/<([^>]+)>/);
  return (match ? match[1] : header).toLowerCase().trim();
}

function getThreadParticipants(thread) {
  const participants = new Set();
  thread.getMessages().forEach(m => {
    participants.add(extractEmail(m.getFrom()));
    (m.getTo() || '').split(',').forEach(a => a.trim() && participants.add(extractEmail(a)));
    (m.getCc() || '').split(',').forEach(a => a.trim() && participants.add(extractEmail(a)));
  });
  return Array.from(participants);
}

function getRecipientCompletion(thread, effectiveUserEmail) {
  const self = effectiveUserEmail.toLowerCase();
  return getThreadParticipants(thread).filter(addr => addr !== self).join(',');
}

function matchesAllowlist(address, allowlist) {
  const addr = address.toLowerCase();
  return allowlist.some(entry => entry.startsWith('@') ? addr.endsWith(entry) : addr === entry);
}

function isAllowlistEligible(thread, allowlist) {
  if (!allowlist.length) return false;
  return getThreadParticipants(thread).every(addr => matchesAllowlist(addr, allowlist));
}

const DM_RECIPIENT_THRESHOLD = 3;

function classifyAudience(msg) {
  const recipients = new Set();
  (msg.getTo() || '').split(',').forEach(a => a.trim() && recipients.add(extractEmail(a)));
  (msg.getCc() || '').split(',').forEach(a => a.trim() && recipients.add(extractEmail(a)));
  return recipients.size <= DM_RECIPIENT_THRESHOLD ? 'dm' : 'list';
}

// --- Minimal mock helpers ---

function mockMessage({ from, to = '', cc = '' }) {
  return {
    getFrom: () => from,
    getTo: () => to,
    getCc: () => cc,
  };
}

function mockThread(messages) {
  return { getMessages: () => messages };
}

// --- Test harness ---

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected: ${e}`);
    console.log(`       actual:   ${a}`);
  }
}

function assertTrue(actual, label) {
  assertEqual(!!actual, true, label);
}

// --- Scenarios ---

console.log('InboxProcessor pure-logic regression suite\n');

console.log('getRecipientCompletion — recipient-completion bug (2026-07-22)');
{
  // Regression case for the real bug found 2026-07-22: a real bump email
  // reached Tyler but never reached Zach. Root cause: the LAST message in
  // the thread only carried tyler@nomac.org and the krewe address — Zach
  // only appeared on an EARLIER message. thread.replyAll()/createDraftReply()
  // only address the last message's participants natively, so the fix is
  // that getRecipientCompletion must return the FULL historical set,
  // including Zach, regardless of which message is last.
  const thread = mockThread([
    mockMessage({ from: 'zach@nomac.org', to: 'tyler@nomac.org, kreweofvaporwave@kreweofvaporwave.com' }),
    mockMessage({ from: 'kreweofvaporwave@kreweofvaporwave.com', to: 'zach@nomac.org, tyler@nomac.org' }),
    // Last message: Zach is NOT a To/Cc/From here, unlike the two above.
    mockMessage({ from: 'tyler@nomac.org', to: 'kreweofvaporwave@kreweofvaporwave.com' }),
  ]);
  const cc = getRecipientCompletion(thread, 'kreweofvaporwave@kreweofvaporwave.com');
  const ccList = cc.split(',');
  assertTrue(ccList.includes('zach@nomac.org'), 'cc includes zach@nomac.org even though absent from the last message');
  assertTrue(ccList.includes('tyler@nomac.org'), 'cc includes tyler@nomac.org');
  assertEqual(ccList.includes('kreweofvaporwave@kreweofvaporwave.com'), false, 'cc excludes the effective user\'s own address');
}

console.log('\nisAllowlistEligible');
{
  const allowlist = ['zach@nomac.org', 'tyler@nomac.org', 'kreweofvaporwave@kreweofvaporwave.com'];
  const eligibleThread = mockThread([
    mockMessage({ from: 'zach@nomac.org', to: 'tyler@nomac.org, kreweofvaporwave@kreweofvaporwave.com' }),
  ]);
  assertTrue(isAllowlistEligible(eligibleThread, allowlist), 'thread with only allowlisted participants is eligible');

  const ineligibleThread = mockThread([
    mockMessage({ from: 'zach@nomac.org', to: 'tyler@nomac.org, someoutsider@example.com' }),
  ]);
  assertEqual(isAllowlistEligible(ineligibleThread, allowlist), false, 'a single outside participant disqualifies the whole thread');

  assertEqual(isAllowlistEligible(eligibleThread, []), false, 'empty allowlist never qualifies');
}

console.log('\nclassifyAudience');
{
  const dmMsg = mockMessage({ from: 'zach@nomac.org', to: 'tyler@nomac.org', cc: 'kreweofvaporwave@kreweofvaporwave.com' });
  assertEqual(classifyAudience(dmMsg), 'dm', 'a 2-recipient message classifies as dm');

  const listMsg = mockMessage({
    from: 'zach@nomac.org',
    to: 'kreweofvaporwave@kreweofvaporwave.com',
    cc: 'a@example.com, b@example.com, c@example.com, d@example.com',
  });
  assertEqual(classifyAudience(listMsg), 'list', 'a 5-recipient message classifies as list');
}

console.log('\nOpenLoops._sanitizeRecheckDays — clamping guard');
{
  // Inline copy of OpenLoops.js's private _sanitizeRecheckDays (see
  // OpenLoops.js's MIN/MAX/DEFAULT_RECHECK_DAYS constants). Not a
  // regression case for the actual stale-recheck-window bug found
  // 2026-07-22 (both director-loop threads stuck at recheck_after_days=10)
  // — that was a model-judgment bug (seasonal restraint overriding an
  // explicit blocker), reproducible only against the real API with live
  // OpenLoops/Messages data, which this local suite deliberately can't
  // reach (no secrets/network). This instead covers the one piece of that
  // failure mode that IS pure logic: the clamp that keeps a bad/missing
  // recheck_after_days from parking a loop absurdly far out. The live-data
  // dry-run scenario for the actual bug is still open — see
  // .scheduler/FOCUS.md's Stability milestone checklist.
  const MIN_RECHECK_DAYS = 1;
  const MAX_RECHECK_DAYS = 60;
  const DEFAULT_RECHECK_DAYS = 3;
  function sanitizeRecheckDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n < MIN_RECHECK_DAYS) return DEFAULT_RECHECK_DAYS;
    return Math.min(n, MAX_RECHECK_DAYS);
  }

  assertEqual(sanitizeRecheckDays(10), 10, 'an in-range value passes through unchanged');
  assertEqual(sanitizeRecheckDays(500), MAX_RECHECK_DAYS, 'an absurdly large value clamps to the 60-day max');
  assertEqual(sanitizeRecheckDays(0), DEFAULT_RECHECK_DAYS, 'a zero/sub-minimum value falls back to the 3-day default');
  assertEqual(sanitizeRecheckDays(-5), DEFAULT_RECHECK_DAYS, 'a negative value falls back to the default');
  assertEqual(sanitizeRecheckDays('not a number'), DEFAULT_RECHECK_DAYS, 'a non-numeric value falls back to the default');
  assertEqual(sanitizeRecheckDays(undefined), DEFAULT_RECHECK_DAYS, 'a missing value falls back to the default');
}

console.log('\nWriteApi.strictBool — a misread safety flag must not mean "no safety"');
{
  // Inline copy of WriteApi.js's strictBool (see WriteApi.js).
  //
  // Regression case for the fail-open dryRun parse. The old form was
  // `String(params.dryRun) === 'true'`, so every value it did not recognise
  // read as false and ran FOR REAL — on an endpoint that can auto-send mail
  // via replyAll() with no human between the decision and delivery.
  // `dryRun=1` and `dryRun=ture` are the realistic ways to hit it.
  function strictBool(value, name) {
    if (value === undefined || value === null || value === '') return false;
    const s = String(value);
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw new Error(`${name} must be exactly "true" or "false" (got "${s}").`);
  }

  const refuses = v => {
    try { strictBool(v, 'dryRun'); return false; } catch (err) { return true; }
  };

  assertEqual(strictBool('true', 'dryRun'), true, 'the exact string "true" is a dry run');
  assertEqual(strictBool('false', 'dryRun'), false, 'the exact string "false" is a real run');
  assertEqual(strictBool(undefined, 'dryRun'), false, 'absent stays a real run — no existing caller changes behaviour');
  assertEqual(strictBool('', 'dryRun'), false, 'empty stays a real run');
  assertEqual(refuses('1'), true, 'dryRun=1 is refused, not silently run for real');
  assertEqual(refuses('ture'), true, 'a typo is refused, not silently run for real');
  assertEqual(refuses('yes'), true, 'dryRun=yes is refused, not silently run for real');
  assertEqual(refuses('TRUE'), true, 'a case variant is refused rather than guessed at');
}

console.log('\nMeetingRecap — the two guards that keep a draft from becoming a send');
{
  // Inline copies from MeetingRecap.js (see that file).
  const RECAP_RECIPIENT = 'kreweofvaporwave@googlegroups.com';
  const MIN_TRANSCRIPT_CHARS = 500;

  function appendOpenQuestions(bodyHtml, openQuestions) {
    if (!openQuestions || !openQuestions.length) return bodyHtml;
    const items = openQuestions.map(q => `<li>${q}</li>`).join('\n');
    return `${bodyHtml}\n<p><strong>Still open:</strong></p>\n<ul>\n${items}\n</ul>`;
  }

  function tooShort(transcript) {
    return String(transcript || '').trim().length < MIN_TRANSCRIPT_CHARS;
  }

  // The recipient is the LIST, not the Workspace account Aedile runs as.
  // Confusing the two sends krewe mail to Aedile's own inbox, where nobody
  // reads it — and it is one character of difference in a plausible typo.
  assertEqual(RECAP_RECIPIENT, 'kreweofvaporwave@googlegroups.com', 'recap is addressed to the Google Group');
  assertEqual(RECAP_RECIPIENT === 'kreweofvaporwave@kreweofvaporwave.com', false, 'recap is NOT addressed to Aedile\'s own Workspace inbox');

  // A silent upstream failure (whisper returning nothing, a truncated upload)
  // must not produce a confident recap of an empty meeting.
  assertTrue(tooShort(''), 'an empty transcript is refused');
  assertTrue(tooShort('   \n  '), 'a whitespace-only transcript is refused');
  assertTrue(tooShort('we met and talked about the parade'), 'a one-line transcript is refused');
  assertEqual(tooShort('x'.repeat(MIN_TRANSCRIPT_CHARS)), false, 'a transcript at the floor is accepted');

  // Open questions must survive into the draft. The recap context tells the
  // model to report what the meeting did NOT settle rather than resolve it;
  // dropping them here would quietly undo that instruction.
  const body = appendOpenQuestions('<p>1. THE LIVESTREAM. Building Sunday at 1.</p>', ['Who is getting the tires?']);
  assertTrue(body.includes('Who is getting the tires?'), 'an open question reaches the draft body');
  assertTrue(body.includes('Still open:'), 'open questions are labelled, not silently appended');
  assertEqual(
    appendOpenQuestions('<p>body</p>', []),
    '<p>body</p>',
    'no open questions adds no empty section'
  );
  assertEqual(
    appendOpenQuestions('<p>body</p>', undefined),
    '<p>body</p>',
    'a missing open_questions field is not an error'
  );
}

console.log('\nMeetingRecap.createDraft — the sink takes a finished recap and can still refuse it');
{
  // Inline copies from MeetingRecap.js (see that file). Change one, change both.
  const RECAP_RECIPIENT = 'kreweofvaporwave@googlegroups.com';
  const RECAP_ENABLED_PROPERTY = 'RECAP_ENABLED';

  function appendOpenQuestions(bodyHtml, openQuestions) {
    if (!openQuestions || !openQuestions.length) return bodyHtml;
    const items = openQuestions.map(q => `<li>${q}</li>`).join('\n');
    return `${bodyHtml}\n<p><strong>Still open:</strong></p>\n<ul>\n${items}\n</ul>`;
  }

  // Stands in for Apps Script's services. `drafts` IS the assertion: this
  // suite's whole question is whether a given input reaches the mailbox.
  let drafts = [];
  let enabled = true;
  const Logger = { log: () => {} };
  const Config = { logEvent: () => {} };
  const GmailApp = { createDraft: (to, subject, plain, opts) => drafts.push({ to, subject, opts }) };
  const isEnabled = () => enabled;

  function createDraft(draftJson, dryRun) {
    if (!isEnabled()) {
      Logger.log(`⏸️ Meeting recap is disabled (Script Property ${RECAP_ENABLED_PROPERTY} is not "true"). Skipping.`);
      return { skipped: 'disabled' };
    }
    let draft;
    try {
      draft = JSON.parse(draftJson);
    } catch (err) {
      const why = `draft is not JSON: ${err.message}`;
      Logger.log(`[createDraft] ${why} — nothing drafted.`);
      return { error: why };
    }
    const subject = String(draft.subject || '').trim();
    const bodyHtml = String(draft.body_html || '').trim();
    if (!subject || !bodyHtml) {
      const why = 'draft needs both a subject and a body_html';
      Logger.log(`[createDraft] ${why} — nothing drafted.`);
      return { error: why };
    }
    const html = appendOpenQuestions(bodyHtml, draft.open_questions);
    if (dryRun) {
      Logger.log(`[createDraft] DRY RUN — would GmailApp.createDraft(${RECAP_RECIPIENT}) and nothing else`);
      return { dryRun: true, wouldSendTo: RECAP_RECIPIENT, subject };
    }
    GmailApp.createDraft(RECAP_RECIPIENT, subject, '', { htmlBody: html });
    Config.logEvent(
      '', 'recap', RECAP_RECIPIENT, subject, 'recap_draft_posted',
      'written by aedile/recap/redige.mjs on mandark'
    );
    Logger.log(`✅ Recap drafted for ${RECAP_RECIPIENT}. NOTHING WAS SENT — a director must open the draft and send it.`);
    return { drafted: true, recipient: RECAP_RECIPIENT, subject };
  }

  const good = JSON.stringify({
    subject: '1. LASER HARP: a playable machine by next month',
    body_html: '<p>1. LASER HARP. Working group is Tyler, Zach and Adam.</p>',
    open_questions: ['Relays or not — slated for the next monthly meeting.'],
  });

  // The kill switch has to cover BOTH ways a recap can be written. A sink that
  // honoured no switch would be a hole in RECAP_ENABLED reachable by anyone
  // holding the write token.
  const reset = () => { drafts = []; enabled = true; };
  reset(); enabled = false;
  assertEqual(createDraft(good, false), { skipped: 'disabled' }, 'RECAP_ENABLED off refuses a perfectly good draft');
  assertEqual(drafts.length, 0, 'and nothing reached the mailbox');

  // A body that arrived truncated must fail whole rather than half-drafted.
  reset();
  assertTrue(createDraft('{"subject": "half a p', false).error, 'a truncated body is refused');
  assertTrue(createDraft('', false).error, 'an empty payload is refused');
  assertTrue(createDraft('{"subject": "x", "body_html": ""}', false).error, 'a subject with no body is refused');
  assertTrue(createDraft('{"body_html": "<p>x</p>"}', false).error, 'a body with no subject is refused');
  assertTrue(createDraft('{"subject": "   ", "body_html": "  "}', false).error, 'whitespace is not content');
  assertEqual(drafts.length, 0, 'no refusal drafted anything');

  // dryRun means the round trip happens and the mailbox does not change.
  reset();
  const dry = createDraft(good, true);
  assertEqual(dry.dryRun, true, 'dryRun reports itself as a dry run');
  assertEqual(dry.wouldSendTo, RECAP_RECIPIENT, 'dryRun names the recipient it would have used');
  assertEqual(drafts.length, 0, 'dryRun writes no draft');

  // The real path: one draft, to the list, with the open questions in it.
  reset();
  const real = createDraft(good, false);
  assertEqual(real.drafted, true, 'a valid draft is filed');
  assertEqual(drafts.length, 1, 'exactly one draft, not one per anything');
  assertEqual(drafts[0].to, RECAP_RECIPIENT, 'addressed to the Google Group, not to a caller-supplied address');
  assertTrue(drafts[0].opts.htmlBody.includes('Still open:'), 'open questions are appended by the sink, not by the generator');
  assertTrue(drafts[0].opts.htmlBody.includes('Relays or not'), 'the open question itself reaches the draft');

  // A recap with nothing left open must not grow an empty section.
  reset();
  createDraft(JSON.stringify({ subject: 's', body_html: '<p>b</p>' }), false);
  assertEqual(drafts[0].opts.htmlBody, '<p>b</p>', 'no open questions adds no section');
}

console.log('\nsetRecapEnabled — a kill switch that can be flipped from outside the editor');
{
  // Inline copies from MeetingRecap.js / WriteApi.js. Change one, change both.
  const RECAP_ENABLED_PROPERTY = 'RECAP_ENABLED';
  let prop = null;                       // stands in for the Script Property
  const Logger = { log: () => {} };
  const MeetingRecap = { isEnabled: () => prop === 'true' };
  const enableMeetingRecap = () => { prop = 'true'; };
  const disableMeetingRecap = () => { prop = 'false'; };

  function strictBool(value, name) {
    if (value === undefined || value === null || value === '') return false;
    const s = String(value);
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw new Error(`${name} must be exactly "true" or "false" (got "${s}").`);
  }
  const WRITE_API = { strictBool };

  function setRecapEnabled(enabled, dryRun) {
    let want;
    try {
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
    if (want) enableMeetingRecap();
    else disableMeetingRecap();
    return { was, now: MeetingRecap.isEnabled() };
  }

  prop = null;
  assertEqual(setRecapEnabled('true', false), { was: false, now: true }, 'unset -> true, and it reports both ends');
  assertEqual(setRecapEnabled('false', false), { was: true, now: false }, 'and back off again — both directions');

  // A misread value must not silently mean "off". Same failure direction the
  // strictBool guard was added for on dryRun.
  prop = 'true';
  for (const bad of ['1', 'yes', 'ture', 'TRUE', 'on']) {
    assertTrue(setRecapEnabled(bad, false).error, `enabled=${bad} is refused, not guessed at`);
  }
  assertEqual(prop, 'true', 'and no refusal moved the switch');

  // Absent reads as false everywhere else in this endpoint, so it does here.
  prop = 'true';
  assertEqual(setRecapEnabled(undefined, false), { was: true, now: false }, 'an absent value is false, consistently with dryRun');

  // dryRun answers what it would do and changes nothing.
  prop = 'false';
  assertEqual(setRecapEnabled('true', true), { dryRun: true, was: false, wouldBe: true }, 'dryRun reports the transition it would make');
  assertEqual(prop, 'false', 'and dryRun leaves the switch alone');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
