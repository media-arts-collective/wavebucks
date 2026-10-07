/**
 * corpus.mjs -- one loader, one sender predicate, one date parser.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
export const DOW_IDX = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
export const DOW_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/** Whose messages are the operator's. The scraper nulled `email` on many rows, so
 *  the masked `author` form counts too. One account, two authors: callers measuring
 *  "the voice" should pass an era. msk@kreweofvaporwave.com stays out deliberately. */
export const isOperator = m => {
  const who = String(m.email || m.author || '');
  // `kreweofvaporwaRE@gmail.com` is a DIFFERENT MEMBER, not a typo of the account.
  // The negative is on the spelling because the masked form cuts at `kreweofv`.
  return /^kreweofv/.test(who) && !/vaporware/i.test(who);
};

/** Is this row a full body, or a Google Groups PREVIEW SNIPPET? The test is length
 *  alone, so a genuinely short note is misclassified as a snippet. A snippet still
 *  carries a correct `date`; only measures taken from `body` need this. */
export const isFullBody = m => m.body.trim().length > 101;

/** The send timestamp. NOT UTC despite what the Date object implies: the archive
 *  stores the hour as WRITTEN in local time, so `getUTCHours()` IS the local hour.
 *  Gmail, via readThread, really is UTC -- never mix the two sources. */
export function parseDate(s) {
  const m = String(s).replace(/[  ]/g, ' ').trim()
    .match(/^(\w{3}) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  const [, mon, day, year, hh, mm, ss, ap] = m;
  let h = parseInt(hh, 10) % 12;
  if (/pm/i.test(ap)) h += 12;
  return new Date(Date.UTC(+year, MONTHS[mon], +day, h, +mm, +ss));
}

export const localHour = d => d.getUTCHours();
export const dayNum = d => Math.floor(d.getTime() / 86400000);

/** Operator messages with a parsed date, optionally restricted to an era.
 *  `until`/`since` are inclusive calendar years. */
export function load({ since = null, until = null } = {}) {
  return readFileSync(join(VAULT, 'messages.jsonl'), 'utf8').trim().split('\n')
    .map(l => JSON.parse(l))
    .filter(m => isOperator(m) && typeof m.body === 'string')
    // Legacy rows duplicate or truncate scraped ones. They stay in the file because
    // the scraper reads its topic list from it.
    .filter(m => m.source !== 'legacy-scrape')
    .map(m => ({ ...m, _d: parseDate(m.date) }))
    .filter(m => m._d)
    .filter(m => (!since || m._d.getUTCFullYear() >= since)
              && (!until || m._d.getUTCFullYear() <= until));
}

export const TIME_RE = /\b\d{1,2}\s?(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b/i;
export const ADDRESS_RE = /\b\d{3,5}\s+[A-Z][a-z]/;
const FUTURE_RE = /tomorrow|tonight|today|this \w+day|next \w+day|see you|reminder|don'?t forget|bring/i;

/** Announcement-shaped: names a day, a time, a place, or points forward. */
export function isAnnouncement(body) {
  let score = 0;
  if (DOW_RE.test(body)) score++;
  if (TIME_RE.test(body)) score++;
  if (ADDRESS_RE.test(body)) score++;
  if (FUTURE_RE.test(body)) score++;
  return score >= 3;
}

/** The day this message points at, as a day number, or null. */
export function eventDay(m) {
  if (!m._d) return null;
  const head = m.body.slice(0, 700);
  const b = head.toLowerCase();
  if (/\b(tonight|today|this afternoon|this evening)\b/.test(b)) return dayNum(m._d);
  if (/\btomorrow\b/.test(b)) return dayNum(m._d) + 1;
  const md = head.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (md && +md[1] >= 1 && +md[1] <= 12 && +md[2] >= 1 && +md[2] <= 31) {
    let year = m._d.getUTCFullYear();
    if (+md[1] < m._d.getUTCMonth() + 1 - 6) year += 1;
    return dayNum(new Date(Date.UTC(year, +md[1] - 1, +md[2])));
  }
  const dow = b.match(DOW_RE);
  if (dow) return dayNum(m._d) + ((DOW_IDX[dow[1].toLowerCase()] - m._d.getUTCDay()) % 7 + 7) % 7;
  return null;
}

// --- statistics -------------------------------------------------------------

export const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : Math.round((s[n / 2 - 1] + s[n / 2]) / 2)) : 0; };

/** Wilson score interval. The normal approximation misbehaves near 0 and 1, which
 *  is where these rates live. */
export function wilson(hits, n, z = 1.96) {
  if (!n) return { lo: 0, hi: 1, p: 0, n: 0 };
  const p = hits / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { p, n, lo: Math.max(0, (c - s) / d), hi: Math.min(1, (c + s) / d) };
}
