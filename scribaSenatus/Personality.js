/**
 * Personality.gs
 * Provides all text and HTML message templates for Scriba Senatus.
 * Reads from the "Personality" tab of the Config spreadsheet.
 *
 * Columns expected:
 *   A: key (e.g. WELCOME, HELP, ERROR)
 *   B: subject (optional)
 *   C: html (body content)
 *   D: lastEdited (optional)
 */

const Personality = (() => {

  /** Cache for faster repeated lookups */
  const _cache = {};

  /** Get HTML string for a given key */
  function get(key) {
    key = String(key).toUpperCase().trim();
    if (_cache[key]) return _cache[key];

    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    const sh = ss.getSheetByName('Personality');
    if (!sh) throw new Error("❌ Personality sheet not found in Config spreadsheet.");
    
    const rows = sh.getDataRange().getValues().slice(1);
    const row = rows.find(r => String(r[0]).toUpperCase() === key);
    if (!row) return `<p>[Missing personality text for ${key}]</p>`;

    const html = row[2] || '';
    _cache[key] = html;
    return html;
  }

  /** Force refresh of cached entries (for testing or after edits) */
  function refresh() { Object.keys(_cache).forEach(k => delete _cache[k]); }

  return { get, refresh };

})();
