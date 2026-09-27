#!/usr/bin/env node
/**
 * subject-shapes.mjs -- what a real subject line does, measured.
 *
 *   node aedile/analysis/subject-shapes.mjs
 *
 * Replaces six weights I invented. `recap/devices.mjs` carried
 * `SUBJECT_SHAPES` with p values of 0.34/0.20/0.16/0.14/0.10/0.06 assigned by hand
 * off seven observations, labelled placeholders and still numbers nobody measured.
 * The list-scrape session recovered 35 real subjects, so they can be computed.
 *
 * Two things the larger sample changes, both against my earlier read:
 *
 *  1. Most subjects carry NO logistics at all. Picking the seven event-ish ones out
 *     of the mailbox and generalising from them overstated the day/time/venue forms
 *     badly -- the same sampling error as reading two specimens and concluding Abe
 *     names people in every message.
 *  2. So the rates that matter for a heads-up are conditioned on the subject
 *     carrying logistics, which is the closest proxy for "this announces a
 *     gathering" available without the bodies. That conditioning is stated in the
 *     output rather than hidden in the pool.
 *
 * ERA: every one of the 35 is the successor era. Abe-era subjects do not exist in any
 * store -- readInbox on the Office mailbox for before:2025/01/01 returns zero mail.
 * These describe current practice and NOT the voice devices.mjs otherwise imitates.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(HERE, 'subjects-live.json'), 'utf8'));

/** Human-authored only. aedile's own subjects are excluded: measuring them would
 *  close a loop in which the generator's habits become the corpus's habits. */
export const HUMAN = DATA.subjects.filter(s => !s.aedile).map(s => s.subject);

const F = {
  dayWord:   s => /\b(sun|mon|tues|wednes|thurs|fri|satur)(day|\.)?\b|\b(today|tonight|tomorrow|weekend)\b/i.test(s),
  clockTime: s => /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|@\s?\d{1,2}|\b\d{1,2}\s?-\s?\d{1,2}\b/i.test(s),
  calDate:   s => /\b\d{1,2}\/\d{1,2}\b/.test(s),
  // Generic only. This used to name `Half Moon` and `NOLA Brewing` as venue
  // literals, and Half Moon reached the list from aedile's OWN subjects -- a detector
  // taught to recognise the generator's vocabulary and then used to measure the
  // humans. `at X` and a street number are shape, not vocabulary.
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

/** Carries at least one of day, time or date. The proxy for "announces something",
 *  since the subjects arrived without their bodies. */
export const carriesLogistics = s => F.dayWord(s) || F.clockTime(s) || F.calDate(s);

const pct = (n, d) => d ? Math.round(100 * n / d) : 0;

/** Weights for the dealt subject shape, computed over the logistics-carrying human
 *  subjects. Pushed into devices.mjs by the caller, the way measuredRates() is, so
 *  no literal ever gets typed into the generator again. */
export function subjectWeights() {
  const pool = HUMAN.filter(carriesLogistics);
  const n = pool.length;
  const count = fn => pool.filter(fn).length;
  return {
    n,
    dayWord: count(F.dayWord) / n,
    clockTime: count(F.clockTime) / n,
    calDate: count(F.calDate) / n,
    venue: count(F.venue) / n,
    bracket: count(F.bracket) / n,
    allCaps: count(F.allCaps) / n,
    bang: count(F.bang) / n,
    lowerOpen: count(F.lowerOpen) / n,
    pipeSlash: count(F.pipeSlash) / n,
    colon: count(F.colon) / n,
    medianChars: (() => { const a = pool.map(s => s.length).sort((x, y) => x - y);
      return a[Math.floor(a.length / 2)]; })(),
  };
}

if (process.argv[1] && process.argv[1].endsWith('subject-shapes.mjs')) {
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
