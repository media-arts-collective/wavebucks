#!/usr/bin/env node
/**
 * brunch.mjs -- the shape of a Sunday-meeting announcement, measured per EVENT.
 *
 *   node aedile/analysis/brunch.mjs [--all] [--since YYYY]
 *
 * Why this exists and cadence.mjs does not answer it: cadence.mjs measures
 * MESSAGES. "How many bumps does one Sunday meeting get, and when" is a question
 * about EVENTS, so messages have to be grouped by the date they point at first.
 * Everything below is per-event.
 *
 * The seed was `Rapid Rewards Brunch. Sun. 1/4 @ 1pm, 920 St. Mary` -- the same
 * shape as the 2026-09-27 laser harp build day, which is also a Sunday with a 1pm
 * eat and a 3pm work half. Matching on that string alone would find almost
 * nothing, so the net is: an event resolving to a SUNDAY, in a message that reads
 * as an announcement, mentioning a meeting/brunch/build or the 920 St. Mary
 * address. Zach, 2026-09-26: "might not always be an exact string match, but
 * general sunday meetings are right."
 *
 * Recency: the archive spans 2019-2026 and the krewe's habits moved. Everything
 * is reported by era as well as pooled, so an older convention cannot quietly
 * outvote current practice on sample size alone. `--since` restricts the pool.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';
/** Whose messages count as the operator's.
 *
 *  NOT `email === 'kreweofvaporwave@gmail.com'`, which is what every other pool in
 *  this repo uses and which silently drops 92 of them. `messages.jsonl` carries
 *  BOTH `author` and `email`, and the scraper left `email: null` on 325 of 1099
 *  rows while redacting `author` to an ellipsized form: 85 MS messages are stored
 *  as `author: "kreweofv...@gmail.com", email: null`, and 7 more under the Office
 *  address. The loss is not spread evenly. 2026 has 88 unattributed rows out of
 *  116, so filtering on `email` throws away almost the whole recent era and makes
 *  current practice look like a 3-event sample. Zach, 2026-09-26: "the 3 event
 *  sample is obviously wrong. You've missed something."
 *
 *  Same class as #30 and #27: a scrape artifact shaping what the corpus appears to
 *  say. style.mjs, devices.mjs and checks.mjs all still use the narrow filter, so
 *  every rate they publish is measured on the old era. That is a bigger fix.
 */
const isKrewe = m => {
  const who = String(m.email || m.author || '');
  return who === 'kreweofvaporwave@gmail.com'
    || who === 'kreweofvaporwave@kreweofvaporwave.com'
    || /^kreweofv.*@gmail\.com$/.test(who)          // "kreweofv...@gmail.com", redacted
    || /^kreweofv.*@kreweofvaporwave\.com$/.test(who);
};
const ALL = process.argv.includes('--all');
const argNum = name => {
  const i = process.argv.indexOf(name);
  return i > -1 ? parseInt(process.argv[i + 1], 10) : null;
};
const SINCE = argNum('--since');
// `--until` matters more than `--since` here. The operator account is ONE address
// and TWO authors: Abe wrote it until he retired around 2025, and everything after
// is a successor. Pooling 2019-2026 blends two voices under one sign-off, so any
// rate quoted without an era is suspect. Zach, 2026-09-26: "I need pre 2025 data,
// that's before abe retired."
const UNTIL = argNum('--until');

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
const DOW_IDX = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
const DOW_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

function parseDate(s) {
  const m = String(s).replace(/[  ]/g, ' ').trim()
    .match(/^(\w{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, mon, day, year, hh, mm, ss, ap] = m;
  let h = parseInt(hh, 10) % 12;
  if (/pm/i.test(ap)) h += 12;
  return new Date(Date.UTC(+year, MONTHS[mon], +day, h, +mm, +ss));
}

/** The send hour, already local.
 *
 *  `messages.jsonl` stores the hour AS WRITTEN in local time, not UTC: only 0.8%
 *  of 1099 sends fall between 1am and 5am and the distribution peaks at 9-11am,
 *  which is a waking-hours curve. `parseDate` builds a Date whose UTC fields carry
 *  those local numbers, so `getUTCHours()` IS the local hour and shifting it by
 *  UTC-5 double-converts. An earlier version of this file did exactly that and
 *  reported a 7am median for announcements, which is what prompted the check.
 *  (Gmail, via readThread, really is UTC -- do not mix the two sources.) */
const localHour = d => d.getUTCHours();
const dayNum = d => Math.floor(d.getTime() / 86400000);

/** The date this message points at, as a day number, or null.
 *
 *  Order matters: an explicit `1/18` beats a weekday name, and "today" beats
 *  both, because a message saying "Today, Sun. 1/18" is about today either way. */
function eventDay(m) {
  const d = m._d;
  if (!d) return null;
  const head = m.body.slice(0, 700);
  const b = head.toLowerCase();
  if (/\b(tonight|today|this afternoon|this evening)\b/.test(b)) return dayNum(d);
  if (/\btomorrow\b/.test(b)) return dayNum(d) + 1;
  const md = head.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (md) {
    const [, mo, da] = md;
    if (+mo >= 1 && +mo <= 12 && +da >= 1 && +da <= 31) {
      // Year comes from the send date; a December send naming January is next year.
      let year = d.getUTCFullYear();
      if (+mo < d.getUTCMonth() + 1 - 6) year += 1;
      return dayNum(new Date(Date.UTC(year, +mo - 1, +da)));
    }
  }
  const dow = b.match(DOW_RE);
  if (dow) {
    const delta = ((DOW_IDX[dow[1].toLowerCase()] - d.getUTCDay()) % 7 + 7) % 7;
    return dayNum(d) + delta;
  }
  return null;
}

const TIME_RE = /\b\d{1,2}\s?(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b/i;
const ADDRESS_RE = /\b\d{3,5}\s+[A-Z][a-z]/;
const SUBJECTY = /\b(brunch|meeting|meet|build|work ?day|production|load|rehears)/i;
const FUTURE_RE = /tomorrow|tonight|today|this \w+day|next \w+day|see you|reminder|don'?t forget|bring/i;

function isAnnouncement(body) {
  let score = 0;
  if (DOW_RE.test(body)) score++;
  if (TIME_RE.test(body)) score++;
  if (ADDRESS_RE.test(body)) score++;
  if (FUTURE_RE.test(body)) score++;
  return score >= 3;
}

// --- load -------------------------------------------------------------------

const msgs = readFileSync(join(VAULT, 'messages.jsonl'), 'utf8').trim().split('\n')
  .map(l => JSON.parse(l))
  .filter(m => isKrewe(m) && typeof m.body === 'string');
for (const m of msgs) m._d = parseDate(m.date);

const candidates = msgs.filter(m => m._d && isAnnouncement(m.body) && SUBJECTY.test(m.body))
  .filter(m => (!SINCE || m._d.getUTCFullYear() >= SINCE)
            && (!UNTIL || m._d.getUTCFullYear() <= UNTIL));

// Group by the Sunday they point at.
const events = new Map();
for (const m of candidates) {
  const ev = eventDay(m);
  if (ev === null) continue;
  const evDate = new Date(ev * 86400000);
  if (evDate.getUTCDay() !== 0) continue;             // Sundays only
  const lead = ev - dayNum(m._d);
  if (lead < 0 || lead > 14) continue;
  if (!events.has(ev)) events.set(ev, []);
  events.get(ev).push({ m, lead, hour: localHour(m._d) });
}
for (const [, list] of events) list.sort((a, b) => b.lead - a.lead);

// --- form -------------------------------------------------------------------

const GREET = /^\s*(hi|hello|hey|hiya|yo|good (morning|evening|afternoon)|greetings|dear|friends|happy|ok|okay)\b/i;
const SIGNOFF = /(<3|\bxo+\b|\bbest\b|\bMS\b|\bSM\b)\s*$/i;
const words = b => (b.trim().match(/\S+/g) || []).length;
const times = b => new Set((b.match(/\b\d{1,2}\s?(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b/gi) || [])
  .map(s => s.toLowerCase().replace(/\s+/g, ''))).size;

function form(b) {
  return {
    chars: b.length,
    words: words(b),
    greet: GREET.test(b),
    signoff: SIGNOFF.test(b.trimEnd()),
    numbered: /(?:^|\n)\s*-?\d+\.\s/.test(b),
    caps: /\b[A-Z]{4,}\b/.test(b),
    bang: /!/.test(b),
    address: ADDRESS_RE.test(b),
    distinctTimes: times(b),
    paras: b.split(/\n\s*\n/).filter(x => x.trim()).length,
  };
}

// --- report -----------------------------------------------------------------

const p = console.log;
const med = a => { const s = [...a].sort((x, y) => x - y); const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : 0; };
const rate = (list, k) => list.length ? Math.round(100 * list.filter(x => x[k]).length / list.length) : 0;

const evList = [...events.entries()].sort((a, b) => a[0] - b[0]);
p(`archive: ${msgs.length} MS messages (narrow email-only filter would give 480)   candidates: ${candidates.length}   SUNDAY events matched: ${evList.length}`);
if (SINCE || UNTIL) p(`(restricted to ${SINCE || 'start'}..${UNTIL || 'end'})`);
p('');

p('MESSAGES PER EVENT (how many bumps a Sunday meeting gets):');
const counts = {};
for (const [, l] of evList) counts[l.length] = (counts[l.length] || 0) + 1;
for (const k of Object.keys(counts).sort()) {
  p(`  ${k} message${k === '1' ? ' ' : 's'}  ${'#'.repeat(counts[k])} (${counts[k]})`);
}
const sizes = evList.map(([, l]) => l.length);
p(`  mean=${(sizes.reduce((a, b) => a + b, 0) / (sizes.length || 1)).toFixed(2)}  median=${med(sizes)}  max=${Math.max(...sizes, 0)}`);
p('');

p('LEAD TIME of each message in the sequence (days before the Sunday):');
const byPos = {};
for (const [, l] of evList) l.forEach((x, i) => { (byPos[i] = byPos[i] || []).push(x); });
for (const i of Object.keys(byPos).sort()) {
  const xs = byPos[i];
  const leads = xs.map(x => x.lead), hours = xs.map(x => x.hour);
  p(`  message ${+i + 1}  n=${String(xs.length).padStart(3)}  lead median=${med(leads)}d  `
    + `leads=[${leads.slice().sort((a, b) => b - a).join(',')}]`.slice(0, 46)
    + `  send-hour median=${med(hours)}h`);
}
p('');

p('SEND HOUR by lead (local, as stored):');
for (const lead of [0, 1, 2, 3]) {
  const xs = evList.flatMap(([, l]) => l).filter(x => x.lead === lead);
  if (!xs.length) continue;
  const h = xs.map(x => x.hour);
  p(`  lead ${lead}d  n=${String(xs.length).padStart(3)}  median=${med(h)}h  `
    + `morning<12=${h.filter(x => x < 12).length}  12-16=${h.filter(x => x >= 12 && x < 17).length}  `
    + `17-20=${h.filter(x => x >= 17 && x < 21).length}  21+=${h.filter(x => x >= 21).length}`);
}
p('');

p('FORM, by position in the sequence (first announcement vs later bumps):');
p('   pos  n   chars  words  greet signoff numbered caps  "!"  addr  times  paras');
for (const i of Object.keys(byPos).sort()) {
  const f = byPos[i].map(x => form(x.m.body));
  if (!f.length) continue;
  p(`   ${+i + 1}    ${String(f.length).padStart(3)}  ${String(med(f.map(x => x.chars))).padStart(5)}  `
    + `${String(med(f.map(x => x.words))).padStart(5)}  ${String(rate(f, 'greet')).padStart(4)}% `
    + `${String(rate(f, 'signoff')).padStart(6)}% ${String(rate(f, 'numbered')).padStart(7)}% `
    + `${String(rate(f, 'caps')).padStart(4)}% ${String(rate(f, 'bang')).padStart(4)}% `
    + `${String(rate(f, 'address')).padStart(4)}% ${String(med(f.map(x => x.distinctTimes))).padStart(5)}  `
    + `${String(med(f.map(x => x.paras))).padStart(5)}`);
}
p('');

p('BY ERA (recency: later rows are current practice):');
const eras = {};
for (const [ev, l] of evList) {
  const y = new Date(ev * 86400000).getUTCFullYear();
  const bucket = y <= 2020 ? '2019-2020' : y <= 2022 ? '2021-2022' : y <= 2024 ? '2023-2024' : '2025-2026';
  (eras[bucket] = eras[bucket] || []).push(l);
}
p('   era        events  msgs/event  first-lead  last-lead  median chars  numbered  signoff');
for (const k of Object.keys(eras).sort()) {
  const ls = eras[k];
  const per = ls.map(l => l.length);
  const first = ls.map(l => l[0].lead), last = ls.map(l => l[l.length - 1].lead);
  const f = ls.flatMap(l => l.map(x => form(x.m.body)));
  p(`   ${k}  ${String(ls.length).padStart(6)}  ${String(med(per)).padStart(10)}  `
    + `${String(med(first)).padStart(10)}d ${String(med(last)).padStart(10)}d  `
    + `${String(med(f.map(x => x.chars))).padStart(12)}  ${String(rate(f, 'numbered')).padStart(7)}% `
    + `${String(rate(f, 'signoff')).padStart(6)}%`);
}
p('');

p('WHAT THE LAST MESSAGE BEFORE THE EVENT LOOKS LIKE (the bump that matters):');
const lasts = evList.map(([, l]) => l[l.length - 1]).filter(x => x.lead <= 1);
const lf = lasts.map(x => form(x.m.body));
p(`  n=${lasts.length} (lead 0-1d)   median ${med(lf.map(x => x.chars))} chars / ${med(lf.map(x => x.words))} words`);
p(`  restates the address: ${rate(lf, 'address')}%   distinct clock times: median ${med(lf.map(x => x.distinctTimes))}`);
p(`  greeting ${rate(lf, 'greet')}%   sign-off ${rate(lf, 'signoff')}%   numbered ${rate(lf, 'numbered')}%   ALL-CAPS ${rate(lf, 'caps')}%   "!" ${rate(lf, 'bang')}%`);
p('');

if (process.argv.includes('--bumps')) {
  // The day-before/day-of messages, whole. A median is not a specimen: "947 chars,
  // address 82%, one clock time" does not tell you what the thing READS like, and
  // the generator is being asked to write one of these, not to hit a percentile.
  const bumps = evList.flatMap(([ev, l]) => l.filter(x => x.lead <= 1).map(x => ({ ev, ...x })));
  p(`LEAD 0-1d MESSAGES, VERBATIM (n=${bumps.length}):`);
  const t = b => new Set((b.match(/\b\d{1,2}\s?(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b/gi) || [])
    .map(x => x.toLowerCase().replace(/\s+/g, '')));
  for (const x of bumps) {
    const f = form(x.m.body);
    p(`\n=== Sunday ${new Date(x.ev * 86400000).toISOString().slice(0, 10)}  sent ${x.lead}d before @${x.hour}h  `
      + `${f.words}w/${f.chars}c  times=[${[...t(x.m.body)].join(',')}]`);
    p(x.m.body.trim().split('\n').map(l => '  | ' + l).join('\n'));
  }
  p('');
  p('distinct clock times per bump: ' + JSON.stringify(
    bumps.reduce((a, x) => { const n = t(x.m.body).size; a[n] = (a[n] || 0) + 1; return a; }, {})));
  process.exit(0);
}

if (ALL) {
  p('EVERY MATCHED EVENT (newest last):');
  for (const [ev, l] of evList) {
    const d = new Date(ev * 86400000).toISOString().slice(0, 10);
    p(`  ${d}  ${l.length} msg  ` + l.map(x => `${x.lead}d@${x.hour}h/${form(x.m.body).words}w`).join('  '));
  }
  p('');
  p('THE THREE MOST RECENT SEQUENCES, VERBATIM FIRST LINES:');
  for (const [ev, l] of evList.slice(-3)) {
    p(`  --- Sunday ${new Date(ev * 86400000).toISOString().slice(0, 10)}`);
    for (const x of l) {
      p(`   ${x.lead}d @${x.hour}h: ${JSON.stringify(x.m.body.split('\n').filter(Boolean)[0] || '').slice(0, 96)}`);
    }
  }
}
