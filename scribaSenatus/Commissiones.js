const Commissio = (() => {

  function getActiveList() {
    const ss = SpreadsheetApp.openById(CONFIG_SHEET_ID);
    const sh = ss.getSheetByName('Commissiones');
    if (!sh) return ['(no active Commissions)'];
    const rows = sh.getDataRange().getValues().slice(1);
    return rows
      .filter(r => String(r[5]).toUpperCase() === 'OPEN')
      .map(r => `<b>${r[1]}</b> — reward ₩${r[3]}`);
  }

  return { getActiveList };
})();
