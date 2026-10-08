# Aedile

AI operations role for the Virtual Krewe of Vaporwave, running as a Google Apps Script
project under the krewe's own Workspace account. Rules and guardrails: [`CLAUDE.md`](./CLAUDE.md).
Tests: `aedile/test.sh`. Deploy: `aedile/deploy.sh "<description>"`.

## Script properties

- `AEDILE_ENABLED`: master switch for the two send actions (`sendReplyAll`,
  `sendDraft`). Drafting does not depend on it.
- `AUTOSEND_ENABLED`: second switch on the same two sends; off or unset means
  nothing sends.
- `AUTOSEND_ALLOWLIST`: comma-separated exact addresses and/or `@domain`
  suffixes. A send proceeds only when every participant on the thread matches.
  Must include Aedile's own inbox address.
- `READ_API_TOKEN`: gates `ReadApi.js`. Unset means every request is refused.
- `WRITE_API_TOKEN`: gates `WriteApi.js`, which can send. Separate from the
  read token so each revokes alone. `recap/call.sh` and `recap/redige.mjs`
  read both from the environment or the secrets file, never from source.

All five live in Project Settings > Script Properties.
`aedile/recap/call.sh get guardrails` prints the two switches, the allowlist
size and any installed trigger.
