// Requests.js -- sheet helper for the "Requests" tab: bug and feature requests
// for Aedile, appended by InboxProcessor.reviewMessage() when is_request is true.
// Columns: Timestamp | ThreadId | MessageId | From | Type | Summary | Status
// Type is "bug" or "feature". Status is always written "open"; closing is a
// manual sheet edit.

const Requests = (() => {

  const HEADER = ['Timestamp', 'ThreadId', 'MessageId', 'From', 'Type', 'Summary', 'Status'];

  function _sheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('Requests');
    if (!sh) {
      sh = ss.insertSheet('Requests');
      sh.appendRow(HEADER);
    }
    return sh;
  }

  /** Append one request row. type should be "bug" or "feature". */
  function append(threadId, messageId, from, type, summary) {
    _sheet().appendRow([new Date(), threadId, messageId, from, type, summary, 'open']);
  }

  return { append };
})();
