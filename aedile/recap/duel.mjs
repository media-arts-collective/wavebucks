#!/usr/bin/env node
// duel.mjs -- build a burst of real-vs-generated pairs for the voice duel.
//
//   ./duel.mjs [--n 12] [--out pairs.json] [--used .duel-used.json] [--seed 7]
//
// Per pair: (A) de-voice the real email to bare factual bullets, (B) regenerate
// those through the same prompt redige.mjs builds. Imports redige.mjs rather
// than shelling out, so there is one copy of the prompt assembly.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readVault, buildSystemPrompt, callModelAsync, parseDecision } from './redige.mjs';
import { normalize, isRagged } from './normalize.mjs';
import { dealDevices, dealFlourish, dealTypo, dealSignoff, devicesBlock } from './devices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';

// The krewe's own account.
const MS_ACCOUNT = 'kreweofvaporwave@gmail.com';

// Below MIN there is no prose to judge; above MAX is a different reading task.
const MIN_CHARS = 400, MAX_CHARS = 4000;

// The threads hardcoded as few-shot examples in redige.mjs: duelling against one is not a test.
const FEWSHOT_URLS = ['PpYQ3C6toiQ', 'IO3RQJWWafk'];

/** Where the burst data is spliced into the committed template. */
const PAGE_SLOT = '/*__PAIRS__*/{"seed":0,"pairs":[]}';

const die = (msg, code = 1) => { console.error(`duel: ${msg}`); process.exit(code); };

const idOf = body => createHash('sha1').update(body).digest('hex').slice(0, 10);

// --- the pool ----------------------------------------------------------------

// MS-authored, long enough to judge, and ending in `<3` + initials: normalize.mjs
// keeps the `<3` and strips the initials, which is only safe if every specimen has one.
function pool() {
  const path = join(VAULT, 'messages.jsonl');
  if (!existsSync(path)) die(`no corpus at ${path} (set KREWE_VAULT)`, 3);
  return readFileSync(path, 'utf8').trim().split('\n')
    .map(l => JSON.parse(l))
    .filter(m => m.email === MS_ACCOUNT)
    .filter(m => typeof m.body === 'string')
    .filter(m => m.body.length >= MIN_CHARS && m.body.length <= MAX_CHARS)
    .filter(m => /<3[\s\S]{0,4}MS\s*$/.test(m.body))
    .filter(m => !FEWSHOT_URLS.some(u => String(m.topic_url || '').includes(u)))
    .map(m => ({ id: idOf(m.body), date: m.date, url: m.topic_url, body: m.body }));
}

/** Deterministic shuffle, so `--seed` reproduces a burst exactly. */
function shuffled(items, seed) {
  let s = seed >>> 0 || 1;
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- step A: de-voice --------------------------------------------------------

export const DEVOICE_PROMPT = `You reduce a piece of writing to its facts, discarding the writing.

Given an email, return ONLY a bulleted list of the facts it contains.

STRUCTURE -- follow the original, do not improve it:
- One bullet per unit of the original, in the order it was written. A unit is a
  paragraph, a numbered or bulleted item, or a trailing afterthought.
- If a unit jams three unrelated facts together, that is ONE bullet carrying
  three facts. Do not split it, and never group facts by topic.
- If the original says something twice, say it twice, where it happened.
- If the original ends in a P.S. or a late addition, keep it last.
- Do not reorder into a taxonomy. What was put together, and in what order, is
  a fact about the message and must survive.

CONTENT, all of them strict:
- Fragments, never sentences. "- storage run tonight, 7pm, bring hands"
- Keep every date, time, address, dollar figure, URL and proper name EXACTLY
  as written. Those are facts and they must survive.
- Discard every greeting, sign-off, joke, aside, insult, curse, exclamation
  and figure of speech. Discard all humour. Discard the writer entirely.
- NEVER reuse a distinctive phrase from the original. If the original says
  "cynical, joyless, spendthrift friends", you write "friends". State each
  fact in the plainest, most ordinary words available to you.
- No adjectives of judgement or attitude. No editorialising. No tone.

The output is what someone jotted while reading the message once, top to
bottom, tidying nothing. It must be impossible to tell from the notes who wrote
the original or how they write -- but the shape of what they wrote, what they
put together and what order they put it in, must still be there.

Output the bullets and nothing else.`;

// Verbatim word-runs the generated body shares with the real one. The default n
// is long because a content-matched pair shares shorter fact-carrying runs by construction.
export function leaks(source, text, n = 10) {
  const grams = s => {
    const w = String(s).toLowerCase().match(/[a-z0-9']+/g) || [];
    const out = new Set();
    for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
    return out;
  };
  const src = grams(source);
  return [...grams(text)].filter(g => src.has(g));
}

/** Words that carry no content. A run matching the notes once these are
 *  dropped is a fact the notes preserved, not phrasing the generator lifted. */
const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'and', 'or',
  'for', 'with', 'is', 'are', 'be', 'will', 'we', 'our', 'it', 'this', 'that',
  'from', 'by', 'as', 'up', 'out', 'over', 'into', 'there', 'their', 'some',
  // Connectives the de-voicing strips and grammar puts straight back.
  'both', 'until', 'then', 'after', 'before', 'all', 'any', 'each', 'so',
  'but', 'if', 'when', 'while', 'have', 'has', 'had', 'been', 'was', 'were']);

const content = s => (String(s).toLowerCase().match(/[a-z0-9']+/g) || [])
  .filter(w => !STOP.has(w));

// Did the notes already carry this run's content? The generator only sees the
// notes, so a run matching them once stopwords are dropped is a preserved fact.
export const carriedByNotes = (run, notes) =>
  content(notes).join(' ').includes(content(run).join(' '));

// Structural units: a blank-line block, or each list item inside one. The
// witness that step A kept the original's shape.
export const units = s => String(s).split(/\n\s*\n/)
  .flatMap(b => {
    const items = b.split('\n').filter(l => /^\s*(?:[-*\u2022]|\d+[.)])\s+/.test(l));
    return items.length ? items : [b];
  })
  .filter(u => u.trim()).length;

// --- a pair ------------------------------------------------------------------

async function buildPair(specimen, systemPrompt, seed) {
  const notes = (await callModelAsync(DEVOICE_PROMPT, specimen.body)).trim();

  // The shipping prompt plus the target length: a length gap is a tell unrelated to voice.
  // Seeded on the specimen so a burst reproduces its hands from --seed.
  const hand = dealDevices(`${seed}:${specimen.id}`);
  const flourish = dealFlourish(`${seed}:${specimen.id}`);
  const typo = dealTypo(`${seed}:${specimen.id}`);
  const signoff = dealSignoff(`${seed}:${specimen.id}`);

  const sized = [
    systemPrompt,
    devicesBlock(hand, [flourish, signoff].filter(Boolean).join('\n- '), typo),
    `## Length for this one\n\nThe finished \`body\` should be roughly ${specimen.body.length} characters. Match that; do not pad and do not truncate.`,
  ].filter(Boolean).join('\n\n');

  const decision = parseDecision(await callModelAsync(sized, notes));
  const shared = leaks(specimen.body, decision.body || '');

  return {
    unexplained: shared.filter(g => !carriedByNotes(g, notes)),
    id: specimen.id,
    date: specimen.date,
    url: specimen.url,
    hand,
    flourish,
    typo: Boolean(typo),
    real: normalize(specimen.body),
    ai: normalize(decision.body || ''),
    units: { real: units(specimen.body), notes: units(notes), ai: units(decision.body || '') },
    notes,
    leaks: shared,
    confidence: decision.confidence,
  };
}


// Fill the template with a burst and write a playable page. Generated, never
// committed: it carries verbatim private messages and this repo is public.
function writePage(pairs, seed, out) {
  const tpl = readFileSync(join(HERE, 'duel.html'), 'utf8');
  if (!tpl.includes(PAGE_SLOT)) die('duel.html has no injection point', 4);
  // `<` is escaped because the payload is spliced inside a <script> block;
  // `<` decodes back to `<`, so `<3` survives.
  const payload = JSON.stringify({ seed, pairs: pairs.map(p => ({
    id: p.id, date: p.date, real: p.real, ai: p.ai,
  })) }).replace(/</g, '\\u003c');
  writeFileSync(out, tpl.replace(PAGE_SLOT, payload));
  console.error(`-- page: ${out} (${pairs.length} pairs)`);
}

// --- main --------------------------------------------------------------------

function arg(args, name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) die(`${name} needs a value`, 2);
  return v;
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help')) {
    console.error('usage: duel.mjs [--n 12] [--out pairs.json] [--page FILE] [--used FILE] [--seed N] [--jobs 4]\n       duel.mjs --from pairs.json --page FILE');
    process.exit(2);
  }

  // Rebuild a page from a burst already on disk. No model calls.
  const from = arg(args, '--from', null);
  if (from) {
    const burst = JSON.parse(readFileSync(from, 'utf8'));
    const page = arg(args, '--page', null);
    if (!page) die('--from needs --page', 2);
    writePage(burst.pairs || [], burst.seed || 0, page);
    return;
  }

  const n = Number(arg(args, '--n', 12));
  const out = arg(args, '--out', join(HERE, 'pairs.json'));
  const usedPath = arg(args, '--used', join(HERE, '.duel-used.json'));
  const seed = Number(arg(args, '--seed', String(Date.now() % 100000)));
  const jobs = Math.max(1, Number(arg(args, '--jobs', 4)));

  const used = new Set(existsSync(usedPath) ? JSON.parse(readFileSync(usedPath, 'utf8')) : []);
  const all = pool();
  const fresh = shuffled(all.filter(s => !used.has(s.id)), seed);

  console.error(`-- pool ${all.length}, ${used.size} already played, ${fresh.length} fresh`);
  if (!fresh.length) die('every specimen has been played; empty the used-ids file to recycle', 3);
  if (fresh.length < n) console.error(`-- only ${fresh.length} fresh specimens; building that many`);

  const take = fresh.slice(0, Math.min(n, fresh.length));
  const vault = readVault();
  const systemPrompt = buildSystemPrompt(vault);
  console.error(`-- vault: ${Object.keys(vault.motifs).length} motifs, ${vault.examples.length} examples, seed ${seed}, ${jobs} at a time`);

  // A bounded pool: pairs are independent; only the two steps inside a pair are ordered.
  const done = new Array(take.length).fill(null);
  let next = 0, finished = 0;

  const flush = () => writeFileSync(out, JSON.stringify(
    { seed, built: take.length, pairs: done.filter(Boolean) }, null, 2));

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= take.length) return;
      const specimen = take[i];
      try {
        const pair = await buildPair(specimen, systemPrompt, seed);
        done[i] = pair;
        const ratio = pair.real.length ? (pair.ai.length / pair.real.length) : 0;
        console.error(`-- [${++finished}/${take.length}] ${specimen.id}  ${specimen.date}  `
          + `real ${pair.real.length} / ai ${pair.ai.length} (${ratio.toFixed(2)}x)`
          + `  ragged real:${isRagged(pair.real)} ai:${isRagged(pair.ai)}`
          + `  units ${pair.units.real}/${pair.units.notes}/${pair.units.ai}`
          + (pair.unexplained.length ? `  UNEXPLAINED:${pair.unexplained.length}` : ''));
      } catch (err) {
        // One specimen dying costs one specimen.
        finished++;
        console.error(`-- [${finished}/${take.length}] ${specimen.id} FAILED: ${String(err.message || err).split('\n')[0]}`);
      }
      // Written as each lands, so a crash costs the pair in flight and nothing
      // that came before it.
      flush();
    }
  }

  await Promise.all(Array.from({ length: Math.min(jobs, take.length) }, worker));
  const pairs = done.filter(Boolean);
  if (pairs.length < take.length) {
    console.error(`-- ${take.length - pairs.length} specimen(s) failed and are not in this burst`);
  }

  // Only what actually produced a pair; a failed specimen returns to the pool.
  writeFileSync(usedPath, JSON.stringify([...used, ...pairs.map(p => p.id)], null, 2));

  // The burst report: ways the game can be decided by the harness instead of the writing.
  const raggedAi = pairs.filter(p => isRagged(p.ai)).length;
  const raggedReal = pairs.filter(p => isRagged(p.real)).length;
  const skewed = pairs.filter(p => {
    const r = p.ai.length / p.real.length;
    return r > 1.5 || r < 0.67;
  });
  const leaky = pairs.filter(p => p.unexplained?.length);
  const carried = pairs.reduce((n, p) => n + (p.leaks.length - (p.unexplained?.length || 0)), 0);

  console.error(`\n-- burst: ${pairs.length} pairs -> ${out}`);
  console.error(`-- ragged spacing: real ${raggedReal}/${pairs.length}, generated ${raggedAi}/${pairs.length}`);
  // Step A's fidelity: if the notes flatten the source's lumping, the generated
  // email cannot get it back.
  const withUnits = pairs.filter(p => p.units);
  if (withUnits.length) {
    const mean = f => (withUnits.reduce((a, p) => a + f(p), 0) / withUnits.length).toFixed(1);
    console.error(`-- units per message: real ${mean(p => p.units.real)}`
      + `  notes ${mean(p => p.units.notes)}  generated ${mean(p => p.units.ai)}`
      + `  (notes skew ${mean(p => p.units.notes - p.units.real)})`);
  }
  if (raggedAi < pairs.length * 0.6) {
    console.error('   ^ the generated side is NOT matching the archive\'s spacing.');
    console.error('     Rounds will be won on whitespace. Fix the prompt before playing.');
  }
  if (skewed.length) {
    console.error(`-- length skew >1.5x or <0.67x on ${skewed.length} pair(s): ${skewed.map(p => p.id).join(', ')}`);
  }
  if (carried) {
    console.error(`-- ${carried} shared run(s) the notes already carried -- preserved facts, not lifted phrasing`);
  }
  if (leaky.length) {
    console.error(`-- UNEXPLAINED phrasing on ${leaky.length} pair(s) -- read these before playing:`);
    for (const p of leaky) console.error(`   ${p.id}: ${p.unexplained.slice(0, 3).map(g => `"${g}"`).join(', ')}`);
  }
  if (!skewed.length && !leaky.length) console.error('-- no length skew, no unexplained phrasing');

  const page = arg(args, '--page', null);
  if (page) writePage(pairs, seed, page);
}

// Only when run directly, so duel.test.mjs can import `leaks` without
// building a burst.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv);
}
