/**
 * MessageLog.js
 * Sheet helper for the "Messages" tab — the append-only raw mailing-list
 * log Aedile draws on for institutional memory. Replaces the retired
 * Threads/Shards/ConsolidationLog tiers: instead of a model-derived summary
 * pipeline, each Claude call gets the actual raw messages from a rolling
 * window directly, plus the hand-curated context in Context.js for anything
 * older than the window.
 *
 * Columns: MessageId | ThreadId | From | Date | Subject | Body | TopicUrl
 * TopicUrl is only populated for historical Google Groups imports
 * (migrateMessagesFromDriveId) — Gmail-sourced rows have no equivalent.
 */

const MessageLog = (() => {

  const HEADER = ['MessageId', 'ThreadId', 'From', 'Date', 'Subject', 'Body', 'TopicUrl'];

  const COL = {
    MESSAGE_ID: 0,
    THREAD_ID: 1,
    FROM: 2,
    DATE: 3,
    SUBJECT: 4,
    BODY: 5,
    TOPIC_URL: 6
  };

  function _sheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('Messages');
    if (!sh) {
      sh = ss.insertSheet('Messages');
      sh.appendRow(HEADER);
    }
    return sh;
  }

  /** Append one message row — called by InboxProcessor for every message it reviews. */
  function append(messageId, threadId, from, date, subject, body, topicUrl = '') {
    _sheet().appendRow([messageId, threadId, from, date, subject, body, topicUrl]);
  }

  /**
   * All messages with Date >= sinceDate, oldest first, rendered as a single
   * delimited text block — same per-message shape as
   * InboxProcessor.buildThreadContent, so the model sees mailing-list
   * history and the thread under review in a consistent format.
   */
  function getRecentRaw(sinceDate) {
    const rows = _sheet().getDataRange().getValues().slice(1);
    return rows
      .filter(r => r[COL.DATE] && new Date(r[COL.DATE]) >= sinceDate)
      .sort((a, b) => new Date(a[COL.DATE]) - new Date(b[COL.DATE]))
      .map(r => `--- ${new Date(r[COL.DATE]).toDateString()} ---\nFrom: ${r[COL.FROM]}\nSubject: ${r[COL.SUBJECT]}\n\n${r[COL.BODY]}`)
      .join('\n\n');
  }

  /**
   * The "MAILING LIST HISTORY" block both InboxProcessor and BumpChecker
   * prepend to their user content — pulled here since MessageLog already
   * owns the rolling-window concept, so there's one place that decides how
   * the window is worded, not two copies drifting apart.
   */
  function buildHistoryBlock(windowDays) {
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const history = getRecentRaw(since);
    return history
      ? `MAILING LIST HISTORY (last ~${windowDays} days, oldest first):\n\n${history}`
      : `MAILING LIST HISTORY (last ~${windowDays} days): none recorded yet.`;
  }

  /**
   * One-time bulk import of the historical mailing-list archive from a
   * Drive-hosted copy of aedile/messages.jsonl (Apps Script has no
   * filesystem access — the export has to be reachable via DriveApp, so
   * upload it to Drive under the krewe account first and pass its file ID).
   * Not idempotent — it only appends, so run it once per export.
   */
  function migrateMessagesFromDriveId(driveFileId) {
    const text = DriveApp.getFileById(driveFileId).getBlob().getDataAsString();
    const rows = text.split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .map(r => [
        '', // no MessageId for a Google Groups export; Gmail-sourced rows get one going forward
        '', // no ThreadId either, same reason
        r.email || r.author || '',
        new Date(r.date),
        '', // Google Groups export has no per-message subject field
        r.body || '',
        r.topic_url || ''
      ]);

    if (!rows.length) {
      Logger.log('⚠️ No rows parsed from Drive file — nothing imported.');
      return;
    }

    const sh = _sheet();
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
    Logger.log(`✅ Imported ${rows.length} historical messages into the Messages tab.`);
  }

  return { append, getRecentRaw, buildHistoryBlock, migrateMessagesFromDriveId };
})();

/**
 * One-time historical import — select this in the Apps Script editor's
 * function dropdown and click Run. Takes no argument because the editor's
 * Run button can't pass one; instead it reads the Drive file ID from the
 * MIGRATION_DRIVE_FILE_ID script property (Project Settings > Script
 * Properties, same place AEDILE_ENABLED and ANTHROPIC_API_KEY live) —
 * set that once before running.
 */
function migrateMessages() {
  const fileId = PropertiesService.getScriptProperties().getProperty('MIGRATION_DRIVE_FILE_ID');
  if (!fileId) throw new Error('Set the MIGRATION_DRIVE_FILE_ID script property first (Project Settings > Script Properties).');
  MessageLog.migrateMessagesFromDriveId(fileId);
}
