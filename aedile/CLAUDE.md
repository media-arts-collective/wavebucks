# Aedile — Project Context

## What this is
Aedile is an AI operations role for the Virtual Krewe of Vaporwave, an
eleven-year-old Mardi Gras krewe run by the nonprofit Media Arts Collective
(co-directors: Zach and Tyler). Judgment runs in Node (`brain/`, `recap/`);
the Apps Script project is its interface to Gmail and the sheet. It was forked from an earlier system called **Scriba Senatus**
(see `../scribaSenatus` in the `wavebucks` repo), which handled email-driven
commands for the krewe's old spendable-Wavebucks economy.

Aedile is a narrower, more deliberate rebuild — not a resurrection of Scriba
Senatus's full command set.

## The problem this solves
The krewe's apparent self-organization was historically sustained by a
founder, Abraham, now retired. Neither director has the bandwidth to
replicate what he did by hand. **Four prior automation attempts have failed**
— each one relocated the hidden human-operator labor rather than eliminating
it (e.g., a human still had to notice mail arrived, open a tool, and prompt
it). Aedile is designed to actually occupy that operator slot.

## The core design split: Engine vs. Ritual
This distinction governs every decision in this codebase.

- **Engine work** (Aedile's job): tracking, scheduling, reminders,
  bookkeeping, recurring drafts, institutional memory, logging. Mechanical,
  repeatable, no taste required.
- **Ritual work** (humans only, always): theme decisions, taste, conflict
  resolution, valuation, anything requiring judgment about what the krewe
  *should* value. Aedile never makes these calls, never simulates having an
  opinion about them, and never nudges toward a particular outcome.

When in doubt about whether a feature belongs in this codebase: if it
requires taste or would take a side in a human disagreement, it doesn't.

## Non-negotiable guardrails
- **Draft only.** What aedile writes lands as a Gmail draft a human sends.
  `brain/triage.mjs` and `recap/redige.mjs` call `createDraft` and nothing
  else that mails. Don't add a "just this once" send beside the two below.
- **Two actions can send: `sendReplyAll` and `sendDraft`** (`WriteApi.js`).
  Each refuses unless all of these hold:
  - `AEDILE_ENABLED` and `AUTOSEND_ENABLED` are both `'true'`.
  - Every participant (From/To/Cc, every message in the thread) matches
    `AUTOSEND_ALLOWLIST`: exact addresses and/or `@domain` suffixes, managed
    in Script Properties, and it must include Aedile's own inbox address. One
    participant outside it refuses the whole thread.
  - Fewer than `MAX_SENDS_PER_DAY` sends are in the Log for the last 24 hours.

  Don't broaden what the allowlist matches, and don't add the list address to
  it, without treating that as its own decision, reasoned through explicitly.
- **Label, don't mark as read.** Reviewed threads get a tracking label; the
  unread flag stays untouched. Directors rely on unread-as-signal.
- **Never add a recipient to a reply.** To/Cc stays the thread's existing
  participants. `createDraft`'s originate form is deliberately outside this:
  it passes `to` through unchecked, because a draft cannot leave without a
  human sending it. Zach, 2026-09-25: *"drafts are safe by construction."*
- **Caps**, enforced in code, not just by good intentions.
- **Kill switch**: `AEDILE_ENABLED` in Script Properties stops both sends;
  either director can flip it without touching code.
- **Log everything**: message, action, one-line reasoning, to the Log tab. It
  is how anyone judges whether aedile's judgment is any good.

## Ownership model
Aedile runs under the krewe's own Google Workspace seat
(`kreweofvaporwave@kreweofvaporwave.com`), inside the `nomac.org` Workspace
that both Zach and Tyler administer. **Not** a personal account, and not
`scribasenatus@gmail.com` (the old system's account — ownership unclear,
outside the Workspace, exactly the single-point-of-failure pattern this
project exists to avoid). Config/Log data lives in a spreadsheet owned by
that same account, not a director's personal Drive.

## Outbound mail is generated, never hand-written

`aedile/recap/redige.mjs --genre recap|headsup|reminder` writes outbound mail and
`checks.mjs` grades it. Do not hand-write a body into `call.sh createDraft`: generate
it, let the checks grade it, then post the saved decision. A heads-up requires
`--event-date`.

A draft is a clean body a human can send as-is. Proposed changes and questions go in
the chat or the issue, not in the mail (Zach, 2026-10-05: *"these drafts are useless
with all this markup"*).

No measured figure is quoted in this file. `python3 aedile/analysis/ingest.py --audit
<file>` and `node aedile/analysis/subject-shapes.mjs` print them.

Before teaching the generator a new trait, check its provenance against a source
outside the scrape.

## Voice
The voice carries over close to verbatim from Scriba Senatus — dry,
deadpan, memory-invoking, in the tradition of Abraham's own register —
codified in `AEDILE_CONTEXT.core.md`. Same entity in a different
register, not a performed character. AI involvement doesn't need explicit
disclosure; the krewe's existing aesthetic (Scriba Senatus's own
cyborg-narrator lore) already makes this on-brand.

Two behavioral rules tied to voice:
- Aedile may **originate** krewe-wide announcements (e.g. gathering
  heads-ups) — which is what the operator historically always did. The safety boundary is **not** a ban on originating; it is
  **draft-only: aedile drafts, a human sends, and it stays that way until a
  flag explicitly changes it** (same posture as `AUTOSEND_ENABLED`).
- Observe seasonal rhythm: July is historically silent (low activity
  expected/correct); October–February is live season.

## What was deliberately left out of this fork
The old Scriba Senatus lexicon (`CAUSA`, `VOTE`, `RESOLVE`, `COMMISSIO`,
`ACCEPT`, `COMPLETE`, `TRANSFER`) is **not** ported into this version. That
command set belonged to a spendable Wavebucks economy that's being retired
in favor of decoupled passive accrual (₩1/day for mailing-list membership,
functioning as a presence pulse, feeding an annual patch-eligibility
decision rather than being spendable for power). Don't resurrect these
commands without an explicit decision to do so.

A confederate account posing as a peer member was proposed and rejected
during design — it would manufacture synthetic social proof and corrupt the
signal the system exists to observe. Don't build anything that simulates
being a human member.

## Build discipline (realisateur baseline — see realisateur/BUILD-DISCIPLINE.md)
Before marking anything done:
- [ ] Fails **loud**? (no exit-0 no-ops; pipefail+SIGPIPE guarded)
- [ ] "Working" backed by a **test name or human-sense witness**, not exit code alone?
- [ ] Config read from **one source**, not retyped per file?
- [ ] Deploy verified against a **git ref**; drift fails loud?
- [ ] **No secret** in a tracked file; tree clean of build debris?
- [ ] `silence-audit --strict` clean? (mechanizes the retired
      stderr-silencing / wired-to-a-real-path / names-what-it-retires rows)
