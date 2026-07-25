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

Current focus (set 2026-07-20, human-directed -- supersedes "continue
whatever context-tiers was mid-way through" below until this is
resolved): **get the current summer director loop (Zach + Tyler) actually
moving.** They had one meeting; the open loops/action items out of it
haven't closed. This is a DELIBERATE, NARROW exception to the seasonal
"July/August is quiet, don't manufacture urgency" default in
`AEDILE_CONTEXT_CORE`/`AEDILE_CONTEXT_BUMP` -- the exception applies ONLY
to the closed director loop (Zach, Tyler, the krewe address), not to the
wider mailing list, which stays on its normal quiet-summer footing.

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

## Backlog (secondary to "Tonight's actual job" above until the director loop is closed)

**Roadmap set 2026-07-21 -- concrete enough to span the next several
cycles, not just tonight, since this file's own invisibility bug (see
top note) meant every prior cycle had nothing real to work from once
"tonight's actual job" above was addressed. Work top to bottom; each
item should be genuinely finishable in one cycle.**

1. **Director loop (still THE priority, still not actually done).**
   Tonight's real first run (2026-07-21) did NOT do this work -- it
   never saw this file (the bug this roadmap update fixes), and instead
   fell back to `CLAUDE.md`'s Open items, shipping a `LockService` race
   fix on `scanUnread()`/`checkBumps()` instead. That fix was good,
   real, and worth keeping -- but the actual "tonight's actual job"
   above (find the director meeting's open loops, draft bumps) is still
   fully outstanding.
   **2026-07-25: still outstanding, and now root-caused as a hard
   blocker, not just an unlucky miss.** Steps 1-2 of "tonight's actual
   job" above ("read the Log/Messages/OpenLoops tabs", "GmailApp.getThreadById")
   require live Google Sheets/Gmail access. This account's aedile job has
   never had that -- it's commit-only against a disposable git clone, no
   `clasp push`/`clasp open`/live API creds (see `CLAUDE.md`'s hard
   scope boundaries and every prior cycle's report). No unattended cycle
   of this job, as currently wired, can ever find real open-loop threads
   or draft a real bump against them -- that step needs either a human
   running it from the Apps Script editor, or this job gaining a live,
   read-only credential (a real design change, not something to default
   into unilaterally). Flagged in `.scheduler/QUESTIONS.md` and tonight's
   report rather than worked around.
2. **Rename the `TESTING_MODE` toggle if it's now serving real
   production behavior**, not just tests -- `Context.js`/
   `InboxProcessor.js`/`SystemPrompt.js` already flagged this
   themselves ("note in the report if repurposing a 'temporary testing'
   mechanism for real production behavior needs a rename/cleanup").
   Only do this once item 1 confirms whether the director-loop override
   actually ended up reusing that mechanism for real.
   **Done 2026-07-25, on the merits rather than waiting on item 1's
   confirmation** (which, per the note just above, this job can never
   produce on its own): renamed to `DIRECTOR_LOOP_OVERRIDE` throughout
   (`Context.js`/`SystemPrompt.js`/`InboxProcessor.js`) since the old
   name was actively misleading regardless of which use case ends up
   applying -- see `.scheduler/QUESTIONS.md`'s 2026-07-25 entry for the
   live-script-property implication (old `TESTING_MODE` value, if any,
   now has no effect; the override needs re-enabling under the new name
   post-deploy if wanted).
3. **Move aedile off the bespoke wrapper, onto `lib/sweep-loop-common.sh`
   directly** (queued via `scheduler -i` 2026-07-21, human's own idea:
   "could be as simple as running some functions before or after
   sweep-loop-common.sh nested inside"). Real constraints to design
   around, don't lose these while implementing: (a) must still ALWAYS
   PUSH + `gh pr create` afterward (the shared engine doesn't do this by
   default -- some post-push hook point would be needed), (b) must
   stay off `main`/never auto-merge to `context-tiers` (the engine
   defaults to a single `BRANCH` var and normal push -- would need a
   dated-branch-per-run pattern the engine doesn't have today), (c) must
   keep restricting itself to `aedile/` only in a repo that also
   contains unrelated `scribaSenatus`/`wavebucksCore`. If any of these
   don't fit cleanly, write up the gap in this file rather than forcing
   it — this is a real design question, not a mechanical migration like
   vkv-inventory's was.
4. **Confirm this file's fix actually worked.** After item 1 is done,
   note explicitly in the report that `aedile/.scheduler/FOCUS.md` was
   successfully read this cycle (closing the loop on tonight's bug) --
   don't just silently assume it, say so, so a human doesn't have to
   re-verify by hand.

No separate feature-request queue yet -- add ideas here as they come up.
Once the numbered list above is exhausted, fall back to: work
oldest-open-thread-first per `CLAUDE.md`'s design, or continue whatever
`context-tiers` was mid-way through.

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
