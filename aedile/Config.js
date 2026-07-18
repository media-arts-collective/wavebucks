/**
 * Config.js
 * Loads settings and the audit log from the Aedile Config spreadsheet.
 *
 * Tabs expected:
 *   Config       - key/value settings (A: key, B: value)
 *   Log          - append-only record of every message Aedile has looked at
 *   Messages     - raw mailing-list archive (read/written by MessageLog.js, not through this module)
 */

const CONFIG_SHEET_ID = '1bBLfPpw618EtkZBpLylBa-Hg-J8cd62nCxHkqbET6BM'; // Aedile Config spreadsheet owned by kreweofvaporwave@kreweofvaporwave.com

const Config = (() => {

  function _sheet(name) {
    const sh = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName(name);
    if (!sh) throw new Error(`❌ "${name}" tab not found in Aedile Config spreadsheet.`);
    return sh;
  }

  /** Return all rows from the Config tab as a {key: value} map */
  function getAll() {
    const rows = _sheet('Config').getDataRange().getValues().slice(1);
    const map = {};
    rows.forEach(([key, value]) => {
      if (key) map[String(key).trim()] = value;
    });
    return map;
  }

  /** Return a single Config value by key */
  function get(key) {
    return getAll()[key];
  }

  const LOG_MESSAGE_ID_COL = 2; // Column C — must match the column order in logEvent() below

  /**
   * Append one row to the Log tab.
   * Columns: Timestamp | ThreadID | MessageID | From | Subject | Action | Notes
   */
  function logEvent(threadId, messageId, from, subject, action, notes = '') {
    _sheet('Log').appendRow([new Date(), threadId, messageId, from, subject, action, notes]);
  }

  /** Check whether a message ID has already been logged, for dedup */
  function isMessageProcessed(messageId) {
    if (!messageId) return false;
    const rows = _sheet('Log').getDataRange().getValues();
    return rows.some(row => row[LOG_MESSAGE_ID_COL] === messageId);
  }

  return { get, getAll, logEvent, isMessageProcessed };
})();
