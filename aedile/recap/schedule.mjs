// schedule.mjs -- which bump beats an event gets, dealt at a measured rate.
//
//   node aedile/recap/schedule.mjs <notes> [--as-of YYYY-MM-DD] [--seed S]
//
// The recap is already the early notice; this schedules the day-before nudge
// plus a dealt earlier lock-in.
// Not a scheduler: it prints which drafts to make and which day each is to be
// read on. A human arms each one; a Gmail draft cannot hold a send time.

import { readFileSync } from 'node:fs';

import { datesIn, DAYS } from './dates.mjs';
import { rng } from './devices.mjs';

// Sunday gatherings get a second notice; midweek ones rarely do.
export const SECOND_BEAT_ODDS = { sunday: 0.29, midweek: 0.07, other: 0.18 };

const iso = d => d.toISOString().slice(0, 10);

// A date the notes have not settled must not be announced: it sits in an
// either/or pair, or its line hedges. Conservative: a false "unsettled" costs a
// bump, a false "settled" announces a gathering that is not happening.
const HEDGE_LINE = /\b(?:not settled|unsettled|tbd|to be confirmed|maybe|asking|proposed|either)\b|\?/i;

export function unsettled(notes, date) {
  const target = iso(date);
  for (const line of String(notes).split('\n')) {
    const here = datesIn(line, date).map(iso);
    if (!here.includes(target)) continue;
    if (here.length > 1 && /\bor\b/i.test(line)) return `one of ${here.length} candidate dates on the same line`;
    if (HEDGE_LINE.test(line)) return 'the line hedges';
  }
  return null;
}
const shift = (d, days) => { const c = new Date(d); c.setDate(c.getDate() + days); return c; };

export function oddsFor(date) {
  const dow = date.getDay();
  if (dow === 0) return SECOND_BEAT_ODDS.sunday;
  if (dow >= 1 && dow <= 4) return SECOND_BEAT_ODDS.midweek;
  return SECOND_BEAT_ODDS.other;
}

// One row per draft to generate: the event, the beat, and the day it is meant
// to be read (`asOf`). Events already past `today` are dropped.
export function schedule(notes, { today = new Date(), seed = 'aedile' } = {}) {
  const rand = rng(`${seed}:beats`);
  const rows = [];
  for (const event of datesIn(notes, today)) {
    // A day-before nudge needs to be written before the day before.
    if (shift(event, -1) <= today) continue;
    const why = unsettled(notes, event);
    if (why) { rows.push({ event: iso(event), dow: DAYS[event.getDay()], skipped: 'all beats', reason: why }); continue; }
    rows.push({ event: iso(event), dow: DAYS[event.getDay()], beat: 'nudge', asOf: iso(shift(event, -1)), lead: 1 });

    const odds = oddsFor(event);
    const roll = rand();
    if (roll < odds) {
      // Lead 4: the commonest early lead that co-occurs with a day-before.
      const early = shift(event, -4);
      if (early > today) {
        rows.push({ event: iso(event), dow: DAYS[event.getDay()], beat: 'lock-in', asOf: iso(early), lead: 4, dealt: { odds, roll: Number(roll.toFixed(3)) } });
      }
    } else {
      rows.push({ event: iso(event), skipped: 'lock-in', dealt: { odds, roll: Number(roll.toFixed(3)) } });
    }
  }
  return rows.sort((a, b) => String(a.asOf || a.event).localeCompare(String(b.asOf || b.event)));
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = n => { const i = args.indexOf(n); return i > -1 ? args[i + 1] : undefined; };
  const path = args[0];
  if (!path) { console.error('usage: schedule.mjs <notes> [--as-of YYYY-MM-DD] [--seed S]'); process.exit(2); }
  const today = flag('--as-of') ? new Date(`${flag('--as-of')}T12:00:00`) : new Date();
  const seed = flag('--seed') || 'aedile';
  const rows = schedule(readFileSync(path, 'utf8'), { today, seed });
  console.log(`dates from ${path}, as of ${iso(today)}, seed "${seed}"\n`);
  console.log('send on     beat      event                   lead   dealt');
  for (const r of rows) {
    if (r.skipped) {
      const why = r.reason ? r.reason : `p=${r.dealt.odds} roll=${r.dealt.roll}`;
      console.log(`${'--'.padEnd(12)}${(r.skipped + ' skipped').padEnd(18)}${r.event.padEnd(16)}      ${why}`);
      continue;
    }
    console.log(`${r.asOf.padEnd(12)}${r.beat.padEnd(10)}${(r.event + ' ' + r.dow).padEnd(24)}${String(r.lead).padEnd(7)}${r.dealt ? `p=${r.dealt.odds} roll=${r.dealt.roll}` : ''}`);
  }
}
