<!-- RETIRED SURFACE. NOTHING READS THIS FILE. Verified 2026-09-27, twice:

     1. `hf7y/scheduler`'s own `examples/schedule-entry.conf.template:38-42`
        on SCHEDULER_SUBDIR: "Retired surface: the FOCUS.md/QUESTIONS.md
        channel it named was sunset by #66/#234 and the queue is the repo's
        GitHub issues. Kept only so an old conf still parses."

     2. `bin/enrole-selfdev.sh:122-124` is a PRECEDENCE, not a list: a root
        `CLAUDE.md` is chosen first ("the live convention"), and only a repo
        WITHOUT one falls back to `.scheduler/FOCUS.md`. This repo has a root
        CLAUDE.md, so this file is never the brief -- not "read second",
        never reached.

     The header this replaces claimed the Tier 2 nightly-batch job "reads
     this FIRST". That was true when it was written (2026-07-21) and was
     retired 2026-08-07, seventeen days later. It then sat here asserting the
     opposite for seven weeks, and on 2026-09-26 a session wrote its entire
     handoff into this file on the strength of it -- into a dead letter box.
     That is the cost of a stale claim about who reads a file, and it is why
     this comment is the loud kind.

     WHERE THINGS ACTUALLY GO NOW:
       - durable project context  -> `aedile/CLAUDE.md` (the brief that IS read)
       - work, and anything a run should pick up -> GitHub issues, milestoned
       - a session handoff -> an issue, or a report under `~/reports/wavebucks/`

     This file is NOT yet reaped only because 26 KB of it has never been
     audited for facts that are still true and have no issue; that is
     media-arts-collective/wavebucks#24's remaining scope. Do not add to it.
     Nothing below is guaranteed current. -->

## Handoff 2026-09-26 (interactive session, Zach AFK at the end)

**The thing with a deadline: the build day is Sunday 2026-09-27 and the list
has never been told when or where.** A verified day-before notice is written
and waiting at `~/Documents/vkv-build-day-notice-2026-09-27.txt` (outside this
repo on purpose: it names three members, and `.gitignore`'s existing guard is
about exactly that). It passes `aedile/recap/checks.mjs` clean, 0 fail 0 warn,
gaps `[3,3,3,3]`. Time and place are Zach's, 2026-09-26, with 1pm/3pm
confirmed against the archive against his own initial "2 pm" (archive: 1pm x10,
3pm x5, 2pm x1; and his 2026-08-16 line, *"the usual 1pm Brunch 3pm meeting at
920 St. Mary"*). To post it, `createDraft` is in the `ask` list, so a human
sees the prompt:

```
aedile/recap/call.sh createDraft to=kreweofvaporwave@googlegroups.com \
  subject="<SUBJECT line from that file>" body="<BODY from that file>" \
  logLabel=headsup_draft_posted logNote="day-before notice for the 9/27 build day"
```

A first hand-written attempt was correctly rejected by Zach on sight for an
em-dash. `checks.mjs:159` makes that a **fail** ("the archive has two in 164
messages, and it reads as machine-written"). The lesson is mechanical: draft
prose goes through `runChecks` before a human is asked to look at it, never
straight from the model's hands.

**Why nobody knew about the build day.** Aedile has been blind since
2026-07-18. Two independent causes, both still open: `AnthropicClient.js:27`
sends `x-api-key` with the metered key, which is **out of credit** (the Node
brain moved to the subscription's OAuth credentials; Apps Script did not, and
that is #46's decommission, not a bug to fix by buying credits), and the hourly
trigger is **separately not firing** (`AEDILE_ENABLED` is on and a firing
trigger would log `error` rows; there are none between 2026-07-22 and
2026-09-08). The recap tier kept posting drafts from mandark through 09-14, so
the system looked alive.

**Landed this session.** #35 (`readInbox`/`readThread` live-Gmail reads on
`WriteApi`'s doPost, deployed v17/v18), #62 (`clasp push` no longer prompts),
#61 (`extractEmail` takes the last bracketed address, closing the display-name
allowlist spoof; 66 tests pass; saved Apps Script code verified by pulling the
executing copy back and diffing). `.claude/settings.json` is now committed as
project policy, and `/krewe-activity` encodes the search-live-mail-first method.

**Needs a human, in order:**
1. Send the Sunday notice (above). Today is the day before.
2. Three people owed replies on thread `1a07dabc90373a49` since 09-08: Lester
   (carpentry, 504 578 8677), Izze (tapes, 504-654-9886), Francesca (her friend
   `adam.scilk@gmail.com` wants on the list). Aedile would have bumped these.
3. Cut a version so `/exec` carries #61's fix: it still serves `@18`, which
   predates the commit, so a `scanInbox` call through `WriteApi` runs the old
   parse. `clasp version` / `clasp deploy` are in `ask`.
4. #60 — Zach 2026-09-26: *"lives somewhere realisateur could provision. I'm
   not sure."* Direction ruled, path open. Candidate and the file's actual
   contents are in that issue's comment. Needs his password either way.

**Still open, not urgent:** #54 (the `/exec` 302 flake, now measured at roughly
3 in 15 calls with today's evidence in the issue), #46, #45, #37, #38.

## Stability milestone

**Current:** the scenario library (`aedile/TestsLocal.js`) covers both of this project's known real bugs plus the validated live-data dry-run scenarios, proving out as the PR-review gate's actual replacement — so the nightly cycle can auto-merge on a clean scenario run instead of always waiting on a human, without losing the bug-catching/Tyler-visibility function the PR gate exists for today — status: in-progress
Done when:
- [x] `TestsLocal.js` exists as a fast, local, no-secrets regression suite (2026-07-22)
- [x] the recipient-completion bug encoded as a permanent regression case (2026-07-22)
- [ ] the stale-recheck-window bug (both director-loop threads stuck at `recheck_after_days=10`) also encoded as a regression case — the second of the two real bugs this session found. **Partially addressed 2026-08-01:** `OpenLoops._sanitizeRecheckDays`'s clamping guard (the one pure-logic piece of this failure mode) now has regression coverage in `TestsLocal.js`. This is NOT the actual bug regression case — the real bug was a model-judgment error (seasonal restraint overriding an explicit blocker), only reproducible against the real API with live `OpenLoops`/`Messages` data, which requires the `/srv/vaporwave-reports/aedile/.aedile-api-secrets` credentials. Tonight's run had those blocked by the environment's own permission classifier (see report), so the actual live-data scenario is still open.
- [ ] the already-validated live-data dry-run scenarios (5 bump-check + 3 request-logging cases, checked once against the real API per `CLAUDE.md`) preserved as a re-runnable suite via `WriteApi`'s `dryRun`/`ignoreDue` support, instead of one-off
- [ ] the nightly cycle actually runs `node aedile/TestsLocal.js` as step one of every scenario check (stated as the standing rule in this file's backlog item 2; not yet confirmed wired as an enforced invariant of the cycle itself)
- [ ] the merge-gate change (auto-merge to `context-tiers` on a clean scenario run, PR-and-hold otherwise) is implemented and validated against both known real bugs before it goes live — sequencing already decided by the user, not a new call: don't flip the gate until the library the gate depends on is itself proven

Ideas beyond this bar are PARKED by default (see
realisateur/STABILITY-MILESTONES.md): manual-alias-narrowing/archive-
misattribution detection (item 3 — real and flagged "conspicuous," but a
design decision away from being buildable, not urgent), the deploy-
awareness signal for the Web-App redeploy bottleneck (item 4), the
`mailto:` feedback link (item 5 — cheap, but not core), the September
DM→list-tier promotion review (item 6 — explicitly can't happen before
September regardless), and the human-facing digest doc (item 7 — "not
yet designed"). None discarded — all real, all past this specific bar.
*(Milestone drafted 2026-07-24 via realisateur's `/ideate`, human-
directed this pass — every checklist item above is this file's own
already-stated backlog item 2, formalized into a checkable bar, not new
scope. The scenario library was the user's own explicit prerequisite for
loosening the PR gate — this doesn't introduce that decision, it makes
its finish line checkable.)*

**Update 2026-07-22: the director loop this file was written to unblock
got real, substantial progress in a live human+Claude session tonight --
not from a nightly batch cycle.** Summary for whoever picks this up next:

- Found both currently-open director-loop threads via `ReadApi` (a
  read-only, token-gated Web App endpoint added tonight -- `ReadApi.js` --
  plus a paired `WriteApi.js` that can trigger `scanInbox`/`checkBumps` on
  demand, with a `dryRun`/`ignoreDue` mode for safely testing decisions
  against real data without side effects). Both threads' `recheck_after_days`
  were stuck at 10 (set 7/18, never bumped) -- root cause was the seasonal
  "dead month" restraint applying uniformly even to an explicit,
  self-stated blocker ("LOCK A BRUNCH DATE, nothing hits the list till we
  do"), and a second gap where the model defaulted to `flag` instead of a
  direct nudge just because the thread was director-to-director.
- Fixed via new DM-only context blocks (`AEDILE_CONTEXT_TRIAGE_DM`/
  `AEDILE_CONTEXT_BUMP_DM` in `Context.js`, `AEDILE_BUMP_PROMPT_DM` split
  out in `SystemPrompt.js`, `BumpChecker.js` now classifies audience per
  thread like `InboxProcessor` already did) -- explicitly DM-only, list-tier
  prompts deliberately untouched, see `CLAUDE.md`'s "DM vs. list-broadcast
  context" section.
- Validated dry-run against the real threads before shipping, then ran a
  REAL (non-dry) `checkBumps` -- both threads got a real `replyAll()`
  nudge proposing a concrete brunch-date window. **Confirmed by the
  director that Tyler received it but Zach did not** -- root-caused as a
  real bug (`thread.replyAll()`/`createDraftReply()` only address the
  LAST message's participants, not the full thread history the allowlist
  eligibility check uses) -- FIXED same night, see `CLAUDE.md`'s "Known
  bugs". A second, separate cause of the same symptom was also found and
  is NOT a code bug -- a human sent manually from the shared
  `kreweofvaporwave@` alias -- see `CLAUDE.md`'s new "conspicuous" bug
  entry on archive misattribution risk.
- This is now genuinely DONE for tonight, not just "attempted" -- don't
  redo it. What's NOT done and IS real backlog: everything in the new
  section below.

This is a co-owned repo (Zach + Tyler, Media Arts Collective) and a v0
email-operations bot with real safety guardrails already designed in --
see `CLAUDE.md`'s "Non-negotiable guardrails" section before touching
anything related to sending, draft generation, the autosend allowlist, or
the kill switch. Read `CLAUDE.md` in full before making changes; it is the
actual source of truth for scope and philosophy, not this file.

## Tonight's actual job

1. **Find the meeting's open loops.** Read the Log/Messages/OpenLoops tabs
   (`Config.js`/`MessageLog.js`/`OpenLoops.js`) and the raw archive for any
   thread(s) tied to the directors' meeting. If `OpenLoops` already has
   rows for them, that's the starting point. If nothing was ever logged
   for that meeting (plausible given the known "did `scanInbox` actually
   fire" bug in `CLAUDE.md`'s "Known bugs" section), that itself is a
   finding to report, not something to paper over.
2. **Prefer branching the EXISTING bump-checker flow over building
   something new.** `BumpChecker.js`/`AEDILE_CONTEXT.bump.md` already do
   exactly this shape of work -- revisit a flagged-open thread that's gone
   quiet and decide whether a nudge is warranted. The natural change is a
   narrow, explicit override (seasonal-restraint-suspended, like the
   existing uncommitted `TESTING_MODE` toggle in `Context.js`/
   `SystemPrompt.js`/`InboxProcessor.js` already does for testing) scoped
   to the director-loop thread(s) specifically -- not a new subsystem, and
   not a blanket change to bump behavior for the whole mailing list. If
   the existing `TESTING_MODE` mechanism is close enough in shape to
   reuse/adapt for this real (non-test) purpose, that's a reasonable
   starting point to evaluate -- but note in the report if repurposing a
   "temporary testing" mechanism for real production behavior needs a
   rename/cleanup to not read as a leftover test hack.
3. **Draft, don't send**, exactly as the existing guardrails require --
   nudging the director loop toward closure means producing a good draft
   bump/reply for a director to actually send, not auto-sending on their
   behalf, unless that specific thread is already within
   `AUTOSEND_ALLOWLIST`'s existing narrow terms (see `CLAUDE.md`).
4. **Never originate a new thread.** If no existing thread captures an
   open item from the meeting, aedile cannot invent one to bump (see
   CLAUDE.md's "never starts mailing-list threads" rule) -- flag that
   specific gap in the report/`QUESTIONS.md` instead of working around it.

## Every cycle must self-score against this goal

At the end of EVERY report from now on (not just tonight's), include a
short, explicit line: **did this cycle move Zach and Tyler closer to
closing the open loops from their meeting, and how** (a bump sent for
review, a loop confirmed closed, a genuine blocker found -- or "no
director-loop-relevant work found this cycle" if that's honestly the
case). This is a standing reporting requirement until a human says the
director loop is actually closed out, not a one-time ask.

## Hard scope boundaries for an unattended run

- **Only touch `aedile/`.** `scribaSenatus/` and `wavebucksCore/` are the
  old, separate Wavebucks-economy system in this same monorepo -- out of
  scope, don't read them for context unless `CLAUDE.md` explicitly says to
  (it references `../scribaSenatus/Personality.js`/`ServiceAdapters.js` as
  historical starting points).
- **Never weaken a guardrail.** Draft-only default, the `AUTOSEND_ALLOWLIST`
  restriction, the recipient allowlist, per-run/per-day caps, and the
  `AEDILE_ENABLED` kill switch are all deliberate and non-negotiable per
  `CLAUDE.md`. Extending/broadening any of them is a human decision, not
  something to default into -- write it up as a question instead.
- **Never deploy.** This run has no interactive `clasp` auth (same
  constraint as vkv-inventory's Apps Script deploys) -- commit only, never
  `clasp push`/`clasp deploy`.
- **Review-gated via GitHub PR, not a local unmerged branch (changed
  2026-07-21).** Everything lands as commits on a dated branch off
  `context-tiers`, and this run PUSHES that branch + opens/updates a PR
  for a human to review and merge -- nothing merges to `context-tiers`
  or `main` automatically, but it DOES reach GitHub now (human's explicit
  choice, over the old "leave it local" default, so review happens via a
  PR instead of a branch someone has to remember to look at locally).
  This is a co-owned repo; unlike the solo projects in this scheduler,
  changes here are visible to Tyler too.
- **Uncommitted local work may already be present** when a cycle starts
  (this project's working copy tends to carry WIP) -- that's expected;
  treat it as the starting point to build on/finish/commit, not something
  to discard or work around.

## Backlog (roadmap set 2026-07-22, supersedes the 2026-07-21 version below the note)

- **2026-07-25 19:19 (via `scheduler -i`):** We need to get creds for the disposable clone to do clasp stuff, or we need to elevate blockers like aedile's clasp problem to where zach can see them in blockers.md. Both. This was a failure because Zach did not see the missing clasp creds until he opened the report.

- **2026-07-25 19:16 (via `scheduler -i`):** See note in 7-25 report: the DIRECTOR_LOOP_OVERRIDE toggle needs to announce itself, to a user with no code access i.e. email kreweofvaporwave@kreweofvaporwave from itself with information like Change this Env Var to Do X Y Z. Noisy failure inside the end user environment is the only way. We must bake it in now as a core principle. The system needs to be fully configurable and interactive via the gmail interface. Gmail is the front door. It may send you to a sheet, it will rarely send you to apps script, and it should never send you to the code backend here.

**Work top to bottom; each item should be genuinely finishable in one
cycle. This whole list came out of tonight's live tuning session -- see
the update note above for what already shipped. Cross-reference
`CLAUDE.md`'s Open Items section, which has the fuller writeup for
several of these.**

1. **Batch-driven tuning loop -- the actual point of tonight's session.**
   The manual loop used tonight (read `OpenLoops`/`Log`/`Messages` via
   `ReadApi` -> spot a gap -> tune a DM-only prompt -> dry-run validate
   against real threads via `WriteApi` -> ship) should become something
   THIS nightly cycle does unattended, not something requiring a live
   human+Claude session every time. Concretely: pull `scope=requests
   &status=open` via `ReadApi` (the existing bug/feature-report channel,
   fed by ordinary director email -- nothing new to build there) as
   in-cycle context, same as any note a human drops via `scheduler -i`.
   Build a small, named, RE-RUNNABLE scenario library first (see item 2)
   so a prompt change can be regression-checked instead of judged fresh
   each time.
2. **Scenario library — DECIDED 2026-07-22 to become the actual PR-review
   replacement, not just a nice-to-have. FIRST PIECE NOW EXISTS:
   `aedile/TestsLocal.js`** (added 2026-07-22, run with plain `node
   TestsLocal.js`, no secrets/network needed) — a fast, local, pure-logic
   regression suite mirroring `scribaSenatus/TestsLocal.js`'s existing
   convention. Currently covers `getRecipientCompletion` (encodes tonight's
   real recipient-completion bug as a permanent regression case),
   `isAllowlistEligible`, and `classifyAudience`. **Every nightly cycle
   from now on should run `node aedile/TestsLocal.js` as step one of its
   scenario check** — if it fails, treat that as equivalent to a live-data
   scenario failing (push branch + open PR, do not auto-merge). This is
   necessary but not sufficient on its own: it doesn't cover the live-data
   dry-run scenarios (bump-check judgment, request-logging, DM voice/tone)
   described below, which still need building before the merge gate can
   switch on for real. **When you add or change logic in
   `InboxProcessor.js`/`BumpChecker.js`, mirror the change into
   `TestsLocal.js`'s inline copies or this suite will silently test stale
   logic** — same discipline `scribaSenatus`'s version already documents.
   Human's explicit call on removing the PR gate itself: the
   PR-review gate on the nightly batch (never-auto-merge) is tedious and
   not something he'll do regularly, so it's being removed — but NOT
   unconditionally (that was explicitly rejected as "full auto-merge, no
   gate at all"). The replacement gate is this scenario library: the
   batch runs it after any prompt/behavior change, and only auto-merges to
   `context-tiers`/`main` directly (no PR, no wait) if every scenario
   still passes — otherwise it still opens a PR (or holds/flags) for a
   human, same as today. Sequencing matters: DO NOT change the wrapper's
   merge behavior until this library exists and is itself validated
   against real known failures — specifically, both of tonight's real
   bugs (the recipient-completion gap, the stale-recheck-window issue)
   should be encoded as regression cases the library actually catches,
   proving the check works before it's trusted to replace a human. Scope:
   named, re-runnable dry-run test cases against real recent
   `OpenLoops`/`Messages` state (via `WriteApi`'s `dryRun`/`ignoreDue`
   support), covering: the 5 bump-check scenarios and 3 request-logging
   scenarios already validated once against the real API per `CLAUDE.md`
   (currently one-off, not preserved as a re-runnable suite), tonight's
   brunch-thread live case, and mining the raw mailing-list archive
   (`scope=messages&q=...` via `ReadApi`) for real historical "dropped
   ball" cases — threads that went quiet and never got picked back up —
   as a source of realistic regression scenarios, not just synthetic
   ones. Also score generated drafts against real archived list VOICE,
   not just correct action/JSON shape — tonight's real auto-sent bump got
   action/timing right but the director flagged its tone as not matching
   how the mailing list actually sounds. **Credentials for these live-data
   scenarios** (the `ReadApi`/`WriteApi` exec URL, `READ_API_TOKEN`,
   `WRITE_API_TOKEN`) live at `/srv/vaporwave-reports/aedile/
   .aedile-api-secrets` (shared, group-readable by `zach` and
   `svc-vaporwave` only, mode 640, NOT in git) — read from there, never
   hardcode or commit them. Rationale for keeping this gate contingent
   rather than flipping it now: the PR gate wasn't only
   protecting against risky email behavior (the allowlist/draft-only
   guardrails already bound that) — it's also the thing that catches
   non-runtime bugs (like both of tonight's) and gives Tyler, a co-owner
   of this repo, visibility into changes landing on shared code. Losing
   that requires something that actually replaces both functions, not
   just the human's attention span.
3. **Manual-alias-narrowing / archive-misattribution risk (see
   `CLAUDE.md`'s "Known bugs" -- marked OPEN, conspicuous).** A human
   sending manually from `kreweofvaporwave@` is indistinguishable in the
   raw archive from Aedile's own authored/sent output -- risks a future
   triage/bump call misattributing a human's words as Aedile's own prior
   commitment, and reads to an auditor as automated even when a director,
   not Aedile, actually wrote it. Proposed approach (not yet built, needs
   a design decision before implementing): cross-reference a
   `kreweofvaporwave@`-From message's `MessageId` against `Log` rows
   tagged `auto_reply`/`bump_auto_reply`; if a message from the krewe
   address has no matching Log row, it was very likely sent manually --
   mark it distinctly wherever it's surfaced (to the model in
   `buildThreadContent`/`buildBumpUserContent`, and to a director via
   `ReadApi`).
4. **Deploy-awareness signal, so the redeploy bottleneck stays tolerable
   without disappearing entirely.** `clasp push` alone updates the code
   real triggers run against (`@HEAD`) -- no redeploy needed for that.
   But the Web App deployment (`ReadApi`/`WriteApi`'s `/exec` URL) needs
   its OWN manual "New version" redeploy in the Apps Script editor every
   time either file changes, and `clasp deploy`/`clasp deploy -i` cannot
   do this (confirmed twice tonight -- it silently drops the Web App's
   Execute-as/Access config, breaking the endpoint with a 404 until a
   human redeploys through the editor UI by hand). Human's explicit
   decision tonight: stick with hand-deploy for this specific step, AS
   LONG AS scheduler can surface "a redeploy is waiting on you" somewhere
   the human actually sees it -- don't let this become an invisible
   bottleneck. Small, concrete mechanism to design: compare the code
   state as of the last `clasp push` against the currently-live Web App
   deployment's version, and if they've diverged, surface that via
   whatever channel scheduler already uses for "needs your attention."
   Also worth a quick check before building anything: whether a Web App
   deployment can be pinned to serve `@HEAD` directly (removing the
   redeploy ceremony entirely, while `clasp push` alone stays the human
   gate) -- verify this is/isn't possible before assuming the notification
   mechanism is the only fix available.
5. **mailto: feedback link on DM-tier bump/nudge emails.** Cheap addition
   to `decision.draft_body` generation in the DM bump path specifically:
   a `mailto:kreweofvaporwave@...?subject=Aedile feedback: ...` link so
   "too aggressive" / "wrong call" feedback rides the existing `Requests`
   pipeline (item 1 above) with zero new infrastructure. Discussed,
   agreed on, not yet built.
6. **September deliberate promotion review (DM lessons -> list-tier),
   before list traffic resumes in October.** `AEDILE_CONTEXT_TRIAGE_LIST`/
   `AEDILE_CONTEXT_BUMP_LIST` are UNCHANGED from before tonight, on
   purpose -- some of what got tuned for the DM tier is universal (the
   flag-vs-nudge over-routing was probably always wrong), some is
   deliberately NOT meant to generalize (the "this team is shy/distracted,
   don't assume organic re-engagement" override is calibrated to two
   specific co-directors; a ~40-person list has a very different risk
   shape, where Aedile manufacturing pressure is the worse failure mode).
   This needs an explicit, deliberate session, not silent inheritance --
   same category of decision as expanding the autosend allowlist. Idea
   floated but not yet decided/sent: email a reminder into the krewe
   inbox itself (so Aedile's own open-loop tracking picks it up and bumps
   it as September approaches) rather than relying on a human remembering
   -- `RecheckAfterDays` supports up to 60 days, comfortably enough
   runway from late July.
7. **Human-facing digest/summary doc (see `CLAUDE.md`'s "Deferred, not
   forgotten").** Idea, not yet designed: periodically summarize raw
   `Messages` dumps (the "we just dumped meeting notes into email
   knowing the bot would see it" pattern) into a human-readable doc/
   report, mirroring the `/srv/vaporwave-reports/aedile/` pattern this
   same nightly batch already writes for its own runs. Explicitly NOT a
   revival of the retired Threads/Shards tier -- this is a summary as an
   OUTPUT for a human to read, never fed back in as the model's own
   source of truth.

No separate feature-request queue beyond this list and the `Requests`
tab (item 1) -- add new ideas here as they come up. Once this list is
exhausted, fall back to: work oldest-open-thread-first per `CLAUDE.md`'s
design, or continue whatever `context-tiers` was mid-way through.

## Scheduling

**Changed 2026-07-21: no longer a Tier 2 paced participant on zach's own
account.** Migrated to run under a separate headless service account
(`svc-vaporwave`, its own Claude subscription, own independent crontab at
`0 3 * * *` daily) to distribute usage off zach's own quota -- entirely
outside this scheduler's `schedule/*.conf`/paced-governor control now.
Dedicated clone lives at `svc-vaporwave`'s
`~/.local/share/aedile-nightly-batch/repo`, refreshed via `git fetch` +
`git reset --hard` (now stash-guarded, not destructive to interactive WIP
-- see the wrapper script's own comments) each cycle, NOT a worktree off
zach's real checkout anymore.

## Fable review (2026-07-25)

<!-- Appended by realisateur/fable-like/inject-suggestions.sh. Full context: fable-like/FABLE_REPORT.md. Triage these like any dated entries; delete freely. -->

- **2026-07-25 (fable-review):** silently orphaned since 2026-07-20 (svc-vaporwave crontab never installed) — the 15-minute human step is the sole blocker for real email ops; surface its AGE daily until done
- **2026-07-25 (fable-review):** two flagged one-liners still unapplied: SCHEDULER_SUBDIR=".scheduler" missing from schedule/aedile.conf (milestone-audit misreports "no focus" every pass) and scheduler's questions/aedile.md symlink pointing at the wrong file — apply on sight; known-wrong survey output trains everyone to ignore the survey
