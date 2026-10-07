// schedule.test.mjs -- which beats an event gets, and which events get none.
//
//   node --test aedile/recap/schedule.test.mjs
//
// No corpus, no network.

import test from 'node:test';
import assert from 'node:assert';

import { schedule, unsettled, oddsFor, SECOND_BEAT_ODDS } from './schedule.mjs';

const TODAY = new Date(2026, 8, 28);        // 2026-09-28

const NOTES = [
  '* Next Wing Wednesday Oct 14th',
  '  * NOLA Brewing (Fallback Half Moon), 7pm',
  '* Rapid Rewards Brunch: Sunday Oct 18th',
  '* Laser harp integration day Oct. 11th',
  '* Evangelion',
  '  * Wednesday 7pm Nov 25th (11/25) or Sunday Nov 29th (11/29)',
].join('\n');

const beats = rows => rows.filter(r => !r.skipped);

test('the odds come from the event weekday, measured', () => {
  assert.equal(oddsFor(new Date(2026, 9, 11)), SECOND_BEAT_ODDS.sunday);     // Sunday
  assert.equal(oddsFor(new Date(2026, 9, 14)), SECOND_BEAT_ODDS.midweek);    // Wednesday
  assert.ok(SECOND_BEAT_ODDS.sunday > SECOND_BEAT_ODDS.midweek);
});

// Two candidate dates for one unbooked event must not both get a nudge.
test('an either/or date pair gets no beats at all', () => {
  assert.ok(unsettled(NOTES, new Date(2026, 10, 25)));
  assert.ok(unsettled(NOTES, new Date(2026, 10, 29)));
  const ev = schedule(NOTES, { today: TODAY }).filter(r => r.event.startsWith('2026-11'));
  assert.ok(ev.length > 0);
  assert.ok(ev.every(r => r.skipped === 'all beats'), 'no November beat may be scheduled');
});

test('a settled date is not called unsettled', () => {
  for (const d of [new Date(2026, 9, 11), new Date(2026, 9, 14), new Date(2026, 9, 18)]) {
    assert.equal(unsettled(NOTES, d), null, `${d.toDateString()} is settled in these notes`);
  }
});

test('every settled future event gets exactly one day-before nudge', () => {
  const nudges = beats(schedule(NOTES, { today: TODAY })).filter(r => r.beat === 'nudge');
  assert.deepEqual(nudges.map(r => r.event), ['2026-10-11', '2026-10-14', '2026-10-18']);
  assert.deepEqual(nudges.map(r => r.asOf), ['2026-10-10', '2026-10-13', '2026-10-17']);
  assert.ok(nudges.every(r => r.lead === 1));
});

test('the same seed deals the same schedule twice', () => {
  const a = JSON.stringify(schedule(NOTES, { today: TODAY, seed: 'x' }));
  const b = JSON.stringify(schedule(NOTES, { today: TODAY, seed: 'x' }));
  assert.equal(a, b);
});

test('a dealt lock-in records the roll that produced it', () => {
  const dealt = schedule(NOTES, { today: TODAY }).filter(r => r.dealt);
  assert.ok(dealt.length, 'something must record a roll, kept or skipped');
  for (const r of dealt) {
    assert.ok(typeof r.dealt.roll === 'number' && typeof r.dealt.odds === 'number');
    // Kept means the roll beat the odds; skipped means it did not. Either way the
    // decision is reconstructable, which is the point of seeding it.
    if (r.beat === 'lock-in') assert.ok(r.dealt.roll < r.dealt.odds);
    else assert.ok(r.dealt.roll >= r.dealt.odds);
  }
});

test('an event too close to nudge is dropped rather than nudged late', () => {
  // Written the day before the event: the day-before beat is already gone.
  const rows = schedule('* Build day Oct. 11th', { today: new Date(2026, 9, 10) });
  assert.deepEqual(rows, []);
});

test('a past date in the notes is never scheduled', () => {
  const rows = schedule('* Wings were Sep 2nd\n* Brunch Oct 18th', { today: TODAY });
  // Distinct events, not rows: one event yields two rows when dealt a lock-in
  // as well as a nudge.
  assert.deepEqual([...new Set(beats(rows).map(r => r.event))], ['2026-10-18']);
});
