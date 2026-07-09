/**
 * ConsolidationProcessor.js
 * Daily cross-thread consolidation tier. Groups Threads rows into
 * longer-lived Shards by entity/participant similarity, using its own
 * Claude API call per updated thread for the fuzzy-matching judgment —
 * exact-string fingerprint comparison alone can't tell "the Ball" and
 * "Ball 2026" refer to the same thing.
 *
 * Not wired to any trigger yet. Run consolidateShards() manually from the
 * script editor to test; installing a daily time-driven trigger is a
 * manual step left for a director once this has been reviewed.
 */

const LAST_CONSOLIDATION_RUN_PROP = 'LAST_CONSOLIDATION_RUN';

// Placeholder pending Change 5 (splitting AEDILE_CONTEXT.md), which will
// replace this with AEDILE_CONSOLIDATION_PROMPT assembled from the shared
// core context plus a dedicated consolidation file.
const CONSOLIDATION_SYSTEM_PROMPT = `You are Aedile, an operations assistant for the Virtual Krewe of
Vaporwave. Your job here is narrow: decide whether one email thread
belongs to an existing group of related threads ("shard") or should start
a new one.

A shard groups threads that are actually the same ongoing situation or
recurring topic (e.g. "finding a meeting date," "Ball 2026 logistics"),
not threads that merely share a participant. The krewe's two directors
appear on almost every thread — a shared participant alone is weak
evidence. Shared distinctive entities (a named event, a specific date
under discussion, a project name) are strong evidence.

Score how confidently this thread belongs to the best-matching existing
shard, from 0.0 (unrelated) to 1.0 (certainly the same situation). You are
not deciding the join/create cutoff — that threshold is applied separately
against your score. Never fabricate a relationship to force a merge; if
nothing existing matches, say so plainly (null match, low score).

Respond with ONLY valid JSON, no other text, in this exact shape:
{
  "best_match_shard_id": "<ShardId of the closest existing shard, or null if none are related>",
  "score": <0.0 to 1.0>,
  "suggested_label": "<short human-readable label, used only if a new shard is created>"
}`;

const ConsolidationProcessor = (function () {

  /** Separate kill switch from AEDILE_ENABLED — a Config sheet row, not a Script Property,
   *  so this tier can be tested independently without touching the triage tier's switch. */
  function isEnabled() {
    return String(Config.get('CONSOLIDATION_ENABLED')).toLowerCase() === 'true';
  }

  function normalizeFingerprint(commaList) {
    if (!commaList) return '';
    return Array.from(new Set(
      String(commaList).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    )).sort().join(', ');
  }

  function buildUserContent(thread, candidateShards) {
    const participantWeightDecay = parseFloat(Config.get('PARTICIPANT_WEIGHT_DECAY'));

    const candidateBlock = candidateShards.length
      ? candidateShards.map(s =>
          `- ShardId: ${s.shardId} | Label: ${s.label} | Entities: ${s.entityFingerprint} | Participants: ${s.participantFingerprint}`
        ).join('\n')
      : '(no existing active shards yet)';

    return `THREAD UNDER REVIEW:
ThreadId: ${thread.threadId}
Summary: ${thread.summary}
Entities: ${thread.entityFingerprint}
Participants: ${thread.participantFingerprint}

EXISTING ACTIVE SHARDS:
${candidateBlock}

GUIDANCE:
Participants appearing in more than ${Math.round(participantWeightDecay * 100)}% of all threads
are common to nearly everything (e.g. the two directors) and should be
down-weighted — a shared participant alone is weak evidence of
relatedness; shared distinctive entities are strong evidence.`;
  }

  /**
   * Entry point, intended for a future daily time-driven trigger (not
   * installed yet — see file header). Reads Threads rows updated since the
   * last run, judges each against existing active Shards via its own
   * Claude call, and logs every decision — join or new, with its score —
   * to ConsolidationLog so the reasoning is auditable later.
   */
  function consolidateShards() {
    if (!isEnabled()) {
      Logger.log('⏸️ Consolidation is disabled (Config CONSOLIDATION_ENABLED is not "true"). Skipping run.');
      return;
    }

    const runStartedAt = new Date();
    const props = PropertiesService.getScriptProperties();
    const lastRunRaw = props.getProperty(LAST_CONSOLIDATION_RUN_PROP);
    const lastRun = lastRunRaw ? new Date(lastRunRaw) : new Date(0);

    const threshold = parseFloat(Config.get('SHARD_MERGE_THRESHOLD'));
    const updatedThreads = Threads.getUpdatedSince(lastRun);

    if (!updatedThreads.length) {
      Logger.log(`✅ Consolidation run complete. No Threads rows updated since ${lastRun}.`);
      props.setProperty(LAST_CONSOLIDATION_RUN_PROP, runStartedAt.toISOString());
      return;
    }

    updatedThreads.forEach(thread => {
      const fingerprinted = {
        threadId: thread.threadId,
        summary: thread.summary,
        entityFingerprint: normalizeFingerprint(thread.entities),
        participantFingerprint: normalizeFingerprint(thread.participants)
      };

      const candidateShards = Shards.getActive();

      let judgment;
      try {
        judgment = AnthropicClient.getJsonDecision(
          CONSOLIDATION_SYSTEM_PROMPT,
          buildUserContent(fingerprinted, candidateShards),
          500
        );
      } catch (err) {
        Shards.appendConsolidationLog(thread.threadId, '', 0, `error: ${err.message}`);
        return;
      }

      const bestShard = candidateShards.find(s => s.shardId === judgment.best_match_shard_id);

      // A future "suggest a tuning change" feature could mine score
      // distributions here (e.g. many near-miss scores just under
      // threshold) to recommend a new SHARD_MERGE_THRESHOLD. Config edits
      // stay a human decision only — do not wire that up automatically.
      if (bestShard && judgment.score >= threshold) {
        Shards.joinShard(bestShard, thread.threadId, fingerprinted.entityFingerprint, fingerprinted.participantFingerprint);
        Shards.appendConsolidationLog(thread.threadId, bestShard.shardId, judgment.score, 'join');
      } else {
        const newShardId = Shards.createShard(
          judgment.suggested_label, thread.threadId,
          fingerprinted.entityFingerprint, fingerprinted.participantFingerprint
        );
        Shards.appendConsolidationLog(thread.threadId, newShardId, judgment.score || 0, 'new');
      }
    });

    props.setProperty(LAST_CONSOLIDATION_RUN_PROP, runStartedAt.toISOString());
    Logger.log(`✅ Consolidation run complete. Processed ${updatedThreads.length} updated thread(s).`);
  }

  return { consolidateShards, isEnabled };
})();

function consolidateShards() {
  ConsolidationProcessor.consolidateShards();
}
