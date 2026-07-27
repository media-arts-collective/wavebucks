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

console.log('\nOpenLoops scheduling arithmetic (upsert/getDue)');
{
  // Inline copy of OpenLoops.js's pure scheduling logic (see OpenLoops.js),
  // backed by a plain in-memory array instead of a real Sheet — same
  // reasoning as the rest of this file: no GAS globals available under
  // plain node.
  //
  // NOTE on scope: this does NOT encode the actual 2026-07-22
  // "stale-recheck-window" incident (both director-loop threads showing
  // recheck_after_days=10 with no bump yet) — that incident's root cause
  // was the model's own judgment (the seasonal "dead month" restraint
  // applying even to an explicit stated blocker, plus a flag-over-nudge
  // default), fixed via new DM-only Context.js/SystemPrompt.js prompt
  // content, not a code path. Nothing here would have caught or would
  // regress-test that — it requires a live-API dry-run scenario (see
  // .scheduler/FOCUS.md backlog item 2's "live-data dry-run scenarios",
  // gated on ReadApi/WriteApi credentials this local suite deliberately
  // never touches). What IS worth covering locally: the mechanical
  // due-date arithmetic (lastMessageDate + recheckAfterDays vs. now) that
  // the incident's symptom depends on — if a future change broke this,
  // it would reproduce the same "never bumped" symptom via a genuinely
  // different, code-level cause. That's what this block regression-tests.
  const MIN_RECHECK_DAYS = 1;
  const MAX_RECHECK_DAYS = 60;
  const DEFAULT_RECHECK_DAYS = 3;

  function sanitizeRecheckDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n < MIN_RECHECK_DAYS) return DEFAULT_RECHECK_DAYS;
    return Math.min(n, MAX_RECHECK_DAYS);
  }

  function makeStore() {
    const rows = [];
    return {
      upsert(threadId, { open, lastMessageDate, recheckAfterDays }) {
        const recheckDays = sanitizeRecheckDays(recheckAfterDays);
        const nextCheckDate = new Date(lastMessageDate);
        nextCheckDate.setDate(nextCheckDate.getDate() + recheckDays);
        const existing = rows.find(r => r.threadId === threadId);
        if (existing) {
          Object.assign(existing, { open, lastMessageDate, recheckAfterDays: recheckDays, nextCheckDate });
        } else {
          rows.push({ threadId, open, lastMessageDate, recheckAfterDays: recheckDays, nextCheckDate, lastBumpDate: null });
        }
      },
      getDue(now, { ignoreDue } = {}) {
        return rows.filter(r => r.open === true && (ignoreDue || (r.nextCheckDate && r.nextCheckDate <= now)));
      },
    };
  }

  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date('2026-07-27T00:00:00Z');

  const store = makeStore();
  store.upsert('due-thread', { open: true, lastMessageDate: new Date(now - 15 * DAY), recheckAfterDays: 10 });
  store.upsert('not-yet-due-thread', { open: true, lastMessageDate: new Date(now - 2 * DAY), recheckAfterDays: 10 });
  store.upsert('closed-thread', { open: false, lastMessageDate: new Date(now - 15 * DAY), recheckAfterDays: 10 });

  const due = store.getDue(now).map(r => r.threadId);
  assertTrue(due.includes('due-thread'), 'a thread whose lastMessageDate + recheckAfterDays has elapsed is due');
  assertEqual(due.includes('not-yet-due-thread'), false, 'a thread still inside its recheck window is not due');
  assertEqual(due.includes('closed-thread'), false, 'a closed loop is never due regardless of date');

  const ignoreDueResult = store.getDue(now, { ignoreDue: true }).map(r => r.threadId);
  assertTrue(ignoreDueResult.includes('not-yet-due-thread'), 'ignoreDue surfaces open loops even before their scheduled date');
  assertEqual(ignoreDueResult.includes('closed-thread'), false, 'ignoreDue still excludes closed loops');

  assertEqual(sanitizeRecheckDays(10), 10, 'a valid recheckAfterDays (10, matching the real incident value) passes through unchanged');
  assertEqual(sanitizeRecheckDays(-5), DEFAULT_RECHECK_DAYS, 'a negative recheckAfterDays falls back to the default rather than under-scheduling');
  assertEqual(sanitizeRecheckDays('not-a-number'), DEFAULT_RECHECK_DAYS, 'a non-numeric recheckAfterDays falls back to the default');
  assertEqual(sanitizeRecheckDays(9999), MAX_RECHECK_DAYS, 'an oversized recheckAfterDays clamps to the 60-day max rather than never coming due');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
