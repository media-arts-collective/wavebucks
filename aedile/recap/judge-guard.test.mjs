// judge-guard.test.mjs -- a judge run that did not discriminate must not report a rate.
//
//   node --test aedile/recap/judge-guard.test.mjs
//
// The case below is a real position-biased burst; the guard has to refuse its rate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twoSidedBinomialP, positionAudit } from './judge.mjs';

// `human` is which side held the real email; `said` is the pick.
const HUMAN = 'BABABBBAAABA'.split('');
const SAID = 'AAAAAAAAABAB'.split('');
const BURST_11 = SAID.map((pick, i) => ({
  pick,
  onA: HUMAN[i] === 'A',
  pickedReal: (pick === 'A') === (HUMAN[i] === 'A'),
}));

test('the exact binomial, against the value #22 computed independently', () => {
  // Exact, not approximated: a normal approximation is wrong at small n.
  assert.ok(Math.abs(twoSidedBinomialP(10, 12) - 0.0386) < 0.0005,
    `10/12 should be ~0.0386, got ${twoSidedBinomialP(10, 12)}`);
  assert.ok(twoSidedBinomialP(9, 12) > 0.05, '9/12 must NOT trip the guard');
  assert.ok(twoSidedBinomialP(10, 12) < 0.05, '10/12 must trip it -- this is the threshold');
  assert.equal(twoSidedBinomialP(6, 12), 1, 'a balanced split is p=1');
  assert.ok(twoSidedBinomialP(12, 12) < 0.001);
  assert.equal(twoSidedBinomialP(0, 0), 1, 'no votes cannot be significant');
});

test('the guard is symmetric -- a B-biased judge is just as degenerate', () => {
  // Bias toward B is the same defect.
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
  // The number the harness published.
  const fooled = BURST_11.filter(r => !r.pickedReal).length;
  assert.equal(fooled, 8);
  assert.equal(Math.round(100 * fooled / 12), 67, "67% is the figure #22 says read as a breakthrough");
});

test('a constant responder is scored on the actual layout, not assumed to be 50%', () => {
  const a = positionAudit(BURST_11);
  // On a balanced layout pure bias scores exactly half; the published rate was
  // above that and still not discrimination.
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
