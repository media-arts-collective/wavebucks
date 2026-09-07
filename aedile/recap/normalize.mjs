/**
 * normalize.mjs -- the one function both sides of the duel pass through.
 *
 * The duel shows a real Abe email beside a generated one and asks which is
 * which. Anything that differs between the two sides for a reason other than
 * the writing decides the round on the harness rather than the prose, and every
 * number the game produces after that is worthless. So there is ONE function,
 * exported, and both sides are its callers. Not two tidy functions that agree
 * today.
 *
 * What it removes, and why each one would otherwise be a free tell:
 *
 *   - The sign-off INITIALS, keeping the `<3`. The archive signs `<3 MS`;
 *     checks.mjs requires the generator to sign `<3 SM` and fails on the
 *     presence of `MS`. Two characters would settle every round. The `<3`
 *     stays because it is part of the register -- 234 threads carry it -- and
 *     keeping it is safe precisely because the pool is filtered to specimens
 *     that end with one.
 *   - Quoted replies and the Google Groups footer. Only ever on the real side.
 *   - Bare email addresses. Only ever on the real side, and this is other
 *     people's mail.
 *
 * What it deliberately does NOT touch:
 *
 *   - WHITESPACE. 152 of the 164 pool specimens have ragged 3+-newline
 *     paragraph spacing. The decision (Zach, 2026-09-06) was to leave it raw
 *     and teach the generator to match it, rather than collapse it on both
 *     sides -- same fairness outcome, but the generator ends up having learned
 *     a real trait instead of us having hidden one. Only the very ends are
 *     trimmed, where nothing is visible either way.
 *   - Greetings. "Hi friends!" against "Krewe," is exactly the kind of thing
 *     the generator should be losing rounds over.
 *   - URLs. They are facts, they survive de-voicing, and both sides may carry
 *     them.
 */

const FOOTER_MARK = 'You received this message because you are subscribed';

/** A quoted reply, from its first marker line to the end. `>` runs and the
 *  `On <date> <someone> wrote:` attribution both start one. */
const QUOTED_TAIL = /\n[ \t]*(?:On\b[^\n]{0,160}\bwrote:[ \t]*$|>)[\s\S]*$/m;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Phone numbers, for the same reason as addresses: they only ever appear on
 *  the real side, so they are a free tell, and they are somebody's actual
 *  number. A burst turned up `Call me at 603-520-4579`. */
const PHONE = /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g;

/** `<3` then the initials, whether they sit on the same line or the next one.
 *  Both real (`<3\nMS`) and generated (`<3 SM`) forms, one pattern. */
const SIGNOFF_INITIALS = /(<3)(?:[ \t]*\r?\n[ \t]*|[ \t]+)(?:MS|SM)\b[ \t]*$/;

/** An initials line with no `<3` above it. The pool filter means this should
 *  not fire on the real side, but a generated body that drops the `<3` would
 *  otherwise keep its `SM` and give itself away. */
const BARE_INITIALS = /\n[ \t]*(?:MS|SM)[ \t]*$/;

/** Cut the Google Groups footer, including the `--` rule that precedes it. */
function dropFooter(s) {
  const at = s.indexOf(FOOTER_MARK);
  if (at === -1) return s;
  const before = s.slice(0, at);
  // The footer is conventionally introduced by a `-- ` line; take it too.
  return before.replace(/\n[ \t]*-{2,}[ \t]*\n?[\s\S]*$/, '\n');
}

/** Curly quotes, and the non-breaking spaces Gmail leaves behind.
 *
 *  Abe never typed a curly apostrophe; his mail client made it. Measured, they
 *  are 0.36 per 1,000 characters of the archive and 0.00 of the generated text,
 *  so left alone they are a per-round giveaway that says nothing about who
 *  wrote anything. Unlike the ragged spacing, which he really does type, this
 *  is the client's hand and not his -- so it is flattened on both sides rather
 *  than taught to the generator. */
const TYPOGRAPHY = [
  [/[\u2018\u2019]/g, "'"],
  [/[\u201C\u201D]/g, '"'],
  [/\u00a0/g, ' '],
];

export function normalize(body) {
  let s = String(body ?? '').replace(/\r\n/g, '\n');
  for (const [re, to] of TYPOGRAPHY) s = s.replace(re, to);
  s = dropFooter(s);
  s = s.replace(QUOTED_TAIL, '');
  s = s.trimEnd();
  s = s.replace(SIGNOFF_INITIALS, '$1');
  s = s.trimEnd();
  s = s.replace(BARE_INITIALS, '');
  s = s.replace(EMAIL, 'someone@example.com');
  s = s.replace(PHONE, '555-0100');
  return s.trim();
}

/** Does this body carry the ragged paragraph spacing the archive has?
 *  Reported per burst: if the generated side is far off the pool's 93%, the
 *  prompt change did not take and the burst will be won on whitespace. */
export const isRagged = body => /\n\s*\n\s*\n/.test(String(body ?? ''));

/** The MODAL paragraph gap, in blank lines.
 *
 *  isRagged above asks only whether a three-line gap appears anywhere, and it
 *  answered yes for 12 of 12 generated emails while they were still visibly
 *  wrong. Measured properly: 54% of the archive's gaps are three blank lines
 *  and 11% are one; the generator's were 17% and 39%. Presence was never the
 *  question -- the DEFAULT is. Same error as measuring an item's length when
 *  the tell was its spread. */
export function modalGap(body) {
  const gaps = (String(body ?? '').match(/\n{2,}/g) || []).map(g => g.length - 1);
  if (!gaps.length) return 0;
  const counts = {};
  for (const g of gaps) counts[g] = (counts[g] || 0) + 1;
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
}
