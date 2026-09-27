/**
 * judge-guard.test.mjs -- a judge run that did not discriminate must not report a rate.
 *
 *   node --test aedile/recap/judge-guard.test.mjs     (also runs under `npm test`)
 *
 * #22: burst 11's batched judge answered A in ten of twelve rounds and the harness
 * reported 67% fooled -- 67 points above the same specimens scored per-pair, against an
 * arc that eleven bursts of real tuning had moved by 8. The twelve rationales were
 * fluent, specific and drawn from the correct vocabulary, so nothing in the output
 * distinguished that run from a breakthrough. The only thing separating them was the key,
 * which the operator does not have at read time.
 *
 * The case below IS burst 11, transcribed from the issue. It is the regression test:
 * position bias at 10/12 is p=0.039, the 67% is p=0.194 against chance, and the guard has
 * to refuse the 67%.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoSidedBinomialP, positionAudit } from './judge.mjs';

/** Burst 11, from #22. `human` is which side held the real email; `said` is the pick. */
const HUMAN = 'BABABBBAAABA'.split('');
const SAID = 'AAAAAAAAABAB'.split('');
const BURST_11 = SAID.map((pick, i) => ({
  pick,
  onA: HUMAN[i] === 'A',
  pickedReal: (pick === 'A') === (HUMAN[i] === 'A'),
}));

test('the exact binomial, against the value #22 computed independently', () => {
  // The issue states 10/12 is p=0.039 two-sided. Exact, not approximated: n is dozens
  // here, and a normal approximation is wrong in precisely the small-n case that matters.
  assert.ok(Math.abs(twoSidedBinomialP(10, 12) - 0.0386) < 0.0005,
    `10/12 should be ~0.0386, got ${twoSidedBinomialP(10, 12)}`);
  assert.ok(twoSidedBinomialP(9, 12) > 0.05, '9/12 must NOT trip the guard');
  assert.ok(twoSidedBinomialP(10, 12) < 0.05, '10/12 must trip it -- this is the threshold');
  assert.equal(twoSidedBinomialP(6, 12), 1, 'a balanced split is p=1');
  assert.ok(twoSidedBinomialP(12, 12) < 0.001);
  assert.equal(twoSidedBinomialP(0, 0), 1, 'no votes cannot be significant');
});

test('the guard is symmetric -- a B-biased judge is just as degenerate', () => {
  // Bias toward B is the same defect. A guard that only caught "always A" would pass the
  // mirror image of the run it was written for.
  assert.equal(twoSidedBinomialP(2, 12), twoSidedBinomialP(10, 12));
  const flipped = BURST_11.map(r => ({ ...r, pick: r.pick === 'A' ? 'B' : 'A' }));
  assert.equal(positionAudit(flipped).degenerate, true);
});

test('burst 11 is flagged degenerate, and its 67% is exactly what must not be reported', () => {
  const a = positionAudit(BURST_11);
  assert.equal(a.n, 12);
  assert.equal(a.saidA, 10, 'the issue records ten A answers in twelve rounds');
  assert.ok(Math.abs(a.p - 0.0386) < 0.0005);
  assert.equal(a.degenerate, true, 'this run did not discriminate and must be refused');
  // The number the harness published. 8 of 12 fooled = 67%.
  const fooled = BURST_11.filter(r => !r.pickedReal).length;
  assert.equal(fooled, 8);
  assert.equal(Math.round(100 * fooled / 12), 67, "67% is the figure #22 says read as a breakthrough");
});

test('a constant responder is scored on the actual layout, not assumed to be 50%', () => {
  const a = positionAudit(BURST_11);
  // Burst 11's layout is 6/6, so always-A scores exactly 50% fooled -- which is the point:
  // the 67% was ABOVE what pure bias earns, and still not discrimination.
  assert.equal(Math.round(a.constA), 50);
  assert.equal(Math.round(a.constB), 50);
  // A lopsided layout must not report 50%, or the line is decorative.
  const lopsided = [
    { pick: 'A', onA: true, pickedReal: true },
    { pick: 'A', onA: true, pickedReal: true },
    { pick: 'A', onA: true, pickedReal: true },
    { pick: 'B', onA: false, pickedReal: true },
  ];
  assert.equal(Math.round(positionAudit(lopsided).constA), 25);
});

test('a discriminating run keeps its rate', () => {
  // Balanced picks, every verdict correct. Nothing here should be withheld.
  const good = [
    { pick: 'A', onA: true, pickedReal: true },
    { pick: 'B', onA: false, pickedReal: true },
    { pick: 'A', onA: true, pickedReal: true },
    { pick: 'B', onA: false, pickedReal: true },
    { pick: 'A', onA: true, pickedReal: true },
    { pick: 'B', onA: false, pickedReal: true },
  ];
  const a = positionAudit(good);
  assert.equal(a.degenerate, false);
  assert.equal(a.saidA, 3);
  assert.equal(a.p, 1);
});
