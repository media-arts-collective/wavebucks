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
        description: 'Display this help message with all available commands, categories, and examples',
        category: 'Balance & Information',
        icon: '&#128176;', // 💰
        example: 'HELP',
        details: 'Shows all commands organized by category with examples and descriptions'
      },
      {
        type: 'QUOT',
        pattern: /^QUOT|^BALANCE/i,
        service: 'InboxProcessor',
        method: 'QUOT',
        description: 'Check your current Wavebucks balance and see all active Causae and Commissiones',
        category: 'Balance & Information',
        icon: '&#128176;', // 💰
        example: 'QUOT',
        details: 'Displays your balance, all open causae with pots, and all active commissiones with rewards'
      },
      {
        type: 'CAUSA',
        pattern: /^CAUSA/i,
        service: 'Causae',
        method: 'createCausa',
        description: 'Create a collective vote with wagers. Separate options with |. Optional: CLOSE date, MIN wager (defaults: 7 days, &#8361;1)',
        category: 'Causae (Voting & Wagering)',
        icon: '&#128179;', // 🗳️
        example: 'CAUSA Best pizza topping | Pepperoni | Mushrooms | CLOSE 2025-12-31 | MIN 5',
        details: 'Format: CAUSA &lt;title&gt; | &lt;option1&gt; | &lt;option2&gt; | ... | CLOSE &lt;YYYY-MM-DD&gt; | MIN &lt;wager&gt;'
      },
      {
        type: 'VOTE',
        pattern: /^VOTE/i,
        service: 'Causae',
        method: 'vote',
        description: 'Vote on an open causa with a wager. Format: VOTE &lt;causaId&gt; &lt;optionIndex&gt; &lt;amount&gt;. Options start at 0',
        category: 'Causae (Voting & Wagering)',
        icon: '&#128179;', // 🗳️
        example: 'VOTE 1 0 10',
        details: 'Example: VOTE 1 0 10 means vote on causa #1, choose option 0 (first option), wager &#8361;10. Wager deducted immediately'
      },
      {
        type: 'RESOLVE',
        pattern: /^RESOLVE/i,
        service: 'Causae',
        method: 'resolveCausa',
        description: 'Resolve a causa and distribute winnings to voters who chose the winning option. Only creator can resolve',
        category: 'Causae (Voting & Wagering)',
        icon: '&#128179;', // 🗳️
        example: 'RESOLVE 1 0',
        details: 'Format: RESOLVE &lt;causaId&gt; &lt;winningOptionIndex&gt;. Distributes pot proportionally to winners'
      },
      {
        type: 'COMMISSIO',
        pattern: /^COMMISSIO/i,
        service: 'Commissio',
        method: 'createCommissio',
        description: 'Create a bounty task with escrowed reward. Optional: REWARD amount, EXPIRES date (defaults: &#8361;10, 30 days)',
        category: 'Commissiones (Bounty Tasks)',
        icon: '&#128203;', // 📋
        example: 'COMMISSIO Fix login bug | REWARD 50 | EXPIRES 2025-12-20',
        details: 'Format: COMMISSIO &lt;title&gt; | REWARD &lt;amount&gt; | EXPIRES &lt;YYYY-MM-DD&gt;. Reward is held in escrow until completed'
      },
      {
        type: 'ACCEPT',
        pattern: /^ACCEPT/i,
        service: 'Commissio',
        method: 'acceptCommissio',
        description: 'Accept and claim an open commissio. Assigns the task to you',
        category: 'Commissiones (Bounty Tasks)',
        icon: '&#128203;', // 📋
        example: 'ACCEPT 3',
        details: 'Format: ACCEPT &lt;commissionId&gt;. Changes status from OPEN to ASSIGNED'
      },
      {
        type: 'COMPLETE',
        pattern: /^COMPLETE/i,
        service: 'Commissio',
        method: 'completeCommissio',
        description: 'Mark your assigned commissio as complete and claim the escrowed reward. Only assignee can complete',
        category: 'Commissiones (Bounty Tasks)',
        icon: '&#128203;', // 📋
        example: 'COMPLETE 3',
        details: 'Format: COMPLETE &lt;commissionId&gt;. Releases escrowed reward to you'
      },
      {
        type: 'TRANSFER',
        pattern: /^TRANSFER/i,
        service: 'DispatchTable',
        method: 'TRANSFER',
        description: 'Send Wavebucks to another user. Requires sufficient balance',
        category: 'Transfers',
        icon: '&#128184;', // 💸
        example: 'TRANSFER friend@example.com 25',
        details: 'Format: TRANSFER &lt;email&gt; &lt;amount&gt;. Direct peer-to-peer transaction'
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
