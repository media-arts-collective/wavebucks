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

**Deployment**
- `.claspignore` — what `clasp push` must NOT upload. Load-bearing, not
  hygiene: Apps Script runs every file in one shared global scope, and
  `TestsLocal.js` declares a top-level `const` that `InboxProcessor.js`
  already declares. Pushing both is a `SyntaxError` at load, which stops the
  whole project — triage, bumps and both Web App endpoints. Do not delete
  this file to "just push everything once".

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
- `ReadApi.js` — read-only, token-gated `doGet` Web App that returns the
  OpenLoops/Messages/Log/Requests tabs as JSON, so an outside dev-ops
  workflow can pull institutional-memory state on demand without Sheets/
  Gmail creds. Strictly read-only (no mutation, no send, no guardrail
  touch); gated by the `READ_API_TOKEN` script property and fails closed if
  it's unset. See the file header for deploy steps and scopes.

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

**Meeting recap** (on demand, `draftRecap()`)
- `MeetingRecap.js` — turns a meeting transcript into a recap DRAFT addressed
  to the mailing list. The only tier that originates a thread, and the only
  one that can never send: its sole Gmail mutation is `GmailApp.createDraft()`.
  A director opens the draft and presses send, so the human originates and
  Aedile drafted. Deliberately does **not** append to `MessageLog` — the recap
  is institutional memory, the raw transcript is not, and anything in
  `Messages` is re-injected into every triage call for a year.
- `AEDILE_CONTEXT.recap.md` — the recap judgment model and the krewe's own
  recap form, drawn from the archive. Signs `<3 SM`.
- No trigger. Meetings are not a cadence; a transcript arrives via
  `WriteApi`'s `draftRecap` action.
- `recap/redige.mjs` — **the generator, and it does not run here.** It runs on
  mandark under node, because it needs a filesystem: the Obsidian voice
  corpus, the context files, whisper. Apps Script has none of those, which is
  why putting a document generator inside an inbox watcher kept failing. It
  writes the recap, runs `recap/checks.mjs` over its own output, and hands the
  result to `WriteApi`'s `createDraft` action. Excluded from `clasp push` by
  `.claspignore` — it is node ESM and pushing it would break the project at
  load.
- `createDraft` is the sink for that generator: it assembles and files a recap
  that arrived already written. It judges nothing and calls no model. Same
  bounds as `draftRecap`, on purpose — `RECAP_ENABLED` gates it, the recipient
  is hard-coded, and it cannot send. The generator holds no Google credential;
  aedile already runs as the krewe account, so the capability stays where the
  credential already is.
- Transcription rides the same whisper the Zaxon relay calls (the container at
  `/srv/zaxon` on dexter), by the same two steps `whisper_stt.sh` uses. There
  is no second STT.

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
  accumulate in `OpenLoops` but nothing ever acts on them. Bump drafts
  **are** eligible for auto-send, under the same allowlist condition as the
  triage tier (`InboxProcessor.isAllowlistEligible`), with their own
  separate per-run cap — decided 2026-07-16, see `CLAUDE.md`. *(This line
  used to say the opposite. It was wrong from the day that decision landed,
  and it was wrong in the dangerous direction: it described a narrower blast
  radius than the code has.)*
- `ANTHROPIC_API_KEY` — the Claude API key `AnthropicClient.js` reads.
- `READ_API_TOKEN` — secret gating the read-only `ReadApi.js` Web App
  endpoint. If unset, that endpoint refuses every request (fail closed).
  Independent of the kill switches above; it has no effect on the
  trigger-driven triage/bump path.
- `WRITE_API_TOKEN` — separate secret gating `WriteApi.js`'s `doPost`, which
  can trigger a real `scanInbox`/`checkBumps` run and therefore real
  auto-sent mail. `recap/redige.mjs --post` reads it from the **environment**;
  it is not read from a path in source, because the tree it lives in today
  (`/srv/vaporwave-reports`) is being retired. Deliberately not shared with `READ_API_TOKEN`, so read
  access and trigger access are revocable independently. Fails closed.
- `TESTING_MODE` — temporary override that suspends dead-season restraint
  for the whitelisted director loop (`SystemPrompt.js`). Set by
  `enableTestingMode()`, cleared by `disableTestingMode()`. Only the exact
  string `'true'` is on. **Leaving this set is a live behaviour change**, so
  check it before assuming aedile is observing seasonal silence.
- `MIGRATION_DRIVE_FILE_ID` — read only by the one-time, non-idempotent
  `migrateMessages()` archive import. Not part of any trigger path.
- `RECAP_ENABLED` — gates the meeting-recap tier, independent of every switch
  above. Off/unset means off. Note what it does *not* gate: nothing in that
  tier can send, so this switch governs whether a draft is written, not
  whether mail leaves. **The only switch here that `WriteApi` can flip**
  (`action=setRecapEnabled`), and that is exactly why: the others gate paths
  that put mail in other people's inboxes, this one gates a path that puts a
  draft in ours.

All ten live in Project Settings > Script Properties, not in code.
`checkGuardrails()` prints the first four.

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
