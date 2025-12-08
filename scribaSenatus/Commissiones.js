/**
 * Commissiones.js
 * Manages bounty task system (Commissiones)
 * Integrates with Wavebucks for escrow and reward distribution
 */

const Commissio = (() => {

  /**
   * Get reference to Commissiones sheet
   */
  function getSheet() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    let sh = ss.getSheetByName('Commissiones');
    if (!sh) {
      sh = ss.insertSheet('Commissiones');
      sh.appendRow(['ID', 'Title', 'Creator', 'Reward', 'Expiry', 'Status', 'Assignee', 'Created', 'Completed', 'Notes']);
    }
    return sh;
  }

  /**
   * Create a new commissio (bounty task)
   * @param {string} creatorEmail - Email of creator
   * @param {string} title - Description of task
   * @param {number} reward - Reward amount in Wavebucks
   * @param {Date} expiry - When task expires
   * @returns {number} Commissio ID
   */
  function createCommissio(creatorEmail, title, reward, expiry) {
    // Check creator has sufficient balance
    const balance = Wavebucks.Wavebucks.getBalance(creatorEmail);
    if (balance < reward) {
      throw new Error(`Insufficient funds. Your balance: &#8361;${balance}, Required: &#8361;${reward}`);
    }

    // Escrow the reward immediately
    Wavebucks.Wavebucks.debit(creatorEmail, reward, `Created Commissio: ${title}`);

    const sh = getSheet();
    const rows = sh.getDataRange().getValues();
    const nextId = rows.length; // Header is row 1, so length = next ID

    sh.appendRow([
      nextId,
      title,
      creatorEmail,
      reward,
      expiry,
      'OPEN',
      '', // assignee (empty until accepted)
      new Date(), // created
      '', // completed (empty until done)
      'Reward held in escrow'
    ]);

    Logger.log(`&#9989; Commissio ${nextId} created: ${title}, reward &#8361;${reward}`);
    return nextId;
  }

  /**
   * Accept a commissio (claim the task)
   * @param {string} acceptorEmail - Email of person accepting
   * @param {number} commissionId - ID of commissio to accept
   */
  function acceptCommissio(acceptorEmail, commissionId) {
    const sh = getSheet();
    const rows = sh.getDataRange().getValues();
    const rowIndex = rows.findIndex(r => r[0] === commissionId);

    if (rowIndex === -1) throw new Error(`Commissio ${commissionId} not found`);

    const row = rows[rowIndex];
    const status = String(row[5]).toUpperCase();

    if (status !== 'OPEN') throw new Error(`Commissio ${commissionId} is ${status}`);

    const expiry = new Date(row[4]);
    if (new Date() > expiry) {
      throw new Error(`Commissio ${commissionId} has expired`);
    }

    // Assign to acceptor
    sh.getRange(rowIndex + 1, 5).setValue('ASSIGNED');
    sh.getRange(rowIndex + 1, 7).setValue(acceptorEmail); // Column G: Assignee
    sh.getRange(rowIndex + 1, 10).setValue(`Accepted by ${acceptorEmail}`);

    Logger.log(`&#9989; ${acceptorEmail} accepted Commissio ${commissionId}`);
  }

  /**
   * Complete a commissio and claim reward
   * @param {string} completerEmail - Email of person completing (must be assignee)
   * @param {number} commissionId - ID of commissio to complete
   * @returns {number} Reward amount
   */
  function completeCommissio(completerEmail, commissionId) {
    const sh = getSheet();
    const rows = sh.getDataRange().getValues();
    const rowIndex = rows.findIndex(r => r[0] === commissionId);

    if (rowIndex === -1) throw new Error(`Commissio ${commissionId} not found`);

    const row = rows[rowIndex];
    const status = String(row[5]).toUpperCase();
    const assignee = row[6];

    if (status !== 'ASSIGNED') {
      throw new Error(`Commissio ${commissionId} is ${status}. Must be ASSIGNED to complete.`);
    }

    if (assignee !== completerEmail) {
      throw new Error(`Only assignee (${assignee}) can complete this commissio`);
    }

    const reward = row[3];
    const title = row[1];

    // Credit reward to completer
    Wavebucks.Wavebucks.credit(completerEmail, reward, `Completed Commissio ${commissionId}: ${title}`);

    // Mark as completed
    sh.getRange(rowIndex + 1, 6).setValue('COMPLETED');
    sh.getRange(rowIndex + 1, 9).setValue(new Date()); // Column I: Completed
    sh.getRange(rowIndex + 1, 10).setValue(`Completed by ${completerEmail}, reward &#8361;${reward} paid`);

    Logger.log(`&#127942; ${completerEmail} completed Commissio ${commissionId}, earned &#8361;${reward}`);
    return reward;
  }

  /**
   * Get list of active (OPEN or ASSIGNED) commissiones for display
   * @returns {Array<string>} HTML-formatted list items
   */
  function getActiveList() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    const sh = ss.getSheetByName('Commissiones');
    if (!sh) return ['<i>(no active Commissiones)</i>'];

    const rows = sh.getDataRange().getValues().slice(1); // Skip header
    const active = rows.filter(r => {
      const status = String(r[5]).toUpperCase();
      return status === 'OPEN' || status === 'ASSIGNED';
    });

    if (active.length === 0) return ['<i>(no active Commissiones)</i>'];

    return active.map(r => {
      const id = r[0];
      const title = r[1];
      const reward = r[3];
      const status = r[5];
      const assignee = r[6] || 'Unassigned';
      return `<b>Commissio ${id}:</b> ${title} — Reward: &#8361;${reward} — Status: ${status} (${assignee})`;
    });
  }

  return {
    createCommissio,
    acceptCommissio,
    completeCommissio,
    getActiveList
  };

})();
