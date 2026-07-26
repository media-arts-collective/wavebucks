# Blockers for a director

Running log of things that stop the nightly batch job cold — not "open
questions" (which can wait), not "deferred by choice." Each entry here is
something *this job structurally cannot do itself* and needs a human
action before the underlying work can proceed. Mirrors `QUESTIONS.md`'s
append-only convention: never overwritten or trimmed, clear an entry by
deleting its line once actually dealt with. New per human feedback on the
2026-07-25 report ("It's going to be forgotten... This is a blocker. It
should have been tagged so Zach would see it") — this file didn't exist
before tonight; two structural findings from the last several cycles are
recorded below rather than left buried in report prose.

- **2026-07-26: this job cannot send the `DIRECTOR_LOOP_OVERRIDE` rename
  notification email itself.** The 2026-07-25 report flagged that the
  `TESTING_MODE` → `DIRECTOR_LOOP_OVERRIDE` rename (see that report,
  archived under `~/reports/aedile/2026-07-25.md`) needs an email to
  `kreweofvaporwave@kreweofvaporwave.com` so the toggle rename doesn't get
  silently forgotten before a director next wants to use the override.
  Tonight's cycle confirmed directly that this job cannot do that itself:
  a Gmail MCP tool call (`search_threads`) was blocked outright by this
  environment's own auto-mode classifier, and separately, this job's own
  scope (`CLAUDE.md`: no `clasp push`/`clasp deploy`, no live Gmail/Sheets
  credentials) never authorized live mailbox access in the first place —
  this isn't a new restriction, it's the same access wall the "Root-caused"
  section of the 2026-07-25 report already hit for the director-loop-bump
  work below, just confirmed a second, independent way tonight. **Ready-
  to-send text, for a director to paste and send by hand** (or have their
  own interactive Claude session send) from the krewe account:

  > Subject: Aedile toggle renamed — TESTING_MODE is now DIRECTOR_LOOP_OVERRIDE
  >
  > The script property that suspends Aedile's seasonal "dead month" restraint
  > for direct director-loop replies (Zach/Tyler/the krewe address only) was
  > renamed from `TESTING_MODE` to `DIRECTOR_LOOP_OVERRIDE` on 2026-07-25, to
  > match what it's actually used for. If `TESTING_MODE` was ever set to
  > `'true'` in Script Properties, it now has no effect. To get the same
  > behavior going forward, set `DIRECTOR_LOOP_OVERRIDE` to `'true'` (or call
  > `enableDirectorLoopOverride()` from the Apps Script editor) after the next
  > `clasp push`. See `aedile/CLAUDE.md` and the 2026-07-25 nightly report for
  > full context.

- **2026-07-25/26: this job cannot find or bump real open director-loop
  threads.** Carried forward from the 2026-07-25 report's "Root-caused"
  section — FOCUS.md's actual priority (find the open loops from the
  Zach/Tyler meeting, draft bumps) requires reading the live `Log`/
  `Messages`/`OpenLoops` sheet tabs and calling `GmailApp.getThreadById()`
  against the real inbox. This job is a disposable git clone with no
  `clasp push`/`clasp open`/live API credentials, and per tonight's own
  test above, Gmail MCP access is also blocked by this environment's
  classifier even where it exists. As currently scoped, no unattended
  cycle of this job can complete this step — it needs a director to either
  grant a scoped live credential, run the discovery/bump step themselves
  in the Apps Script editor or an interactive session, or explicitly
  accept this stays a manual task indefinitely. See `QUESTIONS.md` item
  2026-07-22 #2 for the same gap phrased as an open question rather than a
  blocker — kept in both places on purpose since the earlier phrasing
  under-signaled how hard a stop this is.
