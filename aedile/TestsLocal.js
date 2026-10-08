// TestsLocal.js -- local regression suite for Aedile's pure-logic pieces.
//
//   node TestsLocal.js
//
// Re-declares the functions under test inline (plain node cannot load Apps
// Script globals). When you change the real logic, mirror the change here or
// this suite will silently test stale logic.

// --- Inline copies of the functions under test (see InboxProcessor.js) ---

function extractEmail(header) {
  const matches = String(header).match(/<([^<>]+)>/g);
  const last = matches && matches[matches.length - 1];
  return (last ? last.slice(1, -1) : header).toLowerCase().trim();
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

console.log('extractEmail — display-name spoofing of the allowlist (#61, 2026-09-25)');
{
  // extractEmail takes the LAST bracketed group: a display name containing
  // <zach@nomac.org> must not make a stranger read as allowlisted.
  const allowlist = ['zach@nomac.org', 'tyler@nomac.org', 'kreweofvaporwave@kreweofvaporwave.com'];

  assertEqual(extractEmail('Zachary Pine <zach@nomac.org>'), 'zach@nomac.org',
    'an ordinary display name still yields the real address');
  assertEqual(extractEmail('plain@nomac.org'), 'plain@nomac.org',
    'a bare address with no brackets is unchanged');

  const spoofed = '"Zach <zach@nomac.org>" <evil@example.com>';
  assertEqual(extractEmail(spoofed), 'evil@example.com',
    'a bracketed address inside the display name does NOT win over the real one');
  assertEqual(matchesAllowlist(extractEmail(spoofed), allowlist), false,
    'the spoofed header does not match the allowlist');

  // The whole point: such a thread must not become autosend-eligible.
  const spoofedThread = mockThread([
    mockMessage({ from: spoofed, to: 'kreweofvaporwave@kreweofvaporwave.com' }),
  ]);
  assertEqual(isAllowlistEligible(spoofedThread, allowlist), false,
    'a thread whose only outside sender spoofs an allowlisted display name is NOT eligible');

  // Suffix matching was already sound; kept here so a future "fix" to
  // matchesAllowlist cannot quietly widen it.
  assertEqual(matchesAllowlist('evil@notnomac.org', ['@nomac.org']), false,
    'an @domain entry does not match a domain that merely ends with it');
  assertEqual(matchesAllowlist('x@evil.nomac.org', ['@nomac.org']), false,
    'an @domain entry does not match a subdomain');
}

console.log('getRecipientCompletion — recipient-completion bug (2026-07-22)');
{
  // getRecipientCompletion returns the full historical participant set,
  // regardless of which message is last.
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

console.log('\nWriteApi.strictBool — a misread safety flag must not mean "no safety"');
{
  // Inline copy of WriteApi.js's strictBool. An unrecognised dryRun value must
  // not run for real on an endpoint that can auto-send mail.
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

console.log('\nWriteApi.chooseDraftForm — the createDraft sink picks exactly one shape');
{
  // Inline copy of WriteApi.js's chooseDraftForm. Reply and originate are
  // mutually exclusive; anything ambiguous returns { error }.
  function chooseDraftForm(params) {
    const hasThread = !!params.threadId;
    const hasOriginate = !!params.to || !!params.subject;
    if (hasThread && hasOriginate) {
      return { error: 'createDraft takes EITHER threadId (reply) OR to+subject (originate), not both.' };
    }
    if (hasThread) return { form: 'reply' };
    if (params.to && params.subject) return { form: 'originate' };
    if (hasOriginate) {
      return { error: 'createDraft (originate form) requires BOTH to and subject alongside a body.' };
    }
    return { error: 'createDraft requires either threadId (reply) or to+subject (originate).' };
  }

  assertEqual(chooseDraftForm({ threadId: 'abc' }).form, 'reply', 'threadId alone is the reply form');
  assertEqual(chooseDraftForm({ to: 'a@x.org', subject: 'hi' }).form, 'originate', 'to+subject is the originate form (the recap sink)');
  assertTrue(chooseDraftForm({ threadId: 'abc', to: 'a@x.org' }).error, 'threadId + to is refused as ambiguous, not guessed at');
  assertTrue(chooseDraftForm({ to: 'a@x.org' }).error, 'to without subject is refused, not a half-originate');
  assertTrue(chooseDraftForm({ subject: 'hi' }).error, 'subject without to is refused, not a half-originate');
  assertTrue(chooseDraftForm({}).error, 'neither shape is refused rather than drafting nothing');
}

console.log('\nWriteApi.chooseBody — one body, plain XOR html; recap goes plain so `<3` survives');
{
  // Inline copy of WriteApi.js's chooseBody: exactly one of `body` (plain) or `htmlBody`.
  function chooseBody(params) {
    const hasHtml = params.htmlBody !== undefined && params.htmlBody !== '';
    const hasPlain = params.body !== undefined && params.body !== '';
    if (hasHtml && hasPlain) return { error: 'createDraft takes EITHER body (plain) OR htmlBody, not both.' };
    if (hasHtml) return { html: params.htmlBody };
    if (hasPlain) return { plain: params.body };
    return { error: 'createDraft requires a body (plain text) or htmlBody (POST it as a form field).' };
  }

  assertEqual(chooseBody({ body: 'thanks all\n\n<3 SM' }).plain, 'thanks all\n\n<3 SM', 'a plain body routes to the plain path, `<3 SM` untouched');
  assertEqual(chooseBody({ htmlBody: '<p>hi</p>' }).html, '<p>hi</p>', 'an htmlBody routes to the html path');
  assertTrue(chooseBody({ body: 'x', htmlBody: '<p>x</p>' }).error, 'both body and htmlBody is refused, not silently preferred');
  assertTrue(chooseBody({}).error, 'no body at all is refused rather than drafting an empty message');
  assertTrue(chooseBody({ body: '' }).error, 'an empty-string body counts as absent');
}

console.log('\nWriteApi.sendGate — the send primitive fails closed, master kill first');
{
  // Inline copy of WriteApi.js's sendGate: a refusal reason, or null when a
  // send may proceed. The guardrail last line for sendReplyAll.
  function sendGate(aedileEnabled, allowlistEligible) {
    if (!aedileEnabled) return 'AEDILE_ENABLED is not "true" — master kill switch is off.';
    if (!allowlistEligible) {
      return 'thread failed isAllowlistEligible — AUTOSEND_ENABLED off, empty AUTOSEND_ALLOWLIST, or a participant outside it.';
    }
    return null;
  }

  assertEqual(sendGate(true, true), null, 'kill switch on + allowlist-eligible → may send (null)');
  assertTrue(sendGate(false, true), 'master kill switch off refuses even an allowlist-eligible thread');
  assertTrue(sendGate(true, false), 'a non-allowlisted participant refuses the send');
  assertTrue(sendGate(false, false), 'both off refuses');
  // Master kill switch is reported before the allowlist so flipping
  // AEDILE_ENABLED off is an unambiguous, single-cause stop.
  assertTrue(sendGate(false, false).indexOf('AEDILE_ENABLED') === 0, 'master kill switch is the reason reported when both fail');
}

console.log('\nWriteApi.capRefusal — sends stop at the daily cap');
{
  // The real function, out of WriteApi.js.
  const src = (await import('node:fs')).readFileSync(new URL('./WriteApi.js', import.meta.url), 'utf8');
  const { capRefusal } = new Function(src + '\nreturn WRITE_API;')();

  const four = ['armed_draft_sent', 'reply_sent', 'bump_auto_reply', 'auto_reply'];
  assertEqual(capRefusal([]), null, 'no sends → may send');
  assertEqual(capRefusal(four), null, 'four sends → may send');
  assertTrue(capRefusal(four.concat('reply_sent')), 'the fifth send in the window refuses the next');
  assertEqual(capRefusal(four.concat(['headsup_draft', 'recap_draft_posted', 'no_action', 'error'])), null, 'drafts and reviews do not count');
}

console.log('\nLoops.js nextRowId — ids are never reused');
{
  // Inline copy of Loops.js's nextRowId (plain node cannot load Apps Script
  // globals; mirror any change there here).
  function nextRowId(ids, prefix) {
    let max = 0;
    ids.forEach(id => {
      const m = String(id).match(new RegExp('^' + prefix + '-(\\d+)$'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return prefix + '-' + (max + 1);
  }

  assertEqual(nextRowId([], 'L'), 'L-1', 'an empty tab starts at 1');
  assertEqual(nextRowId(['L-1', 'L-2'], 'L'), 'L-3', 'next after the highest');
  assertEqual(nextRowId(['L-1', 'L-7'], 'L'), 'L-8', 'a gap is not refilled, so a closed id is never reused');
  assertEqual(nextRowId(['L-9', 'L-10'], 'L'), 'L-11', 'numeric, not string, comparison');
  assertEqual(nextRowId(['R-4', '', 'junk'], 'L'), 'L-1', 'another prefix and stray cells are ignored');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
