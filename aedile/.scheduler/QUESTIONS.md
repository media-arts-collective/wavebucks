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

- **2026-07-27 (tonight's cycle, could not complete "Tonight's actual job"
  in `.scheduler/FOCUS.md`):** Step 1 (find the director meeting's open
  loops via `ReadApi`) requires the live `ReadApi`/`WriteApi` exec URL and
  tokens at `/srv/vaporwave-reports/aedile/.aedile-api-secrets`. This
  cycle's own harness (the auto-mode permission classifier, not a
  guardrail in this codebase) blocked reading that secrets file outright
  — denied before any content was seen, so no secret leaked, but it also
  means this and every future svc-vaporwave nightly cycle cannot use those
  credentials unless that classifier is given a standing allowance for
  this specific file/path. Flagging per FOCUS.md's own item-1 backlog note
  (2026-07-25: "elevate blockers like aedile's clasp problem to where zach
  can see them in blockers.md") — same shape of problem, different
  credential. Until resolved, this account can only do the local,
  no-credential half of the scenario-library work (`TestsLocal.js`), not
  the live-data dry-run half FOCUS.md's backlog item 2 depends on, nor
  tonight's specific director-loop check.
  > (answer inline here)
