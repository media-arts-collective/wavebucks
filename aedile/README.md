# Aedile

AI operations role for the Virtual Krewe of Vaporwave (co-directors: Zach
and Tyler), running as a Google Apps Script project under the krewe's own
Workspace account (`kreweofvaporwave@kreweofvaporwave.com`), not either
director's personal account. See [`CLAUDE.md`](./CLAUDE.md) for the
mission, guardrails, and full design rationale — this file is an
orientation to what's actually running and where things live, written so
either director can pick it back up without re-deriving context.

## Status

**Intended to be live**, not just a manual test: the hourly `scanInbox`
trigger is meant to be installed and actually reviewing real inbox mail —
but a 2026-07-17 audit found a real unread thread that was never reviewed
or logged, and Log-tab timestamps that look more like manual test runs
than a continuously-firing trigger. **Whether the trigger has actually been
running on schedule this whole time is unconfirmed** — see "Known bugs" in
`CLAUDE.md`. It creates Gmail drafts by default, with one narrow, opt-in
exception — a closed-participant auto-send trial, currently **turned on**
(see "Auto-send trial" below). Nothing gets marked read, and everything it
does is logged to the `Log` tab, so its judgment is auditable — when it
actually runs.

A second capability, daily bump-checking (nudging on threads that have gone
quiet — see "Bump-check" in `CLAUDE.md`), is also **live**: `BUMP_ENABLED`
is set and `installBumpTrigger()` has been run.

Institutional memory is a single raw mailing-list archive (`Messages` tab)
plus hand-curated context (`Context.js`), injected together into every
triage call — there is no separate model-derived summarization tier. An
earlier Threads→Shards cross-thread consolidation pipeline was retired in
favor of this; see `CLAUDE.md` for why.

## Auto-send trial

By default every outbound message is a Gmail draft — a human has to open
and send it. The one exception, gated by its own `AUTOSEND_ENABLED`
switch and **currently turned on**, lets a `draft_reply` decision send
immediately via `thread.replyAll()` instead, but *only* when every
participant on the thread matches `AUTOSEND_ALLOWLIST` — currently set to
`zach@nomac.org`, `tyler@nomac.org`, `kreweofvaporwave@kreweofvaporwave.com`,
nobody else. Applies to both the triage tier (hourly) and the bump
tier (daily), each with its own separate per-run send cap. The point is to
build trust with real send behavior in a fully closed loop before ever
considering it for the general mailing list. See `CLAUDE.md`'s guardrails
section for the full mechanism and the reasoning for treating it as a
deliberate, scoped exception rather than a step toward removing draft-only
generally.

## Files

**Shared**
- `Config.js` — Config/Log tab access
- `AnthropicClient.js` — Claude Messages API wrapper
- `Context.js` — runtime source for institutional-memory context (mirrors
  the `AEDILE_CONTEXT.*.md` files; Apps Script can't load `.md` at runtime)
- `SystemPrompt.js` — assembles the triage/bump system prompts from
  `Context.js`
- `MessageLog.js` — Messages tab access: appends every reviewed message,
  serves a rolling window of raw history to each triage call, and does the
  one-time historical-archive import (`migrateMessagesFromDriveId`)
- `Requests.js` — Requests tab access: logs a bug/feature entry whenever a
  triage decision sets `is_request: true`

**Triage** (per-message, `scanInbox()`)
- `InboxProcessor.js` — classifies each message "dm" or "list"
  (`classifyAudience`), scans unread mail, drafts/auto-sends/flags/no-ops,
  appends to `MessageLog`, upserts `OpenLoops`, logs to `Requests` when
  flagged
- `AEDILE_CONTEXT.triage-list.md` — judgment model for broadcast list
  traffic
- `AEDILE_CONTEXT.triage-dm.md` — judgment model for narrowly-addressed
  messages (**placeholder content**, pending real instructions — see
  `CLAUDE.md`'s "Open items")

**Bump-check** (daily, `checkBumps()`)
- `BumpChecker.js` — revisits threads `OpenLoops` marks as due, makes a
  second Claude call per thread, drafts/auto-sends (same allowlist as
  triage, separate per-run cap)/flags/no-ops
- `OpenLoops.js` — OpenLoops tab access: tracks per-thread open/closed state
  and next-check date, populated by triage, read by the bump check
- `AEDILE_CONTEXT.bump.md` — the bump-specific judgment model

**Shared context**
- `AEDILE_CONTEXT.core.md` — identity, Engine/Ritual split, voice, lore

**Offline experiment**
- `holon_fold.py` — standalone Python script, not part of the Apps Script
  runtime; tests emergent hierarchy depth over the raw archive as a
  possible future input to hand-curated context. Not wired into anything.

## Config spreadsheet tabs

`Config`, `Log`, `Messages`, `OpenLoops`, `Requests` are live. `Personality`,
`Threads`, `Shards`, `ConsolidationLog` are orphaned — no code reads or
writes them anymore (`Personality.js` was deleted as dead code; the other
three are leftovers from the retired consolidation pipeline). Safe for a
director to archive or delete once the historical data in them isn't needed.

## Kill switches / script properties

- `AEDILE_ENABLED` — gates `scanInbox()` entirely.
- `AUTOSEND_ENABLED` — separate switch gating the auto-send exception
  (below); off/unset means every `draft_reply` stays a draft regardless of
  the allowlist.
- `AUTOSEND_ALLOWLIST` — comma-separated exact addresses and/or `@domain`
  suffixes. A `draft_reply` decision auto-sends via `thread.replyAll()`
  instead of drafting only when every participant on the thread matches
  this list — see `CLAUDE.md`'s guardrails section for the full mechanism
  and why it exists. Must include Aedile's own inbox address explicitly.
- `BUMP_ENABLED` — gates `checkBumps()` entirely, independent of
  `AEDILE_ENABLED`/`AUTOSEND_ENABLED`. Off/unset means open loops
  accumulate in `OpenLoops` but nothing ever acts on them. Bump drafts are
  never eligible for auto-send, regardless of `AUTOSEND_ALLOWLIST`.
- `ANTHROPIC_API_KEY` — the Claude API key `AnthropicClient.js` reads.

All five live in Project Settings > Script Properties, not in code.

`installTrigger()` installs the hourly `scanInbox` trigger;
`installBumpTrigger()` installs the daily `checkBumps` trigger. Independent
of each other.

## Historical archive import — already done

The pre-Aedile mailing-list export (~1,100 messages back to 2019) has
already been imported into the `Messages` tab — this doesn't need to be
re-run, and the local `messages.jsonl`/`scrape_google_group.py` files that
did it are gone now that their job is done (neither was ever committed to
git, so this isn't recoverable from history — the migrated `Messages` tab
is the durable copy going forward). Notes here in case a fresh archive
import is ever needed again (a new spreadsheet, the tab gets wiped, etc.)
— it'll need a new export and `MessageLog.migrateMessagesFromDriveId`'s
Drive-file approach still works, just starting from scratch:

1. Get a JSONL export of the mailing list (one row per message: `email`,
   `date`, `body`, optionally `topic_url`) onto Drive under the krewe's own
   account (`kreweofvaporwave@kreweofvaporwave.com`) — not a director's
   personal Drive, per the ownership guardrail in `CLAUDE.md`. Note its
   file ID.
2. `clasp open`, then in Project Settings > Script Properties add
   `MIGRATION_DRIVE_FILE_ID` = that file ID.
3. Select `migrateMessages` from the function dropdown and click Run.
   (Not `migrateMessagesFromDriveId` — that's the implementation
   `migrateMessages` calls; it takes an argument the editor's Run button
   can't supply.)

Not idempotent — running it twice duplicates every row. If it's ever
re-run, clear the `Messages` tab's historical rows first.
