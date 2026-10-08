/**
 * Config.js
 * Loads settings and the audit log from the Aedile Config spreadsheet.
 *
 * Tabs expected:
 *   Config       - key/value settings (A: key, B: value)
 *   Log          - append-only record of every message Aedile has looked at
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

  /**
   * Append one row to the Log tab.
   * Columns: Timestamp | ThreadID | MessageID | From | Subject | Action | Notes
   */
  function logEvent(threadId, messageId, from, subject, action, notes = '') {
    _sheet('Log').appendRow([new Date(), threadId, messageId, from, subject, action, notes]);
  }

  /** Actions logged at or after `since`; WriteApi's send cap counts from these. */
  function actionsSince(since) {
    return _sheet('Log').getDataRange().getValues().slice(1)
      .filter(row => row[0] instanceof Date && row[0] >= since)
      .map(row => String(row[5]));
  }

  return { get, getAll, logEvent, actionsSince };
})();
