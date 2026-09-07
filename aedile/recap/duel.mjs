#!/usr/bin/env node
/**
 * duel.mjs -- build a burst of real-vs-generated pairs for the voice duel.
 *
 *   ./duel.mjs [--n 12] [--out pairs.json] [--used .duel-used.json] [--seed 7]
 *
 * The generator has never been measured against the voice it claims to write
 * in. checks.mjs grades truthfulness -- invented names, invented figures,
 * swallowed uncertainty -- and nothing grades voice. This produces the evidence:
 * a real Abe email and a generated one, side by side, same facts, and a human
 * says which is which. Indistinguishable means the human is right half the time.
 *
 * Two steps per pair, because a pair has to be content-matched:
 *
 *   A. de-voice   the real email -> bare factual bullets, no phrasing kept.
 *   B. regenerate those bullets through the SAME prompt redige.mjs builds.
 *
 * Step A is the load-bearing one. If it leaks Abe's phrasing, step B echoes it
 * back and the duel is rigged in the generator's favour -- so the prompt is
 * written to be aggressive and every pair is checked for shared 6-word runs
 * before it is allowed into the burst.
 *
 * This IMPORTS redige.mjs rather than shelling out to it. Shelling out hits
 * four separate walls: redige exits 6 on any blocking finding even without
 * --post (and the strict invented-name/figure checks make that the common
 * case, so a loop dies mid-burst); its default --out path is derived from the
 * input, so every run in a loop overwrites the last; `claude -p` can hang on a
 * first-run trust prompt with no timeout; and its 500-char input floor rejects
 * step A's bullets. Importing also means one copy of the prompt assembly --
 * Context.js already drifted from its mirror once and broke draftRecap
 * silently, and a third copy is that bug queued up again.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readVault, buildSystemPrompt, callModel, parseDecision } from './redige.mjs';
import { normalize, isRagged } from './normalize.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';

/** The krewe's own account. 480 of the archive's 1099 messages; the voice the
 *  list has read for a decade, and the one aedile is trying to continue. */
const MS_ACCOUNT = 'kreweofvaporwave@gmail.com';

/** Below 400 characters there is no prose to judge -- much of the archive is
 *  `6:30, 4501 N Galvez Pizza & Beer`. Above 4000 is a different reading task. */
const MIN_CHARS = 400, MAX_CHARS = 4000;

/** The two threads hardcoded as few-shot examples in redige.mjs. The generator
 *  has them verbatim in its prompt; duelling against one is not a test. The
 *  sign-off filter below already excludes both, this is belt and braces. */
const FEWSHOT_URLS = ['PpYQ3C6toiQ', 'IO3RQJWWafk'];

/** Where the burst data is spliced into the committed template. */
const PAGE_SLOT = '/*__PAIRS__*/{"seed":0,"pairs":[]}';

const die = (msg, code = 1) => { console.error(`duel: ${msg}`); process.exit(code); };

const idOf = body => createHash('sha1').update(body).digest('hex').slice(0, 10);

// --- the pool ----------------------------------------------------------------

/** MS-authored, long enough to judge, and ending in `<3` + initials.
 *
 *  That last filter is load-bearing rather than fussy: normalize.mjs keeps the
 *  `<3` and strips only the initials, because the archive signs `<3 MS` and
 *  checks.mjs makes the generator sign `<3 SM` -- two characters that would
 *  otherwise decide every round. Keeping the `<3` preserves a real part of the
 *  register, and is only safe if every specimen has one to keep. */
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

const DEVOICE_PROMPT = `You reduce a piece of writing to its facts, discarding the writing.

Given an email, return ONLY a bulleted list of what it factually contains:
what is happening, when, where, who is doing what, what is being asked for,
what was decided, and what is left unresolved.

Rules, all of them strict:
- Fragments, never sentences. "- storage run tonight, 7pm, bring hands"
- Keep every date, time, address, dollar figure, URL and proper name EXACTLY
  as written. Those are facts and they must survive.
- Discard every greeting, sign-off, joke, aside, insult, curse, exclamation
  and figure of speech. Discard all humour. Discard the writer entirely.
- NEVER reuse a distinctive phrase from the original. If the original says
  "cynical, joyless, spendthrift friends", you write "friends". State each
  fact in the plainest, most ordinary words available to you.
- No adjectives of judgement or attitude. No editorialising. No tone.

The output is scratch notes someone typed during a meeting. It must be
impossible to tell from them who wrote the original or how they write.

Output the bullets and nothing else.`;

/** Verbatim word-runs the generated email shares with the real one.
 *
 *  Measured on the GENERATED BODY, not on the intermediate notes: what matters
 *  is whether Abe's phrasing reaches the reader, and one of the first three
 *  pairs had zero overlap in its notes and eight in its email. The notes are
 *  not the channel.
 *
 *  Ten words, not six, and that is measured rather than chosen. A
 *  content-matched pair GUARANTEES some overlap -- both texts describe the
 *  same facts in ordinary English, so `set up the led array on the canal` and
 *  `92,000 lumen gobo projectors to integrate into` show up on both sides
 *  because there is no other way to say them. Across the first burst the
 *  longest shared run was nine words and every one of them was fact-carrying;
 *  at ten the overlap was zero on every pair. So ten catches a lifted sentence
 *  and stops flagging the design working correctly. */
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
  'from', 'by', 'as', 'up', 'out', 'over', 'into', 'there', 'their', 'some']);

const content = s => (String(s).toLowerCase().match(/[a-z0-9']+/g) || [])
  .filter(w => !STOP.has(w));

/** Did the notes already carry this run's CONTENT?
 *
 *  The generator only ever sees the notes, so it cannot lift anything from the
 *  real email except through them. When the notes say `hang clip lights in
 *  rafters of Brake Tag Station` and the generator writes `hang clip lights in
 *  the rafters of the Brake Tag Station`, it has restored the articles and
 *  landed on Abe's exact sentence -- because there is no other way to write
 *  it. Comparing with stopwords in, that reads as a ten-word lift; comparing
 *  content words only, it is plainly a preserved fact.
 *
 *  Only a run the notes did NOT carry is worth a human's attention. */
export const carriedByNotes = (run, notes) =>
  content(notes).join(' ').includes(content(run).join(' '));

// --- a pair ------------------------------------------------------------------

function buildPair(specimen, systemPrompt) {
  const notes = callModel(DEVOICE_PROMPT, specimen.body).trim();

  // The shipping prompt, plus one addendum: the target length. A systematic
  // length gap is a tell with nothing to do with voice, and the generator has
  // no other way to know how long this one should be. Nothing else is added --
  // the point is to test the prompt the product actually uses.
  const sized = `${systemPrompt}\n\n## Length for this one\n\nThe finished \`body\` should be roughly ${specimen.body.length} characters. Match that; do not pad and do not truncate.`;

  const decision = parseDecision(callModel(sized, notes));
  const shared = leaks(specimen.body, decision.body || '');

  return {
    unexplained: shared.filter(g => !carriedByNotes(g, notes)),
    id: specimen.id,
    date: specimen.date,
    url: specimen.url,
    real: normalize(specimen.body),
    ai: normalize(decision.body || ''),
    notes,
    leaks: shared,
    confidence: decision.confidence,
  };
}


/** Fill the committed template with a burst and write a playable page.
 *
 *  The page is generated, never committed: it carries verbatim private
 *  messages by named krewe members and wavebucks is a public repo. duel.html
 *  in the tree stays an empty template. */
function writePage(pairs, seed, out) {
  const tpl = readFileSync(join(HERE, 'duel.html'), 'utf8');
  if (!tpl.includes(PAGE_SLOT)) die('duel.html has no injection point', 4);
  // `<` is escaped because the payload is spliced INSIDE a <script> block: one
  // `</script>` anywhere in a fifteen-year archive would end the script early
  // and render the bench blank with the rest of the email as loose text.
  // `\u003c` is valid in a JS string and decodes back to `<`, so `<3` survives.
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

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help')) {
    console.error('usage: duel.mjs [--n 12] [--out pairs.json] [--page FILE] [--used FILE] [--seed N]\n       duel.mjs --from pairs.json --page FILE');
    process.exit(2);
  }

  // Rebuild a page from a burst already on disk -- after a template edit, or
  // when the burst was built by an older copy of this file. No model calls.
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

  const used = new Set(existsSync(usedPath) ? JSON.parse(readFileSync(usedPath, 'utf8')) : []);
  const all = pool();
  const fresh = shuffled(all.filter(s => !used.has(s.id)), seed);

  console.error(`-- pool ${all.length}, ${used.size} already played, ${fresh.length} fresh`);
  if (!fresh.length) die('every specimen has been played; empty the used-ids file to recycle', 3);
  if (fresh.length < n) console.error(`-- only ${fresh.length} fresh specimens; building that many`);

  const take = fresh.slice(0, Math.min(n, fresh.length));
  const vault = readVault();
  const systemPrompt = buildSystemPrompt(vault);
  console.error(`-- vault: ${Object.keys(vault.motifs).length} motifs, ${vault.examples.length} examples, seed ${seed}`);

  const pairs = [];
  for (const [i, specimen] of take.entries()) {
    console.error(`-- [${i + 1}/${take.length}] ${specimen.id}  ${specimen.date}  ${specimen.body.length} chars`);
    const pair = buildPair(specimen, systemPrompt);
    pairs.push(pair);
    // Written after every pair: a model failure mid-burst costs one pair, not
    // the twenty minutes that came before it.
    writeFileSync(out, JSON.stringify({ seed, built: take.length, pairs }, null, 2));
    const ratio = pair.real.length ? (pair.ai.length / pair.real.length) : 0;
    console.error(`   real ${pair.real.length} / ai ${pair.ai.length} (${ratio.toFixed(2)}x)`
      + `  ragged real:${isRagged(pair.real)} ai:${isRagged(pair.ai)}`
      + (pair.leaks.length ? `  LEAKS:${pair.leaks.length}` : ''));
  }

  writeFileSync(usedPath, JSON.stringify([...used, ...take.map(s => s.id)], null, 2));

  // The burst report. Every one of these is a way the game can be decided by
  // the harness instead of the writing, so it is printed before anyone plays.
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
  main(process.argv);
}
