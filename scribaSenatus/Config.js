/**
 * Config.gs
 * Loads constants, lexicon, and personality templates
 * from the Scriba Senatus Config spreadsheet.
 */

const CONFIG_SHEET_ID = '1Po4JCz_Vhy604peHOhvVdZUBXxqS8BwlXkYiGtEfEv8'; //Config values, stored states, etc.

const Config = (() => {
  /** Return all rows from the Config tab as {key:value} map */
  function getAll() {
    const sh = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName('Config');
    const rows = sh.getDataRange().getValues().slice(1);
    const map = {};
    rows.forEach(([key, value]) => map[String(key).trim()] = value);
    return map;
  }

  function get(key) { return getAll()[key]; }

  /**
   * Return command lexicon (hardcoded in code for version control)
   * Each entry maps a command pattern to its handler.
   */
  function getLexicon() {
    return [
      {
        type: 'HELP',
        pattern: /^HELP|^AUXILIUM/i,
        service: 'Personality',
        method: 'HELP',
        description: 'Show help message'
      },
      {
        type: 'QUOT',
        pattern: /^QUOT|^BALANCE/i,
        service: 'InboxProcessor',
        method: 'QUOT',
        description: 'Check balance and view active items'
      },
      {
        type: 'CAUSA',
        pattern: /^CAUSA/i,
        service: 'Causae',
        method: 'createCausa',
        description: 'Create collective vote with wagers'
      },
      {
        type: 'VOTE',
        pattern: /^VOTE/i,
        service: 'Causae',
        method: 'vote',
        description: 'Vote on a causa with wager'
      },
      {
        type: 'RESOLVE',
        pattern: /^RESOLVE/i,
        service: 'Causae',
        method: 'resolveCausa',
        description: 'Resolve causa and distribute winnings'
      },
      {
        type: 'COMMISSIO',
        pattern: /^COMMISSIO/i,
        service: 'Commissio',
        method: 'createCommissio',
        description: 'Create bounty task with reward'
      },
      {
        type: 'ACCEPT',
        pattern: /^ACCEPT/i,
        service: 'Commissio',
        method: 'acceptCommissio',
        description: 'Accept and claim a commissio'
      },
      {
        type: 'COMPLETE',
        pattern: /^COMPLETE/i,
        service: 'Commissio',
        method: 'completeCommissio',
        description: 'Complete commissio and claim reward'
      },
      {
        type: 'TRANSFER',
        pattern: /^TRANSFER/i,
        service: 'DispatchTable',
        method: 'TRANSFER',
        description: 'Transfer Wavebucks to another user'
      }
    ];
  }

  /** Return HTML string from Personality tab for a given key */
  function getPersonality(key) {
    const sh = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName('Personality');
    const rows = sh.getDataRange().getValues().slice(1);
    const row = rows.find(r => String(r[0]).toUpperCase() === key.toUpperCase());
    return row ? row[2] : `<p>[Missing personality text for ${key}]</p>`;
  }

  /** Append to Log tab */
  function logEvent(from, subject, command, handler, status, notes) {
    const sh = SpreadsheetApp.openById(CONFIG_SHEET_ID).getSheetByName('Log');
    sh.appendRow([new Date(), from, subject, command, handler, status, notes]);
  }

  return { get, getAll, getLexicon, getPersonality, logEvent };
})();
