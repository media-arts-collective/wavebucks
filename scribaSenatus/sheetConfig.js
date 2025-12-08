/**
 * ============================================================================
 * sheetConfig.gs – Configuration & sheet-access helpers for Wavebucks
 * ============================================================================
 * Centralizes spreadsheet constants, column indices, and helper functions
 * for the Wavebucks ledger.
 * 
 * Designed for use as a Google Apps Script Library.
 * Exports a global object `WavebucksConfig` with constants and helpers.
 * ============================================================================
 */

var WavebucksConfig = (function () {

  /*─────────────────────────────*
   *  CONSTANTS
   *─────────────────────────────*/

  const SHEET_ID = '1LOIRjKvyu4jr-WOvyvvZToNxL2M8Wfop5nDKu023hew'; // Live
  // const SHEET_ID = '1UEUrP-9VoNFkSn1g0qVHZMQEVKkvfcjCfet1i_OWilk'; // Wavebucks Test (safe for writes)

  // Sheet names
  const BALANCES_SHEET     = 'Balances';
  const TRANSACTIONS_SHEET = 'Transactions';
  const LOG_SHEET          = 'Log';

  /*─────────────────────────────*
   *  ROW OFFSET CONSTANTS
   *─────────────────────────────*/
  const HEADER_OFFSET   = 1;  // Sheet row 1 = header
  const INDEX_TO_SHEET  = 1;  // Adds 1 to array index for sheet coordinates

  /** Converts array index to sheet row number, considering headers. */
  function sheetRowFromIndex(index) {
    return index + INDEX_TO_SHEET;
  }

  /** Returns all data rows from a sheet, excluding headers. */
  function getDataRows(sheet) {
    const values = sheet.getDataRange().getValues();
    return values.slice(HEADER_OFFSET);
  }

  /*─────────────────────────────*
   *  COLUMN INDICES
   *─────────────────────────────*/
  const BAL_EMAIL_COL      = 0; // "Email Address"
  const BAL_BALANCE_COL    = 1; // "Balance"
  const BAL_TIMESTAMP_COL  = 2; // "Last Updated"

  const LOG_TIMESTAMP_COL  = 0; // "Timestamp"
  const LOG_EMAIL_COL      = 1; // "Email"
  const LOG_AMOUNT_COL     = 2; // "Amount"
  const LOG_NOTES_COL      = 3; // "Notes"
  const LOG_PREV_BAL_COL   = 4; // "Previous Balance"
  const LOG_PROCESSED_COL  = 5; // "Processed"

  /*─────────────────────────────*
   *  SHEET ACCESS HELPERS
   *─────────────────────────────*/
  function getWorkbook() {
    return SpreadsheetApp.openById(SHEET_ID);
  }

  function getSheet(name) {
    return getWorkbook().getSheetByName(name);
  }

  function getBalancesSheet() {
    return getWorkbook().getSheetByName(BALANCES_SHEET);
  }

  /*─────────────────────────────*
   *  APP URL
   *─────────────────────────────*/

   //Deprecated, from some old WebApp implementation
  const WAVE_APP_URL = 'https://script.google.com/macros/s/AKfycbxtWc-6_T5rADP0-1s-DoYw02mlgOxtGOKyGfp1YzBL/dev';

  /*─────────────────────────────*
   *  PUBLIC EXPORT
   *─────────────────────────────*/
  return {
    // constants
    SHEET_ID,
    BALANCES_SHEET,
    TRANSACTIONS_SHEET,
    LOG_SHEET,
    HEADER_OFFSET,
    INDEX_TO_SHEET,
    BAL_EMAIL_COL,
    BAL_BALANCE_COL,
    BAL_TIMESTAMP_COL,
    LOG_TIMESTAMP_COL,
    LOG_EMAIL_COL,
    LOG_AMOUNT_COL,
    LOG_NOTES_COL,
    LOG_PREV_BAL_COL,
    LOG_PROCESSED_COL,
    WAVE_APP_URL,

    // helpers
    sheetRowFromIndex,
    getDataRows,
    getWorkbook,
    getSheet,
    getBalancesSheet
  };

})();
