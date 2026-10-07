// MessageLog.js -- sheet helper for the "Messages" tab: the append-only raw
// mailing-list log each Claude call draws a rolling window from.
// Columns: MessageId | ThreadId | From | Date | Subject | Body | TopicUrl
// TopicUrl is only populated for historical Google Groups imports.

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

  // Messages with Date >= sinceDate, oldest first, in the same per-message
  // shape as InboxProcessor.buildThreadContent.
  function getRecentRaw(sinceDate) {
    const rows = _sheet().getDataRange().getValues().slice(1);
    return rows
      .filter(r => r[COL.DATE] && new Date(r[COL.DATE]) >= sinceDate)
      .sort((a, b) => new Date(a[COL.DATE]) - new Date(b[COL.DATE]))
      .map(r => `--- ${new Date(r[COL.DATE]).toDateString()} ---\nFrom: ${r[COL.FROM]}\nSubject: ${r[COL.SUBJECT]}\n\n${r[COL.BODY]}`)
      .join('\n\n');
  }

  // The "MAILING LIST HISTORY" block InboxProcessor and BumpChecker prepend; one
  // place decides its wording.
  function buildHistoryBlock(windowDays) {
    const since = new Date();
    since.setDate(since.getDate() - windowDays);
    const history = getRecentRaw(since);
    return history
      ? `MAILING LIST HISTORY (last ~${windowDays} days, oldest first):\n\n${history}`
      : `MAILING LIST HISTORY (last ~${windowDays} days): none recorded yet.`;
  }

  // One-time bulk import from a Drive-hosted copy of messages.jsonl. Not
  // idempotent: it only appends.
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

// One-time historical import, run from the editor. Reads the Drive file ID from
// the MIGRATION_DRIVE_FILE_ID script property.
function migrateMessages() {
  const fileId = PropertiesService.getScriptProperties().getProperty('MIGRATION_DRIVE_FILE_ID');
  if (!fileId) throw new Error('Set the MIGRATION_DRIVE_FILE_ID script property first (Project Settings > Script Properties).');
  MessageLog.migrateMessagesFromDriveId(fileId);
}
