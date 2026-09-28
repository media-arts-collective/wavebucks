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

// aedile's Web App, the deployment the anonymous URL serves. A version cut
// updates THIS deployment rather than making a new one, so the URL is stable
// and belongs in the source. The version it points at is NOT stable and does
// not belong here: this comment said `@10` while the deployment had moved to
// @16, then @18 (2026-09-26, readThread/readInbox). `clasp deployments` is the
// answer to which version is live; a number in a comment is a claim that rots.
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

/** Bullets mean outline. Detected, not declared: a heading or marker the writer
 *  has to remember is a contract that gets forgotten, and the notes are written
 *  during a meeting. Whisper output is unbulleted prose, so it falls through
 *  unchanged and the transcript path is untouched. */
const looksLikeOutline = raw => (raw.match(/(?:^|\n)\s*[*\-\u2022]\s+\S/g) || []).length >= 3;

/** One model call, turning bullets into the meeting as it was spoken, so the
 *  outline rides the pipeline the transcript already rides -- same prompt, same
 *  devices, same checks, nothing downstream aware of which path it came from.
 *
 *  THE CHECKS STILL GRADE THE RAW FILE, not this. #68's warning is that a
 *  fabricated transcript makes invented-name/invented-figure circular, because
 *  they prove a fact appears in the input and the agent wrote the input. That
 *  applies to this output too: it is model-authored. So main() keeps the writer's
 *  bytes as the grounding text and hands only the model the spoken version, which
 *  means anything this pass adds is caught against the original rather than
 *  laundered by it. */
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

/** The genres this generator can write. A genre is a speech act, orthogonal to
 *  topic (#49): the recap reports what a meeting settled, the heads-up summons
 *  people to a gathering. Each is one prompt file appended after the core.
 *
 *  `headsup` was specified in full on 2026-09-13 and then sat unwired for two
 *  weeks, during which two sessions produced heads-up mail by hand-writing prose
 *  straight into `call.sh createDraft` -- which is how a numbered, digest-length
 *  notice went out under a spec whose own text says "a single-venue heads-up
 *  should not be numbered". Zach, 2026-09-26: "is this being generated by a
 *  script? don't we have a script that makes drafts? feels like you're
 *  handrolling." A spec no code reads is a document, not a rule. */
export const GENRES = {
  recap: { context: 'AEDILE_CONTEXT.recap.md', label: 'recap_draft_posted' },
  headsup: { context: 'AEDILE_CONTEXT.headsup.md', label: 'headsup_draft_posted' },
};

export function buildSystemPrompt(vault, genre = 'recap') {
  const g = GENRES[genre] || die(`unknown genre "${genre}" -- one of ${Object.keys(GENRES).join(', ')}`, 2);
  const examples = vault.examples
    .map((e, i) => `--- REAL RECAP ${i + 1}, written by the krewe's own voice ---\n${e}`)
    .join('\n\n');

  // The transport advertises the CLI's tools even though `allowedTools: []`
  // refuses them, so the model can still EMIT a tool_use block. `maxTurns: 1`
  // then spends the only turn on the rejected call and the run ends
  // `error_max_turns` with no text: six consecutive failures on 2026-09-26,
  // diagnosed as `Grep`/`Glob` against a path that never existed. The prompt says
  // so plainly rather than the transport being loosened, because a second turn
  // would buy a retry for a call that should not happen at all.
  const closed = ['## You have no tools here', '',
    'Everything you need is in this prompt and the notes that follow it. There is no',
    'archive to search and no file to read: any tool call is refused and costs you',
    'the whole answer. Write the email from what you have been given.'].join('\n');

  // The genre file ENDS with its output contract, so it goes last: the two blocks
  // that are not the contract sit above it. A prompt whose final words are
  // anything other than "respond with only JSON" gets prose some of the time.
  // BOTH genres' form is COMPUTED, not quoted: the context file carries the
  // genre's purpose and the beats' functions, and analysis/headsup-form.mjs or
  // analysis/recap-form.mjs measures the shape from the corpus every run. A figure
  // in a prompt file is a snapshot, and both snapshots this file used to carry were
  // falsified the first time anyone measured them.
  //
  // The recap went two weeks longer than the heads-up with no measured block at
  // all, which is how a draft carrying 7 items of 28 words each reached a human
  // against a corpus median of 5 items of 43 (#49). Quoting two example recaps is
  // not the same as stating their shape: the model had the examples in front of it
  // both times.
  return [
    contextBody('AEDILE_CONTEXT.core.md'),
    `## Two real recaps from the archive\n\nMatch this register. Do not copy their content.\n\n${examples}`,
    closed,
    contextBody(g.context),
    genre === 'headsup' ? formBlock() : recapFormBlock(),
  ].filter(Boolean).join('\n\n');
}

/** Lead time, computed HERE and never by the model.
 *
 *  A heads-up's whole content is a date, and `AEDILE_CONTEXT.recap.md` forbids
 *  inventing one ("A recap that invents a date is worse than no recap"), so
 *  nothing in the generation path has ever called `new Date()`. But "build day is
 *  TOMORROW" is the single most important word in a day-before notice and the
 *  model cannot derive it without knowing today. So the operator passes
 *  --event-date, Node does the arithmetic, and the model is handed the answer as
 *  a fact alongside the beat. It still invents no date; it is told one.
 *
 *  Beat comes from the corpus, not from taste: lead time is bimodal with a mode
 *  at 0-1 days, and a same-day nudge goes out in the morning. */
export function leadTimeBlock(eventDate, beat, asOf) {
  if (!eventDate) return '';
  for (const [flag, v] of [['--event-date', eventDate], ['--as-of', asOf]]) {
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) die(`${flag} must be YYYY-MM-DD, got "${v}"`, 2);
  }
  // `--as-of` is the day the mail will be READ, which is not always the day it is
  // generated. A nudge goes out in the morning (corpus median 10am) and gets
  // written the night before, so computing lead time against the clock makes it
  // say "tomorrow" to someone reading it on the day. The operator states the send
  // date; nothing here guesses it.
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

/** The list any outbound genre is addressed to -- the Google Group, not the Workspace
 *  account aedile runs as (those are different addresses, and confusing them
 *  drafts krewe mail to aedile's own inbox). Kept in step with MeetingRecap.js's
 *  RECAP_RECIPIENT by hand: this end and the Apps Script end must agree. */
const LIST_RECIPIENT = 'kreweofvaporwave@googlegroups.com';

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
function post(decision, dryRun, genre = 'recap') {
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
    `to=${encodeURIComponent(LIST_RECIPIENT)}`,
    `subject=${encodeURIComponent(decision.subject)}`,
    `body=${encodeURIComponent(body)}`,
    `logLabel=${encodeURIComponent(GENRES[genre].label)}`,
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
    console.error('usage: redige.mjs <notes.md|meeting.m4a|saved.json> [--genre recap|headsup]');
    console.error('                  [--beat lock-in|nudge] [--event-date YYYY-MM-DD]');
    console.error('                  [--as-of YYYY-MM-DD: the day it will be READ, default today]');
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
  if (genre === 'headsup' && !eventDate) {
    // Fail loud. A heads-up whose lead time nobody computed is the exact draft
    // that goes out saying "Sunday the 27th" to people reading it on the 27th.
    die('--genre headsup requires --event-date YYYY-MM-DD: the beat and the word "tomorrow" are derived from it', 2);
  }
  const out = flag('--out') || input.replace(/\.[^.]+$/, '') + `.${genre}.json`;

  // A saved decision can be re-posted without regenerating. Without this, the
  // only way to post was to generate again, so the operator reviewed one draft
  // and shipped its sibling: `--post --dry-run` and `--post` are two runs and the
  // model does not repeat itself. Reviewing text that is not the text that goes
  // out is worse than not reviewing. The notes come back too, so the checks still
  // grade against the input they were written from rather than against nothing.
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
      const dryRun = args.includes('--dry-run');
      const r = post(saved, dryRun, genre);
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

  // `spoken` is what the model drafts from; `raw` stays the grounding text for the
  // checks. An outline gets converted to speech first so it rides the transcript
  // path; a transcript is already speech and is passed through untouched.
  const outline = looksLikeOutline(raw);
  const spoken = outline ? await outlineToTranscript(raw) : raw;
  if (outline) console.error(`-- outline detected: ${raw.trim().length} chars of notes -> ${spoken.length} chars of speech`);

  const vault = readVault();
  console.error(`-- vault: ${Object.keys(vault.motifs).length} motifs, ${vault.examples.length} example recaps`);

  // Which optional devices this recap gets. Presentation only -- it never
  // touches what the recap SAYS. A single generation cannot reproduce a
  // corpus frequency on its own, so the caller rolls and tells it.
  // The dealt rates for a heads-up are measured, not tabulated: see
  // analysis/headsup-form.mjs. A recap keeps devices.mjs's own pool rates.
  const hand = dealDevices(undefined, genre, beat, genre === 'headsup' ? measuredRates() : {});
  const flourish = dealFlourish();
  const typo = dealTypo();
  const signoff = dealSignoff();
  const gap = dealGap(undefined, genre);
  const subjectShape = dealSubject(undefined, subjectWeights());
  const dealt = Object.entries(hand).filter(([, v]) => v).map(([k]) => k);
  console.error(`-- genre: ${genre}${beat ? ` (beat: ${beat})` : ''}`);
  console.error(`-- devices: ${dealt.join(', ') || 'none'}; gap ${gap}`);
  console.error(`-- subject: ${subjectShape.slice(9, 96)}`);

  const lead = leadTimeBlock(eventDate, beat, asOf);
  // Same principle as leadTimeBlock, applied to every date in the notes rather
  // than just the event's: Node resolves the weekday, the model is told. Built
  // from `raw` -- the writer's own bytes -- not from the model's rendering of
  // them, so the spelling it is shown is the spelling the checks grade against.
  const dates = dateBlock(raw, asOf ? new Date(asOf) : new Date());
  const leadDays = eventDate ? leadTimeBlock.days : undefined;
  const prompt = [
    buildSystemPrompt(vault, genre),
    lead,
    dates,
    devicesBlock(hand, [flourish, signoff].filter(Boolean).join('\n- '), typo, gap, subjectShape),
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

  // ONE repair pass, and only over blocking findings.
  //
  // Every check message already says what is wrong and why, in the words a human
  // reads. Handing those same words back to the model is strictly cheaper than a
  // human re-rolling: on 2026-09-27 three consecutive generations were blocked by
  // three mechanical violations each ("a member's handle: misterdee27", "a person
  // attached to an opinion: Zach has doubts", "1pm not present in the input"), all
  // of them fixable without any new fact.
  //
  // Bounded at one, and it keeps whichever draft grades better, so a repair that
  // makes things worse is discarded rather than shipped. It changes nothing about
  // grounding: the notes the checks grade against are untouched, so a repair cannot
  // launder an invented fact -- it can only remove one.
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

  // _hand/_gap are saved because the re-post path re-grades the SAVED decision, and
  // without them `hand-ignored` -- the one check that verifies the draft followed the
  // draw -- silently did not run on the bytes that actually ship. It also made the
  // question "was it following the deal?" unanswerable from the artifact: the draw is
  // unseeded, printed to stderr once, and then gone.
  writeFileSync(out, JSON.stringify({ ...decision, _checks: findings, _notes: raw, _spoken: outline ? spoken : undefined, _hand: hand, _gap: gap }, null, 2));
  console.error(`-- wrote ${out}`);
  report(findings);

  if (args.includes('--json')) console.log(JSON.stringify(decision, null, 2));
  else console.log(render(decision));

  const blocking = findings.filter(f => f.level === 'fail');
  if (args.includes('--post')) {
    if (blocking.length) die(`${blocking.length} blocking finding(s) -- not posting`, 6);
    const dryRun = args.includes('--dry-run');
    const r = post(decision, dryRun, genre);
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
