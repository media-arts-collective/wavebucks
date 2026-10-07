#!/usr/bin/env node
/**
 * subject-shapes.mjs -- what a real subject line does, measured.
 *
 *   node aedile/analysis/subject-shapes.mjs
 */

import { readFileSync } from 'node:fs';
import { load, eventDay, dayNum } from './corpus.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(HERE, 'subjects-live.json'), 'utf8'));

/** Human-authored only. aedile's own subjects are excluded: measuring them would
 *  close a loop in which the generator's habits become the corpus's habits. */
export const HUMAN = DATA.subjects.filter(s => !s.aedile).map(s => s.subject);

export const F = {
  dayWord:   s => /\b(sun|mon|tues|wednes|thurs|fri|satur)(day|\.)?\b|\b(today|tonight|tomorrow|weekend)\b/i.test(s),
  clockTime: s => /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|@\s?\d{1,2}|\b\d{1,2}\s?-\s?\d{1,2}\b/i.test(s),
  calDate:   s => /\b\d{1,2}\/\d{1,2}\b/.test(s),
  // Generic only: `at X` and a street number are shape, not vocabulary.
  venue:     s => /\bat [A-Z]|\b\d{3,5}\s+[A-Z][a-z]|\bSt\.? Mary\b/.test(s),
  bracket:   s => /^\[[^\]]+\]/.test(s),
  allCaps:   s => /\b[A-Z]{3,}\b/.test(s),
  bang:      s => /!/.test(s),
  question:  s => /\?$/.test(s),
  lowerOpen: s => /^[a-z]/.test(s),
  pipeSlash: s => /\s[|/]\s/.test(s),
  colon:     s => /:/.test(s),
  fullStop:  s => /\.\s/.test(s),
};

/** Carries at least one of day, time or date. The proxy for "announces something". */
export const carriesLogistics = s => F.dayWord(s) || F.clockTime(s) || F.calDate(s);

/** Operator subjects out of the corpus. ONLY THE <=2024 SLICE IS CLEAN: `isOperator`
 *  also matches aedile's OWN sent mail, so condition on `{ until: 2024 }`. */
export function corpusSubjects(opts = {}) {
  return load(opts)
    .filter(m => typeof m.subject === 'string' && m.subject.trim())
    .map(m => m.subject.trim());
}

const pct = (n, d) => d ? Math.round(100 * n / d) : 0;

// --- subjects by MESSAGE TYPE ------------------------------------------------

/** Ways a subject joins several topics. */
export const SEPARATORS = {
  ' // ': s => /\s\/\/\s/.test(s),
  ' / ':  s => /\s\/\s/.test(s),
  '; ':   s => /;\s/.test(s),
  ', ':   s => /,\s/.test(s),
  ' + ':  s => /\s\+\s/.test(s),
  ' & ':  s => /\s&\s/.test(s),
};
const isMulti = s => Object.values(SEPARATORS).some(fn => fn(s));

const numberedItems = b => (b.match(/(?:^|\n)\s*-?\d+[.)]\s/g) || []).length;

export function typeOf(m) {
  if (numberedItems(m.body) >= 3) return 'recap';
  const ev = eventDay(m);
  if (ev === null) return 'other';
  const lead = ev - dayNum(m._d);
  if (lead === 0) return 'headsup:nudge';
  if (lead >= 1 && lead <= 6) return 'headsup:lock-in';
  return 'other';
}

/** One row per thread-starting operator subject, typed. A reply shares its topic's
 *  subject, so the same subject inside one calendar month is kept once, at its earliest. */
export function typedSubjects({ until = 2024 } = {}) {
  const seen = new Set();
  const out = [];
  for (const m of load({ until }).sort((a, b) => a._d - b._d)) {
    const subject = typeof m.subject === 'string' ? m.subject.trim() : '';
    if (!subject || /^(re|fwd?):/i.test(subject)) continue;
    const key = subject + '|' + m._d.toISOString().slice(0, 7);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ subject, type: typeOf(m) });
  }
  return out;
}

/** A type needs this many subjects before its own rates are dealt; below it the pool widens. */
export const MIN_POOL = 20;

/** Weights for the dealt subject, for one message type. Computed, never typed in. */
export function subjectWeights(genre = 'recap', beat = null, rows = typedSubjects()) {
  const want = genre === 'headsup' && beat ? `headsup:${beat}` : genre;
  const pools = [
    [want, rows.filter(r => r.type === want)],
    [genre, rows.filter(r => r.type.split(':')[0] === genre)],
    ['all typed', rows.filter(r => r.type !== 'other')],
  ];
  const [poolName, picked] = pools.find(([, p]) => p.length >= MIN_POOL) || pools[pools.length - 1];
  const pool = picked.map(r => r.subject);
  const n = pool.length;
  if (!n) return null;
  const rate = fn => pool.filter(fn).length / n;
  const chars = pool.map(s => s.length).sort((x, y) => x - y);
  const multi = pool.filter(isMulti);
  return {
    pool: poolName, n,
    dayWord: rate(F.dayWord), clockTime: rate(F.clockTime), calDate: rate(F.calDate),
    venue: rate(F.venue), allCaps: rate(F.allCaps), bang: rate(F.bang),
    question: rate(F.question), lowerOpen: rate(F.lowerOpen), colon: rate(F.colon),
    multi: multi.length / n,
    // Counts, so the dealer draws in proportion and an unused joiner cannot be dealt.
    separators: Object.fromEntries(Object.entries(SEPARATORS)
      .map(([sep, fn]) => [sep, multi.filter(fn).length]).filter(([, c]) => c)),
    medianChars: chars[Math.floor(n / 2)],
    q1Chars: chars[Math.floor(n / 4)],
    q3Chars: chars[Math.floor(3 * n / 4)],
  };
}

if (process.argv[1] && process.argv[1].endsWith('subject-shapes.mjs') && process.argv.includes('--types')) {
  const rows = typedSubjects();
  const types = ['recap', 'headsup:lock-in', 'headsup:nudge', 'other'];
  console.log(`thread-starting operator subjects, <=2024: ${rows.length}`);
  for (const t of types) console.log(`  ${t.padEnd(16)} ${rows.filter(r => r.type === t).length}`);
  const ws = [['recap', null], ['headsup', 'lock-in'], ['headsup', 'nudge']].map(([g, b]) => subjectWeights(g, b, rows));
  console.log('\nfeature          recap   lock-in   nudge');
  console.log(`  ${'pool n'.padEnd(14)} ${ws.map(w => String(w.n).padStart(5)).join('    ')}`);
  for (const k of ['multi', 'dayWord', 'clockTime', 'calDate', 'venue', 'bang', 'question', 'allCaps', 'lowerOpen', 'colon']) {
    console.log(`  ${k.padEnd(14)} ${ws.map(w => (pct(Math.round(w[k] * w.n), w.n) + '%').padStart(5)).join('    ')}`);
  }
  console.log(`  ${'chars q1/med/q3'.padEnd(14)} ${ws.map(w => `${w.q1Chars}/${w.medianChars}/${w.q3Chars}`).join('   ')}`);
  console.log(`  joiners        ${ws.map(w => JSON.stringify(w.separators)).join('   ')}`);
} else if (process.argv[1] && process.argv[1].endsWith('subject-shapes.mjs')) {
  const logi = HUMAN.filter(carriesLogistics);
  console.log(`real subjects: ${DATA.subjects.length}  human: ${HUMAN.length}  `
    + `(aedile's own excluded: ${DATA.subjects.length - HUMAN.length})`);
  console.log(`carrying day/time/date: ${logi.length} of ${HUMAN.length} (${pct(logi.length, HUMAN.length)}%)`);
  console.log('');
  console.log('feature                ALL human      logistics-carrying');
  for (const [name, fn] of Object.entries(F)) {
    console.log(`  ${name.padEnd(20)} ${String(pct(HUMAN.filter(fn).length, HUMAN.length)).padStart(3)}%`
      + `           ${String(pct(logi.filter(fn).length, logi.length)).padStart(3)}%`);
  }
  const chars = HUMAN.map(s => s.length).sort((a, b) => a - b);
  console.log('');
  console.log(`length: median ${chars[Math.floor(chars.length / 2)]} chars, range ${chars[0]}..${chars[chars.length - 1]}`);
  console.log(`begin with "N. ": ${HUMAN.filter(s => /^-?\d+\.\s/.test(s)).length} of ${HUMAN.length}`);
  console.log('');
  console.log('the logistics-carrying ones, verbatim:');
  for (const s of logi) console.log('  ' + s);
}
