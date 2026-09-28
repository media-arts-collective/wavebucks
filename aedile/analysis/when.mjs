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
 * THE TOOL OF RECORD for "how many notices does an event get" (#72). `cadence.mjs` and
 * `brunch.mjs` also print a figure for it -- 75% of topics single-message, 69% for Sunday
 * meetings -- over different populations, and both now say to cite this one instead. Use
 * `--sequences`: it groups by EVENT, which is the only grouping that answers what a
 * gathering gets. The marginal distribution this tool prints WITHOUT `--sequences` is a
 * message-level figure and reading it as an event-level one is what filed a two-beat
 * schedule on #68.
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

/** The whole shape: how many notices ONE event gets, and which leads co-occur.
 *
 *  This is the question a marginal lead distribution cannot answer and that reading one
 *  was leading directly to the wrong design. `when.mjs Sunday 1pm` says the day-before
 *  is the commonest single lead and 2+ days accounts for two thirds; from that I filed a
 *  two-message schedule on #68. Grouped by EVENT instead, 81% of events get exactly ONE
 *  notice, and of the events that did get an early one, 64% got no follow-up at all.
 *
 *  Both figures are the UNFILTERED population (n=113, pre-2025). Pass a weekday and they
 *  move: Sunday alone is 69% single-notice (n=55) and 68% no-follow-up, because a Sunday
 *  gathering gets more notice than a midweek one. Conditioned per weekday, the odds of a
 *  SECOND notice are 29% for a Sunday and 7% midweek, which is what the dealt bump
 *  schedule uses -- and those two reconcile with the 18% pooled figure here, which is how
 *  I know the cut is real rather than an artefact of slicing. Re-derived 2026-09-28; the
 *  "71%" this comment used to carry is 64% now, most likely because isOperator was
 *  tightened on 2026-09-26 to exclude kreweofvaporware@, a different member.
 *
 *  Both readings are of the same data. The marginal one counts messages, this one counts
 *  events, and only this one answers "what does an event get".
 *
 *  cadence.mjs has said "75% of topics are single-message" since before any of this, and
 *  brunch.mjs said "1 msg 67%" for Sunday meetings -- still exactly 67% (29 of 43) when
 *  re-run on 2026-09-28. The figure was on hand twice and a
 *  two-beat schedule got filed anyway, which is why it is now a command rather than a
 *  thing to remember. */
export function sequences({ until = null, dow = null } = {}) {
  // Grouped by the DAY THE EVENT FALLS ON, which is the only stable event identity
  // available: two notices about one gathering agree on that and on nothing else.
  const byDay = new Map();
  for (const m of load({ until }).filter(x => isAnnouncement(x.body))) {
    const ev = eventDay(m);
    if (ev === null) continue;
    const lead = ev - dayNum(m._d);
    if (lead < 0 || lead > 10) continue;
    if (dow !== null && new Date(ev * 86400000).getUTCDay() !== dow) continue;
    if (!byDay.has(ev)) byDay.set(ev, { day: ev, dow: new Date(ev * 86400000).getUTCDay(), leads: new Set() });
    byDay.get(ev).leads.add(lead);
  }
  return [...byDay.values()].map(e => ({ ...e, leads: [...e.leads].sort((a, b) => b - a) }));
}

export function reportSequences(opts = {}) {
  const evs = sequences(opts);
  const p = console.log, n = evs.length;
  p(`events with at least one resolvable notice: ${n}` + (opts.dow !== null && opts.dow !== undefined ? `  (${DOW[opts.dow]} only)` : ''));
  p('');
  p('NOTICES PER EVENT -- this is the number that decides how many beats to schedule:');
  const cnt = {};
  for (const e of evs) cnt[e.leads.length] = (cnt[e.leads.length] || 0) + 1;
  for (const k of Object.keys(cnt).sort()) {
    p(`  ${k} notice${k === '1' ? ' ' : 's'}  ${'#'.repeat(cnt[k])} ${cnt[k]} (${Math.round(100 * cnt[k] / n)}%)`);
  }
  p('');
  const early = evs.filter(e => e.leads.some(l => l >= 3 && l <= 6));
  if (early.length) {
    const also = f => early.filter(f).length;
    p(`OF THE ${early.length} EVENTS THAT GOT AN EARLY NOTICE (lead 3-6):`);
    p(`  also a day-before (lead 1): ${also(e => e.leads.includes(1))} (${Math.round(100 * also(e => e.leads.includes(1)) / early.length)}%)`);
    p(`  also a morning-of (lead 0): ${also(e => e.leads.includes(0))} (${Math.round(100 * also(e => e.leads.includes(0)) / early.length)}%)`);
    p(`  no follow-up at all:        ${also(e => !e.leads.includes(1) && !e.leads.includes(0))}`);
    p('');
  }
  p('THE ACTUAL LEAD-SETS, commonest first:');
  const sets = {};
  for (const e of evs) { const k = JSON.stringify(e.leads); sets[k] = (sets[k] || 0) + 1; }
  for (const [k, v] of Object.entries(sets).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    p(`  ${String(v).padStart(3)}x  ${k}`);
  }
  return evs;
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
    console.error('usage: when.mjs <weekday> <time> [--sequences]');
    console.error('   e.g. when.mjs Sunday 1pm              when a notice was sent');
    console.error('        when.mjs Sunday 1pm --sequences   how many notices an event got');
    process.exit(2);
  }
  if (process.argv.includes('--sequences')) reportSequences({ dow });
  else report(dow, hour);
}
