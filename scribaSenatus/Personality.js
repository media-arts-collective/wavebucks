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

    // Special handling for HELP - generate dynamically from lexicon
    if (key === 'HELP') {
      return generateHelpMessage();
    }

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

  /**
   * Generate comprehensive HELP message dynamically from lexicon
   * @returns {string} HTML formatted help message
   */
  function generateHelpMessage() {
    const lexicon = Config.getLexicon();

    let html = `
      <h1>&#128220; Scriba Senatus - Command Reference</h1>
      <p><i>Welcome to the Senate's automated clerk system. Send commands via email to interact with the Wavebucks economy.</i></p>
      <hr/>
    `;

    // Group commands by category (from lexicon metadata)
    const categoriesMap = {};
    lexicon.forEach(cmd => {
      const cat = cmd.category || 'Other';
      if (!categoriesMap[cat]) {
        categoriesMap[cat] = {
          icon: cmd.icon || '📌',
          commands: []
        };
      }
      categoriesMap[cat].commands.push(cmd);
    });

    // Build help text from grouped commands
    Object.entries(categoriesMap).forEach(([categoryName, data]) => {
      html += `<h2>${data.icon} ${categoryName}</h2><ul>`;

      data.commands.forEach(cmd => {
        html += `
          <li>
            <b>${cmd.type}</b> - ${cmd.description || 'No description'}
            <br/><i>Example: ${cmd.example || cmd.type}</i>
          </li>
        `;
      });

      html += '</ul>';
    });

    html += `
      <hr/>
      <h3>&#128218; Tips</h3>
      <ul>
        <li>All commands are <b>case-insensitive</b></li>
        <li>Commands should be at the <b>start of your email body</b></li>
        <li>Dates should be in format: <b>YYYY-MM-DD</b></li>
        <li>Check your balance anytime with <b>QUOT</b></li>
        <li>All transactions are logged and visible in the spreadsheet</li>
      </ul>
      <p><i>Vale! May your decisions be wise and your Wavebucks plentiful.</i></p>
    `;

    return html;
  }

  /** Force refresh of cached entries (for testing or after edits) */
  function refresh() { Object.keys(_cache).forEach(k => delete _cache[k]); }

  return { get, refresh };

})();
