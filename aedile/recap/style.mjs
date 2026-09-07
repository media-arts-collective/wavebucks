#!/usr/bin/env node
/**
 * style.mjs -- measure the generator against the archive, and rank what is off.
 *
 *   ./style.mjs [burst.json] [--all]
 *
 * Zach, after the first burst came back 33%: "is there a general punctuation
 * frequency, capitalization frequency, numbering frequency, etc. we can
 * measure? or like when jokes happen, what percentage, where in the message?"
 *
 * So this does not pick metrics by hand. Every punctuation mark that appears in
 * either corpus becomes a metric automatically, and everything is ranked by how
 * far the generator sits from the archive. Choosing what to measure is how you
 * miss the thing you did not think of: the em-dash was found by a human eye in
 * a duel, not by a metric anyone had written.
 *
 * Four families:
 *
 *   RATE      per 1,000 characters, averaged per message
 *   SHARE     what fraction of messages do this at all
 *   SHAPE     structure: list lengths, sentence lengths, paragraph counts
 *   POSITION  WHERE in the message it happens, 0.0 = first line, 1.0 = sign-off
 *
 * POSITION is the one that answers the "where do jokes happen" half. Humour is
 * not mechanically detectable, but its carriers are: parenthetical asides,
 * exclamation clusters, and very short sentences. Where those sit in a message
 * is measurable, and a generator that puts its one joke in the same place every
 * time is as detectable as one that never jokes at all.
 *
 * With no burst it profiles the archive alone, which is how you get the
 * baseline before there is anything to compare.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';
const MS_ACCOUNT = 'kreweofvaporwave@gmail.com';

/** The same pool duel.mjs draws from, so the comparison is like for like. */
function corpus() {
  const path = join(VAULT, 'messages.jsonl');
  if (!existsSync(path)) { console.error(`style: no corpus at ${path}`); process.exit(3); }
  return readFileSync(path, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    .filter(m => m.email === MS_ACCOUNT && typeof m.body === 'string')
    .filter(m => m.body.length >= 400 && m.body.length <= 4000)
    .filter(m => /<3[\s\S]{0,4}MS\s*$/.test(m.body))
    .map(m => m.body);
}

// --- helpers -----------------------------------------------------------------

const count = (t, re) => (t.match(re) || []).length;
const per1k = (t, re) => 1000 * count(t, re) / (t.length || 1);
const sentences = t => t.split(/[.!?]+[\s"']|\n/).map(s => s.trim()).filter(s => s.length > 1);
const words = s => s.split(/\s+/).filter(Boolean);
const lines = t => t.split('\n');

/** Normalized positions (0 = start, 1 = end) of every match. */
function positions(t, re) {
  const out = [];
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = r.exec(t)) !== null) {
    out.push(m.index / (t.length || 1));
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

/** Which punctuation marks actually occur, so nothing is chosen by hand. */
function punctuationSet(...corpora) {
  const seen = new Map();
  for (const c of corpora) {
    for (const t of c) {
      for (const ch of t.replace(/[\w\s]/g, '')) seen.set(ch, (seen.get(ch) || 0) + 1);
    }
  }
  // Anything vanishingly rare in BOTH is noise, not style.
  return [...seen.entries()].filter(([, n]) => n >= 3).map(([ch]) => ch)
    .sort((a, b) => (seen.get(b) - seen.get(a)));
}

const esc = ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- the battery -------------------------------------------------------------

function battery(punct) {
  const RATE = punct.map(ch => [
    `punct  ${JSON.stringify(ch)}`, t => per1k(t, new RegExp(esc(ch), 'g')),
  ]);

  RATE.push(
    ['caps  ALLCAPS words',      t => per1k(t, /\b[A-Z]{3,}\b/g)],
    ['caps  Title Case words',   t => per1k(t, /(?<=[a-z,] )[A-Z][a-z]+/g)],
    ['caps  lowercase sentence starts', t => per1k(t, /(?:^|[.!?]\s+)[a-z]/g)],
    ['word  first person I',     t => per1k(t, /\bI\b/g)],
    ['word  we/us/our',          t => per1k(t, /\b(?:we|us|our)\b/gi)],
    ['word  contractions',       t => per1k(t, /\b\w+'(?:s|t|re|ll|ve|d|m)\b/gi)],
    ['joke  parenthetical asides', t => per1k(t, /\([^)]{8,}\)/g)],
    ['joke  exclamation clusters', t => per1k(t, /!{2,}/g)],
    ['joke  very short sentences', t => {
      const s = sentences(t); return s.length ? 1000 * s.filter(x => words(x).length <= 3).length / t.length : 0;
    }],
  );

  const SHARE = [
    ['has a numbered list',      t => /(?:^|\n)\s*-?\d+\.\s/.test(t)],
    ['numbers from 0 or -1',     t => /(?:^|\n)\s*(?:0|-1)\.\s/.test(t)],
    ['has a bulleted list',      t => /(?:^|\n)\s*[-*]\s/.test(t)],
    ['has an ALLCAPS run',       t => /\b[A-Z]{4,}\b/.test(t)],
    ['has an ALLCAPS whole line', t => lines(t).some(l => l.trim().length > 6 && l === l.toUpperCase() && /[A-Z]/.test(l))],
    ['has an em-dash',           t => /[—–]/.test(t)],
    ['has a semicolon',          t => /;/.test(t)],
    ['has an exclamation',       t => /!/.test(t)],
    ['has a question mark',      t => /\?/.test(t)],
    ['has a parenthetical',      t => /\([^)]{8,}\)/.test(t)],
    ['has a URL',                t => /https?:\/\//.test(t)],
    ['opens with a greeting',    t => /^(hi|hey|hello|good|greetings|howdy|yo)\b/i.test(t.trim())],
    ['opens straight into item 1', t => /^\s*-?\d+\./.test(t.trim())],
  ];

  const SHAPE = [
    ['mean sentence words',      t => { const s = sentences(t); return s.length ? s.reduce((a, x) => a + words(x).length, 0) / s.length : 0; }],
    ['longest sentence words',   t => { const s = sentences(t); return s.length ? Math.max(...s.map(x => words(x).length)) : 0; }],
    ['numbered items per msg',   t => count(t, /(?:^|\n)\s*-?\d+\.\s/g)],
    ['paragraphs per msg',       t => t.split(/\n\s*\n/).filter(p => p.trim()).length],
    ['mean paragraph chars',     t => { const p = t.split(/\n\s*\n/).filter(x => x.trim()); return p.length ? t.length / p.length : 0; }],
  ];

  // Where in the message, 0 = opening line, 1 = sign-off.
  const POSITION = [
    ['ALLCAPS run',              /\b[A-Z]{4,}\b/g],
    ['exclamation mark',         /!/g],
    ['parenthetical aside',      /\([^)]{8,}\)/g],
    ['question mark',            /\?/g],
    ['a URL',                    /https?:\/\/\S+/g],
    ['first person I',           /\bI\b/g],
  ];

  return { RATE, SHARE, SHAPE, POSITION };
}

// --- comparison --------------------------------------------------------------

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const meanOf = (c, f) => mean(c.map(f));
const shareOf = (c, f) => 100 * c.filter(f).length / (c.length || 1);
const meanPos = (c, re) => { const all = c.flatMap(t => positions(t, re)); return all.length ? mean(all) : NaN; };

/** How far off, signed and scale-free. Infinity when the archive never does it
 *  and the generator does: no percentage describes that honestly. */
function divergence(real, ai) {
  if (!isFinite(real) || !isFinite(ai)) return NaN;
  if (real === 0 && ai === 0) return 0;
  if (real === 0) return Infinity;
  return (ai - real) / real;
}

const fmtDiv = d => !isFinite(d) ? (isNaN(d) ? '' : 'new') : ((d > 0 ? '+' : '') + Math.round(d * 100) + '%');
const num = (v, p = 2) => isNaN(v) ? '–' : v.toFixed(p);

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const burstPath = args.find(a => !a.startsWith('--'));

const real = corpus();
const ai = burstPath
  ? (JSON.parse(readFileSync(burstPath, 'utf8')).pairs || []).map(p => p.ai)
  : null;

const { RATE, SHARE, SHAPE, POSITION } = battery(punctuationSet(real, ai || []));

const rows = [];
const add = (family, name, r, a, unit) => rows.push({ family, name, r, a, unit, d: divergence(r, a) });

for (const [name, f] of RATE) add('RATE', name, meanOf(real, f), ai ? meanOf(ai, f) : NaN, '/1k');
for (const [name, f] of SHARE) add('SHARE', name, shareOf(real, f), ai ? shareOf(ai, f) : NaN, '%');
for (const [name, f] of SHAPE) add('SHAPE', name, meanOf(real, f), ai ? meanOf(ai, f) : NaN, '');
for (const [name, re] of POSITION) add('POSITION', name, meanPos(real, re), ai ? meanPos(ai, re) : NaN, '0-1');

console.log(`archive pool: ${real.length} messages` + (ai ? `   generated: ${ai.length}` : ''));

for (const family of ['RATE', 'SHARE', 'SHAPE', 'POSITION']) {
  const group = rows.filter(r => r.family === family);
  if (!group.length) continue;
  const w = Math.max(...group.map(r => r.name.length));
  console.log(`\n${family}${family === 'POSITION' ? '  (0.0 = opening line, 1.0 = sign-off)' : ''}`);
  console.log('  ' + 'metric'.padEnd(w), 'archive'.padStart(9), (ai ? 'generated' : '').padStart(10), ai ? '  off by' : '');
  for (const r of group) {
    if (!showAll && !ai && r.family === 'RATE' && r.r < 0.05) continue;
    console.log('  ' + r.name.padEnd(w), num(r.r).padStart(9), (ai ? num(r.a) : '').padStart(10), ai ? '  ' + fmtDiv(r.d) : '');
  }
}

if (ai) {
  // Rank by how wrong, not by how interesting. A metric nobody chose can win.
  const scored = rows
    .filter(r => !isNaN(r.d) && (Math.abs(r.d) >= 0.4 || !isFinite(r.d)))
    // A mark that appears twice in the whole archive is not a style. Without
    // this floor the ranking fills with `~`, `=`, `&` at 0.06 per 1,000 chars,
    // each reading as a confident -100%, and the findings that matter get
    // pushed off the bottom.
    .filter(r => Math.max(r.r, r.a) >= (r.unit === '%' ? 5 : 0.15))
    .sort((x, y) => (isFinite(y.d) ? Math.abs(y.d) : 1e9) - (isFinite(x.d) ? Math.abs(x.d) : 1e9));

  console.log('\n' + '='.repeat(64));
  if (!scored.length) { console.log('nothing off by 40% or more.'); }
  else {
    console.log(`off by 40% or more, worst first (${scored.length}):\n`);
    for (const r of scored) {
      console.log(`  ${fmtDiv(r.d).padStart(7)}  ${r.name.padEnd(28)} archive ${num(r.r)}${r.unit}, generated ${num(r.a)}${r.unit}`);
    }
  }
}
