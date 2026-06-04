const cron = require('node-cron');
const { syncAllStudents, verifySheetConnection } = require('../services/googleSheetSyncService');

function scheduleGoogleSheetSync() {
  const cronExpr = process.env.GOOGLE_SHEET_SYNC_CRON || '0 */6 * * *';

  verifySheetConnection()
    .then((info) => {
      const icon = info.titleMatch ? '✓' : '✗';
      console.log(
        `[GoogleSheetSync] ${icon} "${info.spreadsheetTitle}" connected | cron ${cronExpr}`,
      );
    })
    .catch((err) => {
      console.log(`[GoogleSheetSync] ✗ Not connected: ${err.message}`);
    });

  cron.schedule(cronExpr, async () => {
    try {
      const result = await syncAllStudents();
      console.log(
        `[GoogleSheetSync] ✓ Scheduled sync: ${result.rowsWritten} rows (${result.synced}/${result.totalStudents})`,
      );
    } catch (err) {
      console.log(`[GoogleSheetSync] ✗ Scheduled sync failed: ${err.message}`);
    }
  });
}

module.exports = { scheduleGoogleSheetSync };
