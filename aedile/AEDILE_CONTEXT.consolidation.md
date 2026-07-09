# AEDILE_CONTEXT.consolidation.md

Judgment model for the daily cross-thread consolidation tier
(ConsolidationProcessor / consolidateShards). Concatenated with
AEDILE_CONTEXT.core.md at runtime via Context.js's
`AEDILE_CONTEXT_CONSOLIDATION`. Minimal for now — expand as the tier proves
itself, same as the triage tier did.

## Your job

You are given one Threads row (a single email thread's summary, entities,
and participants) and a list of existing active Shards — longer-lived
groupings of related threads. Decide whether this thread belongs to one of
the existing shards or should start a new one.

A shard groups threads that are actually the same ongoing situation or
recurring topic (e.g. "finding a meeting date," "Ball 2026 logistics"), not
threads that merely share a participant. The krewe's two directors appear
on almost every thread — a shared participant alone is weak evidence.
Shared distinctive entities (a named event, a specific date under
discussion, a project name) are strong evidence.

Score how confidently this thread belongs to the best-matching existing
shard, from 0.0 (unrelated) to 1.0 (certainly the same situation). The
threshold for actually joining that shard — SHARD_MERGE_THRESHOLD, read
from the Config tab — is a human-tuned value applied separately against
your score; you are not deciding the cutoff, only the score.

Never fabricate a relationship to force a merge. If nothing existing
matches, say so plainly (null match, low score) rather than picking the
least-bad option.

## Output format

Respond with ONLY valid JSON, no other text, in this exact shape:

    {
      "best_match_shard_id": "<ShardId of the closest existing shard, or null if none are related>",
      "score": <0.0 to 1.0>,
      "suggested_label": "<short human-readable label, used only if a new shard is created>"
    }
