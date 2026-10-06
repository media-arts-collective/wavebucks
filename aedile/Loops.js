/**
 * Loops.js
 * Sheet helpers for the "Loops" and "Record" tabs (#84): what the krewe owes
 * and is owed, and what was ruled, found or settled. One row per ask.
 *
 * These live in the private config spreadsheet on purpose. The repo and its
 * issues are public; a contact, a counterpart's name or a candid reason goes
 * here and nowhere in git. `Sensitive` marks a row to redact if the sheet is
 * ever shared wider.
 *
 * Loops columns:  Id | Opened | Owner | Counterpart | Ask | Channel | Contact |
 *                 Due | Status | Closed | Tag | Source | Sensitive
 * Record columns: Id | Date | Kind | Who | Words | Source | Supersedes | Tag |
 *                 Sensitive
 *
 * Record is append-only: a reversal is a new row whose Supersedes names the
 * old Id, and the old row stays. An Id is never reused, so rows may be closed
 * but not deleted.
 */

/** Next id for a prefix, from the ids already in the tab. Pure; TestsLocal.js mirrors it. */
function nextRowId(ids, prefix) {
  let max = 0;
  ids.forEach(id => {
    const m = String(id).match(new RegExp('^' + prefix + '-(\\d+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + '-' + (max + 1);
}

const Loops = (() => {

  const HEADER = ['Id', 'Opened', 'Owner', 'Counterpart', 'Ask', 'Channel', 'Contact',
    'Due', 'Status', 'Closed', 'Tag', 'Source', 'Sensitive'];
  const COL = {};
  HEADER.forEach((h, i) => { COL[h] = i; });

  function _sheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('Loops');
    if (!sh) {
      sh = ss.insertSheet('Loops');
      sh.appendRow(HEADER);
    }
    return sh;
  }

  function _ids(sh) {
    return sh.getDataRange().getValues().slice(1).map(r => r[COL.Id]);
  }

  /** Append one open loop; returns its Id. */
  function open(f) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = _sheet();
      const id = nextRowId(_ids(sh), 'L');
      sh.appendRow([id, new Date(), f.owner, f.counterpart || '', f.ask, f.channel || '',
        f.contact || '', f.due || '', 'open', '', f.tag || '', f.source || '', f.sensitive ? 'yes' : '']);
      return id;
    } finally {
      lock.releaseLock();
    }
  }

  /** Close an open loop. Returns null when the Id is absent or already closed. */
  function close(id, how, words) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = _sheet();
      const values = sh.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][COL.Id]) !== String(id)) continue;
        if (String(values[i][COL.Status]) !== 'open') return null;
        const source = [values[i][COL.Source], 'closed (' + how + '): ' + words].filter(Boolean).join(' | ');
        sh.getRange(i + 1, COL.Status + 1).setValue('closed');
        sh.getRange(i + 1, COL.Closed + 1).setValue(new Date());
        sh.getRange(i + 1, COL.Source + 1).setValue(source);
        return { id, ask: values[i][COL.Ask] };
      }
      return null;
    } finally {
      lock.releaseLock();
    }
  }

  return { HEADER, open, close };
})();

const Record = (() => {

  const HEADER = ['Id', 'Date', 'Kind', 'Who', 'Words', 'Source', 'Supersedes', 'Tag', 'Sensitive'];
  const KINDS = ['ruling', 'meeting', 'finding'];

  function _sheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('Record');
    if (!sh) {
      sh = ss.insertSheet('Record');
      sh.appendRow(HEADER);
    }
    return sh;
  }

  /** Append one record row; returns its Id. Throws when `supersedes` names no row. */
  function append(f) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = _sheet();
      const ids = sh.getDataRange().getValues().slice(1).map(r => r[0]);
      if (f.supersedes && ids.map(String).indexOf(String(f.supersedes)) === -1) {
        throw new Error('supersedes names no Record row: ' + f.supersedes);
      }
      const id = nextRowId(ids, 'R');
      sh.appendRow([id, f.date || new Date(), f.kind, f.who, f.words, f.source || '',
        f.supersedes || '', f.tag || '', f.sensitive ? 'yes' : '']);
      return id;
    } finally {
      lock.releaseLock();
    }
  }

  return { HEADER, KINDS, append };
})();
