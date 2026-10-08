// duel.test.mjs -- the duel's harness: the two sides may differ only in who wrote them.
//
//   node aedile/recap/duel.test.mjs
//
// No network, no model, no vault reads beyond the two prompt files.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize, isRagged, modalGap } from './normalize.mjs';
import { leaks, carriedByNotes, units, DEVOICE_PROMPT } from './duel.mjs';
import { dealDevices, dealFlourish, dealTypo, dealSignoff, devicesBlock,
         DEVICES, FLOURISHES, SIGNOFF_LEAD_INS } from './devices.mjs';
import { parseDecision } from './redige.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AEDILE = join(HERE, '..');

let passed = 0, failed = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ok   ${label}`); }
  else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       want ${JSON.stringify(want)}`);
    console.log(`       got  ${JSON.stringify(got)}`);
  }
}
const ok = (label, cond) => check(label, !!cond, true);

// A real specimen's shape: ragged spacing, an address, `<3` on its own line
// above the initials.
const REAL = 'Hi friends!\n\n\n1. Tickets. Extend the promo codes.\n\n\n\n'
  + '2. Storage tonight, 7pm. Mail me at kreweofvaporwave@gmail.com.\n\n\n<3\nMS';
// The generated shape: `<3 SM` inline, uniform single blank lines.
const AI = 'Krewe,\n\n1. Tickets. Extend the promo codes.\n\n'
  + '2. Storage tonight, 7pm.\n\n<3 SM';

console.log('duel harness\n');

console.log('the normalizer treats both sides identically');
check('the real side loses its initials', /\bMS\b/.test(normalize(REAL)), false);
check('the generated side loses its initials', /\bSM\b/.test(normalize(AI)), false);
ok('the real side keeps its <3', normalize(REAL).endsWith('<3'));
ok('the generated side keeps its <3', normalize(AI).endsWith('<3'));
check('the two tails are indistinguishable',
  normalize(REAL).slice(-3), normalize(AI).slice(-3));

console.log('\nwhitespace survives, because the duel measures it');
ok('ragged spacing is preserved verbatim', normalize(REAL).includes('\n\n\n\n'));
ok('the real side reads as ragged', isRagged(normalize(REAL)));
check('the generated side reads as uniform', isRagged(normalize(AI)), false);

console.log('\nwhat only ever appears on the real side is removed');
ok('addresses are redacted', normalize(REAL).includes('someone@example.com'));
check('no real address survives', /kreweofvaporwave@gmail/.test(normalize(REAL)), false);
check('phone numbers are redacted too', normalize('Call me at 603-520-4579.'), 'Call me at 555-0100.');

// Invented, not lifted from the archive: wavebucks is public and a fixture is
// not a reason to reprint a member's private mail in it.
const QUOTED = REAL + '\n\nOn Mon, Oct 17, 2020, Someone wrote:\n> Sounds good to me.\n> Sent from my iPhone';
ok('a quoted reply is cut', !normalize(QUOTED).includes('Sounds good to me'));
ok('the message above the quote survives', normalize(QUOTED).includes('1. Tickets.'));

const FOOTED = REAL + '\n\n-- \nYou received this message because you are subscribed to the Google Groups "kreweofvaporwave" group.\nTo unsubscribe, send an email to nobody@example.org.';
ok('the Groups footer is cut', !normalize(FOOTED).includes('You received this message'));
ok('the message above the footer survives', normalize(FOOTED).includes('2. Storage tonight'));

console.log('\nthe mail client\'s hand is flattened, not the author\'s');
// Curly quotes are Gmail's doing, not the author's.
check('curly apostrophes are straightened',
  normalize('We\u2019re on. Don\u2019t be late.'), "We're on. Don't be late.");
check('curly double quotes are straightened',
  normalize('He called it \u201Cthe Livestream\u201D.'), 'He called it "the Livestream".');
check('a non-breaking space becomes a space',
  normalize('noon\u00a0tomorrow'), 'noon tomorrow');
ok('ragged spacing is still untouched by it', normalize(REAL).includes('\n\n\n\n'));

console.log('\nan initials-only sign-off is still caught');
check('bare MS with no <3', /\bMS\b/.test(normalize('Some body text.\n\nMS')), false);
check('bare SM with no <3', /\bSM\b/.test(normalize('Some body text.\n\nSM')), false);

console.log('\nthe de-voicing step must not hand back Abe\'s phrasing');
// Ten words: a content-matched pair guarantees shorter overlaps.
const SOURCE = 'Please extend the promo codes to your cynical, joyless, spendthrift friends before Wednesday, and bring a pushbroom.';
ok('a lifted sentence is caught',
  leaks(SOURCE, 'Please extend the promo codes to your cynical, joyless, spendthrift friends before Wednesday.').length > 0);
check('a plain paraphrase leaks nothing',
  leaks(SOURCE, 'Share the discount codes with people you know. The deadline is Wednesday.'), []);
check('an incidental short overlap is not flagged',
  leaks(SOURCE, 'Bring a pushbroom on Wednesday.'), []);

console.log('\na preserved fact is not a lifted sentence');
// The generator only sees the notes; restoring the articles the de-voicing
// dropped lands on the original wording.
const NOTES_LINE = '- hang clip lights in rafters of Brake Tag Station, set up DMX over stage';
ok('articles restored around a preserved fact is not a leak',
  carriedByNotes('clip lights in the rafters of the brake tag station', NOTES_LINE));
check('phrasing the notes never carried is not excused',
  carriedByNotes('i thought we would never in our lives top that', NOTES_LINE), false);

console.log('\nthe device deal reproduces the archive, which no single email can');
// The caller rolls the devices. These assert the roll lands on the table's
// rates, including the two gated on a parent.
{
  const N = 6000, tally = {};
  for (let i = 0; i < N; i++) {
    const h = dealDevices('specimen' + i);
    for (const k of Object.keys(h)) tally[k] = (tally[k] || 0) + (h[k] ? 1 : 0);
  }
  const want = { numberedList: 82, zeroIndex: 14, parenthetical: 62,
                 question: 46, allCaps: 62, allCapsLine: 12, semicolon: 22 };
  for (const [key, target] of Object.entries(want)) {
    const got = 100 * tally[key] / N;
    ok(`${key} lands near ${target}% (got ${got.toFixed(1)}%)`, Math.abs(got - target) < 3);
  }
  ok('a gated device never fires without its parent',
    Array.from({ length: 400 }, (_, i) => dealDevices('g' + i))
      .every(h => (!h.zeroIndex || h.numberedList) && (!h.allCapsLine || h.allCaps)));
}
check('the same seed deals the same hand',
  JSON.stringify(dealDevices('abc')), JSON.stringify(dealDevices('abc')));
ok('different seeds deal different hands',
  JSON.stringify(dealDevices('abc')) !== JSON.stringify(dealDevices('xyz')));
ok('the block names every device it was dealt',
  devicesBlock(Object.fromEntries(DEVICES.map(d => [d.key, true]))).includes('Number the items.'));
ok('the block tells a no-list email not to number',
  devicesBlock(Object.fromEntries(DEVICES.map(d => [d.key, false]))).includes('Do NOT number anything'));

console.log('\nthe rare things are dealt too, and vary');
{
  const N = 5000;
  let f = 0, t = 0; const kinds = new Set();
  for (let i = 0; i < N; i++) {
    const fl = dealFlourish('s' + i); if (fl) { f++; kinds.add(fl); }
    if (dealTypo('s' + i)) t++;
  }
  ok(`a flourish lands near 40% (got ${(100 * f / N).toFixed(1)}%)`, Math.abs(100 * f / N - 40) < 3);
  ok(`a typo lands near 10% (got ${(100 * t / N).toFixed(1)}%)`, Math.abs(100 * t / N - 10) < 2);
  // The variety IS the trait: one flourish used every time would be its own tell.
  check('every flourish gets used', kinds.size, FLOURISHES.length);
}
ok('the typo instruction fences off facts',
  dealTypo('force') === null || /NOT in a date, a time, an address/.test(dealTypo('force') || ''));
{
  // Find a seed that deals a typo, and assert the fence is in what gets sent.
  let withTypo = null;
  for (let i = 0; i < 200 && !withTypo; i++) withTypo = dealTypo('t' + i);
  ok('a dealt typo carries its fence', /anybody's name/.test(withTypo || ''));
}

console.log('\nthe sign-off is dealt, not fixed');
// The line above the initials is dealt, at rates measured over messages.jsonl,
// not the duel pool.
check('the lead-in rates are a distribution',
  SIGNOFF_LEAD_INS.reduce((a, x) => a + x.p, 0).toFixed(6), '1.000000');
{
  const N = 20000, tally = {};
  for (let i = 0; i < N; i++) {
    const say = dealSignoff('s' + i);
    const key = (SIGNOFF_LEAD_INS.find(x => x.say === say) || {}).key || 'heart';
    tally[key] = (tally[key] || 0) + 1;
  }
  for (const { key, p } of SIGNOFF_LEAD_INS) {
    const got = 100 * (tally[key] || 0) / N;
    ok(`${key} lands near ${(100 * p).toFixed(1)}% (got ${got.toFixed(1)}%)`,
      Math.abs(got - 100 * p) < 1.5);
  }
}
check('the same seed deals the same sign-off', dealSignoff('abc'), dealSignoff('abc'));
// One roll: a hand must not carry two sign-offs.
ok('a hand never carries two closing lines', Array.from({ length: 2000 }, (_, i) =>
  dealSignoff('x' + i)).every(v => v === null || SIGNOFF_LEAD_INS.some(x => x.say === v)));
ok('the common case says nothing, leaving the prompt\'s own `<3 SM`',
  SIGNOFF_LEAD_INS.find(x => x.key === 'heart').say === null);

console.log('\nan unparseable answer costs one specimen, not the burst');
// parseDecision throws rather than exiting, so one bad response cannot kill a burst.
check('JSON behind a prose preamble is recovered',
  parseDecision('3366 chars, no semicolons.\n\n```json\n{"subject":"s","body":"b"}\n```'),
  { subject: 's', body: 'b' });
{
  let threw = false;
  try { parseDecision('not json at all'); } catch (_) { threw = true; }
  ok('garbage throws rather than exiting the process', threw);
}

function bodyOf(file) {
  const s = readFileSync(join(AEDILE, file), 'utf8');
  return s.slice(s.indexOf('\n## ')).trim();
}
// The prompt may not itself do the thing it forbids.
for (const file of ['AEDILE_CONTEXT.core.md', 'AEDILE_CONTEXT.recap.md',
                    'AEDILE_CONTEXT.headsup.md', 'AEDILE_CONTEXT.triage.md']) {
  const t = bodyOf(file);
  check(`${file} contains no em-dash`, /[\u2014\u2013]/.test(t), false);
  check(`${file} contains no spaced --`, /(?:^|\s)--(?:\s|$)/.test(t), false);
}

// Step A has to preserve the source's lumping, not sort facts into a taxonomy.
check('units counts a lumpy paragraph as one unit',
  units('a b c, and also d, and e tonight'), 1);
check('units counts each list item',
  units('1. one\n2. two\n3. three'), 3);
check('units counts blank-line blocks',
  units('first para\n\nsecond para\n\nthird'), 3);
check('units sees the P.S. as its own unit',
  units('body here\n\nP.S. one more thing'), 2);

// The prompt must ask for order and lumping, and must not ask for a taxonomy.
check('DEVOICE_PROMPT asks for one bullet per source unit',
  /one bullet per unit of the original, in the order it was written/i.test(DEVOICE_PROMPT), true);
check('DEVOICE_PROMPT forbids grouping by topic',
  /never group facts by topic/i.test(DEVOICE_PROMPT), true);
check('DEVOICE_PROMPT no longer dictates a fact taxonomy',
  /what is happening, when, where, who is doing what/i.test(DEVOICE_PROMPT), false);
// It still may not hand phrasing back -- the structure fix must not cost the
// leak guard, which is the whole reason step A exists.
check('DEVOICE_PROMPT still forbids reusing distinctive phrasing',
  /NEVER reuse a distinctive phrase/.test(DEVOICE_PROMPT), true);

// Gmail leaves an NBSP at end of line; flattening it to a space leaves trailing
// whitespace the generated side never has.
check('an NBSP at end of line does not become trailing whitespace',
  /[ \t]+$/m.test(normalize('one\u00a0\ntwo')), false);
check('trailing spaces are stripped on the generated side too',
  normalize('a line   \n\n\nnext'), 'a line\n\n\nnext');
// ...but the ruling stands: blank-line RUNS are still ragged on both sides.
check('a three-newline paragraph gap survives normalize',
  isRagged(normalize('one   \n\n\ntwo')), true);
check('stripping does not change the gap count',
  (normalize('one\n\n\n\ntwo').match(/\n/g) || []).length, 4);
// A blank line holding a space must not hide the gap from modalGap.
check('modalGap sees a gap whose blank line held a space',
  modalGap(normalize('one\n \ntwo\n \nthree')), 1);
check('normalize is idempotent',
  normalize(normalize('x\u00a0\n\n\ny  ')), normalize('x\u00a0\n\n\ny  '));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
