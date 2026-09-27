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
// The subject used to be the body's opening, numbered: `0. THIS RECAP IS
// RECONSTRUCTED. The recording failed. 1. LASER HARP...`. That was the shape the
// deleted doctrine prescribed and the scraper invented (#30). A real one is
// short, crafted, and never numbered.
const CLEAN = {
  subject: 'reconstructed notes: the recording failed',
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
const warns = (d, opts) => runChecks(d, NOTES, VAULT, opts).filter(f => f.level === 'warn').map(f => f.id);

// `opts` exists for the checks that only fire when the caller supplies a measured
// figure (shape, leadDays): without it they are silent, which is itself a case.
function expectWarn(label, d, wanted, present = true, opts = undefined) {
  const got = warns(d, opts);
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

// A hyphenated compound whose head is in the notes is grounded; the adjective
// after the hyphen is not a name. "Tyler" is in the fixture, "-shaped" is not.
expectClean('a hyphenated compound off a known name', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('meeting monthly.', 'meeting monthly, on a Tyler-shaped schedule.');
  return d;
})());

// The head still has to be there. Nothing in the fixture says Costco.
expectFinding('a hyphenated compound off an unknown name', d => {
  d.body = d.body.replace('meeting monthly.', 'meeting monthly, on a Costco-style model.');
}, 'invented-name');

// The named sentence: "(The tang is load-bearing.)", 2026-09-27. 0 of 1,108
// archived documents use this vocabulary, so it blocks.
expectFinding('an engineering-critic aside', d => {
  d.body = d.body.replace('meeting monthly.', 'meeting monthly. (The relay question is load-bearing.)');
}, 'critic-register');

// The near-miss the stems were narrowed for: "however trivially" is the archive's
// one real instance, an ordinary adverb, and it must not fire.
expectClean("the archive's own adverb is not the critic register", (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('meeting monthly.', 'meeting monthly, and it differs however trivially.');
  return d;
})());

// The form is fine and was never the finding: a parenthetical aside carrying a
// name and an exclamation is 2% of the archive and passes.
expectClean('a parenthetical aside in the archive\'s own shape', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('meeting monthly.', 'meeting monthly. (Tyler is on it!)');
  return d;
})());

// Oversubdivision, warn-level, and only when the caller supplies the measured
// shape. The fixture is short, so eight one-line items is the shape being caught.
const SHAPE = { items: 5, wordsPerItem: 43 };
{
  const d = structuredClone(CLEAN);
  d.body = '1. One thing.\n\n2. Two.\n\n3. Three.\n\n4. Four.\n\n5. Five.\n\n6. Six.\n\n7. Seven.\n\n8. Eight.\n\n<3 MS';
  expectWarn('eight thin items against a median of five', d, 'oversubdivided', true, { shape: SHAPE });
  // Same draft, no measured shape passed: silent, like every other corpus-gated check.
  expectWarn('no shape supplied, nothing to compare against', d, 'oversubdivided', false);
}

// Deliberately placed in the SUBJECT: it is part of the draft, and an earlier
// version of these checks read only the body and let this through.
expectFinding('a date not in the notes, in the subject', d => {
  d.subject += ', March 14 2027';
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
// subject-body-mismatch is GONE (#30): it enforced the scrape's artifact, so a
// crafted subject failed and an artifact-shaped one passed. What replaces it is
// the absence of a rule, which only a passing case can show.
expectClean('a crafted subject that is not the body\'s opening', (() => {
  const d = structuredClone(CLEAN);
  d.subject = 'Someone bring a floor jack!';
  return d;
})());
expectClean('a subject carrying a figure the body does not', (() => {
  const d = structuredClone(CLEAN);
  d.subject = 'the relays: 100ms or pivot';
  d.body = d.body.replace(' and their 100ms delay', '');
  return d;
})());

// Both holes in `figures()`, with the exact strings that exposed them in a real
// draft. An invented date or time is the one thing this file most has to stop.
expectFinding('an ordinal date not in the notes', d => {
  d.body = d.body.replace('meeting monthly', 'meeting monthly, next on the 27th');
}, 'invented-figure');
expectFinding('a spaced time not in the notes', d => {
  d.body = d.body.replace('on Wednesdays', 'on Wednesdays, 7 pm');
}, 'invented-figure');

// itemNumbers had no line anchor, so prose ending in a digit read as an item.
expectWarn('prose ending in a digit is not a numbered item', (() => {
  const d = structuredClone(CLEAN);
  d.body = 'Hi friends!\n\nDoors at 8, show at 9. See you there!\n\n<3 SM';
  return d;
})(), 'no-numbering', true);

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
  // The item is deliberately over ten words: `stub-items` fails a numbered item
  // shorter than that, and this case is about Nobody-after-an-ordinal, not length.
  d.body = d.body.replace('\n\n<3 SM',
    '\n\n4. Someone should follow up with Nobody about the venue, since the cost is still unknown.\n\n<3 SM');
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

// A gendered pronoun the notes never supply is an invented fact about a person.
expectFinding('a gendered pronoun the input does not supply', d => {
  d.body = d.body.replace('Tyler knows of', 'Tyler knows of, at his place,');
}, 'invented-pronoun');
expectClean('they/them needs no support from the notes', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('Cost unknown.', 'Tyler will say what they think of it.');
  return d;
})());

// A notice that names the wrong day is the worst thing this file can pass.
{
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('Hi friends!', 'Hi friends! Build day is TOMORROW.');
  const got = runChecks(d, NOTES, VAULT, { leadDays: 0 }).filter(f => f.level === 'fail').map(f => f.id);
  const ok = got.includes('temporal-mismatch');
  if (ok) { passed++; console.log('  ok   lead 0 rejects "tomorrow"'); }
  else { failed++; console.log(`  FAIL lead 0 rejects "tomorrow" -- got [${got}]`); }
}
{
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('Hi friends!', 'Hi friends! Build day is TOMORROW.');
  const got = runChecks(d, NOTES, VAULT, { leadDays: 1 }).map(f => f.id);
  const ok = !got.includes('temporal-mismatch');
  if (ok) { passed++; console.log('  ok   lead 1 accepts "tomorrow"'); }
  else { failed++; console.log(`  FAIL lead 1 accepts "tomorrow" -- got [${got}]`); }
}

console.log('\ntells a human named, then measured');
// Zach, 2026-09-26, on a posted draft: "still sounds slightly AI... especially
// corny". Both of these came out of one sentence pair in it.
expectFinding('three clauses opening with the same word', d => {
  d.body = d.body.replace('Cost unknown.',
    'Tell us what feels wrong, what lags, what you expected to happen and did not.');
}, 'parallel-clauses');
expectWarn('reassurance that nothing is needed', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('Cost unknown.', 'No tools and no skills needed for that part.');
  return d;
})(), 'unasked-reassurance');
// The archive's own analogue must survive both: same template, concrete nouns.
expectClean('the archive\'s concrete version is not flagged', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('Cost unknown.', 'No tent, no HDMI grabs. Just projectors and speakers.');
  return d;
})());
// Two parallel clauses are ordinary English; only three trip it.
expectClean('two parallel clauses are fine', (() => {
  const d = structuredClone(CLEAN);
  d.body = d.body.replace('Cost unknown.', 'Say what lags and what feels wrong.');
  return d;
})());

// A short heads-up is not warned for lacking `!`: among the operator's day-before
// announcements the rate is 93-95% above 150 chars but 60% below it, on n=5 with a CI
// of [23,88] -- a sample that cannot resolve anything, so the exemption is the
// honest reading. (This case was originally justified by "the real Half Moon nudge
// carries no `!`". That message was aedile's own output, per five
// recap_draft_posted Log rows, so it proved nothing about the list. The body below
// is kept as a plausible short notice, not as a quoted specimen.)
{
  const nudge = { subject: 'Half Moon tonight',
    body: 'Half Moon tonight, kitchen opens at 5: wings, pizza, skeeball.\n\nBring a buddy',
    confidence: 'high' };
  const notes = 'Half Moon tonight, kitchen opens at 5. Wings, pizza, skeeball. Bring a buddy.';
  const asHeadsup = runChecks(nudge, notes, VAULT, { genre: 'headsup' }).map(f => f.id);
  const asRecap = runChecks(nudge, notes, VAULT, {}).map(f => f.id);
  const ok = !asHeadsup.includes('no-exclamation') && asRecap.includes('no-exclamation');
  if (ok) { passed++; console.log('  ok   a short nudge is not warned for having no exclamation mark'); }
  else {
    failed++;
    console.log('  FAIL a short nudge is not warned for having no exclamation mark');
    console.log(`       headsup=[${asHeadsup}] recap=[${asRecap}]`);
  }
}

console.log('\nthe heads-up genre is graded by its own form rules');
// AEDILE_CONTEXT.headsup.md: the terse register signs ~47% of the time and "the
// barest form is a single unsigned line". This file used to FAIL that at blocking
// level, so the archetypal nudge could not be posted. The asymmetry is the point,
// so both directions are asserted.
const NUDGE = { subject: '1pm tomorrow!', body: '1pm tomorrow! 920 St. Mary',
                confidence: 'high' };
const NUDGE_NOTES = 'Build day 1pm tomorrow at 920 St. Mary. Zach confirmed.';
const levelsOf = (d, opts) => runChecks(d, NUDGE_NOTES, VAULT, opts)
  .filter(f => f.id === 'sign-off').map(f => f.level);

{
  const asRecap = levelsOf(NUDGE, {});
  const asHeadsup = levelsOf(NUDGE, { genre: 'headsup' });
  const ok = asRecap[0] === 'fail' && asHeadsup[0] === 'warn';
  if (ok) { passed++; console.log('  ok   an unsigned nudge blocks as a recap and only warns as a heads-up'); }
  else {
    failed++;
    console.log('  FAIL an unsigned nudge blocks as a recap and only warns as a heads-up');
    console.log(`       recap=[${asRecap}] headsup=[${asHeadsup}]`);
  }
}

// Numbering is NOT graded for a heads-up, in either direction. It measures 44% of
// the operator's day-before Sunday messages, CI [25, 66], and devices.mjs deals it
// at that rate. A `numbered-headsup` warn used to live here, written off prose that
// said a single-venue heads-up "should not be numbered", and it fired on drafts
// whose own dealt hand had told them to number. Whatever the dealer owns, this file
// does not grade.
{
  const numbered = { subject: 'build day tomorrow',
    body: '1. BUILD DAY IS TOMORROW. 920 St. Mary, 1pm!\n\n<3\nSM', confidence: 'high' };
  const plain = { subject: 'build day tomorrow',
    body: 'Build day tomorrow. 920 St. Mary, 1pm!\n\n<3\nSM', confidence: 'high' };
  const ids = d => runChecks(d, NUDGE_NOTES, VAULT, { genre: 'headsup' }).map(f => f.id);
  const a = ids(numbered), b = ids(plain);
  const ok = !a.includes('numbered-headsup') && !a.includes('no-numbering')
          && !b.includes('numbered-headsup') && !b.includes('no-numbering');
  if (ok) { passed++; console.log('  ok   numbering is not graded either way for a heads-up'); }
  else {
    failed++;
    console.log('  FAIL numbering is not graded either way for a heads-up');
    console.log(`       numbered=[${a}] plain=[${b}]`);
  }
  // A recap still gets the warn: that population really does number almost everything.
  const asRecap = runChecks(plain, NUDGE_NOTES, VAULT, {}).map(f => f.id);
  if (asRecap.includes('no-numbering')) { passed++; console.log('  ok   a recap is still warned for not numbering'); }
  else { failed++; console.log(`  FAIL a recap is still warned for not numbering -- got [${asRecap}]`); }
}

// Spacing is skipped rather than passed: a two-line notice has no modal gap.
{
  const got = runChecks(NUDGE, NUDGE_NOTES, VAULT, { genre: 'headsup' }).map(f => f.id);
  const ok = !got.includes('uniform-spacing') && !got.includes('tight-default-spacing');
  if (ok) { passed++; console.log('  ok   digest spacing rules are not applied to a terse notice'); }
  else {
    failed++;
    console.log('  FAIL digest spacing rules are not applied to a terse notice');
    console.log(`       got [${got.join(', ')}]`);
  }
}

// What does NOT relax. An invented figure and the em-dash are genre-neutral.
{
  const bad = { ...NUDGE, body: '2pm tomorrow! 920 St. Mary, bring a soldering iron \u2014 or a friend' };
  const got = runChecks(bad, NUDGE_NOTES, VAULT, { genre: 'headsup' })
    .filter(f => f.level === 'fail').map(f => f.id);
  const ok = got.includes('invented-figure') && got.includes('em-dash');
  if (ok) { passed++; console.log('  ok   invented figures and em-dashes still block a heads-up'); }
  else {
    failed++;
    console.log('  FAIL invented figures and em-dashes still block a heads-up');
    console.log(`       got [${got.join(', ') || 'none'}]`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
