// dates.mjs -- one calendar, shared by the weekday check and the prompt block,
// so the two cannot disagree. Node does the date arithmetic; the model is
// handed the answer.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** 0-11, or null. Matches a full name or any 3+ letter prefix ("Sep", "Sept"). */
export function monthNum(w) {
  const k = String(w || '').toLowerCase();
  const i = MONTHS.findIndex(m => m === k || m.slice(0, 3) === k.slice(0, 3));
  return i < 0 ? null : i;
}

// A weekday word bound to an explicit date, tight on purpose: adjacent,
// separated only by whitespace, a comma or "the". A bare "Wednesday the 25th"
// has no month and is left alone.
// Month names only: a generic word pattern matches "Theater 11" in "Theater
// 11/25" and consumes the date.
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

export const WEEKDAY_DATE_PAIR = new RegExp(
  `\\b(sun|mon|tues|wednes|thurs|fri|satur)day\\b[\\s,]*(?:the\\s+)?`
  + `(?:${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})\\/(\\d{1,2}))\\b`, 'gi');

/** Any explicit date, weekday or not: "Oct. 11th", "October 11", "10/11". */
export const DATE_ANY = new RegExp(
  `\\b(\\d{1,2})\\/(\\d{1,2})\\b|\\b${MON}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'gi');

// Month/day plus a reference point -> a real Date, or null. The year is the
// candidate closest to `asOf`. A 31st of a 30-day month is rejected, not rolled over.
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

// The clock times the source writes, in the source's own spelling, so the
// model is shown them rather than the grounding check being loosened.
export function timesIn(src) {
  const out = new Set();
  for (const m of String(src || '').matchAll(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b|\b(?:food|meeting|doors|start|show)\s+a?t?\s+(\d{1,2})\b|\bnoon\b/gi)) {
    out.add(m[0].trim().replace(/\s+/g, ' '));
  }
  return [...out];
}

// The prompt block: every date in the input with its real weekday, every time
// as the input spells it. '' when the input carries nothing dated.
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

// The numerals a draft may spell differently from the notes because they belong
// to a date that resolves to a day the notes name ("Oct 14th" vs "10/14"). A
// date the notes do not name is not in this set, so it still blocks.
// Returned in the normalised form `figures()` produces.
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
