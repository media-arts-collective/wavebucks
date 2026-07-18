/**
 * Requests.js
 * Sheet helper for the "Requests" tab — lets a director report a bug or
 * feature request for Aedile itself through ordinary email, no special
 * command syntax required. Populated by InboxProcessor.reviewMessage()
 * whenever a triage decision sets is_request: true (see Context.js's
 * "Reporting bugs and features" section). This is a director-facing
 * feedback log, distinct from aedile/CLAUDE.md's "Open items" section
 * (which tracks engineering-side TODOs) — think of this as the intake,
 * not the backlog itself; someone still has to read it and decide what
 * to act on.
 *
 * Columns: Timestamp | ThreadId | MessageId | From | Type | Summary | Status
 * Type is "bug" or "feature". Status is always written as "open" — nothing
 * in this file ever changes it; closing a request out is a manual edit to
 * the sheet, deliberately not automated.
 */

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
