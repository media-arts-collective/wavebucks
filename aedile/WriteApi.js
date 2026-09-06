/**
 * WriteApi.js
 * A token-gated Web App endpoint that lets an external caller trigger
 * Aedile's own worker functions on demand (`scanInbox`, `checkBumps`),
 * instead of waiting for their installed time-based triggers or a director
 * manually running them from the Apps Script editor.
 *
 * SECURITY — unlike ReadApi.js, this endpoint can cause REAL side effects:
 * scanInbox/checkBumps can auto-send mail via replyAll() to any thread whose
 * participants clear the AUTOSEND_ALLOWLIST. Gated separately from ReadApi:
 *   - Requires its own `WRITE_API_TOKEN` Script Property (deliberately not
 *     shared with READ_API_TOKEN — read access and trigger access are
 *     independently revocable). Fails closed if unset.
 *   - Existing kill switches (AEDILE_ENABLED, BUMP_ENABLED) and autosend
 *     guardrails (AUTOSEND_ENABLED, AUTOSEND_ALLOWLIST, MAX_AUTOSEND_PER_RUN)
 *     still apply — this endpoint only reaches the same `scanInbox()`/
 *     `checkBumps()` entry points a time trigger or manual run would use.
 *     It adds no bypass of any kind.
 *   - POST only (not doGet) so a bare link/prefetch can't trigger a run.
 *   - Neither worker uses LockService (a known, separately-tracked gap —
 *     see aedile/CLAUDE.md "Known bugs"), so overlapping invocations (e.g.
 *     this endpoint firing while the hourly trigger is also mid-run) carry
 *     the same already-documented risk as two overlapping time triggers.
 *     This endpoint doesn't add that risk, but doesn't fix it either.
 *
 * DEPLOY:
 *   1. clasp push
 *   2. In the Apps Script editor: Project Settings > Script Properties, add
 *      WRITE_API_TOKEN = <a long random string, different from READ_API_TOKEN>.
 *   3. Deploy > Manage deployments > edit the existing Web app deployment (or
 *      New deployment) so it picks up doPost. Execute as: me, Access: anyone
 *      with the link.
 *   4. Call: POST <exec-url>?token=<WRITE_API_TOKEN>&action=scanInbox
 *
 * ACTIONS (all POST):
 *   ?action=scanInbox[&dryRun=true]                   Runs scanInbox() (= InboxProcessor.scanUnread()).
 *   ?action=checkBumps[&dryRun=true][&ignoreDue=true]  Runs checkBumps() (= BumpChecker.checkBumps()).
 *       ignoreDue=true evaluates every currently-open loop regardless of its
 *       scheduled NextCheckDate — for re-checking existing loops against
 *       improved judgment without waiting out a schedule set before the
 *       improvement existed. Not the normal daily-trigger path.
 *   ?action=draftRecap[&dryRun=true]  + a `transcript` form field
 *       Drafts a meeting recap to the krewe mailing list (MeetingRecap.js).
 *       The transcript goes in the POST BODY as a form field, not the query
 *       string, so length is not a constraint:
 *
 *         curl -X POST "<exec-url>" \
 *           -d token=<WRITE_API_TOKEN> -d action=draftRecap \
 *           --data-urlencode transcript@transcript.txt
 *
 *       This action can never send mail. Its only Gmail effect is
 *       GmailApp.createDraft() -- see MeetingRecap.js for why that carve-out
 *       from "never originate threads" is bounded.
 *
 * dryRun and ignoreDue accept ONLY the exact strings "true" and "false".
 * Absent or empty means false, so no existing caller changes behaviour, but a
 * value this endpoint cannot read is refused with a 400 rather than guessed
 * at. It used to be `String(params.dryRun) === 'true'`, which read every
 * unrecognised value as false — so `dryRun=1`, `dryRun=yes` and `dryRun=ture`
 * each executed a REAL run that can auto-send mail. A misspelled safety flag
 * meaning "no safety" is the wrong direction for this endpoint to fail in,
 * and it disagreed with the token check above, which fails closed.
 *
 * dryRun=true runs the full pipeline — Claude decision-making, eligibility/
 * cap checks — but suppresses every real side effect: no thread.replyAll(),
 * no createDraftReply(), no Gmail labels, no Sheets writes (Log/OpenLoops/
 * Requests/Messages are all skipped, since a real write to Log or OpenLoops
 * would corrupt dedup/scheduling state for subsequent REAL runs — see
 * Config.isMessageProcessed and OpenLoops.getDue). Both worker functions
 * now return a result object ({processed/evaluated, autosent, results: [...]})
 * describing what happened or would have happened, which this endpoint
 * relays back in its JSON response — for a real (non-dry-run) call this is
 * a convenience summary in addition to, not instead of, the Log/OpenLoops
 * tabs (check those via ReadApi for the authoritative record).
 */

const WRITE_API = (() => {

  const ACTIONS = {
    scanInbox: scanInbox,
    checkBumps: checkBumps,
    draftRecap: draftRecap,
  };

  // draftRecap is the one action that carries a payload rather than just
  // flipping switches. It reads e.parameter.transcript, which for a POST is
  // the form-encoded body, NOT the query string — so a 40-minute transcript
  // is fine and no URL length limit applies. Send it as
  // `-d action=draftRecap -d token=... --data-urlencode transcript@file`.
  const PAYLOAD_ACTIONS = { draftRecap: 'transcript' };

  /**
   * Strictly parse a boolean query parameter, defaulting to false when absent.
   *
   * The old form was `String(params.dryRun) === 'true'`, which treated every
   * value it did not recognise as false. `dryRun=1`, `dryRun=yes` and
   * `dryRun=ture` all read as "not a dry run" and executed a REAL run — one
   * that can auto-send mail via replyAll() with no human between the decision
   * and delivery. A misspelled safety flag quietly meaning "no safety" is the
   * wrong direction for this endpoint to fail in, and it disagreed with the
   * token check two lines up, which fails closed.
   *
   * Absent still means false, so no existing caller changes behaviour; a value
   * this function cannot read is now refused instead of guessed at.
   */
  function strictBool(value, name) {
    if (value === undefined || value === null || value === '') return false;
    const s = String(value);
    if (s === 'true') return true;
    if (s === 'false') return false;
    throw new Error(`${name} must be exactly "true" or "false" (got "${s}").`);
  }

  function handle(params) {
    const configured = PropertiesService.getScriptProperties().getProperty('WRITE_API_TOKEN');
    if (!configured) return { status: 503, body: { ok: false, error: 'WRITE_API_TOKEN not set; endpoint disabled.' } };
    if (!params.token || params.token !== configured) return { status: 403, body: { ok: false, error: 'Invalid or missing token.' } };

    const action = params.action;
    const fn = ACTIONS[action];
    if (!fn) return { status: 400, body: { ok: false, error: 'Unknown action. Use one of: ' + Object.keys(ACTIONS).join(', ') } };

    let dryRun, ignoreDue;
    try {
      dryRun = strictBool(params.dryRun, 'dryRun');
      ignoreDue = strictBool(params.ignoreDue, 'ignoreDue');
    } catch (err) {
      return { status: 400, body: { ok: false, error: String(err.message) } };
    }

    let result;
    if (PAYLOAD_ACTIONS[action]) {
      const payload = params[PAYLOAD_ACTIONS[action]];
      if (!payload) {
        return { status: 400, body: { ok: false, error: `${action} requires a "${PAYLOAD_ACTIONS[action]}" parameter. POST it as a form field, not in the query string.` } };
      }
      result = fn(payload, dryRun);
    } else if (action === 'checkBumps') {
      result = fn(dryRun, ignoreDue);
    } else {
      result = fn(dryRun);
    }
    return { status: 200, body: { ok: true, action, dryRun, ignoreDue, result } };
  }

  return { handle };
})();

function doPost(e) {
  const params = (e && e.parameter) || {};
  let result;
  try {
    result = WRITE_API.handle(params);
  } catch (err) {
    result = { status: 500, body: { ok: false, error: String(err && err.message || err) } };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result.body))
    .setMimeType(ContentService.MimeType.JSON);
}
