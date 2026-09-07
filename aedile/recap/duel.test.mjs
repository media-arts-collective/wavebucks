/**
 * duel.test.mjs -- the duel's harness, checked before anyone plays a round.
 *
 *   node aedile/recap/duel.test.mjs
 *
 * The game is only worth playing if the two sides differ ONLY in who wrote
 * them. Every case here is a way that could quietly stop being true:
 *
 *   - the normalizer treating the two sides differently, so the tell is the
 *     harness and every win rate after it is noise;
 *   - the de-voicing step leaking Abe's phrasing into the notes, which hands
 *     it straight back to the generator;
 *   - the two copies of the recap prompt drifting apart, which has already
 *     happened once -- Context.js went on asking for `body_html` after
 *     MeetingRecap stopped reading it, and nothing failed until a draft did.
 *
 * No network, no model, no vault reads beyond the two prompt files.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize, isRagged } from './normalize.mjs';
import { leaks, carriedByNotes } from './duel.mjs';

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
// The generated shape: `<3 SM` inline, and (before the prompt change) uniform
// single blank lines.
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

// Invented, not lifted from the archive: wavebucks is public and a fixture is
// not a reason to reprint a member's private mail in it.
const QUOTED = REAL + '\n\nOn Mon, Oct 17, 2020, Someone wrote:\n> Sounds good to me.\n> Sent from my iPhone';
ok('a quoted reply is cut', !normalize(QUOTED).includes('Sounds good to me'));
ok('the message above the quote survives', normalize(QUOTED).includes('1. Tickets.'));

const FOOTED = REAL + '\n\n-- \nYou received this message because you are subscribed to the Google Groups "kreweofvaporwave" group.\nTo unsubscribe, send an email to nobody@example.org.';
ok('the Groups footer is cut', !normalize(FOOTED).includes('You received this message'));
ok('the message above the footer survives', normalize(FOOTED).includes('2. Storage tonight'));

console.log('\nthe mail client\'s hand is flattened, not the author\'s');
// Curly quotes are Gmail's doing, not Abe's: 0.36 per 1k chars of archive
// against 0.00 generated, which is a per-round giveaway about nothing.
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
// Ten words, not six: a content-matched pair guarantees short overlaps because
// both sides state the same facts in ordinary English. Measured across the
// first burst, the longest shared run was nine words and all were fact-carrying.
const SOURCE = 'Please extend the promo codes to your cynical, joyless, spendthrift friends before Wednesday, and bring a pushbroom.';
ok('a lifted sentence is caught',
  leaks(SOURCE, 'Please extend the promo codes to your cynical, joyless, spendthrift friends before Wednesday.').length > 0);
check('a plain paraphrase leaks nothing',
  leaks(SOURCE, 'Share the discount codes with people you know. The deadline is Wednesday.'), []);
check('an incidental short overlap is not flagged',
  leaks(SOURCE, 'Bring a pushbroom on Wednesday.'), []);

console.log('\na preserved fact is not a lifted sentence');
// The generator only ever sees the notes, so it cannot take anything from the
// real email except through them. Restoring the articles the de-voicing dropped
// lands on the original wording because there is no other way to write it --
// every one of the sixteen runs flagged in the first full burst was this.
const NOTES_LINE = '- hang clip lights in rafters of Brake Tag Station, set up DMX over stage';
ok('articles restored around a preserved fact is not a leak',
  carriedByNotes('clip lights in the rafters of the brake tag station', NOTES_LINE));
check('phrasing the notes never carried is not excused',
  carriedByNotes('i thought we would never in our lives top that', NOTES_LINE), false);

console.log('\nthe two copies of each prompt agree');
// redige.mjs reads the .md files; Apps Script reads the constants in
// Context.js. They are maintained by hand and nothing else enforces this.
// Context.js once went on asking for `body_html` after MeetingRecap stopped
// reading it, and nothing failed until a draft did.
function constantOf(name) {
  const s = readFileSync(join(AEDILE, 'Context.js'), 'utf8');
  const m = s.match(new RegExp('const ' + name + ' = `([\\s\\S]*?)`;\\s*$', 'm'));
  return m ? m[1].replace(/\\`/g, '`').replace(/\\\$/g, '$').trim() : null;
}
function bodyOf(file) {
  const s = readFileSync(join(AEDILE, file), 'utf8');
  return s.slice(s.indexOf('\n## ')).trim();
}
for (const [name, file] of [['AEDILE_CONTEXT_CORE', 'AEDILE_CONTEXT.core.md'],
                            ['AEDILE_CONTEXT_RECAP', 'AEDILE_CONTEXT.recap.md']]) {
  const js = constantOf(name), md = bodyOf(file);
  ok(`${name} was found in Context.js`, js !== null);
  if (js !== null && js !== md) {
    // Name the first differing line, or the diff is a staring contest.
    const a = md.split('\n'), b = js.split('\n');
    const at = a.findIndex((l, k) => l !== b[k]);
    console.log(`       first difference at line ${at + 1}:`);
    console.log(`       ${file}: ${JSON.stringify(a[at])}`);
    console.log(`       Context.js: ${JSON.stringify(b[at])}`);
  }
  check(`${file} and ${name} are byte-identical`, js === md, true);
}

// The prompt may not itself do the thing it forbids. It carried 24 em-dashes
// while telling the generator never to write one, and the examples it holds up
// as exemplary contain none at all.
for (const file of ['AEDILE_CONTEXT.core.md', 'AEDILE_CONTEXT.recap.md']) {
  const t = bodyOf(file);
  check(`${file} contains no em-dash`, /[\u2014\u2013]/.test(t), false);
  check(`${file} contains no spaced --`, /(?:^|\s)--(?:\s|$)/.test(t), false);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
