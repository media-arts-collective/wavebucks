/**
 * schedule.mjs -- which bump beats an event gets, dealt at a measured rate.
 *
 *   node aedile/recap/schedule.mjs <notes> [--as-of YYYY-MM-DD] [--seed S]
 *
 * Zach, 2026-09-27, choosing early-plus-day-before: "stochastically dealed based on
 * the archive but also content aware. some get more bumps then others because
 * they're more important right?"
 *
 * He is right that the archive varies, and the variation turns out to be measurable.
 * Over 113 pre-2025 events (92 with one notice, 21 with two or more), on the features
 * of the EARLIEST notice:
 *
 *     feature                     one-notice   two-plus
 *     event falls on Sunday              39%        71%
 *     has a street address               54%        81%
 *     event falls midweek                29%        10%
 *     mentions build/work                38%        38%
 *     median words in first notice       252        250
 *
 * So "important" is not length and not subject matter -- a build day and a party are
 * both 38%. It is a SUNDAY GATHERING AT A REAL ADDRESS, noticed early. As per-event
 * odds that is P(second beat) = 0.29 for a Sunday, 0.07 midweek, and those two
 * reconcile with the 18% pooled figure `when.mjs --sequences` prints for all
 * weekdays -- which is how I know the cut is real and not an artefact of slicing.
 *
 * THE RECAP IS ALREADY THE EARLY NOTICE. It goes out ~13 days ahead naming every
 * event, which is outside when.mjs's lead 0-10 window entirely, so the [4] half of
 * the commonest two-beat set [4,1] is spent before this runs. What is left to
 * schedule is the day-before nudge -- the commonest single-beat set, [1] x9 -- plus a
 * dealt earlier lock-in.
 *
 * NOT a scheduler. Nothing here fires anything: it prints which drafts to make and
 * which day each is to be READ on, and a human arms each one with Gmail's own
 * scheduled send. A Gmail draft cannot hold a send time -- GmailDraft is
 * deleteDraft/getId/getMessage/getMessageId/send/update and nothing else -- so the
 * human is not a formality here, they are the mechanism.
 */

import { readFileSync } from 'node:fs';

import { datesIn, DAYS } from './dates.mjs';
import { rng } from './devices.mjs';

/** Measured above. Sunday gatherings get a second notice; midweek ones rarely do. */
export const SECOND_BEAT_ODDS = { sunday: 0.29, midweek: 0.07, other: 0.18 };

const iso = d => d.toISOString().slice(0, 10);

/** A date the notes have not actually settled must not be announced.
 *
 *  The first run of this file cheerfully scheduled nudges for BOTH 11/25 and 11/29 --
 *  the two candidate Evangelion dates, one of which will happen, with Chris still
 *  asking the venue. Two nudges would have announced two screenings. A dealt beat for
 *  a date nobody has picked is worse than no beat.
 *
 *  Two signals, both taken from how the notes actually read:
 *    - the date sits in an either/or pair: "11/25 or 11/29", "Wednesday the 25th or
 *      Sunday the 29th". One of two is not a date yet.
 *    - its line hedges: not settled, tbd, maybe, asking, or a bare question mark.
 *  Deliberately conservative -- a false "unsettled" costs a bump nobody sent, a false
 *  "settled" costs the list a notice about a gathering that is not happening. */
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

/** One row per draft to generate: the event it is about, the beat, and the day it is
 *  meant to be READ. `asOf` is that read-day, which is what makes "tomorrow" correct
 *  on the day it is scheduled for rather than on the day it is written.
 *
 *  Events already past `today` are dropped: a nudge for a day that has gone is the
 *  worst kind of noise, and the notes keep old dates in them. */
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
      // Lead 4: the commonest early lead that co-occurs with a day-before ([4,1] x5).
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
