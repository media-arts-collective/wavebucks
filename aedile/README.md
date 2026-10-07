# Aedile

AI operations role for the Virtual Krewe of Vaporwave, running as a Google Apps Script
project under the krewe's own Workspace account. Rules and guardrails: [`CLAUDE.md`](./CLAUDE.md).
Tests: `aedile/test.sh`. Deploy: `aedile/deploy.sh "<description>"`.

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

All nine live in Project Settings > Script Properties, not in code.
`checkGuardrails()` prints the first four.

`installTrigger()` installs the hourly `scanInbox` trigger;
`installBumpTrigger()` installs the daily `checkBumps` trigger. Independent
of each other.
