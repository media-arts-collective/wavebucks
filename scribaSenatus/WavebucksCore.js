/**
 * ============================================================================
 * WavebucksCore.gs – Core Ledger Library
 * ============================================================================
 * Provides basic ledger operations for the Wavebucks system.
 * Relies on sheetConfig.gs for configuration and helper functions.
 *
 * Designed for use as a Google Apps Script Library.
 * Exports all public functions under the global `Wavebucks` object.
 * ============================================================================
 */

// import helpers from WavebucksConfig
const {
  getBalancesSheet,
  getDataRows,
  sheetRowFromIndex,
  getSheet,
  BAL_EMAIL_COL,
  BAL_BALANCE_COL,
  BAL_TIMESTAMP_COL,
  HEADER_OFFSET,
  INDEX_TO_SHEET,
  LOG_SHEET
} = WavebucksConfig;

// Define a global object so other scripts can call Wavebucks.credit(), etc.
var Wavebucks = (function () {

  /** ------------------------------
   * Internal helper: current timestamp
   * ------------------------------ */
  function _currentTimestamp() {
    return new Date();
  }

  /** ------------------------------
   * Core: ensure user account exists
   * ------------------------------ */
  function ensureAccount(email) {
    if (!email) throw new Error('Email is required');

    const sh = getBalancesSheet();
    const rows = getDataRows(sh); // excludes header
    const exists = rows.some(row => String(row[BAL_EMAIL_COL]).toLowerCase() === email.toLowerCase());

    if (!exists) {
      const timestamp = _currentTimestamp();
      sh.appendRow([email, 0, timestamp]);
      console.log(`✅ Created new account for ${email}`);
    }
  }

  /** ------------------------------
   * Core: getBalance(email)
   * ------------------------------ */
  function getBalance(email) {
    if (!email) throw new Error('Email is required');

    const sh = getBalancesSheet();
    const rows = getDataRows(sh);

    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][BAL_EMAIL_COL]).toLowerCase() === email.toLowerCase()) {
        return Number(rows[i][BAL_BALANCE_COL]);
      }
    }

    throw new Error(`No account found for email: ${email}`);
  }

 /** ------------------------------
 * Core: credit(email, amount, notes)
 * ------------------------------ */
function credit(email, amount, notes = '') {
  if (!email) throw new Error('Email is required');
  if (amount <= 0) throw new Error('Credit amount must be positive');

  ensureAccount(email);

  const sh = getBalancesSheet();
  const rows = getDataRows(sh);
  const rowIndex = rows.findIndex(r => String(r[BAL_EMAIL_COL]).toLowerCase() === email.toLowerCase());
  if (rowIndex === -1) throw new Error(`Account not found for ${email}`);

  const currentBalance = Number(rows[rowIndex][BAL_BALANCE_COL]);
  const newBalance = currentBalance + amount;
  const sheetRow = sheetRowFromIndex(rowIndex + HEADER_OFFSET);

  // Update Balances sheet
  sh.getRange(sheetRow, BAL_BALANCE_COL + INDEX_TO_SHEET).setValue(newBalance);
  sh.getRange(sheetRow, BAL_TIMESTAMP_COL + INDEX_TO_SHEET).setValue(_currentTimestamp());

  // Append to Log sheet (match existing format)
  const logSh = getSheet(LOG_SHEET);
  if (logSh) {
    logSh.appendRow([
      _currentTimestamp(),
      email,
      amount,         // positive for credit
      notes,
      currentBalance, // previous balance
      true            // processed flag
    ]);
  } else {
    console.warn('⚠️ Log sheet not found – skipping log entry.');
  }

  console.log(`💰 Credited ${amount} to ${email}. New balance: ${newBalance}`);
}



  /** ------------------------------
   * Core: debit(email, amount, notes)
   * ------------------------------ */
  function debit(email, amount, notes = '') {
    if (!email) throw new Error('Email is required');
    if (amount <= 0) throw new Error('Debit amount must be positive');

    ensureAccount(email);

    const sh = getBalancesSheet();
    const rows = getDataRows(sh);
    const rowIndex = rows.findIndex(r => String(r[BAL_EMAIL_COL]).toLowerCase() === email.toLowerCase());

    if (rowIndex === -1) throw new Error(`Account not found for ${email}`);

    const currentBalance = Number(rows[rowIndex][BAL_BALANCE_COL]);
    const newBalance = currentBalance - amount;
    const sheetRow = sheetRowFromIndex(rowIndex + HEADER_OFFSET);

    // Update Balances sheet
    sh.getRange(sheetRow, BAL_BALANCE_COL + INDEX_TO_SHEET).setValue(newBalance);
    sh.getRange(sheetRow, BAL_TIMESTAMP_COL + INDEX_TO_SHEET).setValue(_currentTimestamp());

    // Append to Log sheet
    const logSh = getSheet(LOG_SHEET);
    if (logSh) {
      logSh.appendRow([
        _currentTimestamp(),
        email,
        amount,
        notes,
        currentBalance,
        true
      ]);
    } else {
      console.warn('⚠️ Log sheet not found – skipping log entry.');
    }

    console.log(`💸 Debited ${amount} from ${email}. New balance: ${newBalance}`);
  }

  /** ------------------------------
   * Exported API
   * ------------------------------ */
  return {
    ensureAccount,
    getBalance,
    credit,
    debit
  };

})();
