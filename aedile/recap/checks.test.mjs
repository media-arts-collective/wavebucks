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

const CLEAN = {
  subject: '0. THIS RECAP IS RECONSTRUCTED — the recording failed. 1. LASER HARP by next month.',
  body_html: '<p>Krewe —</p>' +
    '<p>0. THIS RECAP IS RECONSTRUCTED FROM MEMORY. The recording failed. Correct it on-list.</p>' +
    '<p>1. LASER HARP. Working group is Tyler, Zach and Adam, meeting monthly. The relays and their 100ms delay get settled then.</p>' +
    '<p>2. Weekly social. Bar takeovers with video games, on Wednesdays.</p>' +
    '<p>3. A gutted house that Tyler knows of. Cost unknown.</p>' +
    '<p>&lt;3 SM</p>',
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

console.log('recap checks — negative cases\n');

console.log('a clean draft passes');
expectClean('the clean fixture has no blocking findings', structuredClone(CLEAN));

console.log('\ninvented content is caught');
// Mid-sentence proper noun that appears nowhere in the notes: a hallucinated person.
expectFinding('a name not in the notes', d => {
  d.body_html = d.body_html.replace('meeting monthly.', 'meeting monthly, and Beatrice is getting the tires.');
}, 'invented-name');

// Deliberately placed in the SUBJECT: it is part of the draft, and an earlier
// version of these checks read only the body and let this through.
expectFinding('a date not in the notes, in the subject', d => {
  d.subject = d.subject.replace('by next month', 'on March 14 2027');
}, 'invented-figure');

expectFinding('a date not in the notes, in the body', d => {
  d.body_html = d.body_html.replace('meeting monthly.', 'meeting monthly, due March 14.');
}, 'invented-figure');

expectFinding('a dollar figure not in the notes', d => {
  d.body_html = d.body_html.replace('Cost unknown.', 'Cost is $4,200.');
}, 'invented-figure');

console.log('\nswallowed uncertainty is caught');
expectFinding('hedged notes but no open questions', d => { d.open_questions = []; },
  'swallowed-uncertainty');
expectFinding('a reconstructed input recapped confidently', d => { d.confidence = 'high'; },
  'overconfident');

console.log('\nvoice and form are caught');
expectFinding('missing sign-off', d => { d.body_html = d.body_html.replace('<p>&lt;3 SM</p>', ''); },
  'sign-off');
expectFinding('borrowing the MS figure', d => {
  d.body_html = d.body_html.replace('&lt;3 SM', '&lt;3 MS');
}, 'signed-as-ms');
expectFinding('subject numbers an item the body does not', d => {
  d.subject += ' 7. Send us venues.';
}, 'subject-body-mismatch');

console.log('\nthings that must NOT be flagged');
// Every one of these was a real false positive on the first run.
expectClean('sentence-initial capitals, ALL-CAPS emphasis and plurals', structuredClone(CLEAN));
expectClean('a word capitalised after a colon', (() => {
  const d = structuredClone(CLEAN);
  d.body_html = d.body_html.replace('Cost unknown.', 'One thing: Nobody priced it.');
  return d;
})());
expectClean('a list ordinal followed by a capitalised word', (() => {
  const d = structuredClone(CLEAN);
  d.body_html += '<p>4. Someone should follow up.</p>';
  return d;
})());

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
