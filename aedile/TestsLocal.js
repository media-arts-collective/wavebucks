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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
