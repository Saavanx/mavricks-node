window.WEB3FORMS_ACCESS_KEY = 'd8101c39-e3d3-40b6-a696-2bf11ef86786';

// ---- Google Sheets logging (via Google Apps Script web app) ----
// Saves every contact / newsletter submission into a Google Sheet, in addition
// to the Web3Forms email. Setup steps are in google-apps-script/README.md.
//
//   1. Create a Google Sheet (it lives in your Google Drive).
//   2. Extensions > Apps Script, paste google-apps-script/Code.gs, Save.
//   3. Deploy > New deployment > Web app
//        Execute as: Me   |   Who has access: Anyone
//   4. Copy the Web app URL (ends in /exec) and paste it below.
//
// Until this is filled in, the Sheet logging is simply skipped (forms still email).
window.MAVRICKS_SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbwslWKkP3hwdLuPT6rDGcUE7yPmCIZsQstc1oWzIO9neetWILsubOruWXitvZsvTD81/exec';

// Optional weak shared secret. If you set SHARED_SECRET in Code.gs, set the same
// value here. NOTE: it is visible in page source, so it only deters casual abuse.
window.MAVRICKS_SHEET_SECRET = '256a6417ff2d711e937c89cae8d6cfa9b917153e08f9e2b4';
