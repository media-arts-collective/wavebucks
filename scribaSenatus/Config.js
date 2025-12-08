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
        description: 'Show help message',
        category: 'Balance & Information',
        icon: '💰',
        example: 'HELP'
      },
      {
        type: 'QUOT',
        pattern: /^QUOT|^BALANCE/i,
        service: 'InboxProcessor',
        method: 'QUOT',
        description: 'Check balance and view active items',
        category: 'Balance & Information',
        icon: '💰',
        example: 'QUOT or BALANCE'
      },
      {
        type: 'CAUSA',
        pattern: /^CAUSA/i,
        service: 'Causae',
        method: 'createCausa',
        description: 'Create collective vote with wagers',
        category: 'Causae (Voting & Wagering)',
        icon: '🗳️',
        example: 'CAUSA Best pizza topping | Pepperoni | Mushrooms | CLOSE 2025-12-31 | MIN 5'
      },
      {
        type: 'VOTE',
        pattern: /^VOTE/i,
        service: 'Causae',
        method: 'vote',
        description: 'Vote on a causa with wager',
        category: 'Causae (Voting & Wagering)',
        icon: '🗳️',
        example: 'VOTE 1 0 10'
      },
      {
        type: 'RESOLVE',
        pattern: /^RESOLVE/i,
        service: 'Causae',
        method: 'resolveCausa',
        description: 'Resolve causa and distribute winnings',
        category: 'Causae (Voting & Wagering)',
        icon: '🗳️',
        example: 'RESOLVE 1 0'
      },
      {
        type: 'COMMISSIO',
        pattern: /^COMMISSIO/i,
        service: 'Commissio',
        method: 'createCommissio',
        description: 'Create bounty task with reward',
        category: 'Commissiones (Bounty Tasks)',
        icon: '📋',
        example: 'COMMISSIO Fix login bug | REWARD 50 | EXPIRES 2025-12-20'
      },
      {
        type: 'ACCEPT',
        pattern: /^ACCEPT/i,
        service: 'Commissio',
        method: 'acceptCommissio',
        description: 'Accept and claim a commissio',
        category: 'Commissiones (Bounty Tasks)',
        icon: '📋',
        example: 'ACCEPT 3'
      },
      {
        type: 'COMPLETE',
        pattern: /^COMPLETE/i,
        service: 'Commissio',
        method: 'completeCommissio',
        description: 'Complete commissio and claim reward',
        category: 'Commissiones (Bounty Tasks)',
        icon: '📋',
        example: 'COMPLETE 3'
      },
      {
        type: 'TRANSFER',
        pattern: /^TRANSFER/i,
        service: 'DispatchTable',
        method: 'TRANSFER',
        description: 'Transfer Wavebucks to another user',
        category: 'Transfers',
        icon: '💸',
        example: 'TRANSFER friend@example.com 25'
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
