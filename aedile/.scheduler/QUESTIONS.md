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
  2. Whether `scanInbox`'s trigger was ever actually firing continuously
     (2026-07-17 audit finding, still unconfirmed) -- needs a human to
     check the Apps Script editor's Triggers page directly.
  3. `TESTING_MODE`'s current live state is unknown (no way for an
     unattended cycle to check the live script property) -- confirm
     it's off before assuming so, especially since a later run may
     repurpose it for real (non-test) director-loop use per
     `.scheduler/FOCUS.md`.
  > (answer inline here)

- **2026-07-25:** Renamed `TESTING_MODE` to `DIRECTOR_LOOP_OVERRIDE`
  throughout the code (`Context.js`, `SystemPrompt.js`,
  `InboxProcessor.js`) -- FOCUS.md's backlog item 2 asked for this once
  item 1 (a real director-loop nudge) confirmed the mechanism was being
  reused for production, but that confirmation itself needs live
  Gmail/Sheets access this unattended run doesn't have (see this cycle's
  report). Renamed anyway on the merits: the old name actively misled --
  a director enabling it for a *real* nudge, not a test, would see
  "TESTING_MODE"/"🧪" in both the script property and the log output.
  Behavior is byte-for-byte identical, so **the old `TESTING_MODE`
  script property (if it's currently set to `'true'` live -- still
  unconfirmed, see item 3 above) now has NO effect** -- if a director
  wants the override active, it needs to be re-set under the new name
  `DIRECTOR_LOOP_OVERRIDE` after this branch's next `clasp push`.
  Old item 3 above still stands, now doubly so: confirm the live value
  under the *old* name (harmless leftover either way) and, if the
  override is wanted, set the *new* one.
  > (answer inline here)
