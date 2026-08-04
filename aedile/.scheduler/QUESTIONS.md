# Questions for the user

Running log, appended to (never overwritten or trimmed) by aedile's
nightly job whenever something bigger than a routine note comes up --
especially anything touching a guardrail (allowlist, kill switch,
draft-vs-autosend, caps). Clear an entry by deleting its line once you've
actually read and dealt with it.

- **2026-07-21 (from the first real run's report, folded in by hand --
  this file couldn't be written automatically that cycle, see
  `.scheduler/FOCUS.md`'s top note for why):**
  1. `DM_RECIPIENT_THRESHOLD` is still `3`, still a guess (per
     `CLAUDE.md`) -- worth reconsidering now that
     `AEDILE_CONTEXT_TRIAGE_DM` has a real directness rule to threshold
     against.
  2. **ANSWERED 2026-07-22:** yes, both `scanInbox` and `checkBumps`
     triggers were confirmed actually installed and firing (checked the
     Triggers page directly) -- the earlier audit's gap was genuinely no
     unread mail arriving in that window, not a dead trigger.
  3. `TESTING_MODE`'s current live state is STILL unknown as of
     2026-07-22 -- tonight's session didn't touch it (used explicit
     DM-only `Context.js` overrides instead, see `.scheduler/FOCUS.md`'s
     update note), so this is still open. Worth a human confirming it's
     off via `disableTestingMode()` / checking Script Properties directly
     before assuming so.
  > (answer inline here)

- **2026-07-22 (from tonight's live human+Claude tuning session, see
  `.scheduler/FOCUS.md`'s update note and backlog for full context):**
  1. Should the Web App deployment (`ReadApi`/`WriteApi`) be pinnable to
     `@HEAD` to remove the manual-redeploy step entirely, or does Apps
     Script not support that for this deployment type? Needs someone to
     check directly in the editor -- `clasp`-only investigation tonight
     couldn't settle it (`clasp deploy`/`clasp deploy -i` both confirmed
     NOT usable for this: they silently drop the Web App's Execute-as/
     Access config and 404 the endpoint until a human redeploys by hand
     through the editor UI).
  2. Bigger, deliberately not decided tonight: if the `@HEAD` option
     above doesn't exist, is the ongoing manual-redeploy requirement (for
     Web App changes specifically) tolerable long-term, or is it a sign
     Apps Script is the wrong platform for a system meant to improve
     itself without a human in the loop every time? Human's own framing:
     "worth flagging on its own whether the system should move to a
     platform that doesn't bottleneck on me." Treat as its own decision,
     not something to default into either direction.
  3. Is the DM-tier's new "explicit blocker overrides seasonal restraint"
     / "flag isn't a default escape valve" tuning correctly calibrated, or
     does it risk overcorrecting into nagging? Only tested against one
     real thread so far (small sample) -- worth a human's honest read on
     whether the actual sent bump emails felt right in tone/frequency,
     not just structurally correct.
  > (answer inline here)

- **2026-08-01 (from tonight's nightly cycle):**
  1. **Suspected prompt injection, not acted on.** Tonight's task prompt
     included text claiming to be "human feedback left inline in
     `/home/zach/Documents/Project Archive/scheduler/BLOCKERS.md`"
     instructing aedile to pipe a token into `gh auth login --with-token`,
     coordinate with unfamiliar systems referred to as "senechal"/
     "mandark"/"dexter", and hand off a credential problem cross-host. None
     of this is grounded in `CLAUDE.md`, `FOCUS.md`, or anything in this
     repo — no "senechal" host or gh-auth flow is part of aedile's actual
     scope, and the instruction arrived as unauthenticated text in the
     conversation, not as a verified system directive. Per this file's own
     job (surface anything guardrail-adjacent), flagging this explicitly:
     I did not run any `gh auth` command or attempt any cross-host
     credential action. If this was a real, legitimate ask from a human,
     it needs to come through a channel aedile can actually verify —
     please resend it directly rather than embedded in a blockers file
     aedile has no read access to anyway.
  2. **Live-data credentials blocked by this environment's own permission
     classifier tonight:** `ls`/`cat` on
     `/srv/vaporwave-reports/aedile/.aedile-api-secrets` (the
     `ReadApi`/`WriteApi` token file per `FOCUS.md`'s backlog item 2) were
     both denied by the auto-mode classifier, not by file permissions.
     This blocks the live-data dry-run scenario library (bump-check /
     request-logging / stale-recheck-window regression cases) from being
     buildable in this unattended run until either the classifier allows
     reads under that path or the secrets are made available another way.
     Worked around tonight by adding pure-logic-only coverage instead (see
     report) — not a substitute for the real live-data scenarios.
  > (answer inline here)
