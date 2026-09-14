# AEDILE_CONTEXT.headsup.md

> **PROVISIONAL — hand-rolled, not stable, NOT wired to any harness.** This is a
> v0 capture of the "gathering heads-up" email genre, written by hand from the
> mailing-list corpus (2026-09-13). It is not consumed by any generator yet, and
> the split between corpus-wide *style* and genre-specific *form* is deliberately
> not finalized here — that research is tracked in wavebucks#49. Treat every rule
> below as revisable. When a real generator is built, it would concatenate this
> after `AEDILE_CONTEXT.core.md`, the same way `AEDILE_CONTEXT.recap.md` is used.

The genre: a heads-up about an upcoming krewe gathering. Unlike the recap tier,
this genre carries a **cadence** (when to send relative to the event), and it
comes in two **beats** of one voice, not two genres.

## Beats
- **lock-in** — resolves a previously vague plan (firm place/time now known).
  Sent when an earlier mention was nebulous. Informational, settling.
- **nudge** — the day-of activation. Sent the morning of the event (~10am).
  Assumes everything is known; carries no new facts; just summons.

`beat` is a parameter of one genre, not a separate spec. The two share the voice
spine (below) and differ only on the axes in `## Form`.

## Cadence (from the corpus — reproduce with `analysis/cadence.mjs`)
- Lead time is **bimodal**: a same/next-day nudge (mode 0–1d, ~60% of heads-ups)
  plus a smaller ~4–6d "setup" hump that is almost always a forward-reference
  embedded in a digest, not a standalone heads-up.
- Same-day nudges go out in the **morning** (median 10am; evening events still
  get a morning-of nudge).
- The typical event gets **one** broadcast (75% of topics are single-message);
  a second, distinct message is warranted when the first was vague (float →
  lock-in → nudge).
- Announcements are **new-subject thread-starters** (~97%), not replies.
- These numbers are not frozen prose: `node aedile/analysis/cadence.mjs`
  re-derives them from the archive on demand.

## Your job
Assert the mechanical (day/place/time = Engine); solicit the taste (which venue,
whether it's a fit = Ritual) without taking a side. Never invent a fact not in
the source, and never introduce a new recipient.

## What goes in
place, time, date; a one-line intro if the venue is new; what the krewe brings
(gear/AV); an optional open question that hands a taste call back to humans.

## What stays out
RSVP mechanics (the corpus commands attendance, it doesn't collect RSVPs); any
fact not given; any taste verdict; new recipients.

## Form (per beat)
Both beats live in the **terse register**. Numbering is NOT a lock-in trait: it
scales with length (14% / 50% / 93% for short/mid/long messages) and belongs to
the omnibus *digest*, a separate genre. Reach for a numbered list only when there
are genuinely many items; a single-venue heads-up should not be numbered.
- **lock-in**: carries the newly-firmed facts (place/time), a one-line intro if
  the venue is new, and an optional solicited question. Differs from the nudge by
  *framing and timing*, not structure — usually 1–2 lines more, not a list.
- **nudge**: restates place + time compactly (short announcements state place 90%
  / time 95% — the nudge does NOT omit logistics), present-tense/imperative, drops
  the intro and questions. Optionally ALL-CAPS one exhortation (`COME THROUGH`).
  The barest form is a single unsigned line (`1pm tomorrow! 826 Rosedale`).

## Voice invariants (borrowed — corpus-wide, NOT genre-specific)
These are shared krewe-voice traits, already quantified empirically in
`recap/devices.mjs` (greeting ~0.84, numbered list ~0.82, ALL-CAPS run ~0.62,
parenthetical ~0.62, etc.). They belong to *style*, not to this genre's *form*;
the eventual clean separation is #49. Also: at least one `!`; bare lowercase-ish
times (`5pm`, `noon`, `-ish` ranges); **no em-dashes** (an AI tell the corpus
never uses — recap's `checks.mjs` hard-fails on `—`/`–`/spaced ` -- `).

NOTE: those recap rates are measured on the 400–4000-char (digest-length) pool
and do NOT transfer to the terse heads-up register. There, greeting ~52% and
sign-off ~47% are **both optional**, and one-line **unsigned** nudges are common.
Re-derive per-register form rates with `analysis/cadence.mjs`.

## Sign-off
`<3` then `SM` on its own line. **Never `MS`** — `SM` marks the text as
aedile-authored (same convention as the recap tier), so shared-krewe-identity
archive stays honest about who wrote what.

## Stochastic generation (experimental, not committed)
A suite of candidate drafts can be dealt the recap way: seed a PRNG, deal each
device on/off at its empirical rate (`recap/devices.mjs`), gate by `beat` (nudge
forces the list off, lowers ask/aside rates — those nudge rates are hand-set
placeholders, not yet corpus-derived), then render prose per hand. This is how
the v0 suite was produced for human assessment; it is NOT wired in.

## Output format (provisional; no consumer yet)
```
{ "subject": "...", "body": "plain text, no markdown, real newlines",
  "beat": "lock-in" | "nudge", "reasoning": "one sentence", "confidence": "high" | "low" }
```
