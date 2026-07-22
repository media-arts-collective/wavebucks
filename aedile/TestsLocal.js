/**
 * TestsLocal.js
 * Fast local test suite for Aedile's pure guardrail logic — mirrors
 * scribaSenatus/TestsLocal.js's pattern (see wavebucks/CLAUDE.md): plain
 * `node TestsLocal.js`, no Apps Script services available, so this file
 * re-declares the exact logic under test inline rather than requiring the
 * real .js files (which reference GmailApp/PropertiesService/LockService
 * at load time and can't be `require()`d outside the Apps Script runtime).
 *
 * When you change extractEmail/matchesAllowlist/isAllowlistEligible/
 * classifyAudience in InboxProcessor.js, or the LockService guard shape in
 * scanUnread()/checkBumps(), mirror the change here too — this suite tests
 * the copy below, not the real file, exactly like scribaSenatus's version.
 *
 * Covers the guardrail-adjacent logic this project's CLAUDE.md flags as
 * needing verification without a live deployment: the auto-send allowlist
 * (isAllowlistEligible/matchesAllowlist), the DM/list audience split
 * (classifyAudience), and the LockService overlap guard added 2026-07-21.
 * Does NOT touch anything requiring GmailApp/PropertiesService/Claude for
 * real — that's the "needs live testing" list in CLAUDE.md's Open items,
 * unchanged by this file.
 */

// --- inline copies of the logic under test (see file header) ---

const DM_RECIPIENT_THRESHOLD = 3;

function extractEmail(header) {
  const match = header.match(/<([^>]+)>/);
  return (match ? match[1] : header).toLowerCase().trim();
}

function matchesAllowlist(address, allowlist) {
  const addr = address.toLowerCase();
  return allowlist.some(entry => entry.startsWith('@') ? addr.endsWith(entry) : addr === entry);
}

function isAllowlistEligible(participants, autosendEnabled, allowlist) {
  if (!autosendEnabled) return false;
  if (!allowlist.length) return false;
  return participants.every(addr => matchesAllowlist(addr, allowlist));
}

function classifyAudience(toHeader, ccHeader) {
  const recipients = new Set();
  (toHeader || '').split(',').forEach(a => a.trim() && recipients.add(extractEmail(a)));
  (ccHeader || '').split(',').forEach(a => a.trim() && recipients.add(extractEmail(a)));
  return recipients.size <= DM_RECIPIENT_THRESHOLD ? 'dm' : 'list';
}

/** Mirrors the tryLock/try-finally-releaseLock shape in scanUnread()/checkBumps(). */
function runWithLock(lock, body) {
  if (!lock.tryLock(10000)) return { ran: false };
  try {
    body();
    return { ran: true };
  } finally {
    lock.releaseLock();
  }
}

// --- tiny test harness (mirrors scribaSenatus/TestsLocal.js) ---

let pass = 0;
let fail = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(actual, label) {
  assertEqual(!!actual, true, label);
}

// --- extractEmail ---

assertEqual(extractEmail('Zach <zach@nomac.org>'), 'zach@nomac.org', 'extractEmail: name + angle brackets');
assertEqual(extractEmail('zach@nomac.org'), 'zach@nomac.org', 'extractEmail: bare address');
assertEqual(extractEmail('  Zach  <ZACH@NoMac.org>  '), 'zach@nomac.org', 'extractEmail: lowercases and trims');

// --- matchesAllowlist ---

assertTrue(matchesAllowlist('zach@nomac.org', ['zach@nomac.org']), 'matchesAllowlist: exact match');
assertTrue(matchesAllowlist('someone@nomac.org', ['@nomac.org']), 'matchesAllowlist: domain suffix match');
assertEqual(matchesAllowlist('someone@evil.org', ['@nomac.org']), false, 'matchesAllowlist: no match across domains');
assertTrue(matchesAllowlist('ZACH@NOMAC.ORG', ['zach@nomac.org']), 'matchesAllowlist: case-insensitive');
assertEqual(matchesAllowlist('notzach@evilnomac.org', ['@nomac.org']), false, 'matchesAllowlist: the @ prefix on a domain entry prevents a lookalike domain (evilnomac.org) from matching @nomac.org');

// --- isAllowlistEligible ---

assertTrue(
  isAllowlistEligible(['zach@nomac.org', 'tyler@nomac.org'], true, ['@nomac.org']),
  'isAllowlistEligible: all participants match a domain-suffix allowlist'
);
assertEqual(
  isAllowlistEligible(['zach@nomac.org', 'outsider@gmail.com'], true, ['@nomac.org']),
  false,
  'isAllowlistEligible: one outside participant disables the whole thread'
);
assertEqual(
  isAllowlistEligible(['zach@nomac.org'], false, ['@nomac.org']),
  false,
  'isAllowlistEligible: fails closed when AUTOSEND_ENABLED is off'
);
assertEqual(
  isAllowlistEligible(['zach@nomac.org'], true, []),
  false,
  'isAllowlistEligible: fails closed when allowlist is empty even if autosend is on'
);

// --- classifyAudience ---

assertEqual(classifyAudience('zach@nomac.org', ''), 'dm', 'classifyAudience: single recipient is dm');
assertEqual(
  classifyAudience('zach@nomac.org,tyler@nomac.org', 'krewe@kreweofvaporwave.com'),
  'dm',
  'classifyAudience: three recipients sits at the threshold, still dm'
);
assertEqual(
  classifyAudience('zach@nomac.org,tyler@nomac.org,krewe@kreweofvaporwave.com,fourth@nomac.org', ''),
  'list',
  'classifyAudience: four distinct recipients tips over into list'
);
assertEqual(
  classifyAudience('a@nomac.org,a@nomac.org', ''),
  'dm',
  'classifyAudience: duplicate recipients across To dedupe (Set), not double-counted'
);

// --- LockService overlap guard (added 2026-07-21) ---

function makeLock(startsLocked) {
  const state = { locked: !!startsLocked, released: false, lockCalls: 0, releaseCalls: 0 };
  return {
    state,
    tryLock: () => {
      state.lockCalls++;
      if (state.locked) return false;
      state.locked = true;
      return true;
    },
    releaseLock: () => {
      state.releaseCalls++;
      state.released = true;
      state.locked = false;
    }
  };
}

{
  const lock = makeLock(false);
  let bodyRan = false;
  const result = runWithLock(lock, () => { bodyRan = true; });
  assertTrue(result.ran, 'runWithLock: free lock lets the body run');
  assertTrue(bodyRan, 'runWithLock: body actually executed when lock acquired');
  assertEqual(lock.state.releaseCalls, 1, 'runWithLock: releaseLock called exactly once on success');
}

{
  const lock = makeLock(true);
  let bodyRan = false;
  const result = runWithLock(lock, () => { bodyRan = true; });
  assertEqual(result.ran, false, 'runWithLock: held lock skips the run');
  assertEqual(bodyRan, false, 'runWithLock: body never executes when lock is held');
  assertEqual(lock.state.releaseCalls, 0, 'runWithLock: never releases a lock it never acquired');
}

{
  const lock = makeLock(false);
  let threw = false;
  try {
    runWithLock(lock, () => { throw new Error('boom'); });
  } catch (err) {
    threw = true;
  }
  assertTrue(threw, 'runWithLock: error inside the body still propagates');
  assertEqual(lock.state.releaseCalls, 1, 'runWithLock: releaseLock still fires via finally when the body throws');
}

// --- summary ---

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
