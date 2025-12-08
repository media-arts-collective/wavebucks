const Causae = (() => {

  function getActiveList() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    const sh = ss.getSheetByName('Causae');
    if (!sh) return ['(no active Causae)'];
    const rows = sh.getDataRange().getValues().slice(1);
    return rows
      .filter(r => String(r[4]).toUpperCase() === 'OPEN')
      .map(r => `<b>${r[1]}</b> — closes ${r[7] || 'N/A'}`);
  }

  return { getActiveList };
})();
