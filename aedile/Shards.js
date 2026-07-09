/**
 * Shards.js
 * Sheet helper for the "Shards" and "ConsolidationLog" tabs — the daily
 * cross-thread consolidation tier that groups related Threads rows into
 * longer-lived Shards. Read and written only by ConsolidationProcessor.js.
 *
 * Shards columns: ShardId | Label | ThreadIds | EntityFingerprint |
 * ParticipantFingerprint | Status (active/dormant) | LastTouched | CreatedAt
 *
 * ConsolidationLog columns: Timestamp | ThreadId | ShardId | Score | Decision
 */

const Shards = (() => {

  function _shardsSheet() {
    const sh = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName('Shards');
    if (!sh) throw new Error('❌ "Shards" tab not found in Aedile Config spreadsheet.');
    return sh;
  }

  function _consolidationLogSheet() {
    const sh = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName('ConsolidationLog');
    if (!sh) throw new Error('❌ "ConsolidationLog" tab not found in Aedile Config spreadsheet.');
    return sh;
  }

  const COL = {
    SHARD_ID: 0,
    LABEL: 1,
    THREAD_IDS: 2,
    ENTITY_FP: 3,
    PARTICIPANT_FP: 4,
    STATUS: 5,
    LAST_TOUCHED: 6,
    CREATED_AT: 7
  };

  function _mergeFingerprint(existing, incoming) {
    const set = new Set([
      ...(existing ? String(existing).split(',').map(s => s.trim()).filter(Boolean) : []),
      ...(incoming ? String(incoming).split(',').map(s => s.trim()).filter(Boolean) : [])
    ]);
    return Array.from(set).sort().join(', ');
  }

  /** Active shards as plain row objects, for the fuzzy-match comparison in consolidateShards() */
  function getActive() {
    const rows = _shardsSheet().getDataRange().getValues().slice(1);
    return rows
      .map((r, i) => ({
        rowNum: i + 2, // +1 for header, +1 for 1-indexing
        shardId: r[COL.SHARD_ID],
        label: r[COL.LABEL],
        threadIds: r[COL.THREAD_IDS],
        entityFingerprint: r[COL.ENTITY_FP],
        participantFingerprint: r[COL.PARTICIPANT_FP],
        status: r[COL.STATUS]
      }))
      .filter(s => s.status === 'active');
  }

  /**
   * Row count at call time, used as the next shard's ID — same
   * row-count-as-ID scheme this codebase already uses elsewhere, chosen
   * here for the same reason: no separate counter to keep in sync.
   */
  function _nextShardId() {
    const count = _shardsSheet().getDataRange().getValues().length - 1; // minus header
    return `S${count + 1}`;
  }

  function createShard(label, threadId, entityFingerprint, participantFingerprint) {
    const now = new Date();
    const shardId = _nextShardId();
    _shardsSheet().appendRow([
      shardId, label || `Shard for ${threadId}`, String(threadId),
      entityFingerprint, participantFingerprint, 'active', now, now
    ]);
    return shardId;
  }

  /** Folds threadId into an existing shard, merging (not replacing) its fingerprints */
  function joinShard(shard, threadId, entityFingerprint, participantFingerprint) {
    const mergedThreadIds = shard.threadIds ? `${shard.threadIds}, ${threadId}` : String(threadId);
    const mergedEntities = _mergeFingerprint(shard.entityFingerprint, entityFingerprint);
    const mergedParticipants = _mergeFingerprint(shard.participantFingerprint, participantFingerprint);

    _shardsSheet().getRange(shard.rowNum, COL.THREAD_IDS + 1, 1, 4)
      .setValues([[mergedThreadIds, mergedEntities, mergedParticipants, new Date()]]);
  }

  function appendConsolidationLog(threadId, shardId, score, decision) {
    _consolidationLogSheet().appendRow([new Date(), threadId, shardId, score, decision]);
  }

  return { getActive, createShard, joinShard, appendConsolidationLog };
})();
