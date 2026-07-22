<!-- Per-project "what's live right now" marker -- aedile's Tier 2
     nightly-batch job reads this FIRST. Registered with the scheduler
     2026-07-20. Moved here from aedile/.claude/FOCUS.md 2026-07-21 --
     that path was gitignored (.claude/ = "per-developer local state" by
     repo convention), so NO unattended run ever actually saw this file:
     a fresh clone never had it (never committed), and even the old
     worktree-based wrapper didn't inherit it (git worktrees don't
     inherit ignored/untracked files from another worktree either).
     Confirmed by tonight's real run's own report: "aedile/.claude/
     FOCUS.md was missing." This location is now tracked/committed
     normally, matching the scheduler's own already-proven
     SCHEDULER_SUBDIR pattern (outside .claude/, both git-trackable and
     exempt from the harness's .claude/-write block -- QUESTIONS.md
     writes were ALSO failing for that second reason, now fixed too). -->

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
   each time. Keep actual prompt edits going out as a reviewable PR (this
   project's existing review-gate), at least until there's a track record
   of the diagnostic side being reliable -- don't remove that gate as a
   side effect of automating the diagnosis.
2. **Scenario library.** Named, re-runnable dry-run test cases against
   real recent `OpenLoops`/`Messages` state (via `WriteApi`'s
   `dryRun`/`ignoreDue` support), covering: the 5 bump-check scenarios and
   3 request-logging scenarios already validated once against the real
   API per `CLAUDE.md` (currently one-off, not preserved as a re-runnable
   suite), tonight's brunch-thread live case, and mining the raw mailing-
   list archive (`scope=messages&q=...` via `ReadApi`) for real historical
   "dropped ball" cases -- threads that went quiet and never got picked
   back up -- as a source of realistic regression scenarios, not just
   synthetic ones. Also: score generated drafts against real archived
   list VOICE, not just correct action/JSON shape -- tonight's real
   auto-sent bump got action/timing right but the director flagged its
   tone as not matching how the mailing list actually sounds.
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
