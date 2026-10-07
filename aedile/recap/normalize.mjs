// normalize.mjs -- the one function both sides of the duel pass through, so
// nothing but the writing differs between them.
// Removes: the sign-off initials (keeping the `<3`), quoted replies and the
// Google Groups footer, bare email addresses, end-of-line whitespace.
// Does not touch: blank-line runs (ragged spacing is a trait), greetings, URLs.

const FOOTER_MARK = 'You received this message because you are subscribed';

/** A quoted reply, from its first marker line to the end. `>` runs and the
 *  `On <date> <someone> wrote:` attribution both start one. */
const QUOTED_TAIL = /\n[ \t]*(?:On\b[^\n]{0,160}\bwrote:[ \t]*$|>)[\s\S]*$/m;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Phone numbers, like addresses: only on the real side, and somebody's actual number.
const PHONE = /\b(?:\+?1[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}\b/g;

/** `<3` then the initials, whether they sit on the same line or the next one.
 *  Both real (`<3\nMS`) and generated (`<3 SM`) forms, one pattern. */
const SIGNOFF_INITIALS = /(<3)(?:[ \t]*\r?\n[ \t]*|[ \t]+)(?:MS|SM)\b[ \t]*$/;

// An initials line with no `<3` above it: a generated body that drops the `<3`
// would otherwise keep its `SM`.
const BARE_INITIALS = /\n[ \t]*(?:MS|SM)[ \t]*$/;

/** Cut the Google Groups footer, including the `--` rule that precedes it. */
function dropFooter(s) {
  const at = s.indexOf(FOOTER_MARK);
  if (at === -1) return s;
  const before = s.slice(0, at);
  // The footer is conventionally introduced by a `-- ` line; take it too.
  return before.replace(/\n[ \t]*-{2,}[ \t]*\n?[\s\S]*$/, '\n');
}

// Curly quotes and Gmail's non-breaking spaces are the mail client's hand, not
// the author's, so they are flattened on both sides.
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
  // Per line, so blank-line runs keep their count; also lets modalGap see a gap
  // whose blank line held a space.
  s = s.replace(/[ \t]+$/gm, '');
  return s.trim();
}

// Does this body carry the ragged paragraph spacing the archive has?
export const isRagged = body => /\n\s*\n\s*\n/.test(String(body ?? ''));

// The modal paragraph gap, in blank lines: the default gap is the trait, not
// the presence of one wide gap.
export function modalGap(body) {
  const gaps = (String(body ?? '').match(/\n{2,}/g) || []).map(g => g.length - 1);
  if (!gaps.length) return 0;
  const counts = {};
  for (const g of gaps) counts[g] = (counts[g] || 0) + 1;
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
}
