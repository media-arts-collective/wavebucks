/**
 * Causae.js
 * Manages voting/wagering system (Causae)
 * Integrates with Wavebucks for balance management
 */

const Causae = (() => {

  /**
   * Get reference to Causae sheet
   */
  function getSheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('Causae');
    if (!sh) {
      sh = ss.insertSheet('Causae');
      sh.appendRow(['ID', 'Title', 'Options', 'Creator', 'Status', 'TotalPot', 'ClosingDate', 'Votes', 'Notes']);
    }
    return sh;
  }

  /**
   * Create a new causa (voting/wagering question)
   * @param {string} creatorEmail - Email of creator
   * @param {string} title - Question/title of the causa
   * @param {Array<string>} options - Array of voting options
   * @param {Date} closingDate - When voting closes
   * @param {number} minWager - Minimum wager required
   * @returns {number} Causa ID
   */
  function createCausa(creatorEmail, title, options, closingDate, minWager = 1) {
    const sh = getSheet();
    const rows = sh.getDataRange().getValues();
    const nextId = rows.length; // Header is row 1, so length = next ID

    sh.appendRow([
      nextId,
      title,
      JSON.stringify(options),
      creatorEmail,
      'OPEN',
      0, // totalPot
      closingDate,
      JSON.stringify([]), // votes array
      `Min wager: &#8361;${minWager}`
    ]);

    Logger.log(`&#9989; Causa ${nextId} created: ${title}`);
    return nextId;
  }

  /**
   * Cast a vote on a causa with a wager
   * @param {string} voterEmail - Email of voter
   * @param {number} causaId - ID of causa to vote on
   * @param {number} optionIndex - Index of option being voted for
   * @param {number} wager - Amount being wagered
   */
  function vote(voterEmail, causaId, optionIndex, wager) {
    const sh = getSheet();
    const rows = sh.getDataRange().getValues();
    const rowIndex = rows.findIndex(r => r[0] === causaId);

    if (rowIndex === -1) throw new Error(`Causa ${causaId} not found`);

    const row = rows[rowIndex];
    const status = String(row[4]).toUpperCase();
    if (status !== 'OPEN') throw new Error(`Causa ${causaId} is ${status}`);

    const options = JSON.parse(row[2]);
    if (optionIndex < 0 || optionIndex >= options.length) {
      throw new Error(`Invalid option index. Choose 0-${options.length - 1}`);
    }

    // Parse closing date and check if still open
    const closingDate = new Date(row[6]);
    if (new Date() > closingDate) {
      throw new Error(`Causa ${causaId} has closed`);
    }

    // Check minimum wager from notes
    const minWagerMatch = String(row[8]).match(/Min wager: &#8361;(\d+)/);
    const minWager = minWagerMatch ? parseInt(minWagerMatch[1], 10) : 1;
    if (wager < minWager) {
      throw new Error(`Minimum wager is &#8361;${minWager}`);
    }

    // Debit wager from voter's balance
    Wavebucks.debit(voterEmail, wager, `Vote on Causa ${causaId}: ${row[1]}`);

    // Add vote to votes array
    const votes = JSON.parse(row[7]);
    votes.push({ email: voterEmail, option: optionIndex, wager: wager });

    // Update total pot and votes
    const newPot = row[5] + wager;
    sh.getRange(rowIndex + 1, 6).setValue(newPot); // Column F: TotalPot
    sh.getRange(rowIndex + 1, 8).setValue(JSON.stringify(votes)); // Column H: Votes

    Logger.log(`&#9989; ${voterEmail} voted on Causa ${causaId}, option ${optionIndex}, wager &#8361;${wager}`);
  }

  /**
   * Resolve a causa and distribute winnings
   * @param {number} causaId - ID of causa to resolve
   * @param {number} winningOptionIndex - Index of winning option
   * @param {string} resolverEmail - Email of person resolving (must be creator)
   * @returns {object} Result summary
   */
  function resolveCausa(causaId, winningOptionIndex, resolverEmail) {
    const sh = getSheet();
    const rows = sh.getDataRange().getValues();
    const rowIndex = rows.findIndex(r => r[0] === causaId);

    if (rowIndex === -1) throw new Error(`Causa ${causaId} not found`);

    const row = rows[rowIndex];
    const creator = row[3];
    const status = String(row[4]).toUpperCase();

    if (status !== 'OPEN') throw new Error(`Causa ${causaId} already ${status}`);
    if (creator !== resolverEmail) {
      throw new Error(`Only creator (${creator}) can resolve this causa`);
    }

    const options = JSON.parse(row[2]);
    if (winningOptionIndex < 0 || winningOptionIndex >= options.length) {
      throw new Error(`Invalid winning option. Choose 0-${options.length - 1}`);
    }

    const votes = JSON.parse(row[7]);
    const totalPot = row[5];

    // Find winners (those who voted for winning option)
    const winners = votes.filter(v => v.option === winningOptionIndex);

    if (winners.length === 0) {
      // No winners - pot goes to creator
      Wavebucks.credit(creator, totalPot, `Causa ${causaId} resolved - no winners`);
      sh.getRange(rowIndex + 1, 5).setValue('RESOLVED');
      sh.getRange(rowIndex + 1, 9).setValue(`Resolved: ${options[winningOptionIndex]}. No winners, pot to creator.`);

      Logger.log(`&#127942; Causa ${causaId} resolved. No winners, &#8361;${totalPot} to creator.`);

      return {
        causaId: causaId,
        winningOption: options[winningOptionIndex],
        totalPot: totalPot,
        winnersCount: 0
      };
    }

    // Calculate total wager by winners
    const totalWinnerWagers = winners.reduce((sum, w) => sum + w.wager, 0);

    // Distribute pot proportionally
    winners.forEach(winner => {
      const share = Math.floor((winner.wager / totalWinnerWagers) * totalPot);
      Wavebucks.credit(winner.email, share, `Won Causa ${causaId}: ${row[1]}`);
      Logger.log(`  &#127942; ${winner.email} wins &#8361;${share}`);
    });

    // Mark as resolved
    sh.getRange(rowIndex + 1, 5).setValue('RESOLVED');
    sh.getRange(rowIndex + 1, 9).setValue(`Resolved: ${options[winningOptionIndex]}. ${winners.length} winner(s).`);

    Logger.log(`&#127942; Causa ${causaId} resolved. Winning option: ${options[winningOptionIndex]}`);

    return {
      causaId: causaId,
      winningOption: options[winningOptionIndex],
      totalPot: totalPot,
      winnersCount: winners.length
    };
  }

  /**
   * Get list of active (OPEN) causae for display
   * @returns {Array<string>} HTML-formatted list items
   */
  function getActiveList() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    const sh = ss.getSheetByName('Causae');
    if (!sh) return ['<i>(no active Causae)</i>'];

    const rows = sh.getDataRange().getValues().slice(1); // Skip header
    const active = rows.filter(r => String(r[4]).toUpperCase() === 'OPEN');

    if (active.length === 0) return ['<i>(no active Causae)</i>'];

    return active.map(r => {
      const id = r[0];
      const title = r[1];
      const closingDate = r[6] ? new Date(r[6]).toDateString() : 'N/A';
      const totalPot = r[5] || 0;
      return `<b>Causa ${id}:</b> ${title} — Pot: &#8361;${totalPot} — Closes: ${closingDate}`;
    });
  }

  return {
    createCausa,
    vote,
    resolveCausa,
    getActiveList
  };

})();
