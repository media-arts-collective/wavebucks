# Aedile — Project Context

## What this is
Aedile is an AI operations role for the Virtual Krewe of Vaporwave, an
eleven-year-old Mardi Gras krewe run by the nonprofit Media Arts Collective
(co-directors: Zach and Tyler). This project is an Apps Script implementation
of that role, forked from an earlier system called **Scriba Senatus**
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

## Non-negotiable guardrails (v0 and for the foreseeable future)
- **Draft only, with one narrow, explicit exception: the director
  allowlist.** By default every code path that produces outbound text ends
  in `msg.createDraftReply()`, never `.reply()`/`.replyAll()`/`.sendEmail()`.
  This remains the primary safety margin during the trust-building period —
  don't weaken it for convenience, and don't add an ad hoc "just this once,
  auto-send" branch outside the mechanism below.

  The one sanctioned exception (`InboxProcessor.isAutosendEligible`) lets a
  `draft_reply` decision auto-send via `thread.replyAll()` instead, but only
  when **all** of the following hold:
  - `AUTOSEND_ENABLED` script property is `'true'` (separate from
    `AEDILE_ENABLED` — a director can kill just this capability without
    disabling scanning/drafting entirely).
  - Every participant (From/To/Cc, every message in the thread) matches
    `AUTOSEND_ALLOWLIST`, a comma-separated script property of exact
    addresses and/or `@domain` suffixes (e.g. `zach@nomac.org,@nomac.org`).
    A single participant outside the allowlist — any third party CC'd in —
    disables auto-send for that whole thread; it falls back to a draft.
    The allowlist must include Aedile's own inbox address explicitly (no
    self-detection) and is managed entirely via Project Settings > Script
    Properties, not in code.
  - `MAX_AUTOSEND_PER_RUN` (5) hasn't been hit yet this run — a tighter,
    separate cap than `MAX_MESSAGES_PER_RUN`, since auto-send has no human
    review step between decision and delivery.

  This exists to test live with the directors themselves in a fully
  closed loop (only Zach/Tyler/the krewe address on the thread) before
  ever considering it for the general mailing list. Don't broaden the
  allowlist's reach (e.g. matching on thread content instead of exact
  participants, or applying it to `flag`) without treating that as the
  same category of decision this was — flagged and reasoned through
  explicitly, not defaulted into.
- **Label, don't mark as read.** Processed threads get a tracking label;
  the unread flag stays untouched. Directors rely on unread-as-signal.
- **Recipient allowlist, on the paths that send.** Never let generated
  content introduce a new recipient to a *reply*. To/Cc stays limited to
  existing thread participants or a small hardcoded set (currently: Zach,
  Tyler). **`WriteApi`'s `createDraft` originate form is deliberately
  outside this** — it passes `params.to` through unchecked, because a draft
  cannot leave without a human opening and sending it, and the caller that
  uses it (`redige.mjs`) hardcodes the list address. Zach,
  2026-09-25: *"drafts are safe by construction."* This paragraph used to
  state the rule unconditionally, which read as though the code enforced it
  everywhere; it does not, and the gap was the sentence rather than the
  code (#61). Distinct from `AUTOSEND_ALLOWLIST`
  above — this rule is about never *adding* an unexpected recipient to a
  reply; that one is about whether the *existing* participants are safe
  enough to skip human review entirely.
- **Per-run and per-day caps**, enforced in code, not just by good intentions.
- **Kill switch** via Script Properties (`AEDILE_ENABLED`), checked first in
  every trigger-invoked function, so either director can pause everything
  without touching code.
- **Log everything** — thread ID, timestamp, action, one-line reasoning — to
  the Log tab. This is the primary tool for evaluating whether Aedile's
  judgment is any good, so undecorated logging matters more than clever code.

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
codified in `AEDILE_CONTEXT_CORE` (`Context.js`), not a separate templates
file. (An earlier `Personality.js`, reading HTML templates from a
`Personality` tab, was deleted as dead code — it had zero call sites and
was never wired into draft generation.) Same entity in a different
register, not a performed character. AI involvement doesn't need explicit
disclosure; the krewe's existing aesthetic (Scriba Senatus's own
cyborg-narrator lore) already makes this on-brand.

Two behavioral rules tied to voice:
- Aedile may **originate** krewe-wide announcements (e.g. gathering
  heads-ups) — which is what the operator historically always did. The safety boundary is **not** a ban on originating; it is
  **draft-only: aedile drafts, a human sends, and it stays that way until a
  flag explicitly changes it** (same posture as `AUTOSEND_ENABLED`). The
  earlier "never start threads" rule was scoped to internal working-group
  ops flow, not list-wide announcements, and was removed 2026-09-13. See #49.
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
