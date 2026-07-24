# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This repo is a monorepo of **three independent Google Apps Script projects**, each managed locally with `clasp` and each with its own `.clasp.json` (script ID) and `appsscript.json` (manifest). Two of them (`scribaSenatus`, `wavebucksCore`) implement Wavebucks, a play-money economy run entirely over email; the third (`aedile`) is an unrelated successor project with its own mission — see below and `aedile/CLAUDE.md`.

Wavebucks: users email commands (e.g. `HELP`, `QUOT`, `CAUSA ... | ...`, `VOTE`, `TRANSFER`) to a Gmail inbox; a time-driven trigger scans unread mail, parses commands, mutates a Google Sheet acting as the database/ledger, and replies in-thread with an HTML message.

- **`scribaSenatus/`** — the main service. Processes inbound email, parses commands, runs the Causae (voting/wagering) and Commissiones (bounty task) subsystems, and sends replies.
- **`wavebucksCore/`** — a separate Apps Script **library** providing the core Wavebucks ledger (`credit`/`debit`/`getBalance`/`ensureAccount`). `scribaSenatus` depends on it via the `Wavebucks` library binding declared in its `appsscript.json`.
- **`aedile/`** — a v0-skeleton successor project with a deliberately different mission: an AI-assisted email operations role for a client organization, not a continuation of the Wavebucks economy. It reuses `scribaSenatus`'s `Personality.js`/`ServiceAdapters.js` as a starting point but explicitly does **not** port over the `CAUSA`/`VOTE`/`RESOLVE`/`COMMISSIO`/`ACCEPT`/`COMPLETE`/`TRANSFER` command set. **See `aedile/CLAUDE.md` for its actual scope, safety guardrails (draft-only, kill switch, recipient allowlist), and design philosophy before making changes there** — the summary above is intentionally minimal so it doesn't drift out of sync with that file.

There is no npm/build tooling — no `package.json`, no bundler. Each project is a flat folder of `.js` files that Apps Script loads as separate global-scope scripts (all top-level `const`/`function` declarations in a project share one global namespace at runtime).

## Commands

There is no root build/lint/test command — work happens per-project.

```bash
# Install clasp once, globally
npm install -g @google/clasp
clasp login

# From inside a project directory (scribaSenatus/, wavebucksCore/, or aedile/):
clasp pull              # pull latest from Apps Script before editing
clasp push               # push local changes to Apps Script
clasp push --watch       # auto-push on save
clasp open                # open the project in the Apps Script web editor
clasp logs                # view execution logs (Stackdriver)
```

Testing (scribaSenatus only today):

```bash
cd scribaSenatus
node TestsLocal.js        # fast local suite, no Google Apps Script dependencies
```

- `TestsLocal.js` is self-contained: it re-mocks `Logger`, `SpreadsheetApp`, `GmailApp`, and re-declares the modules under test (e.g. `CommandParsers`) inline, because plain `node` cannot load Apps Script globals from the real `.js` files. **When you change parsing/business logic in a real module, mirror the change in `TestsLocal.js`'s copy** or the local suite will silently test stale logic.
- `Tests.js` is the Apps Script-side integration suite. It requires real Google services, so it only runs inside the Apps Script editor: `clasp push` then `clasp open` then run `runAllTests()` from the editor, and check the execution log.
- `.claspignore` in `scribaSenatus/` excludes `TestsLocal.js`, `.clasp.json`, and git files from `clasp push` — local-only test infra never reaches Apps Script.

## Architecture (Wavebucks: scribaSenatus + wavebucksCore)

This section describes the Wavebucks economy only. It does not apply to `aedile`, which has its own architecture, guardrails, and conventions documented in `aedile/CLAUDE.md`.

All state lives in Google Sheets, not in code — sheets are the database. There are two spreadsheets involved:

- **Config spreadsheet** (`CONFIG_SHEET_ID` in `Config.js`): tabs `Config` (key/value settings), `Personality` (HTML message templates keyed by name), `Log` (append-only audit trail of every processed email, including `messageId` for dedup), `Causae` and `Commissiones` (created on demand by their respective services if missing).
- **Wavebucks ledger spreadsheet** (`WavebucksConfig.SHEET_ID` in `wavebucksCore/sheetConfig.js`): tabs `Balances` and `Log`, owned by the `wavebucksCore` library, accessed only through `Wavebucks.credit/debit/getBalance`.

Request flow, end to end:

1. `InboxProcessor.processUnread()` (triggered every few minutes by a time-driven Apps Script trigger calling `processInbox()`) searches Gmail for unread mail matching `Config.get('inboxSearch')`.
2. For each unread message, `Config.isMessageProcessed(messageId)` checks the `Log` sheet to skip duplicates (messages can be re-scanned before the label/read-state settles).
3. `InboxProcessor.normalizeBody()` strips quoted reply content (Gmail "On ... wrote:" blocks, `>` quote lines, signature separators) so replies to a thread don't re-trigger old commands.
4. `detectCommand()` walks `Config.getLexicon()` — a **hardcoded-in-code array** (not a sheet) of `{type, pattern, service, method, description, category, icon, example, details}` — and returns the first regex match. The lexicon is intentionally in version control rather than a spreadsheet tab so command definitions review like code.
5. The matched `command.type` looks up a handler in `DispatchTable` (`DispatchService.js`), which calls into `CommandParsers.js` to parse the free-text email body into structured args, then into the relevant domain service (`Causae`, `Commissio`, or `Wavebucks` directly for `TRANSFER`).
6. The handler's return value (an HTML string) is sent back via `msg.reply()` to keep the reply in the same Gmail thread, and the outcome is appended to the `Log` sheet via `Config.logEvent`.
7. `Personality.js` supplies static HTML snippets from the `Personality` tab, plus a dynamically generated `HELP` message built by iterating `Config.getLexicon()` and grouping by `category`.

Key conventions to preserve when extending this:

- **Adding a new command** touches four places in `scribaSenatus`: a new entry in `Config.getLexicon()` (pattern + metadata drives both dispatch and the auto-generated HELP text), a parser in `CommandParsers.js`, a handler in `DispatchTable` (`DispatchService.js`), and — if it mutates money or task state — a method in `Causae.js` / `Commissiones.js`. Update `TestsLocal.js` and `Tests.js` alongside.
- Domain sheets (`Causae`, `Commissiones`) store structured sub-data (options, votes) as JSON strings in a single cell (`JSON.stringify`/`JSON.parse`), not as normalized rows — read/write helpers always round-trip through `getSheet()` + `getDataRange().getValues()` rather than caching.
- IDs for `Causae`/`Commissiones` rows are just `rows.length` at creation time (row count = next ID), not a stored counter — do not reorder or delete historical rows without accounting for this.
- Money amounts are always routed through `Wavebucks.credit`/`Wavebucks.debit` (never direct sheet writes to balances), since those functions also enforce positive-amount validation and append to the ledger's own `Log` sheet.
- `wavebucksCore` is consumed as an Apps Script library binding named `Wavebucks` (see `scribaSenatus/appsscript.json`) currently pinned with `developmentMode: true`, meaning `scribaSenatus` always runs the library's latest pushed code rather than a specific deployed version. When cutting a real library version, see the "Publishing the Wavebucks Library" steps in `CONTRIBUTING.md`.
- Currency in user-facing text is rendered as the HTML entity `&#8361;` (₩) — keep this convention in any new reply-building code.

## Working across the monorepo

- Each of `scribaSenatus/`, `wavebucksCore/`, and `aedile/` is pushed/pulled independently with `clasp` from inside that directory — there is no top-level clasp project.
- `git` operates at the repo root and spans all three projects plus `COMMANDS.md`/`CONTRIBUTING.md`, so a single commit can (and often should) touch more than one project's files together.
- `CONTRIBUTING.md` documents the full clasp setup/auth flow and deployment steps in detail; `COMMANDS.md` is the user-facing reference for every email command, its exact syntax, and the sheet schemas — keep both in sync with `Config.getLexicon()` when commands change. Both describe Wavebucks (`scribaSenatus`/`wavebucksCore`) only, not `aedile`.
- `aedile/` doesn't share Wavebucks's spreadsheet-as-database design, lexicon/dispatch pattern, or command set — don't assume conventions from the Architecture section above carry over there. Read `aedile/CLAUDE.md` before working in that directory.

## Push permission (2026-07-24, human-directed, env-gated)

Claude may push committed changes directly to `origin/<current-branch>`
without asking each time, but **only when the environment variable
`WAVEBUCKS_AUTOPUSH=1` is set** in the shell running the session. If it's
unset (the default), commit locally as usual but ask before pushing —
same as the default behavior everywhere else.

**Why gated, unlike realisateur's own scaffolded projects:** this is a
shared, co-directed nonprofit repo (Zach + Tyler, Media Arts Collective),
not a solo sandbox — a blanket always-push grant doesn't fit here by
default. **Why the gate is acceptable at env-var granularity rather than
asking every time:** code here isn't in production and the institution
(Virtual Krewe of Vaporwave) is currently dormant — genuinely low
consequence if a push needs reverting, so a deliberate opt-in switch
(rather than a standing blanket grant) is the right amount of friction.

To enable for a session: `export WAVEBUCKS_AUTOPUSH=1` before starting
Claude Code. To make it the default for your own interactive use, add
that line to your shell profile or a `direnv` `.envrc` in this directory
— but don't bake it into any committed file (it's a per-human toggle, not
project config).

Every autonomous push must still be flagged in the next report/summary —
what was pushed, why, and how to revert (`git revert <sha>`) — same
requirement as every other repo with this permission. This does not
license skipping review of what goes into a commit, only the push step.
