#!/usr/bin/env node
/**
 * redige -- meeting notes in, krewe-voice draft out.
 *
 * Runs on mandark under node, NOT in Apps Script. It needs a filesystem: the
 * Obsidian voice corpus, the context files next door, and whisper. Apps Script
 * has none of those, which is why the generator lives here and aedile stays an
 * inbox watcher.
 *
 *   ./redige.mjs <notes.md|meeting.m4a> [--out FILE] [--post [--dry-run]] [--json]
 *
 * Intake is agnostic on purpose. Given text it uses it; given audio it sends it
 * to whisper first. Nothing in this file knows or cares which happened.
 *
 * It writes a draft to a file. With --post it also hands that draft to aedile's
 * createDraft sink, which is the only step that needs Google at all -- aedile
 * runs AS the krewe account, so no Google credential ever has to exist here.
 * --post --dry-run makes the round trip and files nothing.
 *
 * WRITE_API_TOKEN gates the sink and is read from the environment. It is NOT
 * read from /srv/vaporwave-reports: that tree is being retired, and a path in
 * source is how a retired location outlives the decision to retire it.
 *
 * Excluded from `clasp push` by aedile/.claspignore. Pushing this would break
 * the live project: Apps Script has no `import`, no `fs`, no `process`.
 */

import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChecks, report } from './checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const AEDILE = join(HERE, '..');
const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';
const WHISPER = process.env.WHISPER_URL || 'http://100.107.253.56:8090/inference';

// aedile's Web App, the `@10` deployment the anonymous URL serves. A version
// cut updates THIS deployment rather than making a new one, so the URL is
// stable and belongs in the source.
const EXEC = process.env.AEDILE_EXEC_URL
  || 'https://script.google.com/macros/s/AKfycbyyx1N_0hMP2-GG3z1gM_EgNL0RXFB83yvrY57JOKPQ026a2y2hOARKjGc-lKF-qj7s5w/exec';

const AUDIO_EXT = /\.(m4a|mp3|wav|ogg|opus|aac|flac|mp4|mov|webm|amr)$/i;

const die = (msg, code = 1) => { console.error(`redige: ${msg}`); process.exit(code); };

// --- intake ------------------------------------------------------------------

/** Audio -> text, via the same two steps /opt/zaxon-relay/bin/whisper_stt.sh uses.
 *  Deliberately not via Zaxon: its transcript is written to a TemporaryDirectory
 *  and deleted, and its own watcher records that the success path has never once
 *  run. This talks to the same healthy whisper container directly. */
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

// --- the vault ---------------------------------------------------------------

/** The .md files carry the voice as prose a human reads; this pulls out the two
 *  things a machine can use. The motif counts become the check's expectations,
 *  and real archived recaps become few-shot examples -- far stronger grounding
 *  than describing the form in prose and hoping. */
function readVault() {
  const motifs = {};
  for (const line of readFileSync(join(VAULT, 'voice/Index.md'), 'utf8').split('\n')) {
    const m = line.match(/\[\[([a-z0-9-]+)\|[^\]]*\]\]\s*\((\d+) threads\)/i);
    if (m) motifs[m[1]] = Number(m[2]);
  }

  // Two genuine post-meeting recaps by the krewe's own voice. Chosen because
  // they are the exact genre being generated, not merely the same author.
  const examples = [
    'thank-you-for-a-productive-sunday-meeting-i-had-a-big-email-PpYQ3C6toiQ.md',
    'thank-you-to-everyone-for-a-good-meeting-i-think-that-our-c-IO3RQJWWafk.md',
  ].map(f => {
    const raw = readFileSync(join(VAULT, 'threads', f), 'utf8');
    // Drop the YAML frontmatter and the link header; keep the message body.
    const body = raw.split(/^---$/m).slice(2).join('---');
    return body.replace(/^\s*#.*$/gm, '').replace(/^\s*-\s+\*\*.*$/gm, '').trim();
  });

  const people = readFileSync(join(VAULT, 'Index.md'), 'utf8');
  return { motifs, examples, participantCount: (people.match(/(\d+) participants/) || [])[1] };
}

// --- the model ---------------------------------------------------------------

/** Pluggable, per the plan: whichever backing is available. The generator does
 *  not know which ran. Apps Script would supply a third
 *  (AnthropicClient.getJsonDecision) without this file changing shape. */
function callModel(systemPrompt, userContent) {
  const backing = process.env.ANTHROPIC_API_KEY ? callApi : callCli;
  // A long generation over a slow link drops sometimes -- the first real run
  // died on "Connection lost mid-response". That is worth retrying and not
  // worth failing a meeting recap over.
  const attempts = Number(process.env.REDIGE_ATTEMPTS || 3);
  for (let i = 1; i <= attempts; i++) {
    try {
      return backing(systemPrompt, userContent);
    } catch (err) {
      const why = String(err.stdout || err.stderr || err.message || err).trim().split('\n')[0];
      if (i === attempts) die(`model call failed ${attempts}x -- ${why}`, 5);
      console.error(`-- attempt ${i} failed (${why}); retrying`);
      execFileSync('sleep', [String(i * 5)]);
    }
  }
}

function callCli(systemPrompt, userContent) {
  console.error('-- model: claude -p');
  return execFileSync('claude', ['-p', '--append-system-prompt', systemPrompt, userContent],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

function callApi(systemPrompt, userContent) {
  console.error('-- model: api.anthropic.com');
  const payload = JSON.stringify({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  const raw = execFileSync('curl', ['-sf', 'https://api.anthropic.com/v1/messages',
    '-H', `x-api-key: ${process.env.ANTHROPIC_API_KEY}`,
    '-H', 'anthropic-version: 2023-06-01',
    '-H', 'content-type: application/json',
    '--data-binary', '@-'], { input: payload, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(raw).content[0].text;
}

/** The model is asked for JSON and told not to fence it; it fences it anyway
 *  often enough that AnthropicClient.js strips fences too. Same treatment here. */
function parseDecision(text) {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    die(`model response was not valid JSON.\n--- raw ---\n${text.slice(0, 2000)}`, 5);
  }
}

// --- prompt ------------------------------------------------------------------

/** Same rule Context.js's constants follow: each .md from its first "## " on. */
function contextBody(name) {
  const s = readFileSync(join(AEDILE, name), 'utf8');
  return s.slice(s.indexOf('\n## ')).trim();
}

function buildSystemPrompt(vault) {
  const examples = vault.examples
    .map((e, i) => `--- REAL RECAP ${i + 1}, written by the krewe's own voice ---\n${e}`)
    .join('\n\n');

  return [
    contextBody('AEDILE_CONTEXT.core.md'),
    contextBody('AEDILE_CONTEXT.recap.md'),
    `## Two real recaps from the archive\n\nMatch this register. Do not copy their content.\n\n${examples}`,
  ].join('\n\n');
}

// --- the sink ----------------------------------------------------------------

/** Hand the finished draft to aedile's createDraft action.
 *
 *  This is the only step that touches Google, and it is deliberately the only
 *  one: aedile already runs AS the krewe account, so the capability lives
 *  where the credential already is and no Google credential has to exist on
 *  mandark at all. What crosses the wire is the decision's own fields, not
 *  rendered HTML -- the sink assembles those with the same appendOpenQuestions
 *  the in-script path uses, so both paths file the same artifact.
 */
function post(decision, dryRun) {
  const token = process.env.WRITE_API_TOKEN;
  if (!token) {
    die('WRITE_API_TOKEN is not set -- it gates the sink, and this end has no other way in', 5);
  }

  const draft = JSON.stringify({
    subject: decision.subject,
    body_html: decision.body_html,
    open_questions: decision.open_questions || [],
  });

  // The whole form body goes through a 0600 file rather than argv: a token on
  // a command line is readable out of /proc by any local account for as long
  // as curl runs.
  const form = [
    `token=${encodeURIComponent(token)}`,
    'action=createDraft',
    dryRun ? 'dryRun=true' : null,
    `draft=${encodeURIComponent(draft)}`,
  ].filter(Boolean).join('&');

  const bodyFile = `/tmp/redige-post-${process.pid}.form`;
  writeFileSync(bodyFile, form, { mode: 0o600 });

  let raw;
  try {
    // -L because /exec answers a POST with a 302 to googleusercontent.com and
    // the result is served from there. NO -X POST: it pins the method across
    // that redirect, so curl re-POSTs with no body and Google answers with a
    // sign-in page instead of JSON -- which reads exactly like a missing
    // version cut and is not one. --data-binary alone already means POST.
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
    // An HTML page here is the endpoint 404ing or asking for a login, which is
    // what a missing version cut looks like from this side.
    die(`the sink answered with something that is not JSON:\n${raw.slice(0, 300)}`, 7);
  }
  if (!res.ok) die(`the sink refused: ${res.error || raw}`, 7);

  // ok:true only means the endpoint ran the action. The action reports its own
  // refusals in the result, and a refusal that reads as success is the failure
  // this whole pipeline is built to avoid.
  const r = res.result || {};
  if (r.error || r.skipped) die(`the sink did nothing: ${r.error || r.skipped}`, 7);
  return r;
}

// --- main --------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  if (!args.length || args[0] === '--help') {
    console.error('usage: redige.mjs <notes.md|meeting.m4a> [--out FILE] [--post [--dry-run]] [--json]');
    process.exit(2);
  }

  const input = args[0];
  const outFlag = args.indexOf('--out');
  const out = outFlag > -1 ? args[outFlag + 1] : input.replace(/\.[^.]+$/, '') + '.recap.json';

  const notes = intake(input);
  if (notes.trim().length < 500) {
    die(`input is ${notes.trim().length} chars, under the 500-char floor -- refusing rather than recapping nothing`, 3);
  }

  const vault = readVault();
  console.error(`-- vault: ${Object.keys(vault.motifs).length} motifs, ${vault.examples.length} example recaps`);

  const decision = parseDecision(callModel(buildSystemPrompt(vault), notes));

  const findings = runChecks(decision, notes, vault);

  writeFileSync(out, JSON.stringify({ ...decision, _checks: findings }, null, 2));
  console.error(`-- wrote ${out}`);
  report(findings);

  if (args.includes('--json')) console.log(JSON.stringify(decision, null, 2));
  else console.log(render(decision));

  const blocking = findings.filter(f => f.level === 'fail');
  if (args.includes('--post')) {
    if (blocking.length) die(`${blocking.length} blocking finding(s) -- not posting`, 6);
    const dryRun = args.includes('--dry-run');
    const r = post(decision, dryRun);
    console.error(dryRun
      ? `-- DRY RUN: the sink would have drafted to ${r.wouldSendTo}. Nothing was written.`
      : `-- drafted to ${r.recipient}. NOTHING WAS SENT -- a director opens the draft and sends it.`);
  }
  process.exit(blocking.length ? 6 : 0);
}

function render(d) {
  const strip = s => s.replace(/<li>/g, '  - ').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const lines = [`Subject: ${d.subject}`, '', strip(d.body_html || '')];
  if (d.open_questions?.length) {
    lines.push('', '--- still open ---', ...d.open_questions.map(q => `  - ${q}`));
  }
  lines.push('', `[confidence: ${d.confidence}]`);
  return lines.join('\n');
}

main(process.argv);
