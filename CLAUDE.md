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

## Push permission (2026-07-24, human-directed)

Claude may push committed changes directly to `origin/<current-branch>`
without asking each time, for ordinary work in this repo — same standing
grant as every other repo realisateur touches. Flag every such push in
the next report/summary (what was pushed, why, and how to revert it —
`git revert <sha>`). This does not license skipping review of what goes
into a commit in the first place, only the push step itself.

**Why this is fine here despite being a shared, co-directed nonprofit
repo (Zach + Tyler):** the real safety boundary already lives on the
Apps Script *production* side, not in git — `aedile`'s own env vars
there enforce a recipient whitelist/kill switch that prevents it from
acting outside approved bounds regardless of what's pushed to this repo.
A git push here changes source under version control; it does not by
itself change production behavior or reach beyond the whitelist. Given
that, gating pushes behind an extra opt-in switch here would be
redundant friction, not real safety — removed the earlier
`WAVEBUCKS_AUTOPUSH` env-var gate from this file (2026-07-24) for
exactly that reason.

## Agent permissions live in `.claude/settings.json` (2026-09-25, human-directed)

Zach: *"permission needs to be persistent somehow: a skill? a script?
this is literally the point of the repo."* A skill cannot grant
permission — it is instructions. The grant is `.claude/settings.json`,
which is the one path un-ignored under `.claude/` (see `.gitignore`), so
the policy reviews like code and reaches Tyler and unattended runs alike.

The split is the operating rule, not a convenience:

- **allow** — reads, bookkeeping, and drafting. `call.sh get`/`readThread`/
  `readInbox`, `gh issue` verbs, `git push`, `clasp pull`/`deployments`,
  the local test suite, and (since 2026-10-06, below) `redige.mjs` and
  `call.sh createDraft`. None of these can put mail in anyone's inbox.
- **ask** — everything that can send, trash, or change what runs. `clasp
  version`, `call.sh scanInbox`/`checkBumps` (metered `x-api-key` in
  `AnthropicClient.js` and can auto-send within the allowlist),
  `sendReplyAll`/`sendDraft`/`setRecapEnabled`/`trashMessage`.
- **deny** — `git push --force` in any spelling.

The rows above are the current state; the dated entries below are how it
got there, and the older ones describe rows that have since moved.

**`clasp push` promoted to `allow` (2026-09-25, human-directed).** Zach:
*"I need you to be able to push unattended as a rule."* Asked again the
same session after the first `ask` prompt, so it is a standing grant, not
one approval. Scope is `clasp push` only — `clasp deploy` and `clasp
version` stay in `ask`, because a push changes saved code (what the
time-driven triggers execute) while those two change what the anonymous
`/exec` serves to every caller. That line is the whole distinction; do
not blur it by promoting the other two on the strength of this entry.

**In effect since 2026-09-26 (#62 closed).** The `ask` entry is gone, so
`clasp push` no longer prompts. Worth keeping on the record: the
classifier refused the deleting edit twice as Self-Modification and only
allowed it after Zach said *"you have permission to delete this from ask
for me."* Adding an `allow` entry was permitted throughout; removing an
`ask` entry was not. That asymmetry is the guard working — an agent may
be handed a permission, but may not quietly retire its own confirmation
requirement. Expect to need an explicit sentence from Zach for any future
`ask` removal, and do not read this entry as standing licence for the
next one.

**`clasp -u aedile deploy` promoted to `allow` (2026-09-28,
human-directed).** Zach: *"allow clasp -u aedile deploy from now on. then
go."* Said unprompted, after a turn that stopped at the gate and asked
rather than routing around it — so it is a standing grant, not one
approval, and it is the explicit sentence the entry above says any `ask`
removal requires.

Scope is `deploy` only. **`clasp -u aedile version` stays in `ask`**, and
the line between them is now finer than the one the entry above draws,
so read it carefully: both change what the anonymous `/exec` serves, and
`deploy` implicitly cuts a version anyway. What does not change is that
`version` alone is how a numbered release gets *named* in the deployment
list that `CONTRIBUTING.md` treats as the record. Do not read this grant
as covering it.

Why the gate was worth having until now: `clasp push` saves code that
time-driven triggers execute; `clasp deploy` changes what the anonymous
`/exec` URL serves to every caller holding it, including `call.sh` and
`redige.mjs`. A pinned deployment is also the reason a pushed fix can
read as absent — verified 2026-09-28, when `trashMessage` was saved by
`clasp push`, absent from `/exec`'s action list, and unreachable via the
`@HEAD` deployment because Apps Script serves HEAD at `/dev` behind an
owner login. That is the standing "verify the copy that executes" rule
with a deployment id attached.

**`redige.mjs` and `call.sh createDraft` promoted to `allow`; the
PreToolUse hook deleted (2026-10-06, human-directed).** Zach, on the
hook: *"These bash blocks are killing me"*; on two regex repairs to it:
*"The rule edit looks like a silly sed incantation. there should be
something simpler"* and *"same incantation problem"*; on the
recommendation that became this entry: *"ok I take your recommendation"*.

The hook grepped the whole command for `redige\.mjs`, so a `grep` or
`wc` that merely named the file prompted like a run. It existed because
`Bash(aedile/recap/redige.mjs:*)` never matched `cd aedile/recap &&
./redige.mjs` (commit `025dc45`). The replacement is no pattern at all:
each gated verb is listed in both spellings, `aedile/recap/call.sh <verb>`
and `./call.sh <verb>`.

Why these two could move: neither sends. `redige.mjs` generates through
the subscription `claude` CLI (`redige.mjs:169-171`, no API key) and with
`--post` files a draft; `createDraft` files a draft. `sendDraft` stays in
`ask` because it does send (`WriteApi.js:458`, first real send
2026-10-06).

**Tested 2026-10-06 with Zach present:** `cd aedile/recap && ./call.sh
sendDraft messageId=<id> dryRun=true` was run and Zach, asked whether the
prompt appeared: *"ok that worked"*. So an `ask` row does match the
`./call.sh` segment of a `cd ... &&` chain. The paragraph below is the
record from before that test; its env-prefixed and wrapped spellings
remain untested.

**UNVERIFIED before the test above, and the hole to know about:** that an `ask` row matches the
`./call.sh sendDraft` segment of a `cd … && ./call.sh sendDraft` chain
was not tested — Zach was away and the test is a prompt. An env-prefixed
or wrapped spelling (`X=1 ./call.sh …`, `timeout 60 ./call.sh …`)
matches no row and falls to the session's permission mode. Until the
test is run with a human present, invoke gated verbs from the repo root
as `aedile/recap/call.sh <verb>`, the spelling the rows name outright.

**`openLoop` and `appendRecord` in `allow`, `closeLoop` in `ask`, and a
SessionStart hook (2026-10-06, human-directed, #84).** Asked whether the
three Loops verbs should be allowed and whether a session-start hook
should print open loops, Zach: *"a. yes, allow except closeLoop is ask"*
and *"b. yes"*. None of the three touches Gmail; they write rows to the
private sheet. The hook runs `aedile/recap/loops.sh`, a read. On a check
that would hold bot PRs touching this file, Zach: *"c. do nothing"*.

**`amendLoop` added to `ask` (2026-10-06).** Not ruled by Zach; placed
beside `closeLoop` because it retires a row the same way. Moving it to
`allow` needs his sentence.

**Loops are krewe work; issues are this machinery (2026-10-06,
human-directed).** Zach: *"Can we separate Loop items from repo/self-dev
stuff? Loop should be for krewe work. Issues should be for maintaining
this machinery."* A question about permissions, deploys or tests is an
issue here, never a Loops row.

**Do not move a row from `ask` to `allow` to get unblocked mid-task.**
The point of the `ask` list is that a human sees those specific actions
every time. Widening it is a decision, dated and recorded here like the
push grant above.

Because this repo is public, a pull request can edit this file. Treat a
diff to `.claude/settings.json` as a privilege change and review it as
one — it is the only file here that grants an agent anything.

**Prefer noisy failures over silent guards in this phase.** This project
is pre-full-list-deployment — the whitelist scope is intentionally
narrow right now specifically so problems surface loudly and get fixed
before wider rollout. Don't add defensive try/catch or fallback paths
that would quiet an error instead of surfacing it; a loud failure now is
cheaper than a silent one discovered after the list widens. Matches
`BUILD-DISCIPLINE.md`'s "fail loud by default" rule (stamped into
`aedile/CLAUDE.md` same night) — applies to this whole repo, not just
`aedile`.
