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
 * getRecipientCompletion, isAllowlistEligible, classifyAudience) or
 * OpenLoops.js (upsert/getDue), mirror the change here or this suite will
 * silently test stale logic.
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

// --- Inline copy of OpenLoops.js's upsert/getDue (see OpenLoops.js) ---
// Same mechanical sheet-row logic, backed by an in-memory mock sheet instead
// of a real Spreadsheet.

const MIN_RECHECK_DAYS = 1;
const MAX_RECHECK_DAYS = 60;
const DEFAULT_RECHECK_DAYS = 3;

function _sanitizeRecheckDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < MIN_RECHECK_DAYS) return DEFAULT_RECHECK_DAYS;
  return Math.min(n, MAX_RECHECK_DAYS);
}

function mockOpenLoopsSheet() {
  // rows[0] is the header, mirroring a real sheet's getDataRange().getValues().
  const rows = [['ThreadId', 'Open', 'LastMessageDate', 'RecheckAfterDays', 'NextCheckDate', 'LastBumpDate', 'UpdatedAt']];
  return {
    upsert(threadId, { open, lastMessageDate, recheckAfterDays }, now) {
      const recheckDays = _sanitizeRecheckDays(recheckAfterDays);
      const nextCheckDate = new Date(lastMessageDate);
      nextCheckDate.setDate(nextCheckDate.getDate() + recheckDays);
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === threadId) {
          rows[i][1] = open;
          rows[i][2] = lastMessageDate;
          rows[i][3] = recheckDays;
          rows[i][4] = nextCheckDate;
          rows[i][6] = now;
          return;
        }
      }
      rows.push([threadId, open, lastMessageDate, recheckDays, nextCheckDate, '', now]);
    },
    getRow(threadId) {
      const r = rows.find(r => r[0] === threadId);
      return r && { threadId: r[0], open: r[1], lastMessageDate: r[2], recheckAfterDays: r[3], nextCheckDate: r[4], lastBumpDate: r[5] || null };
    },
  };
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

console.log('\nOpenLoops.upsert — stale-recheck-window bug (2026-07-22)');
{
  // Regression case for the second real bug found the 2026-07-22 session:
  // both director-loop threads were stuck at RecheckAfterDays=10 (set
  // 7/18, an explicit blocker never got re-bumped) because the model kept
  // returning a conservative recheck window under seasonal restraint. The
  // fix was prompt-level (DM-tier context now overrides restraint for an
  // explicit blocker), but the mechanism that lets a corrected decision
  // actually take effect is upsert() always OVERWRITING RecheckAfterDays/
  // NextCheckDate from the model's latest call rather than merging with
  // (or preserving) whatever was stored before. If upsert ever regressed
  // to a merge/preserve-on-existing-row behavior, a stale window would
  // get "stuck" again regardless of how good the prompt is — this locks
  // that invariant in place.
  const sheet = mockOpenLoopsSheet();
  const threadId = 'thread-director-loop';
  const firstMessageDate = new Date('2026-07-18T00:00:00Z');

  // Initial (buggy-era) decision: a 10-day recheck window on an explicit blocker.
  sheet.upsert(threadId, { open: true, lastMessageDate: firstMessageDate, recheckAfterDays: 10 }, new Date('2026-07-18T12:00:00Z'));
  const stale = sheet.getRow(threadId);
  assertEqual(stale.recheckAfterDays, 10, 'initial upsert records the stale 10-day window');

  // A later call (fresh model decision, corrected prompt) on the same
  // thread with a shorter, more urgent window and a newer LastMessageDate.
  const secondMessageDate = new Date('2026-07-22T00:00:00Z');
  sheet.upsert(threadId, { open: true, lastMessageDate: secondMessageDate, recheckAfterDays: 2 }, new Date('2026-07-22T09:00:00Z'));
  const fixed = sheet.getRow(threadId);
  assertEqual(fixed.recheckAfterDays, 2, 'later upsert overwrites the stale window with the fresh, shorter one');
  assertEqual(fixed.lastMessageDate, secondMessageDate, 'later upsert overwrites LastMessageDate rather than preserving the first one');

  const expectedNextCheck = new Date(secondMessageDate);
  expectedNextCheck.setDate(expectedNextCheck.getDate() + 2);
  assertEqual(fixed.nextCheckDate.getTime(), expectedNextCheck.getTime(), 'NextCheckDate is derived from the fresh LastMessageDate + fresh window, not stuck on the old one');

  // Sanity check on the sanitizer itself: an out-of-range or garbage value
  // from the model never silently reintroduces a stuck/oversized window.
  assertEqual(_sanitizeRecheckDays(999), MAX_RECHECK_DAYS, 'recheck days above MAX_RECHECK_DAYS clamp down');
  assertEqual(_sanitizeRecheckDays('not-a-number'), DEFAULT_RECHECK_DAYS, 'garbage recheck days fall back to the default');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
