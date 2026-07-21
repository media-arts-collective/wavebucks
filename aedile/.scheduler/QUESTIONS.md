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
