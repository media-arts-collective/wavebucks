#!/usr/bin/env node
// triage.mjs [--dry-run] -- reviews unread krewe mail that has no Log row and,
// per message, drafts a reply, flags it for a director, or stays quiet.
// Never sends. A message is done when its Log row exists, so a run that died
// is rerun as it is. --dry-run decides and prints, and writes nothing.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getJsonDecision } from './model.mjs';
import { VAULT } from '../analysis/corpus.mjs';
import { contextBody } from '../recap/redige.mjs';

const CALL = join(dirname(fileURLToPath(import.meta.url)), '../recap/call.sh');
const SCAN_DAYS = 14;
const SCAN_QUERY = `in:inbox is:unread newer_than:${SCAN_DAYS}d`;
const MAX_MESSAGES_PER_RUN = 20;
const HISTORY_DAYS = 365;
const LOG_LIMIT = 500;
// Distinct To+Cc addresses at or below this reads as a direct ask.
const DM_RECIPIENT_THRESHOLD = 3;
const ACTIONS = ['no_action', 'draft_reply', 'flag'];
const READS = ['get', 'readInbox', 'readThread'];

// The LAST bracketed group: the address follows the display name, and a
// display name can itself contain `<someone@else>`.
export function extractEmail(header) {
  const groups = String(header).match(/<([^<>]+)>/g);
  const last = groups && groups[groups.length - 1];
  return (last ? last.slice(1, -1) : String(header)).toLowerCase().trim();
}

export function audienceOf(msg) {
  const recipients = new Set(`${msg.to || ''},${msg.cc || ''}`.split(',')
    .filter(a => a.trim()).map(extractEmail));
  return recipients.size <= DM_RECIPIENT_THRESHOLD ? 'dm' : 'list';
}

// Dedup is by message id in the Log, not by label: the label is per thread and
// permanent, so it would hide a later reply.
export function pending(messages, logged) {
  return messages.filter(m => m.unread && !logged.has(m.messageId));
}

// A reply carries every earlier message under it; the history holds each once.
export function stripQuoted(body) {
  const kept = [];
  for (const line of String(body).split('\n')) {
    if (/^On .{10,90} wrote:\s*$/.test(line.trim())) break;
    if (!line.trimStart().startsWith('>')) kept.push(line);
  }
  return kept.join('\n').trim();
}

export function historyBlock(rows, now = new Date()) {
  const since = new Date(now - HISTORY_DAYS * 86400000).toISOString();
  const recent = rows
    .filter(m => m.date_iso && new Date(m.date_iso).toISOString() >= since)
    .sort((a, b) => new Date(a.date_iso) - new Date(b.date_iso))
    .map(m => `--- ${m.date_iso.slice(0, 10)} ---\nFrom: ${m.author || m.email || ''}\nSubject: ${m.subject || ''}\n\n${stripQuoted(m.body || '')}`);
  return `MAILING LIST HISTORY (last ${HISTORY_DAYS} days, oldest first):\n\n${recent.join('\n\n') || 'none recorded.'}`;
}

export function threadBlock(messages, current) {
  return messages.map((m, i) => [
    `--- Message ${i + 1}${m.messageId === current.messageId ? ' (this is the message under review)' : ''} ---`,
    `From: ${extractEmail(m.from)}`, `Date: ${m.date}`, `Subject: ${m.subject}`, '', m.body,
  ].join('\n')).join('\n\n');
}

// The Log is read newest-first with a row limit. Dedup holds only while those
// rows reach back past the scan window.
export function logCoversWindow(rows, now = new Date()) {
  if (rows.length < LOG_LIMIT) return true;
  return new Date(rows[rows.length - 1].Timestamp) < new Date(now - SCAN_DAYS * 86400000);
}

// Every write one decision causes, as call.sh argument lists, in order. The Log
// row is last, so a message whose earlier writes failed is reviewed again.
export function writesFor(d, msg, threadId) {
  const from = extractEmail(msg.from);
  const writes = [];
  if (d.action === 'draft_reply') {
    writes.push(['createDraft', `threadId=${threadId}`, `body=${d.draft_body}`, 'logLabel=triage_draft', `logNote=${d.reasoning}`]);
  } else if (d.action === 'flag') {
    writes.push(['addLabel', `threadId=${threadId}`, 'label=aedile-flagged']);
  }
  if (d.loop) {
    writes.push(['openLoop', `owner=${d.loop.owner}`, `ask=${d.loop.ask}`, `due=${d.loop.due}`, `audience=${d.loop.audience}`,
      `counterpart=${String(msg.from).replace(/\s*<[^<>]+>\s*$/, '')}`, `contact=${from}`,
      'channel=email', 'tag=triage', `source=thread ${threadId}`]);
  }
  writes.push(['logEvent', `messageId=${msg.messageId}`, `threadId=${threadId}`, `from=${from}`,
    `subject=${msg.subject}`, `logLabel=${d.action}`, `logNote=${d.reasoning}`]);
  return writes;
}

function call(...args) {
  // /exec sometimes answers with Google's HTML page (#54). A read is safe to repeat.
  for (let left = READS.includes(args[0]) ? 3 : 1; ; ) {
    const raw = execFileSync(CALL, args, { encoding: 'utf8', maxBuffer: 64 << 20 });
    let res;
    try { res = JSON.parse(raw); } catch {
      if (--left) continue;
      throw new Error(`${args[0]} did not answer JSON: ${raw.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(`${args[0]} refused: ${JSON.stringify(res).slice(0, 300)}`);
    return res;
  }
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const log = call('get', 'log', `limit=${LOG_LIMIT}`).rows;
  if (!logCoversWindow(log)) throw new Error(`the newest ${LOG_LIMIT} Log rows do not reach back ${SCAN_DAYS} days; dedup would miss rows`);
  const logged = new Set(log.map(r => r.MessageID));

  const system = [contextBody('AEDILE_CONTEXT.core.md'), contextBody('AEDILE_CONTEXT.triage.md')].join('\n\n');
  const history = historyBlock(readFileSync(join(VAULT, 'messages.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)));

  // So the model neither reopens a tracked ask nor dates one in the past.
  const tracked = call('get', 'loops', 'open=true').rows.map(r => `${r.Id} ${r.Owner}: ${r.Ask}`).join('\n') || 'none';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

  let reviewed = 0;
  for (const t of call('readInbox', `q=${SCAN_QUERY}`, 'limit=50').threads) {
    const { messages } = call('readThread', `threadId=${t.threadId}`);
    if (messages.some(m => typeof m.unread !== 'boolean')) throw new Error('readThread returned no `unread` flag; the deployed WriteApi predates it');
    const todo = pending(messages, logged);
    for (const msg of todo) {
      if (reviewed >= MAX_MESSAGES_PER_RUN) {
        console.error(`-- triage: cap of ${MAX_MESSAGES_PER_RUN} reached; the rest wait for the next run`);
        return;
      }
      const from = extractEmail(msg.from);
      const audience = audienceOf(msg);
      const d = await getJsonDecision(system,
        `${history}\n\n${'='.repeat(20)}\n\nTHREAD UNDER REVIEW:\n\n${threadBlock(messages, msg)}\n\nAUDIENCE: ${audience}\nTODAY: ${today}\n\nOPEN LOOPS:\n${tracked}`);
      if (!ACTIONS.includes(d.action)) throw new Error(`unknown action ${JSON.stringify(d.action)} for ${msg.messageId}`);
      if (d.action === 'draft_reply' && !d.draft_body) throw new Error(`draft_reply with no draft_body for ${msg.messageId}`);
      reviewed++;
      console.log(`${dryRun ? '[dry run] ' : ''}${msg.messageId} ${audience} ${from} "${msg.subject}" -> ${d.action}: ${d.reasoning}`);
      if (d.loop) console.log(`  loop: ${d.loop.owner}, due ${d.loop.due}, ${d.loop.audience}: ${d.loop.ask}`);
      if (d.action === 'draft_reply') console.log(d.draft_body.replace(/^/gm, '  | '));
      if (dryRun) continue;

      for (const write of writesFor(d, msg, t.threadId)) call(...write);
    }
    // Only a thread whose every unread message was seen: the cap returns above.
    if (!dryRun && todo.length) call('addLabel', `threadId=${t.threadId}`, 'label=aedile-reviewed');
  }
  console.error(`-- triage: reviewed ${reviewed} message(s)${dryRun ? ', wrote nothing' : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(err => { console.error(`triage: ${err.message}`); process.exitCode = 1; });
}
