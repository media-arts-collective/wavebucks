/**
 * dates.test.mjs -- the calendar shared by `weekday-mismatch` and `dateBlock`.
 *
 *   node --test aedile/recap/dates.test.mjs
 *
 * No corpus, no network. Every case is a real string from the 2026-09-27 session,
 * because the two bugs this file exists to pin were both found by rendering the
 * block against the real notes and counting what came out, not by reading it.
 */

import test from 'node:test';
import assert from 'node:assert';

import { datesIn, timesIn, weekdayPairs, dateBlock, resolve, monthNum, dateNumerals, DAYS } from './dates.mjs';

const ASOF = new Date(2026, 8, 27);          // 2026-09-27, the meeting
const iso = d => d.toISOString().slice(0, 10);

test('monthNum takes a full name, a 3-letter prefix, or Sept', () => {
  assert.equal(monthNum('October'), 9);
  assert.equal(monthNum('oct'), 9);
  assert.equal(monthNum('Sept'), 8);
  assert.equal(monthNum('Theater'), null);
});

test('the year is whichever candidate is nearest, so December resolves forward', () => {
  // Written 2026-12-28, "January 3" means the coming January, not the past one.
  assert.equal(iso(resolve(0, 3, new Date(2026, 11, 28))), '2027-01-03');
  assert.equal(iso(resolve(11, 3, new Date(2027, 0, 2))), '2026-12-03');
});

test('a 31st of a 30-day month resolves to nothing, not to the 1st of the next', () => {
  assert.equal(resolve(3, 31, ASOF), null);      // April 31
});

// THE BUG. "New Marigny Theater 11/25" -- `Theater 11` matched a `[A-Za-z]{3,9}`
// month branch, resolved to nothing, and consumed the text, so the scan resumed at
// "/25" and the date vanished. Reordering the alternation did NOT fix it: order
// only decides between branches at the same start position, and `Theater` starts
// earlier. Only refusing to match a non-month does.
test('a word before a number does not swallow an M/D date', () => {
  const got = datesIn('New Marigny Theater 11/25 or 11/29 ask', ASOF).map(iso);
  assert.deepEqual(got, ['2026-11-25', '2026-11-29']);
});

test("every date in the real notes is found, in calendar order", () => {
  const notes = [
    '* Next Wing Wednesday Oct 14th',
    '* Rapid Rewards Brunch: Sunday Oct 18th',
    '* Laser harp integration day Oct. 11th',
    '  * New Marigny Theater 11/25 or 11/29 ask',
  ].join('\n');
  assert.deepEqual(datesIn(notes, ASOF).map(iso),
    ['2026-10-11', '2026-10-14', '2026-10-18', '2026-11-25', '2026-11-29']);
});

test('the resolved weekdays are the real ones', () => {
  const byDate = Object.fromEntries(
    datesIn('Oct 11th, Oct 14th, Oct 18th, 11/25, 11/29', ASOF).map(d => [iso(d), DAYS[d.getDay()]]));
  assert.deepEqual(byDate, {
    '2026-10-11': 'sunday', '2026-10-14': 'wednesday', '2026-10-18': 'sunday',
    '2026-11-25': 'wednesday', '2026-11-29': 'sunday',
  });
});

test('a wrong weekday is reported with the right one', () => {
  // The draft's lead item, three generations running, in capitals.
  const [p] = weekdayPairs('LASER HARP INTEGRATION DAY IS SATURDAY OCTOBER 11TH', ASOF);
  assert.equal(p.claimed, 'saturday');
  assert.equal(p.actual, 'sunday');
});

test('a correct weekday reports no disagreement', () => {
  const bad = weekdayPairs('Rapid Rewards Brunch is Sunday October 18th', ASOF)
    .filter(p => p.claimed !== p.actual);
  assert.deepEqual(bad, []);
});

test('a weekday and a date in separate clauses are not paired', () => {
  // The false pair a looser pattern invents. Both halves are correct prose.
  assert.deepEqual(
    weekdayPairs("Daryll runs Wednesday movie nights at Lucky's, so November 25th is open", ASOF), []);
});

test('a bare ordinal carries no month and is left alone', () => {
  assert.deepEqual(weekdayPairs('Either Wednesday the 25th or Sunday the 29th', ASOF), []);
});

test('times keep the notes own spelling', () => {
  assert.deepEqual(timesIn('* NOLA Brewing (Fallback Half Moon), 7pm\n* food at 1, meeting a 3'),
    ['7pm', 'food at 1', 'meeting a 3']);
});

test('the block states each date, its weekday, and the times verbatim', () => {
  const b = dateBlock('* Laser harp integration day Oct. 11th\n  * food at 1, meeting a 3', ASOF);
  assert.match(b, /2026-10-11 is a SUNDAY/);
  // Assert on the times LINE, not the whole block: the instruction below it quotes
  // "3pm" on purpose, as the counter-example. A whole-block /3pm/ assertion fails
  // on the block's own teaching -- which is what the first version of this test did.
  const times = b.split('\n').find(l => l.startsWith("Times, in the notes' own spelling"));
  assert.match(times, /meeting a 3/);
  assert.doesNotMatch(times, /3pm/);       // the figure invented-figure blocked
});

test('an input with no date and no time adds nothing to the prompt', () => {
  assert.equal(dateBlock('Solder pins on the Pis and DACs. Partnerships. Outreach.', ASOF), '');
});

// The notes say "Oct 14th", the dealer instructs "include the calendar date as
// M/D", the draft writes "10/14" -- one day, no shared substring, and
// invented-figure blocked the subject the dealer had asked for.
test('a date restated as M/D is forgiven when the notes name that day', () => {
  const notes = '* Next Wing Wednesday Oct 14th\n* Rapid Rewards Brunch: Sunday Oct 18th';
  const got = dateNumerals('wings 10/14, brunch 10/18', notes, ASOF);
  assert.ok(got.has('14') && got.has('18') && got.has('10'));
});

test('a date the notes do not name is forgiven nothing', () => {
  const notes = '* Next Wing Wednesday Oct 14th';
  assert.equal(dateNumerals('party 10/22', notes, ASOF).size, 0);
});
