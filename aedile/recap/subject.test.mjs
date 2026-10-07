// subject.test.mjs -- the dealt subject knows the message type, and the type is
// read off the body.
//
//   node --test aedile/recap/subject.test.mjs
//
// No corpus, no network: weights are passed in, and the rows `subjectWeights`
// pools are built here.

import test from 'node:test';
import assert from 'node:assert';

import { dealSubject } from './devices.mjs';
import { typeOf, subjectWeights, MIN_POOL } from '../analysis/subject-shapes.mjs';

const at = iso => new Date(iso);
const msg = (iso, body) => ({ _d: at(iso), body });

test('the type comes from the body: a numbered digest is a recap', () => {
  assert.equal(typeOf(msg('2023-03-06T15:00:00Z', 'Hi\n\n1. one\n\n2. two\n\n3. three\n\nxo')), 'recap');
});

test('pointing at the day it was sent is a nudge; a later day is a lock-in', () => {
  assert.equal(typeOf(msg('2023-03-05T15:00:00Z', 'today! 1pm, 826 Rosedale')), 'headsup:nudge');
  assert.equal(typeOf(msg('2023-03-04T15:00:00Z', 'tomorrow! 1pm, 826 Rosedale')), 'headsup:lock-in');
  assert.equal(typeOf(msg('2023-03-04T15:00:00Z', 'thanks all, that was fun')), 'other');
});

const rows = (type, n, subject) => Array.from({ length: n }, () => ({ type, subject }));

test('each type is weighted from its own subjects', () => {
  const pool = [
    ...rows('recap', MIN_POOL, 'gear purge / crawfish / BUKU'),
    ...rows('headsup:nudge', MIN_POOL, 'today!'),
  ];
  const recap = subjectWeights('recap', null, pool);
  const nudge = subjectWeights('headsup', 'nudge', pool);
  assert.equal(recap.pool, 'recap');
  assert.equal(recap.multi, 1);
  assert.deepEqual(recap.separators, { ' / ': MIN_POOL });
  assert.equal(nudge.pool, 'headsup:nudge');
  assert.equal(nudge.multi, 0);
  assert.equal(nudge.bang, 1);
});

test('a type with too few subjects widens its pool and says which one it used', () => {
  const pool = [
    ...rows('headsup:lock-in', 3, 'Sunday 1pm'),
    ...rows('headsup:nudge', MIN_POOL, 'today!'),
  ];
  assert.equal(subjectWeights('headsup', 'lock-in', pool).pool, 'headsup');
  assert.equal(subjectWeights('headsup', 'lock-in', []), null);
});

test('a recap is dealt a joined subject; a nudge never is', () => {
  const recap = { multi: 1, separators: { ' // ': 1 }, medianChars: 40, q1Chars: 30, q3Chars: 50 };
  const nudge = { multi: 0, separators: {}, bang: 1, medianChars: 10, q1Chars: 6, q3Chars: 14 };
  for (let seed = 0; seed < 50; seed++) {
    assert.match(dealSubject(seed, recap), /joined by " \/\/ "/);
    const n = dealSubject(seed, nudge);
    assert.doesNotMatch(n, /joined by/);
    assert.match(n, /exclamation mark/);
  }
});

test('the joiner is drawn in proportion, and one the pool never used is never dealt', () => {
  const w = { multi: 1, separators: { ' / ': 3, ' // ': 1 }, medianChars: 40 };
  const dealt = Array.from({ length: 400 }, (_, seed) => dealSubject(seed, w).match(/joined by "([^"]+)"/)[1]);
  const slash = dealt.filter(s => s === ' / ').length;
  assert.deepEqual([...new Set(dealt)].sort(), [' / ', ' // ']);
  assert.ok(slash > 240 && slash < 360, `" / " dealt ${slash} of 400, expected near 300`);
});

test('the same seed deals the same subject, and the length varies across seeds', () => {
  const w = { multi: 0, separators: {}, medianChars: 30, q1Chars: 20, q3Chars: 44 };
  assert.equal(dealSubject('a', w), dealSubject('a', w));
  const lengths = new Set(Array.from({ length: 40 }, (_, s) => dealSubject(s, w).match(/about (\d+) characters/)[1]));
  assert.ok(lengths.size > 5, 'length should be drawn across the quartiles, not pinned');
  assert.equal(dealSubject(1, null), '');
});
