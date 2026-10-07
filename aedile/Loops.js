// Loops.js -- sheet helpers for the "Loops" and "Record" tabs: what the krewe
// owes and is owed, and what was ruled, found or settled. One row per ask.
// Private config spreadsheet on purpose: the repo is public, so a contact, a
// counterpart's name or a candid reason goes here and nowhere in git.
//
// Loops columns:  Id | Opened | Owner | Counterpart | Ask | Channel | Contact |
//                 Due | Status | Closed | Tag | Source | Sensitive | Audience
// Record columns: Id | Date | Kind | Who | Words | Source | Supersedes | Tag |
//                 Sensitive | Audience
//
// Audience is `list` or `private`, required at intake: only a `list` row may be
// rendered into mail to the list.
// Nothing is edited in place and an Id is never reused: Record reversals and
// loop amendments are new rows naming the old Id.

const AUDIENCES = ['list', 'private'];

/** Add any HEADER column the tab predates; a new Audience column is backfilled `private`. */
function ensureColumns(sh, header) {
  const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(String);
  header.forEach((h, i) => {
    if (have[i] === h) return;
    if (have[i]) throw new Error(sh.getName() + ' column ' + (i + 1) + ' is "' + have[i] + '", expected "' + h + '"');
    sh.getRange(1, i + 1).setValue(h);
    const rows = sh.getLastRow() - 1;
    if (h === 'Audience' && rows > 0) sh.getRange(2, i + 1, rows, 1).setValue('private');
  });
}

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
    'Due', 'Status', 'Closed', 'Tag', 'Source', 'Sensitive', 'Audience'];
  const COL = {};
  HEADER.forEach((h, i) => { COL[h] = i; });

  function _sheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('Loops');
    if (!sh) {
      sh = ss.insertSheet('Loops');
      sh.appendRow(HEADER);
    }
    ensureColumns(sh, HEADER);
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
        f.contact || '', f.due || '', 'open', '', f.tag || '', f.source || '', f.sensitive ? 'yes' : '', f.audience]);
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

  // Correct an open loop without editing it: append the corrected row under a
  // new Id, mark the old one superseded. Null when the Id is absent or not open.
  function amend(id, f) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = _sheet();
      const values = sh.getDataRange().getValues();
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][COL.Id]) !== String(id)) continue;
        if (String(values[i][COL.Status]) !== 'open') return null;
        const row = values[i].slice(0, HEADER.length);
        const newId = nextRowId(values.slice(1).map(r => r[COL.Id]), 'L');
        ['Owner', 'Counterpart', 'Ask', 'Channel', 'Contact', 'Due', 'Tag', 'Source', 'Audience'].forEach(h => {
          const v = f[h.toLowerCase()];
          if (v !== undefined && v !== '') row[COL[h]] = v;
        });
        row[COL.Id] = newId;
        row[COL.Source] = [row[COL.Source], 'amends ' + id].filter(Boolean).join(' | ');
        sh.appendRow(row);
        sh.getRange(i + 1, COL.Status + 1).setValue('superseded');
        sh.getRange(i + 1, COL.Closed + 1).setValue(new Date());
        sh.getRange(i + 1, COL.Source + 1).setValue(
          [values[i][COL.Source], 'superseded by ' + newId].filter(Boolean).join(' | '));
        return { id: newId, supersedes: id };
      }
      return null;
    } finally {
      lock.releaseLock();
    }
  }

  return { HEADER, open, close, amend };
})();

const Record = (() => {

  const HEADER = ['Id', 'Date', 'Kind', 'Who', 'Words', 'Source', 'Supersedes', 'Tag', 'Sensitive', 'Audience'];
  // `event` is a dated gathering: Date is when it happens, Words is what, where and what time.
  const KINDS = ['ruling', 'meeting', 'finding', 'event'];

  function _sheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('Record');
    if (!sh) {
      sh = ss.insertSheet('Record');
      sh.appendRow(HEADER);
    }
    ensureColumns(sh, HEADER);
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
        f.supersedes || '', f.tag || '', f.sensitive ? 'yes' : '', f.audience]);
      return id;
    } finally {
      lock.releaseLock();
    }
  }

  return { HEADER, KINDS, append };
})();
