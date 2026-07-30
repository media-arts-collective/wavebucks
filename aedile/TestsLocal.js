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

// --- Inline copies of OpenLoops.js's scheduling helpers (see OpenLoops.js) ---
// _sanitizeRecheckDays/getDue's date filter are the mechanical half of the
// 2026-07-22 stale-recheck-window bug (both director-loop threads stuck at
// recheck_after_days=10, never bumped). The bug's actual ROOT CAUSE was a
// model-judgment gap (seasonal "dead month" restraint applying even to an
// explicit, self-stated blocker) fixed in Context.js's prompt text — that
// half can't be regression-tested here without a live API call (see
// FOCUS.md backlog item 2's "live-data dry-run scenarios", not yet built).
// What CAN be tested locally is the mechanical scaffolding the human used to
// recover from it: getDue's ignoreDue bypass (used tonight to re-evaluate
// already-scheduled loops against the fixed prompt without waiting out the
// stale NextCheckDate) and the recheck-day clamp that guards against a
// missing/garbage model value in the first place.

const MIN_RECHECK_DAYS = 1;
const MAX_RECHECK_DAYS = 60;
const DEFAULT_RECHECK_DAYS = 3;

function sanitizeRecheckDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < MIN_RECHECK_DAYS) return DEFAULT_RECHECK_DAYS;
  return Math.min(n, MAX_RECHECK_DAYS);
}

function getDue(rows, now, { ignoreDue } = {}) {
  return rows.filter(r => r.open === true && (ignoreDue || (r.nextCheckDate && new Date(r.nextCheckDate) <= now)));
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

console.log('\ngetDue / sanitizeRecheckDays — stale-recheck-window bug (2026-07-22), mechanical half');
{
  // Regression case for the mechanical scaffolding used to recover from
  // tonight's real bug: a loop scheduled 10 days out (matching the actual
  // stuck threads' RecheckAfterDays value) whose NextCheckDate hasn't
  // arrived yet must NOT show up in a normal getDue() call...
  const now = new Date('2026-07-22T12:00:00Z');
  const stillWaiting = {
    threadId: 'thread-brunch-1', open: true,
    nextCheckDate: new Date('2026-07-28T00:00:00Z'), // set 7/18 + 10 days
  };
  const dueRows = [stillWaiting];
  assertEqual(getDue(dueRows, now).length, 0, 'a loop whose NextCheckDate is still in the future is not due yet');

  // ...but IS returned when ignoreDue is set, which is exactly the escape
  // hatch the human used live to re-evaluate both stuck threads against
  // the fixed DM-tier prompt without waiting out the stale schedule.
  assertEqual(getDue(dueRows, now, { ignoreDue: true }).length, 1, 'ignoreDue surfaces an open loop regardless of its scheduled NextCheckDate');

  // A closed loop is never due, ignoreDue or not — closing a loop must be
  // able to actually stick.
  const closed = { threadId: 'thread-closed', open: false, nextCheckDate: new Date('2026-07-01T00:00:00Z') };
  assertEqual(getDue([closed], now, { ignoreDue: true }).length, 0, 'a closed loop is excluded even with ignoreDue');

  assertEqual(sanitizeRecheckDays(10), 10, 'a valid recheck_after_days value passes through unchanged');
  assertEqual(sanitizeRecheckDays(0), DEFAULT_RECHECK_DAYS, 'a zero/sub-minimum value falls back to the default rather than scheduling an immediate recheck loop');
  assertEqual(sanitizeRecheckDays('not-a-number'), DEFAULT_RECHECK_DAYS, 'a garbage (non-numeric) model value falls back to the default');
  assertEqual(sanitizeRecheckDays(9999), MAX_RECHECK_DAYS, 'an excessive value is clamped to the 60-day ceiling, not trusted outright');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
