# Aedile

AI operations role for the Virtual Krewe of Vaporwave, running as a Google
Apps Script project under the krewe's own Workspace account. See
[`CLAUDE.md`](./CLAUDE.md) for the actual mission, guardrails (draft-only,
kill switch, recipient allowlist), and design philosophy — this file is
just an orientation to what's in the folder.

## Status

v0: inbox scanning, per-message triage (draft/no_action/flag), and a daily
cross-thread consolidation tier. Neither tier has its time-driven trigger
installed yet — both run manually from the Apps Script editor until
reviewed live.

## Files, by tier

**Shared**
- `Config.js` — Config/Log tab access
- `AnthropicClient.js` — Claude Messages API wrapper (shared by both tiers)
- `Context.js` — runtime source for institutional-memory context (mirrors
  the `AEDILE_CONTEXT.*.md` files; Apps Script can't load `.md` at runtime)
- `SystemPrompt.js` — assembles each tier's system prompt from `Context.js`
- `Personality.js` — HTML message templates from the Personality tab

**Triage tier** (per-message, `scanInbox()`)
- `InboxProcessor.js` — scans unread mail, drafts/flags/no-ops
- `Threads.js` — Threads tab upsert (summary/entities/participants)
- `AEDILE_CONTEXT.triage.md` — the draft/no_action/flag judgment model

**Consolidation tier** (daily, `consolidateShards()`)
- `ConsolidationProcessor.js` — groups Threads rows into longer-lived Shards
- `Shards.js` — Shards/ConsolidationLog tab access
- `AEDILE_CONTEXT.consolidation.md` — the shard merge/split judgment model

**Shared context**
- `AEDILE_CONTEXT.core.md` — identity, Engine/Ritual split, voice, lore

## Config spreadsheet tabs

`Config`, `Log`, `Personality`, `Threads`, `Shards`, `ConsolidationLog` —
see `CLAUDE.md`'s guardrails section and the code comments in `Config.js`,
`Threads.js`, and `Shards.js` for exact column layouts.

## Kill switches

Two, independent: `AEDILE_ENABLED` (Script Property, gates `scanInbox()`)
and `CONSOLIDATION_ENABLED` (Config tab row, gates `consolidateShards()`).
