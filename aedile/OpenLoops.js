// OpenLoops.js -- sheet helper for the "OpenLoops" tab: per thread, whether
// triage flagged something worth checking back on, and when. Written by
// InboxProcessor.reviewMessage(), read by BumpChecker.js.
// Columns: ThreadId | Open | LastMessageDate | RecheckAfterDays |
// NextCheckDate | LastBumpDate | UpdatedAt

const OpenLoops = (() => {

  const HEADER = ['ThreadId', 'Open', 'LastMessageDate', 'RecheckAfterDays', 'NextCheckDate', 'LastBumpDate', 'UpdatedAt'];

  const COL = {
    THREAD_ID: 0,
    OPEN: 1,
    LAST_MESSAGE_DATE: 2,
    RECHECK_AFTER_DAYS: 3,
    NEXT_CHECK_DATE: 4,
    LAST_BUMP_DATE: 5,
    UPDATED_AT: 6
  };

  // recheck_after_days is model output driving a schedule: clamped, not trusted.
  const MIN_RECHECK_DAYS = 1;
  const MAX_RECHECK_DAYS = 60;
  const DEFAULT_RECHECK_DAYS = 3;

  function _sheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('OpenLoops');
    if (!sh) {
      sh = ss.insertSheet('OpenLoops');
      sh.appendRow(HEADER);
    }
    return sh;
  }

  function _sanitizeRecheckDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n < MIN_RECHECK_DAYS) return DEFAULT_RECHECK_DAYS;
    return Math.min(n, MAX_RECHECK_DAYS);
  }

  // Insert or update the row for threadId. Always overwrites rather than
  // merging: the latest decision supersedes the last. LastBumpDate is only
  // written by markBumped().
  function upsert(threadId, { open, lastMessageDate, recheckAfterDays }) {
    const sh = _sheet();
    const rows = sh.getDataRange().getValues();
    const now = new Date();
    const recheckDays = _sanitizeRecheckDays(recheckAfterDays);
    const nextCheckDate = new Date(lastMessageDate);
    nextCheckDate.setDate(nextCheckDate.getDate() + recheckDays);

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][COL.THREAD_ID] === threadId) {
        sh.getRange(i + 1, COL.OPEN + 1, 1, 4)
          .setValues([[open, lastMessageDate, recheckDays, nextCheckDate]]);
        sh.getRange(i + 1, COL.UPDATED_AT + 1).setValue(now);
        return;
      }
    }

    sh.appendRow([threadId, open, lastMessageDate, recheckDays, nextCheckDate, '', now]);
  }

  // Open threads whose NextCheckDate has arrived. `ignoreDue: true` returns
  // every open loop; not the normal path.
  function getDue(now, { ignoreDue } = {}) {
    const rows = _sheet().getDataRange().getValues().slice(1);
    return rows
      .map((r, i) => ({
        rowNum: i + 2,
        threadId: r[COL.THREAD_ID],
        open: r[COL.OPEN],
        lastMessageDate: r[COL.LAST_MESSAGE_DATE],
        recheckAfterDays: r[COL.RECHECK_AFTER_DAYS],
        nextCheckDate: r[COL.NEXT_CHECK_DATE],
        lastBumpDate: r[COL.LAST_BUMP_DATE] || null
      }))
      .filter(r => r.open === true && (ignoreDue || (r.nextCheckDate && new Date(r.nextCheckDate) <= now)));
  }

  /** Stamp LastBumpDate after BumpChecker actually sends/drafts a nudge for threadId. */
  function markBumped(threadId, when) {
    const sh = _sheet();
    const rows = sh.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][COL.THREAD_ID] === threadId) {
        sh.getRange(i + 1, COL.LAST_BUMP_DATE + 1).setValue(when);
        return;
      }
    }
  }

  return { upsert, getDue, markBumped };
})();
