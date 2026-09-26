/**
 * ReadApi.js
 * A read-only, token-gated Web App endpoint for pulling Aedile's own
 * bookkeeping tabs (OpenLoops, Messages, Log, Requests) out as JSON, so an
 * outside dev-ops workflow can read institutional-memory state on demand
 * without Sheets/Gmail credentials. Mirrors the doGet-returns-JSON pattern
 * the rest of this ecosystem's trackers already use (see the web intake
 * contract), but strictly READ-ONLY: nothing here mutates a sheet, sends
 * mail, marks a thread, or touches a guardrail. It is purely a viewer over
 * data the triage/bump tiers already wrote.
 *
 * SECURITY — this exposes raw mailing-list archive content (message bodies).
 * Treat the deployed URL *and* the token as secrets together.
 *   - Gated by the `READ_API_TOKEN` Script Property. If that property is
 *     unset, the endpoint refuses every request (fail closed) — deploying
 *     the code is not enough; a token must be set deliberately.
 *   - Deploy as: Execute as = me (the krewe account), Who has access =
 *     "Anyone with the link". Access is really controlled by the token in
 *     the query string, not by Google's anonymous-link setting.
 *   - Independent of AEDILE_ENABLED / AUTOSEND_ENABLED / BUMP_ENABLED —
 *     this is not part of the trigger-driven path and has no kill switch of
 *     its own beyond removing the token (which disables it) or deleting the
 *     deployment.
 *
 * DEPLOY:
 *   1. clasp push
 *   2. In the Apps Script editor: Project Settings > Script Properties, add
 *      READ_API_TOKEN = <a long random string>.
 *   3. Deploy > New deployment > Web app (Execute as: me, Access: anyone
 *      with the link). Copy the /exec URL.
 *   4. Call: <exec-url>?token=<READ_API_TOKEN>&scope=openloops
 *
 * SCOPES (all GET):
 *   ?scope=openloops[&open=true]
 *       OpenLoops rows. open=true returns only currently-open loops.
 *   ?scope=messages[&q=<kw>][&threadId=<id>][&limit=<n>]
 *       Raw Messages archive. q filters case-insensitively over From/
 *       Subject/Body; threadId filters to one thread. Newest first.
 *       limit default 50, hard cap 500.
 *   ?scope=log[&limit=<n>]        Recent Log rows, newest first (cap 500).
 *   ?scope=requests[&status=open] Requests rows; status filters.
 *   ?scope=thread&threadId=<id>
 *       LIVE GMAIL, not a sheet (#35). Every message on that thread — From/To/
 *       Cc/Date/Subject/plain body — read or unread. Widens this endpoint from
 *       "what aedile archived" to "any thread in the krewe mailbox, by id",
 *       which is why the token gate above matters more, not less. Adds no new
 *       OAuth scope: the project already reads Gmail in InboxProcessor.
 */

// Column layouts mirror the writers: MessageLog.js, OpenLoops.js,
// Config.js (Log), Requests.js. Kept here as a local read-map so this file
// never has to reach into those modules' private COL objects.
const READ_API = (() => {

  const MAX_LIMIT = 500;
  const DEFAULT_LIMIT = 50;

  function _tab(name) {
    return SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName(name);
  }

  // Turn a sheet into an array of objects keyed by its header row.
  function _rows(name) {
    const sh = _tab(name);
    if (!sh) return [];
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return [];
    const header = values[0];
    return values.slice(1).map(r => {
      const o = {};
      header.forEach((h, i) => { o[String(h)] = r[i]; });
      return o;
    });
  }

  function _clampLimit(raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
  }

  function openloops(p) {
    let rows = _rows('OpenLoops');
    if (String(p.open) === 'true') rows = rows.filter(r => r.Open === true || r.Open === 'TRUE');
    return rows;
  }

  function messages(p) {
    let rows = _rows('Messages');
    if (p.threadId) rows = rows.filter(r => String(r.ThreadId) === String(p.threadId));
    if (p.q) {
      const q = String(p.q).toLowerCase();
      rows = rows.filter(r =>
        String(r.From || '').toLowerCase().includes(q) ||
        String(r.Subject || '').toLowerCase().includes(q) ||
        String(r.Body || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => new Date(b.Date) - new Date(a.Date)); // newest first
    return rows.slice(0, _clampLimit(p.limit));
  }

  function log(p) {
    const rows = _rows('Log');
    rows.reverse(); // newest first (Log is append-only, oldest-first on disk)
    return rows.slice(0, _clampLimit(p.limit));
  }

  function requests(p) {
    let rows = _rows('Requests');
    if (p.status) rows = rows.filter(r => String(r.Status) === String(p.status));
    return rows;
  }

  /**
   * The one scope that reads Gmail instead of a sheet (#35). It exists because
   * a thread is sometimes the ONLY copy: a director sending under the
   * kreweofvaporwave@ alias from their own mailbox leaves the Sent copy in
   * THAT mailbox, never the krewe's, and mail already read never reaches the
   * Messages tab once the triage trigger stops. getMessages() returns the
   * whole thread regardless of read state, which is the point — the unread
   * replies are findable without this, the root message is not.
   *
   * Throws rather than returning an error row: handle() turns that into a 500
   * with the message, which is the loud failure a missing thread deserves.
   */
  function thread(p) {
    if (!p.threadId) throw new Error('scope=thread requires threadId.');
    const t = GmailApp.getThreadById(String(p.threadId));
    if (!t) throw new Error(`thread ${p.threadId} not found.`);
    return t.getMessages().map(m => ({
      MessageId: m.getId(),
      Date: m.getDate(),
      From: m.getFrom(),
      To: m.getTo(),
      Cc: m.getCc(),
      Subject: m.getSubject(),
      Body: m.getPlainBody(),
    }));
  }

  const SCOPES = { openloops, messages, log, requests, thread };

  function handle(params) {
    const configured = PropertiesService.getScriptProperties().getProperty('READ_API_TOKEN');
    if (!configured) return { status: 503, body: { ok: false, error: 'READ_API_TOKEN not set; endpoint disabled.' } };
    if (!params.token || params.token !== configured) return { status: 403, body: { ok: false, error: 'Invalid or missing token.' } };

    const scope = params.scope;
    const fn = SCOPES[scope];
    if (!fn) return { status: 400, body: { ok: false, error: 'Unknown scope. Use one of: ' + Object.keys(SCOPES).join(', ') } };

    const rows = fn(params);
    return { status: 200, body: { ok: true, scope, count: rows.length, rows } };
  }

  return { handle };
})();

/**
 * Web App entry point. Apps Script has no real HTTP status codes for
 * ContentService, so the status is echoed inside the JSON body instead;
 * callers should check `ok`, not rely on the HTTP code.
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  let result;
  try {
    result = READ_API.handle(params);
  } catch (err) {
    result = { status: 500, body: { ok: false, error: String(err && err.message || err) } };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result.body))
    .setMimeType(ContentService.MimeType.JSON);
}
