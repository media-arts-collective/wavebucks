/**
 * corpus.mjs -- one loader, one sender predicate, one date parser.
 *
 * Extracted because the narrow sender filter `email === 'kreweofvaporwave@gmail.com'`
 * was copied into style.mjs, cadence.mjs and brunch.mjs, and is wrong in all of them:
 * it drops 93 of the operator's 573 messages.
 *
 * WHO ACTUALLY IMPORTS THIS, as of 2026-09-26: headsup-form.mjs and brunch.mjs.
 * `recap/style.mjs` and `analysis/cadence.mjs` STILL carry their own narrow filter.
 * The header of this file claimed to be the one loader everything routes through from
 * the moment it was written, which was not true of a single existing caller, and
 * brunch.mjs kept its own /^kreweofv/ copy for long enough that a contamination fix
 * here did not reach it. Extracting a module is not the same as adopting it.
 *
 * Routing style.mjs and cadence.mjs through here is NOT a one-line change and is not
 * done: every probability in devices.mjs's DEVICES table was measured by style.mjs on
 * the 480-message pool, so widening the pool moves all of them at once. That needs a
 * measured before/after, not a find-and-replace.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const VAULT = process.env.KREWE_VAULT
  || '/srv/vaporwave-reports/obsidian-vault/mailing-list-archive';

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
export const DOW_IDX = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
export const DOW_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/** Whose messages are the operator's.
 *
 *  `messages.jsonl` carries BOTH `author` and `email`, and the scraper nulled
 *  `email` on 325 of 1099 rows while redacting `author` to an ellipsized form.
 *  85 of the operator's messages are stored as
 *  `author: "kreweofv...@gmail.com", email: null`, and 7 more under the Office
 *  address. Matching `email` alone yields 480 messages where the true count is 575,
 *  and the loss is concentrated in recent years (2026: 88 unattributed of 116).
 *  573 after excluding the vaporware member below; the docstring said 575 while the
 *  regex took 580, and neither number was the operator's.
 *
 *  ONE ACCOUNT, TWO AUTHORS. Abe wrote this address until he retired around 2025;
 *  everything after is a successor. Pooling the whole range blends two voices under
 *  one sign-off, so callers measuring "the voice" should pass an era. */
export const isOperator = m => {
  const who = String(m.email || m.author || '');
  // `kreweofvaporwaRE@gmail.com` is a DIFFERENT MEMBER, not a typo of the account:
  // "Do y'all mind if I add a second alternative email to the list?" (2025-11),
  // "Sorry, didn't mean to cause trouble! We're just excited." (2026-02). A bare
  // /^kreweofv/ took 580 rows and 7 of them are theirs, putting a stranger's messages
  // in every operator pool through the one loader everything routes through. Found by
  // the list-scrape session, 2026-09-26.
  //
  // The negative is on the `vaporware` spelling rather than a longer prefix because
  // the masked form cuts at `kreweofv` and cannot distinguish the two. That leaves a
  // bounded residue: of the 85 masked rows, only 2 are dated 2025-10 or later, which
  // is when the vaporware spelling first appears, so at most 2 rows are unresolvable.
  // A date rule would clear them and is deliberately not applied -- it would argue
  // from the absence of earlier posts in a corpus that is itself redacted.
  return /^kreweofv/.test(who) && !/vaporware/i.test(who);
};

// THE REDACTION SPLITS EVERY SENDER INTO TWO IDENTITIES, not just the operator.
// Measured over the whole archive by first/last post:
//
//   kreweofvaporwave@gmail.com  480  2019-09..2026-01   kreweofv...@gmail.com  85
//   thejakeman16@gmail.com       32  2019-09..2025-10   thejak...@gmail.com    32
//   rlcolbert@gmail.com          25  2020-09..2026-02   rlco...@gmail.com      32
//
// So a per-author count is halved or doubled depending on which form it matches, and
// a sender's span is truncated: rlcolbert's earliest post is 2019-09 under the masked
// form and 2020-09 under the plain one. `isOperator` only papers over this for the
// operator. Anything grouping by sender must fold the pairs first, and there is no
// general rule for it -- some authors are display names ("Wbbales", "T83", "vip")
// with no address at all.
//
// DO NOT INFER MEMBERSHIP DATES FROM THIS. Posting proves membership at that moment,
// never joining, and a lurker who never posts receives the whole list and appears
// nowhere. "A member since at least 2019 judging by the archive" was asserted in this
// session off exactly this data, relayed to another session as fact, and falsified by
// Zach: dangerpine@gmail.com is 11 messages, 2023-01 to 2026-06. Wrong by four years,
// and neither session ran the one-line query first.

// THE CORPUS'S REACH, measured with the stranger excluded (2026-09-26):
//
//   573 operator rows, 2019-09-02 .. 2026-01-24
//
// `2026-02-19` was published as that cutoff earlier in this session, in a message that
// another session then wrote into its own docs. It is the vaporwaRE member's last
// message: exactly what /^kreweofv/ returns before the exclusion above. The cutoff
// documented in the tooling that found the contamination was produced BY the
// contamination, through two hops and no query.
//
// OPERATOR-authored mail by month against all senders, because "the corpus stops" is
// a different claim depending on whose mail you mean:
//
//   month     all   operator          month     all   operator
//   2025-01    50      29             2025-10    27       1
//   2025-02    26      16             2025-11    16       0  <- silent, others active
//   2025-03     3       2             2025-12    43       5
//   2025-04     9       2             2026-01    97       9
//   2025-05     0       0             2026-02    14       0  <- silent, others active
//   2025-06     0       0             2026-03     1       0
//   2025-07     1       0             2026-04     2       0
//   2025-08     0       0             2026-06     2       0
//   2025-09    14       0
//
// SO "THE CORPUS STOPS 2026-01-24" IS THE WRONG READING, and it is one this session
// published. The scrape reaches 2026-06-17 for other senders. What ends on 2026-01-24
// is the OPERATOR ACCOUNT, which goes quiet in six 2025 months, returns thinly from
// October to January, and then stops while everyone else keeps posting. That is Abe
// retiring and the successor moving to the Office address (8 rows), not a truncated
// scrape. #45's staleness is real and separate; this is not evidence for it.
//
// 2025-07's single message is NOT a gap: CLAUDE.md:179 records July as historically
// silent. Reading it as truncation turns the krewe's own rhythm into a data defect.
//
// THE `until:2024` CUTOFF IS DOING TWO JOBS AND ONLY ONE IS DELIBERATE. It was chosen
// for REGISTER -- Abe is the voice worth imitating -- and it has silently been the only
// thing excluding every defect found on 2026-09-26:
//
//   the vaporwaRE member's 7 messages    all postdate 2025-10
//   aedile's own 4 outbound subjects     2026
//   the 2 unresolvable masked rows       2026-01
//
// A session that widens the era gets the register change it asked for and loses a
// filter it did not know it had. Before any successor-era rate means anything: exclude
// the vaporwaRE spelling (done, above), mark aedile-authored rows, and unmask what can
// be unmasked. None of tonight's checks carry forward on their own.
//
// AND WHEN TWO MEASUREMENTS DISAGREE HERE, CHECK THE POPULATION FIRST. Three times in
// one session: the exclamation rate (49% over all operator messages, 93% over
// announcements), the subject denominators (12/31 and 10/31 on two regexes), and the
// month counts above. Only the last was an actual contradiction; the other two were two
// parties measuring different sets on purpose and then comparing the outputs as if they
// were the same quantity. Ship the definition attached to the rate.

/** Is this row a full body, or a Google Groups PREVIEW SNIPPET?
 *
 *  28% of the corpus is snippets. The length histogram has a cliff that cannot be
 *  anything else -- 10-char bins over the whole file:
 *
 *      80-89   46        exact lengths:  96c  36
 *      90-99  236                        97c  44
 *    100-109   68                        99c  27
 *    110-119   12                       100c  30
 *    120-129   11                       101c  31
 *                                       103c   1   <- cliff
 *                                       104c   1
 *
 *  236 rows in one 10-char bin against 11-13 in its neighbours, 31 at exactly 101
 *  characters, and then nothing. Every one of them ends mid-sentence: "...is debuting
 *  a new generation", "...Join us at 6pm tonight at", "...Meeting @ 3pm Topics: Theme
 *  team (". They are list previews, not messages.
 *
 *  THIS CONTAMINATED A PUBLISHED FIGURE. Two of the 18 day-before Sunday messages in
 *  headsup-form.mjs's pool are snippets, and excluding them moves the length target
 *  from 134 words to 173 -- a figure that had already been written into the generator's
 *  prompt as "write about 134 words". A snippet is short by construction, so any median
 *  length computed over a pool containing them is biased down, and the bias is
 *  invisible because a short message is not obviously a truncated one.
 *
 *  The test is length alone, because the cliff is sharp enough to carry it. That will
 *  misclassify a genuinely 96-character note as a snippet; there are few of those and
 *  the alternative, testing for a clean ending, flags 571 of 1099 rows and is useless.
 *  An mbox would end the guessing, which is the strongest argument for that path yet:
 *  it is not only subjects and headers, it is a quarter of the bodies. */
export const isFullBody = m => m.body.trim().length > 101;

/** The send timestamp. NOT UTC despite what the Date object implies: the archive
 *  stores the hour as WRITTEN in local time (only 0.8% of 1099 sends fall between
 *  1am and 5am; the curve peaks at 9-11am). So the UTC fields carry local numbers
 *  and `getUTCHours()` IS the local hour. Gmail, via readThread, really is UTC --
 *  never mix the two sources. */
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
    .map(m => ({ ...m, _d: parseDate(m.date) }))
    .filter(m => m._d)
    .filter(m => (!since || m._d.getUTCFullYear() >= since)
              && (!until || m._d.getUTCFullYear() <= until));
}

export const TIME_RE = /\b\d{1,2}\s?(?::\d{2})?\s?(?:am|pm)\b|\bnoon\b/i;
export const ADDRESS_RE = /\b\d{3,5}\s+[A-Z][a-z]/;
const FUTURE_RE = /tomorrow|tonight|today|this \w+day|next \w+day|see you|reminder|don'?t forget|bring/i;

/** Announcement-shaped: names a day, a time, a place, or points forward. The same
 *  score>=3 heuristic cadence.mjs uses, kept identical on purpose so the two tools
 *  are comparable. */
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

/** Wilson score interval. A rate off 18 messages is not the same claim as a rate
 *  off 180, and the normal approximation misbehaves near 0 and 1 -- which is
 *  exactly where these rates live (94% carry an exclamation mark). Encoding a
 *  point estimate without its width is how "92% of the archive" became a rule
 *  that was wrong for the register it was applied to. */
export function wilson(hits, n, z = 1.96) {
  if (!n) return { lo: 0, hi: 1, p: 0, n: 0 };
  const p = hits / n;
  const d = 1 + z * z / n;
  const c = p + z * z / (2 * n);
  const s = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { p, n, lo: Math.max(0, (c - s) / d), hi: Math.min(1, (c + s) / d) };
}
