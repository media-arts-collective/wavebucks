/**
 * checks.test.mjs -- proves the checks FIRE, not just that they pass.
 *
 *   node aedile/recap/checks.test.mjs
 *
 * No network, no secrets, no vault. Every case starts from a draft that is
 * clean, breaks exactly one thing, and asserts that exactly that finding
 * appears. "All clear" on a real draft means nothing unless these fail on
 * purpose -- the first version of the name check passed nothing and flagged
 * ten ordinary words, and only negative cases would have shown which.
 */

import { runChecks } from './checks.mjs';

const NOTES = `
# Vaporwave Club Meeting — Reconstructed Notes
Reconstructed from memory; STT recording failed. Not verified against other attendees.
Attendees: Me, Tyler, Zach, Adam, Alex.

## Laser harp
- Working group: Tyler, Zach, Adam. Monthly meetings.
- Decision point: keep the relays (100ms delay) or pivot.
- Hazy: further detail discussed but not recalled.

## Weekly social
- Wednesday meet. Bar takeovers with video games.

## Venues
- Tyler knows someone with a gutted house. Cost unknown.
`;

// The fixture is archive-shaped on purpose. It used to open `Krewe —` and carry
// two em-dashes, which is to say it was written the way the generator writes
// rather than the way the list does; adding the em-dash check failed it, which
// is the check doing its job on the first draft it ever saw.
const CLEAN = {
  subject: '0. THIS RECAP IS RECONSTRUCTED. The recording failed. 1. LASER HARP by next month.',
  body: 'Hi friends!\n\n' +
    '0. THIS RECAP IS RECONSTRUCTED FROM MEMORY. The recording failed. Correct it on-list.\n\n' +
    '1. LASER HARP. Working group is Tyler, Zach and Adam, meeting monthly. The relays and their 100ms delay get settled then.\n\n' +
    '2. Weekly social. Bar takeovers with video games, on Wednesdays.\n\n' +
    '3. A gutted house that Tyler knows of. Cost unknown.\n\n' +
    '<3 SM',
  open_questions: ['Whether the social is actually Wednesday.'],
  confidence: 'low',
};

const VAULT = { motifs: { 'all-caps-emphasis': 622 } };

let passed = 0, failed = 0;
const ids = d => runChecks(d, NOTES, VAULT).filter(f => f.level === 'fail').map(f => f.id);

function expectFinding(label, mutate, wanted) {
  const d = structuredClone(CLEAN);
  mutate(d);
  const got = ids(d);
  const ok = got.includes(wanted);
  if (ok) { passed++; console.log(`  ok   ${label}`); }
  else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected finding "${wanted}", got [${got.join(', ') || 'none'}]`);
  }
}

function expectClean(label, d) {
  const got = ids(d);
  if (!got.length) { passed++; console.log(`  ok   ${label}`); }
  else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected no blocking findings, got [${got.join(', ')}]`);
  }
}


/** Warn-level findings. The spacing and caps checks are advisory -- they do not
 *  block a post -- so `ids()` above, which filters to level 'fail', cannot see
 *  them. */
const warns = d => runChecks(d, NOTES, VAULT).filter(f => f.level === 'warn').map(f => f.id);

function expectWarn(label, d, wanted, present = true) {
  const got = warns(d);
  const ok = got.includes(wanted) === present;
  if (ok) { passed++; console.log(`  ok   ${label}`); }
  else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected "${wanted}" ${present ? 'present' : 'absent'}, got [${got.join(', ') || 'none'}]`);
  }
}

console.log('recap checks — negative cases\n');

console.log('a clean draft passes');
expectClean('the clean fixture has no blocking findings', structuredClone(CLEAN));

console.log('\ninvented content is caught');
// Mid-sentence proper noun that appears nowhere in the notes: a hallucinated person.
expectFinding('a name not in the notes', d => {
  d.body = d.body.replace('meeting monthly.', 'meeting monthly, and Beatrice is getting the tires.');
}, 'invented-name');

// Deliberately placed in the SUBJECT: it is part of the draft, and an earlier
// version of these checks read only the body and let this through.
expectFinding('a date not in the notes, in the subject', d => {
  d.subject = d.subject.replace('by next month', 'on March 14 2027');
}, 'invented-figure');

expectFinding('a date not in the notes, in the body', d => {
  d.body = d.body.replace('meeting monthly.', 'meeting monthly, due March 14.');
}, 'invented-figure');

expectFinding('a dollar figure not in the notes', d => {
  d.body = d.body.replace('Cost unknown.', 'Cost is $4,200.');
}, 'invented-figure');

console.log('\nswallowed uncertainty is caught');
expectFinding('hedged notes but no open questions', d => { d.open_questions = []; },
  'swallowed-uncertainty');
expectFinding('a reconstructed input recapped confidently', d => { d.confidence = 'high'; },
  'overconfident');

console.log('\nvoice and form are caught');
expectFinding('missing sign-off', d => { d.body = d.body.replace('<3 SM', ''); },
  'sign-off');
expectFinding('borrowing the MS figure', d => {
  d.body = d.body.replace('<3 SM', '<3 MS');
}, 'signed-as-ms');
expectFinding('subject numbers an item the body does not', d => {
  d.subject += ' 7. Send us venues.';
}, 'subject-body-mismatch');

console.log('\nthings that must NOT be flagged');
// Every one of these was a real false positive on the first run.
expectClean('sentence-initial capitals, ALL-CAPS emphasis and plurals', structuredClone(CLEAN));
expectClean('a word capitalised after a colon', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('Cost unknown.', 'One thing: Nobody priced it.');
  return d;
})());
expectClean('a list ordinal followed by a capitalised word', (() => {
  const d = structuredClone(CLEAN);
  // BEFORE the sign-off. This used to append after it, which passed only while
  // the sign-off check searched the whole body; it now reads the last line, so
  // an item pasted below the initials is a draft that does not end in a
  // sign-off -- which is the thing being checked, not what this case is about.
  d.body = d.body.replace('\n\n<3 SM', '\n\n4. Someone should follow up.\n\n<3 SM');
  return d;
})());

// The archive does not always write `<3`. Measured over the 219 MS-signed
// messages in the generator's length window, the line above the initials is
// `<3` in 74%, a short line of its own in 10.5%, absent in 7.3%, `xo`/`xoxo`
// in 3.7% and `Best` in 2.7%. devices.mjs deals these; the check has to accept
// every one of them or the deal cannot reach a sent email.
for (const [name, close] of [
  ['a plain Best above the initials', 'Best'],
  ['xoxo above the initials', 'xoxo'],
  ['a short valence line above the initials', 'More soon!'],
  ['the multi-heart variant', '<3 <3 <3'],
]) {
  expectClean(name, (() => {
    const d = structuredClone(CLEAN);
    d.body = d.body.replace('<3 SM', `${close}\nSM`);
    return d;
  })());
}
expectClean('no closing line at all -- the initials follow the last item', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('\n\n<3 SM', '\n\nSM');
  return d;
})());
expectFinding('a draft that just stops, with no initials', d => {
  d.body = d.body.replace('\n\n<3 SM', '');
}, 'sign-off');

// A heart alone, no initials. 2 of 468 archived messages close this way, and
// it is what a human signs by hand when neither figure is theirs to claim:
// `MS` is the archive's, `SM` is aedile's. Not malformed.
expectClean('a bare `<3` with no initials', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('<3 SM', '<3');
  return d;
})());
expectClean('several hearts and no initials', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('<3 SM', '<3 <3 <3');
  return d;
})());


console.log('\nthe machine-written tells');
expectFinding('an em-dash in the body', d => {
  d.body = d.body.replace('Cost unknown.', 'Cost unknown \u2014 nobody priced it.');
}, 'em-dash');
expectFinding('an em-dash in the subject', d => {
  d.subject += ' \u2014 more to come';
}, 'em-dash');
expectFinding('a spaced double dash', d => {
  d.body = d.body.replace('Cost unknown.', 'Cost unknown -- nobody priced it.');
}, 'em-dash');
expectWarn('a body with no exclamation mark', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace(/!/g, '.');
  return d;
})(), 'no-exclamation');
expectWarn('the fixture, which greets with one, is not flagged',
  structuredClone(CLEAN), 'no-exclamation', false);

console.log('\nragged paragraph spacing');
// 93% of comparable archived messages leave 2-4 blank lines between items. The
// clean fixture uses one throughout, which is what a generated recap looks like.
expectWarn('uniform single blank lines are flagged', structuredClone(CLEAN), 'uniform-spacing');
expectWarn('ragged spacing is not flagged', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace(/\n\n/g, '\n\n\n');
  return d;
})(), 'uniform-spacing', false);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
