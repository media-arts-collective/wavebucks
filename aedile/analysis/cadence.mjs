#!/usr/bin/env node
/**
 * cadence.mjs -- reproduce the "heads-up" cadence finding from the archive.
 *
 * This is the DURABLE home for the bimodal-lead-time finding: not prose that
 * rots, but a mechanism anyone can re-run. Prints, from the mailing-list
 * archive, the numbers that back aedile's heads-up genre timing:
 *
 *   - lead-time distribution (send -> event), median/mean, %<=1d, %<=3d
 *   - which weekday heads-ups are sent on
 *   - send-hour of same-day nudges (morning-of vs later)
 *   - messages-per-topic (touches per event)
 *   - operator announcements: new-subject thread-starters vs replies
 *
 * Reads the archive from $KREWE_VAULT/messages.jsonl (JSON lines:
 * {author,email,date,body,topic_url}). Default path is the (deprecating)
 * /srv location -- override with KREWE_VAULT when the corpus moves.
 *
 * NOT JavaScript for Apps Script: node-only (fs/import). Excluded from
 * `clasp push` via aedile/.claspignore (`analysis/**`). Pushing it would
 * break the live project.
 *
 *   node aedile/analysis/cadence.mjs
 *   KREWE_VAULT=/some/other/path node aedile/analysis/cadence.mjs
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';
const KREWE_ACCOUNT = 'kreweofvaporwave@gmail.com';

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const DOW_IDX = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };

// "Jan 29, 2024, 2:48:24 PM" (with a narrow no-break space before AM/PM in the raw)
function parseDate(s) {
  const t = s.replace(/[  ]/g, ' ').trim();
  const m = t.match(/^(\w{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let [, mon, day, year, hh, mm, ss, ap] = m;
  let h = parseInt(hh, 10) % 12;
  if (/pm/i.test(ap)) h += 12;
  // UTC is fine: we only need weekday and hour-of-day, both stable here.
  return new Date(Date.UTC(+year, MONTHS[mon], +day, h, +mm, +ss));
}

const DOW_RE = /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i;
const TIME_RE = /(\b\d{1,2}\s?(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b)/i;
const FUTURE_RE = /tomorrow|tonight|today|this \w+day|next \w+day|see you|reminder|don'?t forget/i;

function isAnnouncement(body) {
  const b = body.toLowerCase();
  let score = 0;
  if (DOW_RE.test(b)) score++;
  if (TIME_RE.test(b)) score++;
  if (/\b\d{3,5}\s+\w+/.test(body)) score++;   // street address
  if (FUTURE_RE.test(b)) score++;
  return score >= 3;
}

// Days from send to the referenced event, or null if not resolvable.
function leadDays(msg) {
  const d = msg._d;
  if (!d) return null;
  const b = msg.body.slice(0, 600).toLowerCase();
  if (/\btonight\b|\btoday\b/.test(b)) return 0;
  if (/\btomorrow\b/.test(b)) return 1;
  const mm = b.match(DOW_RE);
  if (mm) return ((DOW_IDX[mm[1].toLowerCase()] - d.getUTCDay()) % 7 + 7) % 7;
  return null;
}

const median = a => { const s=[...a].sort((x,y)=>x-y); const n=s.length; return n? (n%2? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2) : 0; };
const mean = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const pct = (n,d) => d ? Math.round(100*n/d) : 0;

const raw = readFileSync(join(VAULT, 'messages.jsonl'), 'utf8').trim().split('\n');
const msgs = raw.map(l => JSON.parse(l));
for (const m of msgs) m._d = parseDate(m.date);

const anns = msgs.filter(m => isAnnouncement(m.body));
const dated = anns.filter(m => m._d);

// --- lead time ---
const leads = [];
for (const m of anns) { const L = leadDays(m); if (L !== null && L <= 21) leads.push(L); }
const hist = {};
for (const L of leads) hist[L] = (hist[L]||0)+1;

// --- send day-of-week ---
const sendDow = {};
for (const m of dated) { const k = DOW[m._d.getUTCDay()]; sendDow[k]=(sendDow[k]||0)+1; }

// --- same-day nudge send-hour ---
const hrs = dated.filter(m => /tonight|today/i.test(m.body.slice(0,400))).map(m => m._d.getUTCHours());

// --- messages per topic ---
const byTopic = {};
for (const m of msgs) { if (m.topic_url) (byTopic[m.topic_url] ||= []).push(m); }
const topics = Object.values(byTopic);
const single = topics.filter(v => v.length === 1).length;

// --- operator announcements: starter vs reply ---
let starter=0, reply=0;
for (const v of topics) {
  const s = v.filter(m=>m._d).sort((a,b)=>a._d-b._d);
  s.forEach((m,i) => {
    if (m.email === KREWE_ACCOUNT && isAnnouncement(m.body)) (i===0 ? starter++ : reply++);
  });
}

// --- report ---
const p = (...a) => console.log(...a);
p(`archive: ${msgs.length} msgs, ${topics.length} topics  (VAULT=${VAULT})`);
p(`announcement-like (heuristic score>=3): ${anns.length}`);
p('');
p('LEAD TIME (days from send to event):');
for (let k=0;k<=14;k++) if (hist[k]) p(`  ${String(k).padStart(2)}d  ${'#'.repeat(hist[k])} (${hist[k]})`);
p(`  median=${median(leads)}d  mean=${mean(leads).toFixed(1)}d  n=${leads.length}`);
p(`  <=1d (same/next-day nudge): ${pct(leads.filter(x=>x<=1).length, leads.length)}%`);
p(`  <=3d: ${pct(leads.filter(x=>x<=3).length, leads.length)}%`);
p(`  >=4d (setup-in-digest hump): ${pct(leads.filter(x=>x>=4).length, leads.length)}%`);
p('');
p('SEND day-of-week:');
for (const k of DOW.slice(1).concat(DOW[0])) p(`  ${k.padEnd(9)} ${sendDow[k]||0}`);
p('');
p(`SAME-DAY nudge send-hour (n=${hrs.length}): morning<12=${hrs.filter(h=>h<12).length}  12-17=${hrs.filter(h=>h>=12&&h<17).length}  >=17=${hrs.filter(h=>h>=17).length}  median=${median(hrs)}h`);
p('');
p(`MESSAGES PER TOPIC: single-message = ${pct(single, topics.length)}% of ${topics.length} topics`);
p(`OPERATOR announcements: new-subject starters=${starter}  replies=${reply}  (${pct(starter, starter+reply)}% new-subject)`);
p('');
p('HEADLINE: heads-up lead time is bimodal -- a same/next-day nudge (mode 0-1d,');
p('~60%) plus a smaller ~4-6d setup hump (usually embedded in a digest). Same-day');
p('nudges go out in the morning. Announcements are ~always new-subject.');
