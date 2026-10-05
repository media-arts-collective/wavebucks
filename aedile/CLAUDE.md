# Aedile — Project Context

> **Doc review in progress (2026-09-13).** Parts of this file predate the
> brain-in-repo migration (milestone #2) and may be stale; broader cleanup is
> tracked in #49. Verify claims against `main` before relying on them.

## What this is
Aedile is an AI operations role for the Virtual Krewe of Vaporwave, an
eleven-year-old Mardi Gras krewe run by the nonprofit Media Arts Collective
(co-directors: Zach and Tyler). This project is an Apps Script implementation
of that role, forked from an earlier system called **Scriba Senatus**
(see `../scribaSenatus` in the `wavebucks` repo), which handled email-driven
commands for the krewe's old spendable-Wavebucks economy.

Aedile is a narrower, more deliberate rebuild — not a resurrection of Scriba
Senatus's full command set.

## The problem this solves
The krewe's apparent self-organization was historically sustained by a
founder, Abraham, now retired. Neither director has the bandwidth to
replicate what he did by hand. **Four prior automation attempts have failed**
— each one relocated the hidden human-operator labor rather than eliminating
it (e.g., a human still had to notice mail arrived, open a tool, and prompt
it). Aedile is designed to actually occupy that operator slot.

## The core design split: Engine vs. Ritual
This distinction governs every decision in this codebase.

- **Engine work** (Aedile's job): tracking, scheduling, reminders,
  bookkeeping, recurring drafts, institutional memory, logging. Mechanical,
  repeatable, no taste required.
- **Ritual work** (humans only, always): theme decisions, taste, conflict
  resolution, valuation, anything requiring judgment about what the krewe
  *should* value. Aedile never makes these calls, never simulates having an
  opinion about them, and never nudges toward a particular outcome.

When in doubt about whether a feature belongs in this codebase: if it
requires taste or would take a side in a human disagreement, it doesn't.

## Non-negotiable guardrails (v0 and for the foreseeable future)
- **Draft only, with one narrow, explicit exception: the director
  allowlist.** By default every code path that produces outbound text ends
  in `msg.createDraftReply()`, never `.reply()`/`.replyAll()`/`.sendEmail()`.
  This remains the primary safety margin during the trust-building period —
  don't weaken it for convenience, and don't add an ad hoc "just this once,
  auto-send" branch outside the mechanism below.

  The one sanctioned exception (`InboxProcessor.isAutosendEligible`) lets a
  `draft_reply` decision auto-send via `thread.replyAll()` instead, but only
  when **all** of the following hold:
  - `AUTOSEND_ENABLED` script property is `'true'` (separate from
    `AEDILE_ENABLED` — a director can kill just this capability without
    disabling scanning/drafting entirely).
  - Every participant (From/To/Cc, every message in the thread) matches
    `AUTOSEND_ALLOWLIST`, a comma-separated script property of exact
    addresses and/or `@domain` suffixes (e.g. `zach@nomac.org,@nomac.org`).
    A single participant outside the allowlist — any third party CC'd in —
    disables auto-send for that whole thread; it falls back to a draft.
    The allowlist must include Aedile's own inbox address explicitly (no
    self-detection) and is managed entirely via Project Settings > Script
    Properties, not in code.
  - `MAX_AUTOSEND_PER_RUN` (5) hasn't been hit yet this run — a tighter,
    separate cap than `MAX_MESSAGES_PER_RUN`, since auto-send has no human
    review step between decision and delivery.

  This exists to test live with the directors themselves in a fully
  closed loop (only Zach/Tyler/the krewe address on the thread) before
  ever considering it for the general mailing list. Don't broaden the
  allowlist's reach (e.g. matching on thread content instead of exact
  participants, or applying it to `flag`) without treating that as the
  same category of decision this was — flagged and reasoned through
  explicitly, not defaulted into.
- **Label, don't mark as read.** Processed threads get a tracking label;
  the unread flag stays untouched. Directors rely on unread-as-signal.
- **Recipient allowlist, on the paths that send.** Never let generated
  content introduce a new recipient to a *reply*. To/Cc stays limited to
  existing thread participants or a small hardcoded set (currently: Zach,
  Tyler). **`WriteApi`'s `createDraft` originate form is deliberately
  outside this** — it passes `params.to` through unchecked, because a draft
  cannot leave without a human opening and sending it, and the caller that
  uses it (`MeetingRecap`/`redige.mjs`) hardcodes the list address. Zach,
  2026-09-25: *"drafts are safe by construction."* This paragraph used to
  state the rule unconditionally, which read as though the code enforced it
  everywhere; it does not, and the gap was the sentence rather than the
  code (#61). Distinct from `AUTOSEND_ALLOWLIST`
  above — this rule is about never *adding* an unexpected recipient to a
  reply; that one is about whether the *existing* participants are safe
  enough to skip human review entirely.
- **Per-run and per-day caps**, enforced in code, not just by good intentions.
- **Kill switch** via Script Properties (`AEDILE_ENABLED`), checked first in
  every trigger-invoked function, so either director can pause everything
  without touching code.
- **Log everything** — thread ID, timestamp, action, one-line reasoning — to
  the Log tab. This is the primary tool for evaluating whether Aedile's
  judgment is any good, so undecorated logging matters more than clever code.

## Ownership model
Aedile runs under the krewe's own Google Workspace seat
(`kreweofvaporwave@kreweofvaporwave.com`), inside the `nomac.org` Workspace
that both Zach and Tyler administer. **Not** a personal account, and not
`scribasenatus@gmail.com` (the old system's account — ownership unclear,
outside the Workspace, exactly the single-point-of-failure pattern this
project exists to avoid). Config/Log data lives in a spreadsheet owned by
that same account, not a director's personal Drive.

## Outbound genres: what is wired, and why you must not hand-write one
**(2026-09-26)**

`aedile/recap/redige.mjs` writes outbound list mail. It takes `--genre`:

- `recap` (`AEDILE_CONTEXT.recap.md`) — what a meeting settled. Numbered,
  digest-length.
- `headsup` (`AEDILE_CONTEXT.headsup.md`) — a gathering. Terse, **unnumbered**,
  two beats (`lock-in`, `nudge`), and `--event-date` is REQUIRED because Node
  computes the lead time so the model never has to know today's date.

`AEDILE_CONTEXT.headsup.md` was written 2026-09-13 and sat unwired until
2026-09-26. In between, two sessions produced heads-up mail by hand-writing prose
into `call.sh createDraft`, which is how a numbered, digest-length notice with a
`1.`-prefixed subject reached the drafts folder under a spec whose own text says a
single-venue heads-up should not be numbered. **A spec no code reads is a
document, not a rule.** Do not hand-write a body and post it: generate it, let the
checks grade it, then post the saved decision.

### Every draft for review is a redline, not a clean copy (2026-09-28, human-directed)

> **SUSPENDED 2026-10-05. Do not build a redline draft.** Zach, on meeting the
> four redlines a week later: *"the scheduled delete and repush of drafts was a
> complete failure. these drafts are useless with all this markup"*. This
> section's own last paragraph names that outcome as the point where the
> convention "needs rethinking, not patching". Until he re-rules: a draft is a
> clean body a human can send as-is, and aedile's proposed changes and
> questions go in the chat or the issue, not in the mail. What follows is the
> record of what was tried (#77), not an instruction.

Zach: *"repush drafts as I wrote them with inline additions yours in another
color and the date/time I had scheduled at the top of the draft as well. That
should be how drafts look in general from now on."*

So a draft aedile puts in front of a human carries three things a clean body does
not:

1. **A header box**, first thing in the body: the date and time the beat was (or
   should be) armed for, the recipient, a colour legend, and `DELETE THIS BOX
   BEFORE SENDING` as its first line.
2. **The human's text exactly as they wrote it.** Not regenerated, not
   re-flowed. Blank-line gaps especially — `dealGap` measures them and the
   archive's spacing is a device, so a draft that silently re-wraps destroys the
   thing being reviewed. `white-space:pre-wrap` preserves it.
3. **Redline marks**: additions in red, proposed cuts struck through in grey.
   A question aedile will not answer for itself goes in a red-bordered box that
   says it is a question, not an edit.

**This forces `htmlBody`, which cuts against #20 and against the plain-text rule
in the outbound-genres section above** — the archive has no markup, and a recap
posts plain text on purpose. The two are reconciled by the header box, not by
exception: the markup is *scaffolding a human removes*, and the box's own first
line is the instruction to remove it. If a review draft ever gets sent with its
box intact, that reconciliation has failed and the convention needs rethinking,
not patching.

**Why the armed time has to be in the body.** Gmail's scheduled send cannot be
created or edited through any API (wavebucks#74), so cancelling a beat to revise
it *destroys the only record of when it was meant to go*. `trashMessage` cancels
cleanly — proven 2026-09-28 — but the send time is Google's, not ours, and it
does not survive the trash. Carrying it in the body is what makes cancel/revise/
re-arm a loop a human can actually close.

Done by hand the first time, for three beats on 2026-09-28. Mechanising it into
`redige.mjs` and the `createDraft` sink is wavebucks#77.

`checks.mjs` is **genre-gated** (`runChecks(d, notes, vault, { genre, beat, leadDays,
hand })`) and defaults to `recap`. For a heads-up the sign-off drops to `warn`, the two
spacing checks are skipped, and the exclamation exemption applies only below 150
characters. What does NOT relax: invented names, invented figures, invented **pronouns**
(a gendered pronoun the input does not supply blocks, because guessing misgenders a
member), the em-dash, `temporal-mismatch` (the day-word must match the computed lead
time), `stub-items` (a numbered item under 5 words), and never signing `MS`.

**A dealt device is not a checked property.** `numbered-headsup` and `no-caps` briefly
lived in `checks.mjs` and warned at drafts whose own dealt hand had told them to number
and to shout. Both are gone for this genre. Whatever `devices.mjs` deals, `checks.mjs`
does not grade -- except `hand-ignored`, which checks the hand was *followed*, which is
instruction-following rather than a rate.

**The heads-up form is computed, not written.** `analysis/headsup-form.mjs` measures it
from the corpus every run and `redige.mjs` splices the result; `AEDILE_CONTEXT.headsup.md`
keeps only the genre's purpose and the beats' functions. Its Form section was deleted
because it was wrong twice in one session in the same direction (it called both beats
"terse" against a 173-word median, and said numbering "is NOT a lock-in trait" against
50%). Every rate is checked three ways before it may become an instruction -- target
pool, a differently-drawn neighbour pool, and a Wilson interval -- and an interval
spanning 50% is reported as undecidable rather than rounded into a rule.

Device rates for a heads-up are **pushed in** from `measuredRates()`, not tabulated.
That table has been wrong three ways: first `GENRE_OFF`, devices forced to false on the
strength of prose; then `GENRE_P`, the same rates as literals I typed after reading the
report; now the measurement itself. Only the third survives a corpus change.

**EVERY RATE IN THIS SECTION AND IN `devices.mjs` IS A LOWER BOUND.** 28% of
`messages.jsonl` is a ~101-character Google Groups preview rather than a body (31% if
the band is drawn at 80-101 characters, as `ingest.py --audit` draws it -- same pool,
different edge, and the conclusion holds either way), and the
truncation is strongly length-biased: 62% of messages 111-1000 characters long were
truncated, 75% at 1001-3000, 94% above 3001. A snippet is cut before the sign-off, the
closing exclamation and the later numbered items, so it votes "trait absent" for every
trait that lives late in a message. `isFullBody` in `analysis/corpus.mjs` excludes them
now, which raised the length target from 134 words to 173 and the exclamation rate from
94% to 100%.

**Re-deriving these rates from the OLD `messages.jsonl` will NOT correct them** -- the
same pool reproduces the same bias. The fix was never a second mailbox: it is reading the
group's own topic pages, which `aedile/analysis/scrape-topics.py` now does
(2026-09-27). A collapsed message on a topic page renders masked and truncated exactly
like a list preview, so the scrape clicks `Expand all` first; see that file's header.

**Partially corrected, and the direction was a surprise.** At 239 of 628 topics (38%
coverage) the snippet band falls 343 -> 288 of 1171 rows, subjects go 0 -> 368, null
addresses 325 -> 262 and ellipsized authors 802 -> 558. But the length target moved
**DOWN**, 173 -> 164 words, with the lower quartile falling 96 -> 64. The prediction here
was that 173 was a floor and the true figure was above it, on the argument that truncation
is length-biased and the survivors are the short ones. That argument is sound and still
produced the wrong direction, because replacing a snippet with its real body also admits
genuinely SHORT announcements that `isFullBody` had been dropping. So 173 was not a floor.
No property verdict changed, which is the reassuring half: the form conclusions survived a
38% corpus change intact. **Nothing has been adopted from the new corpus** -- the rates in
`devices.mjs` and `formBlock()` still read the vault copy, and moving them is a decision.

Finishing the scrape is blocked on a live session, not on code: Google invalidated the
exported container credential mid-run (every Google property bounced to the account
chooser with all five auth cookies present and freshly re-exported), which on ~250
headless page loads in 90 minutes reads as an anti-automation revocation. Re-signing the
`kreweofvaporwave` Firefox container in restores it and the ledger resumes.

Two rules the corpus turned out not to support, both deleted:

- The subject doctrine (#30). `messages.jsonl` has **no subject field**; the scraper
  built thread titles from body first lines, and 448 of 542 comparable titles are the
  body opening verbatim with nearly all the rest differing only in apostrophes. They are
  truncated at slug length too ("Bring bri" for "Bring brilliant, unwieldy ideas"). Of 31
  real subjects recovered from live Gmail, **0** begin `N. ` and 0 restate the body
  opening. The prompt rule and the `subject-body-mismatch` check are both gone, and
  `dealSubject` deals subject FEATURES at rates measured over those 31 -- successor-era
  only, which was forced when Abe-era subjects existed in no store. **They exist now**:
  the topic scrape put 186 Abe-era operator subjects in the corpus at 38% coverage, and
  `subject-shapes.mjs` reads them (`corpusSubjects({ until: 2024 })`). `N. ` is 0 of 186,
  so #30's deletion holds on a six-times-larger denominator spanning the era it was
  missing.

  **The weights `dealSubject` uses are drawn from the wrong era, and one is badly wrong.**
  Same detectors, the 12 logistics-carrying subjects the weights come from against 112
  Abe-era ones: `calDate` 58% -> **2%**, `bang` 8% -> 44%, `lowerOpen` 8% -> 29%,
  `clockTime` 50% -> 26%, `dayWord` 75% -> 94%, carries-logistics 39% -> 60%. The
  generator is taught to put an `M/D` in a subject at 58%, off roughly seven specimens,
  against 2% of 112. Not yet changed -- re-weighting is Zach's call, and only the `<=2024`
  slice is clean anyway (`isOperator` matches aedile's own sends and no `--mark-aedile`
  pass runs behind that loader; aedile did not exist before 2026, so the Abe slice needs
  no filter).

  **Do not build a generator on those 31.** They refute a rule; they are far too thin
  and too skewed to source one. Only 10 of 31 carry a day, time or date at all (32%,
  counting a day word, a clock time, `tonight`/`today`, or `M/D`/`Nth`; a looser regex
  scores 12 of 31, and both definitions are in the code beside their numbers). Median
  length 28 characters, range 8-63. Reading event-shaped specimens out of a mailbox by
  eye overstated exactly this, twice, in one session. If a rate off this set travels,
  the denominator and the definition travel with it.

  Two of the 35 raw thread-starters were unsent DRAFTS, not list mail -- Gmail's
  `list:` operator matches drafts addressed to the group, so `--gmail` ingested text
  nobody had read. `ingest.py` excludes them at the source now. It is the same error as
  counting aedile's own sent mail, one step earlier and worse in kind, because a draft
  may never go out at all.
- The three-blank-line default (#27). Now a per-email draw (`dealGap`) at the measured
  54/34/11 for a recap and 42/40/18 for a heads-up, not an instruction. Zach:
  *"defaulting to 3 spaces as a rule is wrong, it should be stochastic."* The
  distribution itself stays UNVERIFIED as a human habit; #27 has the 2020 regime change,
  and a cross-source body comparison shows the two renderings diverge past 60 characters,
  which is consistent with re-flow and does not establish it.

**Before teaching the generator any new trait, check its provenance against a
source outside the scrape.** Non-breaking spaces, gap sizes and subjects all read
as strong authorial signal and all three were the pipeline.

`figures()` was blind to ordinal dates (`27th`) and spaced times (`1 pm`) until
2026-09-26, so `invented-figure` — a blocking check whose whole job is to stop a
made-up date or time — never examined the date or either time of a day-before
notice. Fixed, with cases. If you add a figure format, add a case.

## Voice
The voice carries over close to verbatim from Scriba Senatus — dry,
deadpan, memory-invoking, in the tradition of Abraham's own register —
codified in `AEDILE_CONTEXT_CORE` (`Context.js`), not a separate templates
file. (An earlier `Personality.js`, reading HTML templates from a
`Personality` tab, was deleted as dead code — it had zero call sites and
was never wired into draft generation.) Same entity in a different
register, not a performed character. AI involvement doesn't need explicit
disclosure; the krewe's existing aesthetic (Scriba Senatus's own
cyborg-narrator lore) already makes this on-brand.

Two behavioral rules tied to voice:
- Aedile may **originate** krewe-wide announcements (e.g. gathering
  heads-ups) — which is what the operator historically always did (97% of
  past announcements were new-subject thread-starters, per the mailing-list
  archive). The safety boundary is **not** a ban on originating; it is
  **draft-only: aedile drafts, a human sends, and it stays that way until a
  flag explicitly changes it** (same posture as `AUTOSEND_ENABLED`). The
  earlier "never start threads" rule was scoped to internal working-group
  ops flow, not list-wide announcements, and was removed 2026-09-13. See #49.
- Observe seasonal rhythm: July is historically silent (low activity
  expected/correct); October–February is live season.

## What was deliberately left out of this fork
The old Scriba Senatus lexicon (`CAUSA`, `VOTE`, `RESOLVE`, `COMMISSIO`,
`ACCEPT`, `COMPLETE`, `TRANSFER`) is **not** ported into this version. That
command set belonged to a spendable Wavebucks economy that's being retired
in favor of decoupled passive accrual (₩1/day for mailing-list membership,
functioning as a presence pulse, feeding an annual patch-eligibility
decision rather than being spendable for power). Don't resurrect these
commands without an explicit decision to do so.

A confederate account posing as a peer member was proposed and rejected
during design — it would manufacture synthetic social proof and corrupt the
signal the system exists to observe. Don't build anything that simulates
being a human member.

## Current status
v0 skeleton: inbox scanning, dedup, logging, kill switch, trigger
installation. `reviewMessage()` calls Claude (`AnthropicClient.getJsonDecision`,
`UrlFetchApp` to `api.anthropic.com/v1/messages`) with the current thread
plus institutional-memory context, and acts on the model's decision —
`draft_reply` creates a Gmail draft (`createDraftReply`, gated behind all
the guardrails above), `flag` adds the `aedile-flagged` label for a
director to judge, `no_action` just logs.

### Institutional memory: raw log + hand-curated context, not a summary pipeline

An earlier design ran every reviewed thread through a `Threads` tab
(model-derived summary/entities/participants) feeding a daily `Shards`
consolidation pass (`ConsolidationProcessor.js`) that fuzzy-matched related
threads into longer-lived groupings. That pipeline has been **retired** —
`Threads.js`, `Shards.js`, and `ConsolidationProcessor.js` are gone, along
with `AEDILE_CONTEXT.consolidation.md`. It was replaced by:

- **`MessageLog.js`** — an append-only `Messages` tab holding the raw
  mailing-list archive. Every message `reviewMessage()` looks at gets
  appended here regardless of the triage outcome (draft/flag/no_action/
  error) — this is ground truth about what arrived, independent of whether
  any given model call succeeded.
- **A rolling 12-month window** of that raw log, injected verbatim
  alongside the thread under review on every triage call
  (`InboxProcessor.buildUserContent`, `MESSAGE_LOG_WINDOW_DAYS`). Chosen
  over "inject the entire ever-growing archive" because the archive is
  already ~172-230k tokens after ~6.8 years at ~25k tokens/year of growth —
  already at or past a standard 200k-token context budget once the system
  prompt and current thread are added, so unbounded injection wasn't
  viable without either committing to an extended-context model or
  bounding the window. A 12-month window also isn't arbitrary — it matches
  the krewe's own annual cadence (the ₩1/day accrual described above feeds
  an *annual* patch-eligibility decision), and it keeps per-call token cost
  flat forever regardless of how large the archive eventually gets.
- **`Context.js`'s hand-curated blocks** (`AEDILE_CONTEXT_CORE`/`_TRIAGE`)
  carry forward whatever's durable from *outside* that rolling window —
  they're what "distills" everything older than 12 months, rather than a
  live per-thread summarization tier trying to do it automatically.
- **`aedile/holon_fold.py`** — a standalone, not-yet-wired-in Python
  experiment testing whether unsupervised entity-clustering over the raw
  archive reveals a natural hierarchy depth. A possible future *offline*
  source of new hand-curated context entries (proposed for human review,
  not auto-applied) — not part of the runtime path, and not a reason to
  reconsider the two points above.
- The historical archive has already been imported into the `Messages`
  tab, **defect and all** — measured 2026-09-26, 489 of the 500 newest rows
  are legacy-imported and 0 of those carry a Subject. `aedile/analysis/
  ingest.py` is the replacement for the scraper that vanished; it merges
  sources rather than replacing, and `--audit` reprints every number this
  file quotes. The original `messages.jsonl` export and the scraper that
  produced it are gone (migration's done — see `README.md`'s "Historical
  archive import" section for what re-running this would take). The
  `Personality`/`Threads`/`Shards`/`ConsolidationLog` sheet tabs themselves
  are left in place (orphaned, not auto-deleted) since they hold historical data a
  director may still want.

### Bump-check: closing open loops without a fixed nag schedule

A second, independent daily tier (`BumpChecker.js`, `checkBumps()`) revisits
threads that have gone quiet after being flagged as an open loop. The
regular triage call (`AEDILE_CONTEXT_TRIAGE`) now returns `open_loop`
(bool) and `recheck_after_days` (int) alongside its usual
action/reasoning/draft_body — the model's own judgment about whether *this
specific* message leaves something unresolved, and how many days of silence
on *that* ask would warrant a check-in, rather than a single hardcoded
staleness threshold in code. `InboxProcessor.reviewMessage()` upserts this
into a new `OpenLoops` tab (`ThreadId | Open | LastMessageDate |
RecheckAfterDays | NextCheckDate | LastBumpDate | UpdatedAt`) — pure
bookkeeping, not a revival of the retired Threads/Shards summarization tier
(no summary/entities/participants, no fuzzy matching).

`checkBumps()` reads `OpenLoops` for threads due for a recheck, and for each
one makes a *second* Claude call (`AEDILE_CONTEXT_BUMP`/`AEDILE_BUMP_PROMPT`)
asking whether it's actually worth a nudge now — told how long it's been
quiet and whether/when it was last bumped, so repeat nagging is the model's
call to make (or not), not a fixed cadence JS enforces. This is deliberately
the same delegation pattern as the rest of Aedile's judgment calls: the
anti-nagging instructions already in `AEDILE_CONTEXT_CORE` ("if you're about
to be the sole originator of continuity, pause," seasonal pulse-matching)
are what's expected to keep this from becoming mechanical spam, not a
separate rate limit.

Gated by its own kill switch, `BUMP_ENABLED` (independent of
`AEDILE_ENABLED`/`AUTOSEND_ENABLED`), and its own trigger
(`installBumpTrigger()`, daily — separate from `scanInbox`'s hourly
trigger).

**Bump drafts can now auto-send** (decided 2026-07-16), reusing
InboxProcessor's `isAllowlistEligible(thread)` — same condition as the
triage-tier exception (every participant on the thread already has to be
Zach, Tyler, and/or the krewe address). Reasoning: the allowlist itself is
what contains the blast radius, not which tier is asking — extending it to
bump nudges doesn't widen what can go wrong, since it's still the same
closed-participant gate. `BumpChecker.js` tracks its own
`MAX_BUMP_AUTOSEND_PER_RUN` cap, deliberately separate from
InboxProcessor's `MAX_AUTOSEND_PER_RUN`/`_autosendCountThisRun`, since the
two tiers fire on independent triggers and sharing a counter would make one
tier's cap depend on the other's unrelated timing.

**Validated 2026-07-16** against the real Claude API (model
`claude-sonnet-4-6`, matching `AnthropicClient.js`), outside Gmail/Sheets
entirely: 5 synthetic scenarios built to match `BumpChecker.buildBumpUserContent`'s
exact shape (unanswered ask → should bump; bumped yesterday → shouldn't
re-bump immediately; thread actually resolved in-content but hypothetically
still marked open → must recognize resolution and close the loop; dead
season → should stay quiet; already bumped once with continued silence →
should escalate to `flag` rather than repeat the nudge). **All 5 passed on
the unmodified prompt, no wording changes needed.** The core "loop closing"
case (a thread resolved via an in-thread reply) correctly returned
`open_loop: false` even with no code-level signal telling it the loop used
to be open — it re-derives that from the actual thread content every time,
which is the intended design (see "Institutional memory" above: no cached
"resolved" flag to go stale).

### DM vs. list-broadcast context — mechanism wired, prompt content is a placeholder

`InboxProcessor.buildThreadContent()` renders From/Date/Subject/body per
message but never rendered To/Cc — the model had zero signal about whether
a message was addressed narrowly (a direct ask) or broadcast to the full
list. A quick experiment (3 calls, same message body, varying only an
injected recipient-scope line) confirmed this isn't a non-issue: the
baseline (no recipient info) returned `flag` ("this needs a director, I
can't tell who's asking or how directly"); adding "sent only to the krewe
address" shifted it to `draft_reply` with a hedged, redirect-only answer;
adding "sent to the full ~40-person list" also produced `draft_reply` but
this time answered from established lore in the public "Office" character
voice. Small sample, not a rigorous A/B, but enough to show recipient scope
measurably changes the decision.

**Wired 2026-07-16**: `InboxProcessor.classifyAudience(msg)` counts distinct
To+Cc addresses on the message under review (not the whole thread — a
thread's audience can shift message to message) and returns `"dm"` at or
below `DM_RECIPIENT_THRESHOLD` (3, a rough placeholder — doesn't exclude
Aedile's own inbox address, so a 1:1 exchange plus the krewe address lands
around 2) or `"list"` above it. `reviewMessage()` picks
`AEDILE_SYSTEM_PROMPT_DM` or `AEDILE_SYSTEM_PROMPT_LIST` (`SystemPrompt.js`)
accordingly, and logs which one it used.

**Real instructions added 2026-07-17**: director feedback was that DM
replies were too hedgy/redirect-only even when Aedile had enough context to
answer directly — a symptom of the placeholder's original design (recipient
scope as a signal only, no rule about what to *do* with it). `AEDILE_CONTEXT_TRIAGE_DM`
(`Context.js` / `AEDILE_CONTEXT.triage-dm.md`) now has a "Directness in
DMs" section: answer directly when the thread and institutional memory
actually support it, and reserve flag/redirect for genuine Ritual-work
judgment calls, budget/commitment questions, or missing information — not
as a default posture for every direct question. Not yet validated against
the real API the way the bump-check and request-logging prompts were (see
Open items below) — the recipient-count threshold (`DM_RECIPIENT_THRESHOLD`,
still 3, still a guess) is also still open for reconsideration now that a
real DM rule exists to threshold against.

### Bug/feature request logging — a natural-language feedback channel

**Added 2026-07-16.** A director can report a bug or ask for a new Aedile
capability through ordinary email — no command syntax, no separate tool.
The triage output schema (`AEDILE_CONTEXT_TRIAGE_LIST`/`_DM`) gained three
more always-required fields alongside `open_loop`/`recheck_after_days`:
`is_request` (bool), `request_type` (`"bug"`/`"feature"`, only meaningful
when `is_request` is true), and `request_summary` (one sentence). Whenever
`is_request` is true, `InboxProcessor.recordRequest()` appends a row to a
new `Requests` tab (`Requests.js`): Timestamp, ThreadId, MessageId, From,
Type, Summary, Status (always written `"open"` — nothing automates closing
one out, that's a manual edit).

Validated against the real API before shipping: a genuine bug report, a
genuine feature request, and a negative control (ordinary krewe business
that happens to mention Aedile in passing) — all three classified
correctly on the unmodified prompt, no tuning needed.

This is deliberately a *feedback intake*, not the engineering backlog
itself — distinct from this file's "Open items" section below. Someone
still has to read `Requests` and decide what, if anything, becomes actual
work; nothing here auto-creates a task or auto-implements anything.

First real-world test case: a two-person scheduling thread between Zach and
Tyler (cc'd to the krewe address) to find a day to meet. This is Engine work
— tracking an open loop, nudging without being asked — being tested in the
smallest possible container before it's ever pointed at the full mailing
list.

## Open items (bugs & features)

The one place meant to answer "what's left" and "what needs a director" —
keep this updated as things change rather than letting it drift back into
scattered prose. Last reviewed 2026-07-17.

**Done as of 2026-07-16:** `AUTOSEND_ENABLED=true` and `AUTOSEND_ALLOWLIST`
(`zach@nomac.org`, `tyler@nomac.org`, `kreweofvaporwave@kreweofvaporwave.com`)
are both confirmed set via `checkGuardrails()`. `BUMP_ENABLED=true` and
`installBumpTrigger()` has been run — bump-checking is live on its daily
trigger, not just built. This means, right now, live and not hypothetical:
a `draft_reply` decision on any thread where every participant is one of
those three addresses auto-sends via `thread.replyAll()` instead of
drafting, from both the triage tier (hourly) and the bump tier
(daily), each with its own separate per-run cap.

**Needs a director to actually do something (mechanical, not a judgment call):**
- Optional cleanup: archive/delete the orphaned `Personality`/`Threads`/
  `Shards`/`ConsolidationLog` sheet tabs whenever the historical data in
  them isn't needed anymore. No code touches them.
- **2026-07-17: `scanInbox`'s trigger interval was dropped from 10 minutes
  to 1 (for a live-chat-like response feel), then walked back to hourly**
  same day, after an audit (below) found a real unread thread that had
  never been reviewed at all and raised doubt about whether the trigger
  was ever actually installed/running continuously, plus a structural risk
  — `scanUnread()` has no `LockService` lock, so at a 1-minute cadence,
  overlapping runs during a burst of unread mail could each get their own
  fresh `MAX_AUTOSEND_PER_RUN` counter, silently exceeding the intended
  cap. Hourly makes that overlap effectively impossible without fixing the
  lock, so it's the current target (`InboxProcessor.installTrigger()`).
  The code change alone doesn't move the live trigger — `clasp push` then
  re-run `installTrigger()` from the Apps Script editor to actually
  reinstall it at the new cadence.

**Needs a director's decision (judgment, not mechanical):**
- Reconsider `DM_RECIPIENT_THRESHOLD` (currently 3, a rough guess) now that
  `AEDILE_CONTEXT_TRIAGE_DM` has a real directness rule to threshold
  against — it was picked before the actual rule was written. See "DM vs.
  list-broadcast context" above.

**Needs live testing (validated locally against the real API, not yet
exercised end-to-end in production Gmail):**
- Send real test emails through the live inbox to confirm auto-send
  actually behaves as expected in practice — `thread.replyAll()` reaching
  the right people, `Log`/`Messages`/`OpenLoops` rows landing correctly —
  not just that the prompt returns the right JSON in isolation (which is
  all the local harness testing proved).
- Send test messages with varying To/Cc counts to confirm
  `classifyAudience()` actually splits real mail into "dm"/"list" the way
  it's supposed to.
- Once the daily trigger has run for real (not just `checkGuardrails()`),
  confirm a genuinely stale thread actually gets bumped — and, separately,
  that a resolved one correctly doesn't.
- Run a scenario suite (like the bump-check one) against the new "Directness
  in DMs" rule before trusting it live — confirm it actually answers direct
  questions instead of hedging, without bleeding into Ritual-work calls it
  should still flag. Not yet run against the real API the way bump-check
  and request-logging were before shipping.

**Known bugs:**
- **2026-07-17, since checked (2026-07-22):** the Triggers page confirms
  both `scanInbox` (hourly) and `checkBumps` (daily) are actually installed
  and firing — a manual `scanUnread()` run same-day logged "Reviewed 0 new
  message(s)," confirming the earlier 4-message-thread gap was genuinely no
  unread mail arriving in that window, not a dead trigger. `scanInbox`'s
  ~10.65% error rate (visible on the Triggers page) is still unexplained
  and worth a director skimming Apps Script's execution log for the actual
  stack traces next time it's convenient — not urgent, since scanUnread's
  per-message try/catch already isolates one bad message from killing a
  whole run.
- **2026-07-22, FIXED same day:** `thread.replyAll()`/`createDraftReply()`
  only address a reply to the LAST message in a thread's From/To/Cc, not
  the full thread history — but `isAllowlistEligible()` (the autosend
  safety check) evaluates eligibility against every message in the thread.
  A thread could pass eligibility on someone who participated earlier but
  wasn't on the specific last message, and the actual send/draft would then
  silently exclude them. Caught live: an auto-sent bump reached Tyler but
  never reached Zach. Fixed in `InboxProcessor.js`/`BumpChecker.js` — every
  `replyAll()`/`createDraftReply()` call now explicitly `cc`s the full
  aggregated participant set (`InboxProcessor.getRecipientCompletion`), so
  eligibility and delivery can't disagree again.
- **2026-07-22, OPEN, needs conspicuous handling:** a director manually sent
  a reply from the shared `kreweofvaporwave@` alias (rather than their own
  `@nomac.org` address) mid-thread, which is a *separate* cause of the same
  symptom as the bug above (a narrower recipient set than intended) — but a
  materially different risk. The raw archive (`MessageLog`, see
  "Institutional memory" above) records only a `From` address; it has no
  way to distinguish a message Aedile itself authored and sent from one a
  human sent manually while logged into the same shared identity. That
  ambiguity means: (a) a future triage/bump call reading thread history
  could misattribute a human's words as Aedile's own prior commitment or
  reasoning, and (b) information sent this way carries none of Aedile's own
  scrutiny (voice, guardrails, allowlist checks) while still reading, to
  the model and to anyone auditing the archive later, as if it came from
  the automated account — a real leak/misattribution risk, not just a
  cosmetic one. No detection mechanism exists yet. A plausible approach
  (not yet built, needs its own decision before implementing): cross-
  reference a `kreweofvaporwave@`-authored message's `MessageId` against
  `Log` rows tagged `auto_reply`/`bump_auto_reply` — if a message from the
  krewe address exists with no matching Log row, it was very likely sent
  manually, and could be marked distinctly wherever it's surfaced (to the
  model in `buildThreadContent`/`buildBumpUserContent`, and to a director
  via `ReadApi`). Flagged for the batch-driven tuning loop's diagnostic
  pass (see below) rather than fixed ad hoc tonight.

(The earlier, separate "reviewed but no row in any sheet" issue was
root-caused and fixed — confirmed by a later clean execution log showing
successful writes end to end.)

**Deferred, not forgotten:**
- `aedile/holon_fold.py` — entity-clustering experiment over the raw
  archive, explicitly "for later, maybe implement in JS." Not wired into
  anything; revisit only when actually prioritized.
- **2026-07-22, feature idea — human-facing digest, not a new model-context
  tier:** in a live test case, Zach and Tyler had a real meeting and then
  deliberately dumped raw brainstorm notes into an email exchange with the
  krewe address specifically so Aedile's archive (`MessageLog`, see
  "Institutional memory" above) would pick them up — content nobody
  expected a reply to, closer to a deposit than an ask. Right now that
  content only exists as raw rows in `Messages`, unless a director thinks
  to go read the thread directly. The idea: periodically (the batch-driven
  tuning loop discussed above is a natural home for this) generate a
  human-readable summary/digest of recent raw dumps — a doc or dated
  report, mirroring the existing `/srv/vaporwave-reports/aedile/` pattern
  svc-vaporwave's nightly batch already writes for its own runs — so a
  director can catch up without re-reading raw email. Important distinction
  from the retired Threads/Shards consolidation tier (see "Institutional
  memory" above): that pipeline fed model-derived summaries back into the
  model's own reasoning as a replacement for raw history, and got retired
  because of the drift/staleness risk that created. This is the opposite
  shape — a summary as an OUTPUT for a human to read, never fed back in as
  the model's source of truth — so it doesn't reopen that same risk. Not
  scoped or built; needs its own design pass before implementing.

## Build discipline (realisateur baseline — see realisateur/BUILD-DISCIPLINE.md)
Before marking anything done:
- [ ] Fails **loud**? (no exit-0 no-ops; pipefail+SIGPIPE guarded)
- [ ] "Working" backed by a **test name or human-sense witness**, not exit code alone?
- [ ] Config read from **one source**, not retyped per file?
- [ ] Deploy verified against a **git ref**; drift fails loud?
- [ ] **No secret** in a tracked file; tree clean of build debris?
- [ ] `silence-audit --strict` clean? (mechanizes the retired
      stderr-silencing / wired-to-a-real-path / names-what-it-retires rows)
