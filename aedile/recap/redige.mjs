#!/usr/bin/env node
// redige -- meeting notes in, krewe-voice draft out. Runs under node, not Apps Script.
//
//   ./redige.mjs <notes.md|meeting.m4a> [--out FILE] [--post [--dry-run]] [--json]
//
// --post hands the draft to aedile's createDraft sink; --post --dry-run files nothing.
// WRITE_API_TOKEN gates the sink and is read from the environment.
// Excluded from `clasp push` by aedile/.claspignore: Apps Script has no `import`.

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { callModel, parseDecision } from '../brain/model.mjs';
import { runChecks, report } from './checks.mjs';
import { dateBlock } from './dates.mjs';
import { formBlock, measuredRates } from '../analysis/headsup-form.mjs';
import { formBlock as recapFormBlock, form as recapForm } from '../analysis/recap-form.mjs';
import { subjectWeights } from '../analysis/subject-shapes.mjs';
import { dealDevices, dealFlourish, dealTypo, dealSignoff, dealGap, dealSubject, devicesBlock } from './devices.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AEDILE = join(HERE, '..');
const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';
const WHISPER = process.env.WHISPER_URL || 'http://100.107.253.56:8090/inference';

// Stable across version cuts; `clasp deployments` says which version is live.
const EXEC = process.env.AEDILE_EXEC_URL
  || 'https://script.google.com/macros/s/AKfycbyyx1N_0hMP2-GG3z1gM_EgNL0RXFB83yvrY57JOKPQ026a2y2hOARKjGc-lKF-qj7s5w/exec';

const AUDIO_EXT = /\.(m4a|mp3|wav|ogg|opus|aac|flac|mp4|mov|webm|amr)$/i;

const die = (msg, code = 1) => { console.error(`redige: ${msg}`); process.exit(code); };

// --- intake ------------------------------------------------------------------

function transcribe(audioPath) {
  const health = WHISPER.replace(/\/inference$/, '/health');
  try {
    execFileSync('curl', ['-sf', '--max-time', '10', health], { stdio: 'pipe' });
  } catch {
    die(`whisper is not answering at ${health}`, 4);
  }

  const wav = `/tmp/redige-${process.pid}.wav`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', audioPath,
    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);

  const raw = execFileSync('curl', ['-sf', '--max-time', '3600', '-X', 'POST', WHISPER,
    '-F', `file=@${wav}`, '-F', 'response_format=json', '-F', 'language=en'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  return JSON.parse(raw).text.trim();
}

function intake(path) {
  if (!AUDIO_EXT.test(path)) return readFileSync(path, 'utf8');
  console.error(`-- transcribing ${basename(path)}`);
  const text = transcribe(path);
  console.error(`-- ${text.length} chars of transcript`);
  return text;
}

// Bullets mean outline. Detected, not declared; whisper output is unbulleted and falls through.
const looksLikeOutline = raw => (raw.match(/(?:^|\n)\s*[*\-\u2022]\s+\S/g) || []).length >= 3;

// One model call turning bullets into spoken prose, so the outline rides the transcript path.
// The checks still grade the raw file, not this: this output is model-authored.
async function outlineToTranscript(raw) {
  const sys = [
    'You are given one person\'s bullet notes from a meeting that already happened.',
    'Rewrite them as what was actually said in the room: plain spoken prose, people',
    'talking, in the order the notes have them.',
    '',
    'Add NOTHING. No date, time, place, name, number or decision that is not in the',
    'notes. Do not resolve a question the notes leave open, do not infer a weekday',
    'from a date, and do not invent who said what -- write "someone" if the notes',
    'do not say. A line you cannot render without inventing something gets rendered',
    'as the bare fact it is.',
    '',
    'Output the prose only. No preamble, no headings, no bullets, no JSON.',
  ].join('\n');
  const text = (await callModel(sys, raw)).trim();
  if (text.length < 200) die(`the outline pass returned ${text.length} chars -- refusing to draft from that`, 3);
  return text;
}

// --- the vault ---------------------------------------------------------------

export function readVault() {
  const motifs = {};
  for (const line of readFileSync(join(VAULT, 'voice/Index.md'), 'utf8').split('\n')) {
    const m = line.match(/\[\[([a-z0-9-]+)\|[^\]]*\]\]\s*\((\d+) threads\)/i);
    if (m) motifs[m[1]] = Number(m[2]);
  }

  const examples = [
    'thank-you-for-a-productive-sunday-meeting-i-had-a-big-email-PpYQ3C6toiQ.md',
    'thank-you-to-everyone-for-a-good-meeting-i-think-that-our-c-IO3RQJWWafk.md',
  ].map(f => {
    const raw = readFileSync(join(VAULT, 'threads', f), 'utf8');
    // A thread file is frontmatter, a link header, then one section per message
    // headed `## <date> -- [[people/...]]`. Take the first message only.
    const first = (raw.split(/^## /m)[1] || '').split('\n').slice(1).join('\n');
    return first
      .replace(/^\s*-\s+\*\*.*$/gm, '')  // `- **Thread URL:** ...` bullets
      .replace(/^\s*---\s*$/gm, '')       // the rule that closed the section
      .trim();
  });

  const people = readFileSync(join(VAULT, 'Index.md'), 'utf8');
  return { motifs, examples, participantCount: (people.match(/(\d+) participants/) || [])[1] };
}

// --- the model ---------------------------------------------------------------

// One model client: brain/model.mjs, via the subscription `claude` CLI, no
// ANTHROPIC_API_KEY. Re-exported under the names duel.mjs and judge.mjs import.
export { parseDecision };
export const callModelAsync = callModel;

// --- prompt ------------------------------------------------------------------

/** Same rule Context.js's constants follow: each .md from its first "## " on. */
export function contextBody(name) {
  const s = readFileSync(join(AEDILE, name), 'utf8');
  return s.slice(s.indexOf('\n## ')).trim();
}

export const GENRES = {
  recap: { context: 'AEDILE_CONTEXT.recap.md', label: 'recap_draft_posted' },
  headsup: { context: 'AEDILE_CONTEXT.headsup.md', label: 'headsup_draft_posted' },
  // One person, their own commitments. Requires --to: a reminder must not go to the list.
  reminder: { context: 'AEDILE_CONTEXT.reminder.md', label: 'reminder_draft_posted', needsTo: true, needsFor: true },
};

export function buildSystemPrompt(vault, genre = 'recap') {
  const g = GENRES[genre] || die(`unknown genre "${genre}" -- one of ${Object.keys(GENRES).join(', ')}`, 2);
  const examples = vault.examples
    .map((e, i) => `--- REAL RECAP ${i + 1}, written by the krewe's own voice ---\n${e}`)
    .join('\n\n');

  // The model can still emit a tool_use block, which spends the only turn and
  // returns no text; so the prompt says there are no tools.
  const closed = ['## You have no tools here', '',
    'Everything you need is in this prompt and the notes that follow it. There is no',
    'archive to search and no file to read: any tool call is refused and costs you',
    'the whole answer. Write the email from what you have been given.'].join('\n');

  // The genre file ends with its output contract, so the examples and `closed`
  // sit above it. Form is computed from the corpus each run, not quoted.
  return [
    contextBody('AEDILE_CONTEXT.core.md'),
    `## Two real recaps from the archive\n\nMatch this register. Do not copy their content.\n\n${examples}`,
    closed,
    contextBody(g.context),
    genre === 'headsup' ? formBlock() : genre === 'recap' ? recapFormBlock() : '',
  ].filter(Boolean).join('\n\n');
}

// Lead time, computed here and never by the model: the operator passes
// --event-date, Node does the arithmetic, and the model is told the answer.
export function leadTimeBlock(eventDate, beat, asOf) {
  if (!eventDate) return '';
  for (const [flag, v] of [['--event-date', eventDate], ['--as-of', asOf]]) {
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) die(`${flag} must be YYYY-MM-DD, got "${v}"`, 2);
  }
  // `--as-of` is the day the mail will be read, not the day it is generated.
  const day = s => Math.floor(new Date(s + 'T12:00:00').getTime() / 86400000);
  const days = day(eventDate) - day(asOf || new Date().toISOString().slice(0, 10));
  leadTimeBlock.days = days;  // the one derivation, reused by the checks below
  const when = days === 0 ? 'TODAY' : days === 1 ? 'TOMORROW' : days < 0
    ? `${-days} day(s) AGO, which is almost certainly a mistake in the call`
    : `in ${days} days`;
  const lines = [`The event is on ${eventDate}, which is ${when}. Lead time: ${days} day(s).`];
  if (beat) lines.push(`Beat: ${beat}.`);
  lines.push('Say when the event is in the words the krewe would use. That is the one fact',
    'the reader opens this for.');
  return `## When this is going out\n\n${lines.join('\n')}`;
}

// --- the sink ----------------------------------------------------------------

// The default recipient: the Google Group, not the account aedile runs as.
// `--to` overrides it for a reminder. A member address must never be committed: recipients come from argv.
const LIST_RECIPIENT = 'kreweofvaporwave@googlegroups.com';

const SECRETS = process.env.AEDILE_SECRETS
  || [join(process.env.HOME || '', '.config/aedile/api-secrets'), '/srv/vaporwave-reports/aedile/.aedile-api-secrets']
    .find(f => existsSync(f)) || '';

// Renders open_questions into the body so what the meeting did not settle
// survives into the draft.
export function appendOpenQuestions(body, openQuestions) {
  if (!openQuestions || !openQuestions.length) return body;
  const items = openQuestions.map(q => `  - ${q}`).join('\n');
  const block = `Still open:\n${items}`;

  // The sign-off stays last: the block goes above it.
  const SIGNOFF_LINE = /^(?:(?:<3[ \t]*)+|(?:<3[ \t]*)*SM)$/;
  const lines = body.replace(/\s+$/, '').split('\n');
  const signOff = [];
  // The sign-off can be one line (`<3 SM`) or two (`<3` then `SM`).
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (last === '') { lines.pop(); continue; }
    if (!SIGNOFF_LINE.test(last)) break;
    signOff.unshift(last);
    lines.pop();
  }
  // No sign-off to protect: append as before rather than inventing a position.
  if (!signOff.length) return `${body}\n\n${block}`;
  return `${lines.join('\n').replace(/\s+$/, '')}\n\n${block}\n\n${signOff.join('\n')}`;
}

// Reads the Log, where an originate's addressee is in the `From` column.
// Prevents a double draft, not a double send.
function alreadyDrafted(label, to, days = 14) {
  const token = process.env.READ_API_TOKEN
    || (() => { try { return (readFileSync(SECRETS, 'utf8').match(/^AEDILE_READ_API_TOKEN=(.*)$/m) || [])[1]?.replace(/["'\r]/g, ''); } catch { return undefined; } })();
  if (!token) die('--if-new needs READ_API_TOKEN (or a readable secrets file) to check the Log', 5);
  let raw;
  try {
    raw = execFileSync('curl', ['-sfL', '--max-time', '60', '-G', EXEC,
      '--data-urlencode', `token=${token}`, '--data-urlencode', 'scope=log', '--data-urlencode', 'limit=200'],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    die(`--if-new could not read the Log: ${err.message}`, 7);
  }
  let rows;
  try { rows = JSON.parse(raw).rows || []; } catch { die(`--if-new got non-JSON from the Log:\n${raw.slice(0, 200)}`, 7); }
  const cutoff = Date.now() - days * 86400000;
  return rows.some(r => r.Action === label && String(r.From) === to && new Date(r.Timestamp).getTime() >= cutoff);
}

// The only step that touches Google; no Google credential exists on this side.
function post(decision, dryRun, genre = 'recap', to = LIST_RECIPIENT) {
  const token = process.env.WRITE_API_TOKEN;
  if (!token) {
    die('WRITE_API_TOKEN is not set -- it gates the sink, and this end has no other way in', 5);
  }

  // Plain text, no HTML: HTML would force escaping `<3`.
  const body = appendOpenQuestions(decision.body, decision.open_questions);

  // The form body goes through a 0600 file, not argv: a token on a command line
  // is readable out of /proc.
  const form = [
    `token=${encodeURIComponent(token)}`,
    'action=createDraft',
    dryRun ? 'dryRun=true' : null,
    `to=${encodeURIComponent(to)}`,
    `subject=${encodeURIComponent(decision.subject)}`,
    `body=${encodeURIComponent(body)}`,
    `logLabel=${encodeURIComponent(GENRES[genre].label)}`,
    `logNote=${encodeURIComponent('written by aedile/recap/redige.mjs on mandark')}`,
  ].filter(Boolean).join('&');

  const bodyFile = `/tmp/redige-post-${process.pid}.form`;
  writeFileSync(bodyFile, form, { mode: 0o600 });

  let raw;
  try {
    // -L because /exec answers a POST with a 302. No -X POST: it pins the method
    // across the redirect, curl re-POSTs with no body, and Google answers with a
    // sign-in page.
    raw = execFileSync('curl', ['-sfL', '--max-time', '120', EXEC,
      '-H', 'Content-Type: application/x-www-form-urlencoded',
      '--data-binary', `@${bodyFile}`],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    die(`the sink did not answer: ${err.message}`, 7);
  } finally {
    rmSync(bodyFile, { force: true });
  }

  let res;
  try {
    res = JSON.parse(raw);
  } catch {
    // An HTML page here is the endpoint 404ing or asking for a login.
    die(`the sink answered with something that is not JSON:\n${raw.slice(0, 300)}`, 7);
  }
  if (!res.ok) die(`the sink refused: ${res.error || raw}`, 7);

  // ok:true only means the endpoint ran the action; the action reports its own
  // refusals in the result.
  const r = res.result || {};
  if (r.error || r.skipped) die(`the sink did nothing: ${r.error || r.skipped}`, 7);
  return r;
}

// --- main --------------------------------------------------------------------

async function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args[0] === '--help') {
    console.error('usage: redige.mjs <notes.md|meeting.m4a|saved.json> [--genre recap|headsup]');
    console.error('                  [--beat lock-in|nudge] [--event-date YYYY-MM-DD]');
    console.error('                  [--as-of YYYY-MM-DD: the day it will be READ, default today]');
    console.error('                  [--to ADDRESS] [--for NAME: both required for a reminder]');
    console.error('                  [--out FILE] [--post [--dry-run]] [--json]');
    process.exit(2);
  }

  const flag = name => {
    const i = args.indexOf(name);
    return i > -1 ? args[i + 1] : undefined;
  };

  const input = args[0];
  const genre = flag('--genre') || 'recap';
  if (!GENRES[genre]) die(`unknown --genre "${genre}" -- one of ${Object.keys(GENRES).join(', ')}`, 2);
  const beat = flag('--beat');
  const eventDate = flag('--event-date');
  const asOf = flag('--as-of');
  const to = flag('--to') || LIST_RECIPIENT;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) die(`--to must be one email address, got "${to}"`, 2);
  // Fail loud both ways: a reminder sent to the list leaks one person's action items.
  if (GENRES[genre].needsTo && to === LIST_RECIPIENT) {
    die(`--genre ${genre} requires --to ADDRESS: it is one person's items, and the list is not a person`, 2);
  }
  if (!GENRES[genre].needsTo && to !== LIST_RECIPIENT) {
    die(`--genre ${genre} goes to the list; --to is only for a reminder`, 2);
  }

  // `--to` is an address and does not say whose items; the name is passed in, never guessed.
  const forWhom = flag('--for');
  if (GENRES[genre].needsFor && !forWhom) {
    die(`--genre ${genre} requires --for NAME: it carries one person's items and cannot guess whose`, 2);
  }
  if (forWhom && !GENRES[genre].needsFor) die(`--for is only for a reminder`, 2);
  if (forWhom && !/^[A-Z][a-zA-Z'’-]{1,30}$/.test(forWhom)) {
    die(`--for must be one capitalised first name as the notes write it, got "${forWhom}"`, 2);
  }

  const forBlock = forWhom ? [
    `## This message is for ${forWhom}, and only ${forWhom}`,
    '',
    `Include ONLY the commitments the notes attach to ${forWhom}. Another person's item`,
    `is not ${forWhom}'s business and must not appear -- not as context, not as a list of`,
    'what everyone else is doing, not in a closing line. If the notes attach nothing to',
    `${forWhom}, say so in one sentence and set confidence to "low" rather than inventing`,
    'an obligation for them.',
  ].join('\n') : '';
  if (genre === 'headsup' && !eventDate) {
    die('--genre headsup requires --event-date YYYY-MM-DD: the beat and the word "tomorrow" are derived from it', 2);
  }
  const out = flag('--out') || input.replace(/\.[^.]+$/, '') + `.${genre}.json`;

  // A saved decision is re-posted without regenerating, so the text reviewed is
  // the text posted. The notes are saved with it so the checks still grade against the input.
  if (input.endsWith('.json')) {
    const saved = JSON.parse(readFileSync(input, 'utf8'));
    if (!saved.body || !saved.subject) die(`${input} has no subject/body -- not a saved decision`, 3);
    if (!saved._notes) die(`${input} has no _notes -- regenerate it with this version, which saves them`, 3);
    leadTimeBlock(eventDate, beat, asOf);  // recompute leadTimeBlock.days for the check
    const findings = runChecks(saved, saved._notes + '\n' + (eventDate || ''), readVault(), { genre, beat, leadDays: eventDate ? leadTimeBlock.days : undefined, shape: genre === 'recap' ? recapForm() : undefined, asOf: asOf || new Date(), hand: saved._hand });
    report(findings);
    console.log(render(saved));
    const blocked = findings.filter(f => f.level === 'fail');
    if (args.includes('--post')) {
      if (blocked.length) die(`${blocked.length} blocking finding(s) -- not posting`, 6);
      if (args.includes('--if-new') && alreadyDrafted(GENRES[genre].label, to)) {
        console.error(`-- already drafted: a ${GENRES[genre].label} row for ${to} exists in the last 14 days. Nothing posted.`);
        process.exit(0);
      }
      const dryRun = args.includes('--dry-run');
      const r = post(saved, dryRun, genre, to);
      console.error(dryRun
        ? `-- DRY RUN: the sink would have drafted to ${r.wouldSendTo}. Nothing was written.`
        : `-- drafted to ${r.recipient}. NOTHING WAS SENT -- a director opens the draft and sends it.`);
    }
    process.exit(blocked.length ? 6 : 0);
  }

  const raw = intake(input);
  if (raw.trim().length < 500) {
    die(`input is ${raw.trim().length} chars, under the 500-char floor -- refusing rather than recapping nothing`, 3);
  }

  // `spoken` is what the model drafts from; `raw` stays the grounding text for the checks.
  const outline = looksLikeOutline(raw);
  const spoken = outline ? await outlineToTranscript(raw) : raw;
  if (outline) console.error(`-- outline detected: ${raw.trim().length} chars of notes -> ${spoken.length} chars of speech`);

  const vault = readVault();
  console.error(`-- vault: ${Object.keys(vault.motifs).length} motifs, ${vault.examples.length} example recaps`);

  // Presentation only: the caller rolls the devices and tells the model. A
  // heads-up uses measured rates (analysis/headsup-form.mjs); a reminder is dealt no hand.
  const hand = genre === 'reminder' ? {} : dealDevices(undefined, genre, beat, genre === 'headsup' ? measuredRates() : {});
  const flourish = dealFlourish();
  const typo = dealTypo();
  const signoff = dealSignoff();
  const gap = dealGap(undefined, genre);
  const subjectShape = dealSubject(undefined, subjectWeights(genre, beat));
  const dealt = Object.entries(hand).filter(([, v]) => v).map(([k]) => k);
  console.error(`-- genre: ${genre}${beat ? ` (beat: ${beat})` : ''}`);
  console.error(`-- devices: ${dealt.join(', ') || 'none'}; gap ${gap}`);
  console.error(`-- subject: ${subjectShape.slice(9, 96)}`);

  const lead = leadTimeBlock(eventDate, beat, asOf);
  // Node resolves each date's weekday and the model is told. Built from `raw`,
  // so the spelling shown is the spelling the checks grade against.
  const dates = dateBlock(raw, asOf ? new Date(asOf) : new Date());
  const leadDays = eventDate ? leadTimeBlock.days : undefined;
  const prompt = [
    buildSystemPrompt(vault, genre),
    lead,
    dates,
    forBlock,
    genre === 'reminder' ? '' : devicesBlock(hand, [flourish, signoff].filter(Boolean).join('\n- '), typo, gap, subjectShape),
  ].filter(Boolean).join('\n\n');
  let decision;
  try {
    decision = parseDecision(await callModel(prompt, spoken));
  } catch (err) {
    die(String(err.message || err), 5);
  }

  const checkOpts = { genre, beat, leadDays, hand, shape: genre === 'recap' ? recapForm() : undefined, asOf: asOf || new Date() };
  const grade = d => runChecks(d, raw + '\n' + (eventDate || ''), vault, checkOpts);
  let findings = grade(decision);

  // One repair pass, over blocking findings only; keeps whichever draft grades
  // better. The notes the checks grade against are untouched, so a repair cannot add a fact.
  const blockers = f => f.filter(x => x.level === 'fail');
  if (blockers(findings).length) {
    const fix = ['## Your draft was rejected. Fix exactly these and change nothing else.', ''];
    for (const f of blockers(findings)) fix.push(`- ${f.msg}`);
    fix.push('',
      'Keep every other sentence as it stands. Add no facts: each of these is fixed by',
      'removing or rewording what is already there, never by introducing something new.');
    console.error(`-- ${blockers(findings).length} blocking finding(s); one repair pass`);
    try {
      const repaired = parseDecision(await callModel(`${prompt}\n\n${fix.join('\n')}`, spoken));
      const after = grade(repaired);
      if (blockers(after).length < blockers(findings).length) {
        decision = repaired;
        findings = after;
        console.error(`-- repair kept: ${blockers(after).length} blocking finding(s) remain`);
      } else {
        console.error(`-- repair discarded: it graded ${blockers(after).length}, no better than ${blockers(findings).length}`);
      }
    } catch (err) {
      console.error(`-- repair pass failed, keeping the original: ${err.message || err}`);
    }
  }

  // _hand/_gap are saved because the re-post path re-grades the saved decision,
  // and `hand-ignored` needs the draw.
  writeFileSync(out, JSON.stringify({ ...decision, _checks: findings, _notes: raw, _spoken: outline ? spoken : undefined, _hand: hand, _gap: gap }, null, 2));
  console.error(`-- wrote ${out}`);
  report(findings);

  if (args.includes('--json')) console.log(JSON.stringify(decision, null, 2));
  else console.log(render(decision));

  const blocking = findings.filter(f => f.level === 'fail');
  if (args.includes('--post')) {
    if (blocking.length) die(`${blocking.length} blocking finding(s) -- not posting`, 6);
    const dryRun = args.includes('--dry-run');
    const r = post(decision, dryRun, genre, to);
    console.error(dryRun
      ? `-- DRY RUN: the sink would have drafted to ${r.wouldSendTo}. Nothing was written.`
      : `-- drafted to ${r.recipient}. NOTHING WAS SENT -- a director opens the draft and sends it.`);
  }
  process.exit(blocking.length ? 6 : 0);
}

// What prints here is what the krewe receives.
function render(d) {
  return [
    `Subject: ${d.subject}`,
    '',
    appendOpenQuestions(d.body || '', d.open_questions),
    '',
    `[confidence: ${d.confidence}]`,
  ].join('\n');
}

// Only when run directly: duel.mjs imports from here so it exercises the same prompt.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A throw before main()'s own exit must still leave non-zero.
  main(process.argv).catch(err => die(String(err?.message || err), 1));
}
