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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { callModel, parseDecision } from '../brain/model.mjs';
import { runChecks, report } from './checks.mjs';
import { dealDevices, dealFlourish, dealTypo, dealSignoff, devicesBlock } from './devices.mjs';

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

// One model client for the whole project: brain/model.mjs (#40), driven by the
// subscription-authenticated `claude` CLI through the Agent SDK -- no
// ANTHROPIC_API_KEY (dead, #48). #41 collapsed this file's former duplicate
// callModel/callModelAsync/callApi/callCli/parseDecision onto it, so there is
// one implementation to keep correct rather than a copy that drifts. main()
// below awaits the (async) client; the old sync callModel (execFileSync) is
// gone. duel.mjs and judge.mjs import callModelAsync/parseDecision from here, so
// those names are re-exported unchanged -- callModelAsync IS brain's callModel,
// which already carries the retry/backoff the old duplicate had.
export { parseDecision };
export const callModelAsync = callModel;

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

/** The list a recap is addressed to -- the Google Group, not the Workspace
 *  account aedile runs as (those are different addresses, and confusing them
 *  drafts krewe mail to aedile's own inbox). Kept in step with MeetingRecap.js's
 *  RECAP_RECIPIENT by hand: this end and the Apps Script end must agree. */
const RECAP_RECIPIENT = 'kreweofvaporwave@googlegroups.com';

/** Render open_questions into the body the same way MeetingRecap.js does --
 *  plain text, "Still open:" then a dash list. #41 moved assembly here so the
 *  POST carries a FINISHED body: the createDraft primitive is a dumb sink that
 *  assembles nothing. The two copies (this and MeetingRecap.appendOpenQuestions,
 *  which the in-Apps-Script draftRecap path still uses) sit on opposite sides of
 *  the clasp boundary and cannot share a function; keep them identical. */
function appendOpenQuestions(body, openQuestions) {
  if (!openQuestions || !openQuestions.length) return body;
  const items = openQuestions.map(q => `  - ${q}`).join('\n');
  return `${body}\n\nStill open:\n${items}`;
}

/** Hand the finished draft to aedile's createDraft primitive (originate form).
 *
 *  This is the only step that touches Google, and it is deliberately the only
 *  one: aedile already runs AS the krewe account, so the capability lives where
 *  the credential already is and no Google credential has to exist on mandark at
 *  all. #41: a FINISHED plain-text body crosses the wire (to + subject + body),
 *  not the decision's raw fields for the far end to assemble -- the primitive is
 *  the single dumb draft sink and judges nothing.
 */
function post(decision, dryRun) {
  const token = process.env.WRITE_API_TOKEN;
  if (!token) {
    die('WRITE_API_TOKEN is not set -- it gates the sink, and this end has no other way in', 5);
  }

  // Plain text, no HTML: the archive is plain text and HTML would force escaping
  // things like `<3` -- the same reason MeetingRecap.js drafts plain.
  const body = appendOpenQuestions(decision.body, decision.open_questions);

  // The whole form body goes through a 0600 file rather than argv: a token on
  // a command line is readable out of /proc by any local account for as long
  // as curl runs.
  // logLabel/logNote name the genre + provenance for the Log tab (#53). The
  // primitive is genre-blind; the caller supplies these, so a recap reads as a
  // recap in the audit trail (restoring what the removed MeetingRecap.createDraft
  // sink used to write) rather than every draft being hardcoded as one.
  const form = [
    `token=${encodeURIComponent(token)}`,
    'action=createDraft',
    dryRun ? 'dryRun=true' : null,
    `to=${encodeURIComponent(RECAP_RECIPIENT)}`,
    `subject=${encodeURIComponent(decision.subject)}`,
    `body=${encodeURIComponent(body)}`,
    'logLabel=recap_draft_posted',
    `logNote=${encodeURIComponent('written by aedile/recap/redige.mjs on mandark')}`,
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

async function main(argv) {
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
  const flourish = dealFlourish();
  const typo = dealTypo();
  const signoff = dealSignoff();
  const dealt = Object.entries(hand).filter(([, v]) => v).map(([k]) => k);
  console.error(`-- devices: ${dealt.join(', ') || 'none'}`);

  const prompt = [buildSystemPrompt(vault), devicesBlock(hand, [flourish, signoff].filter(Boolean).join('\n- '), typo)].filter(Boolean).join('\n\n');
  let decision;
  try {
    decision = parseDecision(await callModel(prompt, notes));
  } catch (err) {
    die(String(err.message || err), 5);
  }

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
// callModelAsync/parseDecision from here so the game exercises the SAME prompt
// the product uses -- a second copy would drift, which is precisely how
// Context.js came to request a field MeetingRecap had stopped reading.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // main() is async now (the model client is): a throw before its own exit(0/6)
  // must still leave non-zero, not an unhandled rejection warning.
  main(process.argv).catch(err => die(String(err?.message || err), 1));
}
