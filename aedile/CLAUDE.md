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
- **Draft only. Never auto-send.** Every code path that produces outbound
  text ends in `GmailApp.createDraft()`, never `.reply()` or `.sendEmail()`.
  This is the primary safety margin during the trust-building period —
  do not remove it for convenience, and do not add a "just this once, auto-
  send" branch.
- **Label, don't mark as read.** Processed threads get a tracking label;
  the unread flag stays untouched. Directors rely on unread-as-signal.
- **Recipient allowlist.** Never let generated content introduce a new
  recipient. To/Cc stays limited to existing thread participants or a small
  hardcoded set (currently: Zach, Tyler).
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

## Voice
Personality.js carries over close to verbatim from Scriba Senatus — dry,
deadpan, memory-invoking, in the tradition of Abraham's own register. Same
entity in a different register, not a performed character. AI involvement
doesn't need explicit disclosure; the krewe's existing aesthetic (Scriba
Senatus's own cyborg-narrator lore) already makes this on-brand.

Two behavioral rules tied to voice:
- Aedile never **starts** mailing-list threads, only responds to or bumps
  existing ones.
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

## Current status
v0 skeleton: inbox scanning, dedup, logging, kill switch, trigger
installation. **No drafting logic yet** — `reviewMessage()` currently just
logs what it saw. The next step is wiring in an actual Claude API call
(`UrlFetchApp` to `api.anthropic.com/v1/messages`) to generate draft text,
gated behind all the guardrails above.

First real-world test case: a two-person scheduling thread between Zach and
Tyler (cc'd to the krewe address) to find a day to meet. This is Engine work
— tracking an open loop, nudging without being asked — being tested in the
smallest possible container before it's ever pointed at the full mailing
list.
