# Aedile — Project Context

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
- **Recipient allowlist.** Never let generated content introduce a new
  recipient. To/Cc stays limited to existing thread participants or a small
  hardcoded set (currently: Zach, Tyler). Distinct from `AUTOSEND_ALLOWLIST`
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
- Aedile never **starts** mailing-list threads, only responds to or bumps
  existing ones.
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
  tab (the local `messages.jsonl` export and the scraper that produced it
  are gone now that migration's done — see `README.md`'s "Historical
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
- **2026-07-25: `TESTING_MODE` renamed to `DIRECTOR_LOOP_OVERRIDE`**
  (`Context.js`/`SystemPrompt.js`/`InboxProcessor.js` —
  `enableTestingMode`/`disableTestingMode` are now
  `enableDirectorLoopOverride`/`disableDirectorLoopOverride`). Same exact
  behavior and scope (suspends dead-season restraint for replies inside
  the closed Zach/Tyler/krewe-address loop only); renamed because the old
  name misleadingly implied "test only" even though this mechanism is
  also the intended vehicle for the real director-loop-nudging work in
  `aedile/.scheduler/FOCUS.md`. **If `TESTING_MODE` was ever set live to
  `'true'`, it now has no effect** — after the next `clasp push`, a
  director needs to set the new `DIRECTOR_LOOP_OVERRIDE` script property
  instead if the override is wanted.
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
- **2026-07-17, unconfirmed:** an audit of the Log tab found a real 4-message
  thread ("updates?", Abraham/Tyler/Zach, substantive laser-harp/venue
  content) unread since 6/28–7/7 with zero rows in the Log at any point —
  meaning `scanUnread()` never reviewed it, not that it reviewed it and
  chose silence. The Log's own timestamps (clustered on 7/8, 7/9, then a
  gap to 7/15, 7/16, 7/17) read more like manual test runs than a
  continuously-firing trigger. Needs a director to check the Apps Script
  editor's Triggers page directly to confirm whether `scanInbox` was
  actually installed/firing on schedule this whole time, or whether the
  "Live" status claimed in `README.md` was aspirational. Not yet
  root-caused.

(The earlier, separate "reviewed but no row in any sheet" issue was
root-caused and fixed — confirmed by a later clean execution log showing
successful writes end to end.)

**Deferred, not forgotten:**
- `aedile/holon_fold.py` — entity-clustering experiment over the raw
  archive, explicitly "for later, maybe implement in JS." Not wired into
  anything; revisit only when actually prioritized.
