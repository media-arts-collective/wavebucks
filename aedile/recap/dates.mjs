/**
 * dates.mjs -- one calendar, shared by the check that catches a wrong weekday and
 * the prompt block that stops the model guessing one.
 *
 * `checks.mjs` grew this resolver first, for `weekday-mismatch`. Then
 * `redige.mjs` needed exactly the same arithmetic to TELL the model each date's
 * real weekday. Two copies of a calendar is how a check and a prompt come to
 * disagree about the same draft -- the bug `no-numbering` had against the dealer
 * all along -- so there is one copy and both import it.
 *
 * The rule this file exists to enforce is `leadTimeBlock`'s, generalised:
 * Node does the date arithmetic and the model is handed the answer. It invented
 * "SATURDAY OCTOBER 11TH" in three separate generations on 2026-09-27, in
 * capitals, as a draft's lead item, from notes that said only "Oct. 11th".
 */

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** 0-11, or null. Matches a full name or any 3+ letter prefix ("Sep", "Sept"). */
export function monthNum(w) {
  const k = String(w || '').toLowerCase();
  const i = MONTHS.findIndex(m => m === k || m.slice(0, 3) === k.slice(0, 3));
  return i < 0 ? null : i;
}

/** A weekday word bound to an explicit date, tight on purpose: the two must be
 *  adjacent, separated only by whitespace, a comma or "the".
 *
 *  "Wednesday is October 14th" does not match, and neither does "Wednesday movie
 *  nights at Lucky's, so November 25th" -- that second one is the false pair a
 *  looser pattern invents, and failing a correct sentence on it would be worse
 *  than missing the rare phrasing. A bare "Wednesday the 25th" has no month and
 *  is not resolvable, so it is left alone rather than guessed at. */
/** Month names only. `[A-Za-z]{3,9}` was the first attempt and it is actively
 *  harmful: in "New Marigny Theater 11/25", `Theater 11` matched, resolved to
 *  nothing, and CONSUMED the text, so the scan resumed at "/25" and 11/25 vanished
 *  from the block while 11/29 survived. Reordering the alternation does not fix
 *  that -- order only decides between branches at the same start position, and
 *  `Theater` starts earlier. Only refusing to match a non-month does. */
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

export const WEEKDAY_DATE_PAIR = new RegExp(
  `\\b(sun|mon|tues|wednes|thurs|fri|satur)day\\b[\\s,]*(?:the\\s+)?`
  + `(?:${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})\\/(\\d{1,2}))\\b`, 'gi');

/** Any explicit date, weekday or not: "Oct. 11th", "October 11", "10/11". */
export const DATE_ANY = new RegExp(
  `\\b(\\d{1,2})\\/(\\d{1,2})\\b|\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi');

/** Month/day plus a reference point -> a real Date, or null.
 *
 *  The year is whichever candidate lands closest to `asOf`, so a December notice
 *  written in November resolves forward and not back into last year. A 31st of a
 *  30-day month is rejected rather than rolled into the next month, which is what
 *  `new Date` would do silently. */
export function resolve(mon, day, asOf) {
  if (mon === null || !(mon >= 0 && mon <= 11) || !(day >= 1 && day <= 31)) return null;
  const ref = new Date(asOf);
  let best = null;
  for (const y of [ref.getFullYear() - 1, ref.getFullYear(), ref.getFullYear() + 1]) {
    const c = new Date(y, mon, day);
    if (c.getMonth() !== mon) continue;
    if (!best || Math.abs(c - ref) < Math.abs(best - ref)) best = c;
  }
  return best;
}

/** Every weekday+date pair in `src`, each with the weekday it claims and the one
 *  the calendar gives. The check reports the disagreements; nothing else does. */
export function weekdayPairs(src, asOf) {
  const out = [];
  for (const m of String(src || '').matchAll(WEEKDAY_DATE_PAIR)) {
    const claimed = `${m[1]}day`.toLowerCase();
    const mon = m[2] ? monthNum(m[2]) : Number(m[4]) - 1;
    const date = resolve(mon, Number(m[3] || m[5]), asOf);
    if (date) out.push({ text: m[0].trim(), claimed, actual: DAYS[date.getDay()], date });
  }
  return out;
}

/** Every resolvable date in `src`, deduped, in calendar order. Used to tell the
 *  model what day of the week each date in the NOTES actually falls on. */
export function datesIn(src, asOf) {
  const seen = new Map();
  for (const m of String(src || '').matchAll(DATE_ANY)) {
    // m[1]/m[2] is the M/D branch, m[3]/m[4] the month-name branch.
    const mon = m[1] ? Number(m[1]) - 1 : monthNum(m[3]);
    if (mon === null) continue;          // "Theater 11" -- a word, not a month
    const date = resolve(mon, Number(m[2] || m[4]), asOf);
    if (!date) continue;
    const key = date.toISOString().slice(0, 10);
    if (!seen.has(key)) seen.set(key, date);
  }
  return [...seen.values()].sort((a, b) => a - b);
}

const iso = d => d.toISOString().slice(0, 10);

/** The clock times the source writes, normalised only enough to dedupe, and kept
 *  in the source's own spelling.
 *
 *  This exists because "meeting a 3" in the notes became "3pm" in the draft, and
 *  `invented-figure` blocked it -- correctly, since `3pm` is not in the input. The
 *  fix is to show the model the notes' own spelling, not to loosen the check.
 *  Quieting a grounding check to get unblocked is the move that went wrong earlier
 *  in the same session. */
export function timesIn(src) {
  const out = new Set();
  for (const m of String(src || '').matchAll(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b(?:food|meeting|doors|start|show)\s+a?t?\s+(\d{1,2})\b|\bnoon\b/gi)) {
    out.add(m[0].trim().replace(/\s+/g, ' '));
  }
  return [...out];
}

/** The prompt block. Every date in the input with its real weekday, and every
 *  time in the input as the input spells it.
 *
 *  Returns '' when the input carries no resolvable date, so a notes file about
 *  nothing dated adds no noise to the prompt. */
export function dateBlock(src, asOf = new Date()) {
  const dates = datesIn(src, asOf);
  const times = timesIn(src);
  if (!dates.length && !times.length) return '';

  const lines = ['## The dates and times in these notes, resolved', ''];
  if (dates.length) {
    lines.push('Computed from the notes by the program, not by you:', '');
    for (const d of dates) lines.push(`- ${iso(d)} is a ${DAYS[d.getDay()].toUpperCase()}.`);
    lines.push('',
      'Write a weekday ONLY if it is on this list against that date. If the notes name',
      'a date with no weekday, you may state the weekday above or leave it out -- you may',
      'not guess a third thing. A notice that tells 40 people the wrong day is the worst',
      'thing this email can do.');
  }
  if (times.length) {
    lines.push('',
      `Times, in the notes' own spelling: ${times.join('; ')}.`,
      'Use those words. Do not respace or reformat them, and do not add a meridiem the',
      'notes do not have -- "meeting at 3" is not "3pm" unless the notes say so.');
  }
  return lines.join('\n');
}

/** The numerals a draft may spell differently from the notes, because they belong
 *  to a date that resolves to a day the notes actually name.
 *
 *  "Oct 14th" in the notes and "10/14" in the draft are one day, but they share no
 *  substring, so `invented-figure` called `14` invented and blocked a correct
 *  subject -- one the dealer had ASKED for, having dealt `calDate` and instructed
 *  "include the calendar date as M/D". Resolving both sides and comparing days is
 *  what makes forgiving it safe: a date the notes do not name is not in this set,
 *  so it still blocks.
 *
 *  Returns the numerals in the same normalised form `figures()` produces, so both
 *  the M/D halves and the bare/ordinal day are covered. */
export function dateNumerals(draft, notes, asOf) {
  const nights = new Set(datesIn(notes, asOf).map(d => d.toISOString().slice(0, 10)));
  const out = new Set();
  for (const m of String(draft || '').matchAll(DATE_ANY)) {
    const mon = m[1] ? Number(m[1]) - 1 : monthNum(m[3]);
    if (mon === null) continue;
    const day = Number(m[2] || m[4]);
    const date = resolve(mon, day, asOf);
    if (!date || !nights.has(date.toISOString().slice(0, 10))) continue;
    for (const n of [String(mon + 1), String(day), `${day}st`, `${day}nd`, `${day}rd`, `${day}th`]) out.add(n);
  }
  return out;
}
