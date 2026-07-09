/**
 * Threads.js
 * Sheet helper for the "Threads" tab — one row per Gmail thread Aedile has
 * reviewed, holding a running summary/entities/participants used by the
 * separate daily consolidation tier (see ConsolidationProcessor.js). Written
 * by InboxProcessor.reviewMessage() in the same pass that decides
 * draft/no_action/flag, not as a separate API call.
 *
 * Columns expected: ThreadId | Summary | Entities | Participants |
 * LastMessageDate | UpdatedAt
 */

const Threads = (() => {

  function _sheet() {
    const sh = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName('Threads');
    if (!sh) throw new Error('❌ "Threads" tab not found in Aedile Config spreadsheet.');
    return sh;
  }

  const COL = {
    THREAD_ID: 0,
    SUMMARY: 1,
    ENTITIES: 2,
    PARTICIPANTS: 3,
    LAST_MESSAGE_DATE: 4,
    UPDATED_AT: 5
  };

  function _toCommaList(value) {
    if (Array.isArray(value)) return value.join(', ');
    return value || '';
  }

  /**
   * Insert or update the Threads row for threadId. Always overwrites
   * Summary/Entities/Participants with the latest model output rather than
   * merging — the model is given the full thread on every call, so its
   * output already reflects the whole conversation, not just the delta.
   */
  function upsert(threadId, { summary, entities, participants, lastMessageDate }) {
    const sh = _sheet();
    const rows = sh.getDataRange().getValues();
    const now = new Date();
    const entitiesStr = _toCommaList(entities);
    const participantsStr = _toCommaList(participants);

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][COL.THREAD_ID] === threadId) {
        sh.getRange(i + 1, COL.SUMMARY + 1, 1, 5)
          .setValues([[summary || '', entitiesStr, participantsStr, lastMessageDate, now]]);
        return;
      }
    }

    sh.appendRow([threadId, summary || '', entitiesStr, participantsStr, lastMessageDate, now]);
  }

  /** Threads rows whose UpdatedAt is strictly after sinceDate, for consolidateShards() */
  function getUpdatedSince(sinceDate) {
    const rows = _sheet().getDataRange().getValues().slice(1);
    return rows
      .filter(r => r[COL.THREAD_ID] && new Date(r[COL.UPDATED_AT]) > sinceDate)
      .map(r => ({
        threadId: r[COL.THREAD_ID],
        summary: r[COL.SUMMARY],
        entities: r[COL.ENTITIES],
        participants: r[COL.PARTICIPANTS],
        lastMessageDate: r[COL.LAST_MESSAGE_DATE],
        updatedAt: r[COL.UPDATED_AT]
      }));
  }

  return { upsert, getUpdatedSince };
})();
