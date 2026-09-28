#!/usr/bin/env node
/**
 * recap-form.mjs -- the measured form of a recap: how many items, how fat each
 * one is, how long the whole thing runs.
 *
 *   node aedile/analysis/recap-form.mjs            # the report
 *   node aedile/analysis/recap-form.mjs --block    # the prompt block it emits
 *
 * WHY THIS EXISTS. `analysis/headsup-form.mjs` computes the heads-up's form every
 * run, and `redige.mjs` appends it -- but only for `--genre headsup`. A recap got
 * the two quoted example recaps and the prose in AEDILE_CONTEXT.recap.md, and
 * nothing that measured anything about its shape. Zach, 2026-09-27, on a draft
 * carrying seven thin items: "Is this level of detail right? what's measurable in
 * the archive and how is that mechanically wired into the redige script already?"
 * For the recap the answer was: nothing was. The draft ran 7 items at 28 words
 * each against an archive median of 5 items at 42 words, i.e. it was not too
 * detailed, it was too SUBDIVIDED -- a shape no reader had a number for.
 *
 * The property is established the way headsup-form.mjs demands: it holds on both
 * sides of the Abe/successor split (43 words per item to 2024, 42 from 2025), so
 * it is about the genre and not about one author.
 *
 * POOL: operator-authored, signed, 400-4000 characters -- the same pool
 * devices.mjs measured its device rates on, so a figure here and a rate there
 * describe the same population.
 */

import { load, median } from './corpus.mjs';

const MIN = 400, MAX = 4000;

/** `<3 MS` / `, MS` / a trailing `MS` line. Same test cadence.mjs uses: a recap
 *  is a signed message, and an unsigned fragment is usually a snippet. */
const signed = b => {
  const t = b.trim().slice(-60);
  return /<3/.test(t) || /(^|\n)\s*(MS|SM)\s*$/.test(t) || /,\s*(MS|SM)\s*$/.test(t);
};

const words = s => s.split(/\s+/).filter(Boolean).length;

/** HAND-CURATED, and the only figure in this file that is not derived. Three
 *  automatic sources were tried on 2026-09-27 and all three are wrong:
 *  `people/` filenames are mangled email local-parts (`Tylernomacorg`,
 *  `Cragmailcom`), so Tyler, Chris, Josh, Kevin, Brandon and Daryll are absent
 *  and the rate came out 5%; the `author` display names survive for only 11
 *  people, giving 3%; and taking every mid-sentence capitalised token gave 47%
 *  by counting Canal, Esplanade, Raspberry and Need as people.
 *
 *  So this list is eyeballed off the mid-sentence frequency table, and the rate
 *  it produces is an UPPER BOUND -- a place or a thing wrongly kept inflates it.
 *  That is good enough for the finding it supports, because the finding survives
 *  all three name sets: 3%, 25% and 47% are each far below the 86-88% the
 *  generator was writing. Direction, not decimal. */
export const NAMES = ['Abraham', 'Adam', 'Alex', 'Asha', 'Ben', 'Brandon', 'Chuck', 'Dan', 'Elliot',
  'Elliott', 'Fran', 'Francesca', 'George', 'Haley', 'Ingrid', 'Izze', 'Jacob', 'Jake', 'Jeff', 'Joe',
  'Joseph', 'Jordan', 'Ken', 'Kevin', 'Laura', 'Lauren', 'Margaret', 'Michael', 'Nick', 'Nora', 'Olin',
  'Paul', 'Phoebe', 'Rich', 'Ryan', 'Seymore', 'Smitty', 'Stephen', 'Telemachus', 'Tricia', 'Tyler',
  'Vanessa', 'Zach'];

/** "Kevin is bringing the projector", "Stephen will email them" -- a name plus a
 *  verb of commitment. This is the shape a recap uses sparingly and a project
 *  tracker uses in every line. */
export const ownerRe = (names = NAMES) => new RegExp(
  `\\b(?:${names.join('|')})\\b(?:\\s+\\w+){0,3}?\\s+(?:is|are|will|has|can|should|needs? to|volunteered|wants|said)\\b`);
const nameRe = (names = NAMES) => new RegExp(`\\b(?:${names.join('|')})\\b`);

/** The numbered items of a body, split on the numbering itself. Text before the
 *  first number (greeting, preamble) is not an item and is dropped -- counting it
 *  is what turned 42 words per item into 60 on the first pass. */
const itemsOf = b => b.split(/(?=(?:^|\n)\s*-?\d+[.)]\s)/)
  .filter(s => /^\s*-?\d+[.)]\s/.test(s));

export function pool({ since = null, until = null } = {}) {
  return load({ since, until })
    .filter(m => m.body.length >= MIN && m.body.length <= MAX)
    .filter(m => signed(m.body))
    .map(m => m.body);
}

/** Every figure the block quotes, from one pool, so the report and the prompt
 *  cannot disagree. */
export function form(p = pool()) {
  const numbered = p.map(itemsOf).filter(a => a.length);
  const items = numbered.flat();
  const lens = items.map(words).sort((a, b) => a - b);
  const at = q => lens[Math.floor(lens.length * q)] || 0;
  const rate = re => Math.round(100 * items.filter(t => re.test(t)).length / (items.length || 1));
  return {
    n: p.length,
    numberedPct: Math.round(100 * numbered.length / (p.length || 1)),
    words: median(p.map(words)),
    items: median(numbered.map(a => a.length)),
    wordsPerItem: median(items.map(words)),
    // The spread, because the median alone instructs uniformity -- and uniformity
    // is the tell style.mjs ranks (#29). A real recap mixes a one-line item in
    // with a fat paragraph.
    p25: at(0.25), p75: at(0.75),
    shortPct: Math.round(100 * items.filter(t => words(t) <= 15).length / items.length),
    longPct: Math.round(100 * items.filter(t => words(t) >= 60).length / items.length),
    namePct: rate(nameRe()),
    ownerPct: rate(ownerRe()),
    names: NAMES,
  };
}

/** The form section, computed. Mirrors headsup-form.mjs's formBlock(): a number
 *  here cannot drift from the corpus because it is read from it. */
export function formBlock() {
  const f = form();
  return [
    '## Form, measured (not asserted)',
    '',
    `Computed from the ${f.n} signed recap-length messages the operator actually sent.`,
    '',
    `- **About ${f.items} numbered items.** Not ${f.items + 3} and not 2. ${f.numberedPct}% of these messages`,
    '  number their items at all. Merge related material rather than splitting it finer:',
    '  one item that says everything about the cinema beats three that each say a third.',
    `- **Vary the item lengths.** Median ${f.wordsPerItem} words, but a quarter run ${f.p25} or fewer and`,
    `  ${f.longPct}% run 60 or more; ${f.shortPct}% are one line. Items that are all the same length are`,
    '  the single clearest sign an email was generated. Some items are a paragraph, some',
    '  are six words.',
    `- **About ${f.words} words overall -- but ONLY what the notes support.** If the notes give`,
    '  a topic six words, the item is six words. Never pad an item to reach a length:',
    '  everything you add that the notes do not contain is an invented fact, and that is',
    '  where a made-up time, place or joke comes from. A short honest recap is correct.',
    `- **Name a person in about ${f.namePct}% of items, and say who owes something in about ${f.ownerPct}%.**`,
    '  A recap reports what the room settled, not who owes what. Naming an owner in every',
    '  item reads like a project tracker, and this list has never received one.',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--block')) { console.log(formBlock()); process.exit(0); }
  const all = form();
  console.log(`pool: operator, signed, ${MIN}-${MAX} chars`);
  console.log(`  n=${all.n}  numbered ${all.numberedPct}%  words ${all.words}  items ${all.items}  words/item ${all.wordsPerItem}`);
  // The era split is the A-vs-B check: if the figure survives it, the rule is
  // about the genre. If it does not, it is about Abe and must not be a rule.
  for (const [label, sel] of [['<=2024 (Abe)', { until: 2024 }], ['>=2025 (successor)', { since: 2025 }]]) {
    const f = form(pool(sel));
    console.log(`  ${label.padEnd(20)} n=${String(f.n).padStart(3)}  words ${f.words}  items ${f.items}  words/item ${f.wordsPerItem}`);
  }
}
