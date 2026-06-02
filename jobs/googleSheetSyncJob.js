const cron = require('node-cron');
const { syncAllStudents } = require('../services/googleSheetSyncService');

function scheduleGoogleSheetSync() {
  const cronExpr = process.env.GOOGLE_SHEET_SYNC_CRON || '0 */6 * * *';
  console.log(`[GoogleSheetSync] Scheduled with cron: ${cronExpr}`);

  cron.schedule(cronExpr, async () => {
    console.log('[GoogleSheetSync] Starting scheduled sync...');
    try {
      const result = await syncAllStudents();
      console.log(`[GoogleSheetSync] Sync completed: ${result.synced}/${result.totalStudents} students synced`);
    } catch (err) {
      console.error('[GoogleSheetSync] Sync error:', err.message);
    }
  });
}

module.exports = { scheduleGoogleSheetSync };
