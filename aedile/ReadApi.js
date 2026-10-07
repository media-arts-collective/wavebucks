// ReadApi.js -- read-only, token-gated Web App endpoint over Aedile's
// bookkeeping tabs. Mutates nothing.
// Exposes raw message bodies: treat the deployed URL and the token as secrets
// together. Gated by the READ_API_TOKEN Script Property; fails closed if unset.
//
// Call: GET <exec-url>?token=<READ_API_TOKEN>&scope=<scope>
//   scope=openloops [open=true]
//   scope=messages  [q=<kw>] [threadId=<id>] [limit=<n>]   newest first
//   scope=log       [limit=<n>]                            newest first
//   scope=requests  [status=open]
//
// Every scope reads a sheet. Live Gmail reads are on WriteApi's doPost instead:
// this endpoint's token rides in a query string.

// Column layouts mirror the writers: MessageLog.js, OpenLoops.js, Config.js (Log), Requests.js.
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

  // `open=true` keeps only rows still open.
  function loops(p) {
    let rows = _rows('Loops');
    if (p.open === 'true') rows = rows.filter(r => String(r.Status) === 'open');
    return rows;
  }

  function record(p) {
    const rows = _rows('Record');
    rows.reverse(); // newest first (append-only, oldest-first on disk)
    return rows.slice(0, _clampLimit(p.limit));
  }

  const SCOPES = { openloops, messages, log, requests, loops, record };

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

// Web App entry point. ContentService has no real HTTP status, so it is echoed
// in the JSON body; callers check `ok`.
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
