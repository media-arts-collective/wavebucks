/**
 * OpenLoops.js
 * Sheet helper for the "OpenLoops" tab — tracks, per thread, whether the
 * regular triage call flagged an unresolved question or commitment worth
 * checking back on, and when. Populated by InboxProcessor.reviewMessage()
 * after every triage decision; read by BumpChecker.js's daily pass to find
 * threads due for a recheck without rescanning the whole raw archive.
 *
 * This is purely mechanical bookkeeping — an open/closed flag plus a next-
 * check date — not a revival of the retired Threads/Shards summarization
 * tier. It doesn't store a summary, entities, or participants, and doesn't
 * do any fuzzy cross-thread matching.
 *
 * Columns: ThreadId | Open | LastMessageDate | RecheckAfterDays |
 * NextCheckDate | LastBumpDate | UpdatedAt
 */

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

  // Guards against a missing/garbage recheck_after_days from the model —
  // clamped, not trusted outright, same reasoning as any other model output
  // that drives a scheduling decision.
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

  /**
   * Insert or update the OpenLoops row for threadId from the latest triage
   * (or bump-check) decision. Always overwrites Open/LastMessageDate/
   * RecheckAfterDays/NextCheckDate rather than merging — the model sees the
   * whole thread on every call, so its latest open_loop call supersedes
   * whatever it said last time (a reply can close a loop that was open, or
   * reopen one that looked closed). LastBumpDate is untouched here — only
   * markBumped() writes it.
   */
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

  /**
   * Open threads whose NextCheckDate has arrived, for BumpChecker.checkBumps().
   * `ignoreDue: true` returns every currently-open loop regardless of its
   * scheduled NextCheckDate — for re-evaluating existing loops against
   * improved judgment (e.g. a prompt tuning) without waiting out a schedule
   * set before the improvement existed. Not the normal path; BumpChecker's
   * daily trigger always calls this without ignoreDue.
   */
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
