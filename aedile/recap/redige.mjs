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
import { execFileSync, spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runChecks, report } from './checks.mjs';
import { dealDevices, devicesBlock } from './devices.mjs';

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
export function readVault() {
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
    // A thread file is frontmatter, a link header, then one section per message
    // headed `## <date> -- [[people/...]]`. Take the FIRST message only.
    //
    // This used to be `split(/^---$/m).slice(2).join('---')`, which kept every
    // LATER message too -- so REAL RECAP 1 was being shown to the model with a
    // reply pasted onto the end of it reading `Brandon Bales / WBBALES.COM`,
    // plus the horizontal rules between messages. An exemplary recap that ends
    // in someone else's signature block teaches exactly that.
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

/** Pluggable, per the plan: whichever backing is available. The generator does
 *  not know which ran. Apps Script would supply a third
 *  (AnthropicClient.getJsonDecision) without this file changing shape. */
export function callModel(systemPrompt, userContent) {
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

/** Same two backings, without blocking the event loop.
 *
 *  callModel above is execFileSync, so a twelve-pair burst was twenty-four
 *  calls of forty to sixty seconds each, strictly one after another: about
 *  twenty-five minutes to produce something a reader gets through in ten. The
 *  pairs are independent and always were; only the two steps WITHIN a pair are
 *  ordered. This is what lets a caller run several at once.
 *
 *  Kept beside the sync version rather than replacing it: redige.mjs proper
 *  makes exactly one call and gains nothing from being asynchronous. */
function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve(out)
      : reject(new Error(err.trim().split('\n')[0] || `${cmd} exited ${code}`)));
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

export async function callModelAsync(systemPrompt, userContent) {
  const attempts = Number(process.env.REDIGE_ATTEMPTS || 3);
  for (let i = 1; i <= attempts; i++) {
    try {
      if (process.env.ANTHROPIC_API_KEY) {
        const payload = JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        });
        const raw = await run('curl', ['-sf', 'https://api.anthropic.com/v1/messages',
          '-H', `x-api-key: ${process.env.ANTHROPIC_API_KEY}`,
          '-H', 'anthropic-version: 2023-06-01',
          '-H', 'content-type: application/json',
          '--data-binary', '@-'], payload);
        return JSON.parse(raw).content[0].text;
      }
      // Notes on stdin, for the same reason callCli does it: an argv positional
      // beginning with `-` is parsed as an option.
      return await run('claude', ['-p', '--append-system-prompt', systemPrompt], userContent);
    } catch (err) {
      const why = String(err.message || err).trim().split('\n')[0];
      if (i === attempts) throw new Error(`model call failed ${attempts}x -- ${why}`);
      console.error(`-- attempt ${i} failed (${why}); retrying`);
      await new Promise(r => setTimeout(r, i * 5000));
    }
  }
}

function callCli(systemPrompt, userContent) {
  console.error('-- model: claude -p');
  // The notes go in on STDIN, not as an argv positional. As a positional, any
  // input whose first character is `-` is parsed by the CLI as an option and
  // the run dies with `error: unknown option '- rental sweeper broken...'`.
  // Notes that open with a bullet are not exotic -- that is what notes look
  // like -- and the failure is total, three retries deep, with the whole file
  // quoted back as the option name.
  return execFileSync('claude', ['-p', '--append-system-prompt', systemPrompt],
    { input: userContent, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
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
export function parseDecision(text) {
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

export function buildSystemPrompt(vault) {
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
 *  mandark at all. What crosses the wire is the decision's own fields, not an
 *  assembled body -- the sink joins them with the same appendOpenQuestions the
 *  in-script path uses, so both paths file the same artifact.
 */
function post(decision, dryRun) {
  const token = process.env.WRITE_API_TOKEN;
  if (!token) {
    die('WRITE_API_TOKEN is not set -- it gates the sink, and this end has no other way in', 5);
  }

  const draft = JSON.stringify({
    subject: decision.subject,
    body: decision.body,
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

  // Which optional devices this recap gets. Presentation only -- it never
  // touches what the recap SAYS. A single generation cannot reproduce a
  // corpus frequency on its own, so the caller rolls and tells it.
  const hand = dealDevices();
  const dealt = Object.entries(hand).filter(([, v]) => v).map(([k]) => k);
  console.error(`-- devices: ${dealt.join(', ') || 'none'}`);

  const prompt = [buildSystemPrompt(vault), devicesBlock(hand)].filter(Boolean).join('\n\n');
  const decision = parseDecision(callModel(prompt, notes));

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

/** What you read here is what the krewe receives, character for character.
 *
 *  It did not used to be. The body was HTML and this function un-marked-up a
 *  rough approximation of it for the terminal, so reviewing a draft meant
 *  reading one thing and sending another -- and the two differed in exactly the
 *  place a reviewer would not look, the open-questions section, which the sink
 *  assembles rather than the model. Plain text ended that, and the only reason
 *  it can now be promised is that `body` needs no rendering at all.
 *
 *  So this is a copy of MeetingRecap.js's appendOpenQuestions -- change one,
 *  change both -- plus a subject line and the confidence, neither of which is
 *  part of the body. */
function render(d) {
  const open = d.open_questions?.length
    ? `\n\nStill open:\n${d.open_questions.map(q => `  - ${q}`).join('\n')}`
    : '';
  return [
    `Subject: ${d.subject}`,
    '',
    (d.body || '') + open,
    '',
    `[confidence: ${d.confidence}]`,
  ].join('\n');
}

// Only when run directly. duel.mjs imports readVault/buildSystemPrompt/
// callModel/parseDecision from here so the game exercises the SAME prompt the
// product uses -- a second copy would drift, which is precisely how Context.js
// came to request a field MeetingRecap had stopped reading.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
