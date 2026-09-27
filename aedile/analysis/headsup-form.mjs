#!/usr/bin/env node
/**
 * headsup-form.mjs -- the measured form of a day-before/day-of heads-up, with
 * every property checked three independent ways before it is allowed to be a rule.
 *
 *   node aedile/analysis/headsup-form.mjs            # the report
 *   node aedile/analysis/headsup-form.mjs --block    # the prompt block it emits
 *
 * Zach, 2026-09-26: "so we're going to fix heads up today using actual statistical
 * measures, triple checked, three different ways".
 *
 * Why three. AEDILE_CONTEXT.headsup.md asserted a form in prose and was wrong twice
 * in one session in the same direction: it called both beats "terse" (the Sunday
 * gathering's day-before message is a median 134 words, middle half 52 to 279) and
 * said numbering "is NOT a lock-in trait" (44% of them are numbered, CI [25, 66]).
 * Both errors came from generalising one population to another.
 *
 * The same trap caught the summary that prompted this file: reading two specimens
 * by hand produced "each item carries its own time range" and "Abe names people in
 * nearly every bump", which measure 22% and 6%. Two documents and one pair of eyes
 * all failed the same way, so no property gets encoded on a single estimate.
 *
 * The three ways are deliberately different KINDS of check, not three flavours of
 * the same one:
 *
 *   A. POOL          the target population: Sunday meetings, lead 0-1 day, pre-2025.
 *   B. NEIGHBOUR     a differently-drawn population -- every pre-2025 announcement
 *                    at lead 0-1 day, Sunday or not, meeting or not. If a property
 *                    is about the BEAT it survives here; if it only holds for A it
 *                    is about the event type, and saying so matters.
 *   C. INTERVAL      Wilson 95% on A. n=18 makes some rates unlearnable, and a
 *                    width of +/-20 points is a fact about the rule, not a footnote.
 *
 * A property is ESTABLISHED when A and B agree inside A's interval. It is
 * EVENT-SPECIFIC when they disagree and A is the relevant one. It is UNDERPOWERED
 * when the interval spans the decision (roughly, contains 50%), and an
 * underpowered property must not become an instruction -- at best it becomes a
 * dealt probability, which is what devices.mjs is for.
 */

import {
  load, isAnnouncement, eventDay, dayNum, localHour, median, wilson, ADDRESS_RE,
  isFullBody,
} from './corpus.mjs';

const ERA_UNTIL = 2024;   // Abe. See corpus.mjs: one account, two authors.

// --- the three pools --------------------------------------------------------

// Snippets excluded: 28% of the corpus is a ~101-char Google Groups preview, and two
// of them were in this pool, holding the length target at 134 words when the full
// bodies give 173. See isFullBody in corpus.mjs for the histogram.
const all = load({ until: ERA_UNTIL }).filter(isFullBody);
const anns = all.filter(m => isAnnouncement(m.body));

/** lead in days from send to the event this message points at, or null. */
const leadOf = m => { const ev = eventDay(m); return ev === null ? null : ev - dayNum(m._d); };

const withLead = anns.map(m => ({ m, lead: leadOf(m) })).filter(x => x.lead !== null);

const SUNDAYISH = /\b(brunch|meeting|meet|build|work ?day|production|load|rehears)/i;
const isSunday = x => new Date((dayNum(x.m._d) + x.lead) * 86400000).getUTCDay() === 0;

const POOL = withLead.filter(x => x.lead >= 0 && x.lead <= 1 && isSunday(x) && SUNDAYISH.test(x.m.body));
const NEIGHBOUR = withLead.filter(x => x.lead >= 0 && x.lead <= 1);

// --- properties -------------------------------------------------------------

const GREET_A = b => /^\s*(hi|hello|hey|hiya|yo|good (morning|evening|afternoon)|greetings|dear|friends|happy|ok|okay)\b/i.test(b);
// A second, independent operationalisation: a short opening line that is not a
// sentence about the event. Used to check the greeting rate is not an artifact of
// the word list above.
const GREET_B = b => { const first = b.trim().split('\n')[0] || ''; return first.length <= 24 && !/\d/.test(first); };

const PROPS = {
  greeting:      b => GREET_A(b),
  'greeting (alt detector)': b => GREET_B(b),
  exclamation:   b => /!/.test(b),
  numbered:      b => /(?:^|\n)\s*-?\d+\.\s/.test(b),
  allCaps:       b => /\b[A-Z]{4,}\b/.test(b),
  signOff:       b => /(<3|\bxo+\b|\bbest\b|\bMS\b|\bSM\b)\s*$/i.test(b.trimEnd()),
  restatesPlace: b => ADDRESS_RE.test(b),
  timeRange:     b => /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)?\s?[-–]\s?\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b\d{1,2}\s?-\s?\d{1,2}(?:ish)?\b/i.test(b),
  namesPeople:   b => (b.match(/(?:^|\n)\s*[A-Z][a-z]+(?: [A-Z][a-z]*)?\s*$/gm) || []).length >= 2,
};

const words = b => (b.trim().match(/\S+/g) || []).length;

// --- report -----------------------------------------------------------------

const pct = x => (100 * x).toFixed(0).padStart(3) + '%';
const rows = [];

for (const [name, fn] of Object.entries(PROPS)) {
  const a = POOL.filter(x => fn(x.m.body)).length;
  const b = NEIGHBOUR.filter(x => fn(x.m.body)).length;
  const A = wilson(a, POOL.length);
  const B = wilson(b, NEIGHBOUR.length);
  const agrees = B.p >= A.lo && B.p <= A.hi;
  const underpowered = A.lo <= 0.5 && A.hi >= 0.5;
  const verdict = underpowered ? 'UNDERPOWERED'
    : agrees ? 'ESTABLISHED'
    : 'EVENT-SPECIFIC';
  rows.push({ name, A, B, agrees, verdict });
}

if (!process.argv.includes('--block')) {
  console.log(`era: <=${ERA_UNTIL} (Abe)   operator messages: ${all.length}   announcements: ${anns.length}`);
  console.log(`A/POOL      Sunday meeting, lead 0-1d   n=${POOL.length}`);
  console.log(`B/NEIGHBOUR any announcement, lead 0-1d  n=${NEIGHBOUR.length}`);
  console.log('');
  console.log('property                    A/POOL   95% CI        B/NEIGHBOUR  verdict');
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(24)} ${pct(r.A.p)}  [${pct(r.A.lo)},${pct(r.A.hi)}]  `
      + `${pct(r.B.p)}        ${r.verdict}`);
  }
  console.log('');
  const wA = POOL.map(x => words(x.m.body)), wB = NEIGHBOUR.map(x => words(x.m.body));
  const sorted = [...wA].sort((x, y) => x - y);
  console.log('LENGTH (words):');
  console.log(`  A/POOL      median ${median(wA)}  quartiles ${sorted[Math.floor(sorted.length / 4)]}..${sorted[Math.floor(3 * sorted.length / 4)]}  range ${Math.min(...wA)}..${Math.max(...wA)}`);
  console.log(`  B/NEIGHBOUR median ${median(wB)}`);
  console.log('');
  console.log('SEND HOUR (local):');
  for (const lead of [0, 1]) {
    const h = POOL.filter(x => x.lead === lead).map(x => localHour(x.m._d));
    const hb = NEIGHBOUR.filter(x => x.lead === lead).map(x => localHour(x.m._d));
    console.log(`  lead ${lead}d   A median ${median(h)}h (n=${h.length})   B median ${median(hb)}h (n=${hb.length})`);
  }
  console.log('');
  console.log('Only ESTABLISHED and EVENT-SPECIFIC properties become instructions.');
  console.log('UNDERPOWERED ones belong in devices.mjs as a dealt probability, or nowhere.');
}

/** The device rates for this genre, measured. Exported so devices.mjs does not have
 *  to carry them as literals.
 *
 *  They WERE literals: `GENRE_P = { greeting: 0.67, numberedList: 0.44, ... }`, typed
 *  into devices.mjs by reading this file's output and rounding. Correct on the day
 *  and a snapshot forever after -- the same defect as a prose prompt, one indirection
 *  removed. A re-scrape of the corpus is in progress in another worktree, and it
 *  would have updated formBlock() while leaving those four numbers frozen and
 *  nothing would have failed.
 *
 *  Only rates that were re-measured on this subpool are returned. A device absent
 *  here keeps the 400-4000 char pool's value in devices.mjs, which is a known
 *  approximation rather than a silent one. */
export function measuredRates() {
  const get = n => rows.find(r => r.name === n);
  return {
    greeting: get('greeting').A.p,
    numberedList: get('numbered').A.p,
    allCaps: get('allCaps').A.p,
    question: wilson(POOL.filter(x => /\?/.test(x.m.body)).length, POOL.length).p,
  };
}

// --- the emitted prompt block ----------------------------------------------

/** The form section, computed. This replaces the hand-written Form rules in
 *  AEDILE_CONTEXT.headsup.md: those were a snapshot, and the snapshot was wrong.
 *  A number here cannot drift from the corpus because it is read from it. */
export function formBlock() {
  const wA = POOL.map(x => words(x.m.body));
  const sorted = [...wA].sort((x, y) => x - y);
  const q1 = sorted[Math.floor(sorted.length / 4)], q3 = sorted[Math.floor(3 * sorted.length / 4)];
  const get = n => rows.find(r => r.name === n);
  const say = [];

  say.push('## Form, measured (not asserted)',
    '',
    `Computed from the ${POOL.length} day-before and day-of messages the operator actually sent`,
    `about a Sunday gathering, up to ${ERA_UNTIL}. Percentages are of those messages.`,
    '');

  // The median is the TARGET. An earlier version of this block offered the
  // interquartile range as "real latitude", which is how a 55-word draft got
  // written and posted against a 134-word norm: a spread quoted as permission.
  const itemLens = POOL.flatMap(x => x.m.body.split(/(?=(?:^|\n)\s*-?\d+\.\s)/)
    .filter(t => /^\s*-?\d+\.\s/.test(t)).map(t => words(t)));
  const paras = POOL.map(x => x.m.body.split(/\n\s*\n/).filter(t => t.trim()).length);
  // Computed, not typed. "Only 3 of 18 first lines contain a number" was a literal in
  // this function -- a hand-copied count inside the very block written to stop numbers
  // being hand-copied, and it went stale the moment the pool changed size.
  const digitsFirst = POOL.filter(x => /\d/.test(x.m.body.trim().split('\n')[0])).length;
  say.push(`- **Write about ${median(wA)} words.** That is the target, not a floor. Half of these`,
    `  messages fall between ${q1} and ${q3} words, but aim at ${median(wA)}: a draft near the bottom of`,
    '  that range is thin, not concise.',
    `- **About ${median(paras)} paragraph blocks.**`,
    `- **If you number items, each item is a TOPIC with real content: median ${median(itemLens)} words,`,
    `  and not one of the ${itemLens.length} items in the corpus is under 10.** Numbering a bare clock`,
    '  time ("1. 1pm: sausages") is not what the list does; an item explains the thing.',
    '  If you have nothing to say about an item, it is not an item.',
    `- **Do not open with digits.** Only ${digitsFirst} of ${POOL.length} first lines contain a`,
    '  number. The opening is a greeting or a short framing line; logistics follow it.');

  // Phrasing follows the RATE, not the verdict. A well-established 6% is still a
  // reason NOT to do something, and an earlier version of this function printed
  // "Name the people involved" as a bold instruction off a 6% rate because it
  // confused "we are confident about this number" with "the number is high".
  //
  // Devices dealt in devices.mjs (greeting, numbering, ALL-CAPS, questions) are
  // deliberately absent: they are coin-flips, the dealer already draws them at these
  // same measured rates, and instructing on them here would fight the hand.
  const band = (name, high, mid, low) => {
    const r = get(name);
    if (!r) return;
    const p = r.A.p, ci = `${(100 * r.A.lo).toFixed(0)}-${(100 * r.A.hi).toFixed(0)}%`;
    const only = r.verdict === 'EVENT-SPECIFIC'
      ? ` This one belongs to this kind of gathering: ${(100 * r.B.p).toFixed(0)}% across announcements generally.`
      : '';
    if (p >= 0.75) say.push(`- **${high}** ${(100 * p).toFixed(0)}% do.${only}`);
    else if (p >= 0.4) say.push(`- ${mid} ${(100 * p).toFixed(0)}%, CI ${ci}, so genuinely either way.${only}`);
    else say.push(`- ${low} Only ${(100 * p).toFixed(0)}% do.${only}`);
  };

  band('exclamation',
    'At least one exclamation mark.', 'An exclamation mark:', 'Rarely an exclamation mark.');
  band('restatesPlace',
    'Restate the street address in the body, not only in the subject.',
    'Restating the address:', 'Usually no address in the body.');
  band('signOff', 'Close with the sign-off.', 'A sign-off:', 'Usually unsigned.');
  band('timeRange',
    'Give each item a time RANGE.', 'A time range on an item:',
    'Do NOT give items time ranges; state the times plainly.');
  band('namesPeople',
    'List the people involved one per line.', 'A list of names:',
    'Do NOT list people one per line. That is a crew-roster habit from staffed gigs, not this.');

  const h0 = POOL.filter(x => x.lead === 0).map(x => localHour(x.m._d));
  const h1 = POOL.filter(x => x.lead === 1).map(x => localHour(x.m._d));
  say.push('',
    `Sent morning-of (median ${median(h0)}h, n=${h0.length}) or during the day before`,
    `(median ${median(h1)}h, n=${h1.length}). The operator chooses that, not you.`);
  return say.join('\n');
}

if (process.argv.includes('--block')) console.log(formBlock());
