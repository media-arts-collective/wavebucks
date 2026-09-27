#!/usr/bin/env node
/**
 * when.mjs -- for an event on a given weekday at a given time, when did the krewe
 * historically send the notice?
 *
 *   node aedile/analysis/when.mjs Sunday 1pm
 *   node aedile/analysis/when.mjs Wednesday 5pm --all
 *
 * Zach, 2026-09-26: "I want some kind of function that lets me pass in a day-of-week
 * and time and get out when the bumps historically came out."
 *
 * WHY THIS EXISTS RATHER THAN A REMEMBERED RULE. A general figure was quoted at him
 * four times tonight -- "morning-of, median 10h, 73% between 08:00 and 12:59, n=102" --
 * and it is a real measurement over the wrong population. Conditioned on a SUNDAY
 * MIDDAY event, the day before outnumbers the morning of 19 to 5. The general number
 * was computed over every event type at once, where same-day socials and evening bar
 * nights dominate. Passing the event in is the difference.
 *
 * SNIPPET-SAFE. Everything here is derived from `date`, not from `body`, and a
 * truncated body still carries a correct timestamp (snippets median 12h against
 * survivors 11h, same quartiles). So unlike every length, sign-off or structure figure
 * in this repo, nothing below is a lower bound. See isFullBody in corpus.mjs.
 *
 * WHAT IT CANNOT TELL YOU. Sample sizes are small once conditioned, and it prints
 * every n so that is visible rather than implied. It reports what was DONE, not what
 * worked: the archive has no attendance data, so a lead time that appears often is
 * common and not necessarily effective.
 */

import {
  load, isAnnouncement, eventDay, dayNum, localHour, median, DOW_IDX,
} from './corpus.mjs';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "1pm", "13", "1:30pm", "noon" -> hour 0-23, or null. */
function parseHour(s) {
  if (!s) return null;
  const t = String(s).trim().toLowerCase();
  if (t === 'noon') return 12;
  if (t === 'midnight') return 0;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  return h >= 0 && h <= 23 ? h : null;
}

/** The event's own clock time, as the message states it. */
function eventHour(body) {
  const m = body.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b|\b(noon)\b/i);
  if (!m) return null;
  if (m[4]) return 12;
  let h = parseInt(m[1], 10);
  if (/pm/i.test(m[3]) && h < 12) h += 12;
  if (!/pm/i.test(m[3]) && h === 12) h = 0;
  return h;
}

/** Every announcement whose event day AND event hour resolve. */
export function corpus({ until = null } = {}) {
  const out = [];
  for (const m of load({ until }).filter(x => isAnnouncement(x.body))) {
    const ev = eventDay(m);
    if (ev === null) continue;
    const lead = ev - dayNum(m._d);
    if (lead < 0 || lead > 10) continue;
    const eh = eventHour(m.body);
    if (eh === null) continue;
    out.push({
      dow: new Date(ev * 86400000).getUTCDay(),
      eventHour: eh,
      lead,
      sendHour: localHour(m._d),
      sendDow: m._d.getUTCDay(),
      date: m.date,
    });
  }
  return out;
}

/** Comparable events, widening only when it has to, and saying which rule it used. */
export function comparable(rows, dow, hour) {
  const band = h => (h < 12 ? 'morning' : h < 16 ? 'midday' : h < 19 ? 'late-afternoon' : 'evening');
  const want = band(hour);
  const exact = rows.filter(r => r.dow === dow && band(r.eventHour) === want);
  if (exact.length >= 12) return { rows: exact, how: `${DOW[dow]} events in the ${want} band` };
  const sameDay = rows.filter(r => r.dow === dow);
  if (sameDay.length >= 12) {
    return { rows: sameDay, how: `all ${DOW[dow]} events (the ${want} band alone was n=${exact.length})`, widened: true };
  }
  const sameBand = rows.filter(r => band(r.eventHour) === want);
  return { rows: sameBand, how: `all ${want}-band events, any weekday (${DOW[dow]} alone was n=${sameDay.length})`, widened: true };
}

export function report(dow, hour, { until = null } = {}) {
  const rows = corpus({ until });
  const { rows: set, how, widened } = comparable(rows, dow, hour);
  const p = console.log;
  p(`event: ${DOW[dow]} at ${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`);
  p(`comparable set: ${how}  n=${set.length}`);
  if (widened) p('  (widened for sample size -- the narrower set was too thin to read)');
  p('');
  p('LEAD TIME -- how many days before the event the notice went out:');
  const byLead = {};
  for (const r of set) (byLead[r.lead] = byLead[r.lead] || []).push(r.sendHour);
  const leads = Object.keys(byLead).map(Number).sort((a, b) => a - b);
  for (const L of leads) {
    const hrs = byLead[L].sort((a, b) => a - b);
    const label = L === 0 ? 'same day' : L === 1 ? 'day before' : `${L} days before`;
    p(`  ${label.padEnd(15)} n=${String(hrs.length).padStart(3)}  `
      + `send hour median ${String(median(hrs)).padStart(2)}h  [${hrs.join(',')}]`.slice(0, 74));
  }
  p('');
  const total = set.length;
  const share = L => Math.round(100 * (byLead[L]?.length || 0) / total);
  p(`  same day ${share(0)}%   day before ${share(1)}%   2+ days ${100 - share(0) - share(1)}%`);
  p('');
  const best = leads.reduce((a, b) => ((byLead[b].length > byLead[a].length) ? b : a), leads[0]);
  const hrs = byLead[best].sort((a, b) => a - b);
  const q1 = hrs[Math.floor(hrs.length / 4)], q3 = hrs[Math.floor(3 * hrs.length / 4)];
  p(`MOST COMMON: ${best === 0 ? 'same day' : best === 1 ? 'the day before' : best + ' days before'}`
    + `, n=${hrs.length} of ${total}, sent between ${q1}:00 and ${q3}:00 (median ${median(hrs)}:00).`);
  p('');
  p('This is what was DONE, not what worked -- the archive has no attendance data.');
  p('Derived from timestamps only, so the snippet defect does not touch it.');
  return { set, how, best };
}

if (process.argv[1] && process.argv[1].endsWith('when.mjs')) {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const dowArg = (args[0] || '').toLowerCase();
  const dow = DOW_IDX[dowArg] ?? DOW.findIndex(d => d.toLowerCase().startsWith(dowArg.slice(0, 3)));
  const hour = parseHour(args[1]);
  if (dow < 0 || hour === null) {
    console.error('usage: when.mjs <weekday> <time>     e.g. when.mjs Sunday 1pm');
    process.exit(2);
  }
  report(dow, hour, { until: process.argv.includes('--all') ? null : null });
}
