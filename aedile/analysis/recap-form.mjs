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
  return {
    n: p.length,
    numberedPct: Math.round(100 * numbered.length / (p.length || 1)),
    words: median(p.map(words)),
    items: median(numbered.map(a => a.length)),
    wordsPerItem: median(numbered.flatMap(a => a.map(words))),
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
    `- **About ${f.items} numbered items.** Not ${f.items + 2} and not 2. ${f.numberedPct}% of these messages`,
    '  number their items at all.',
    `- **About ${f.wordsPerItem} words per item**, and that is the figure to hit. An item is a short`,
    '  paragraph, not a headline: it carries the detail that makes the item actionable',
    '  (who is doing it, where, what is still unknown).',
    `- **About ${f.words} words overall.**`,
    '',
    'These three are one shape, and the failure mode is splitting the same material',
    'into more, thinner items to look thorough. Merge related items instead: one fat',
    'item that says everything about the cinema beats three that each say a third.',
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
