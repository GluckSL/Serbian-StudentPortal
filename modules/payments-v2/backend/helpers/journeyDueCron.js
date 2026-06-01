const journeyDueService = require('../services/journeyLanguageFeeDueService');

let cronInterval = null;

const start = () => {
  if (cronInterval) return;

  const run = async () => {
    try {
      const result = await journeyDueService.syncAllEligibleStudents();
      if (result.notified > 0) {
        console.log(
          `[JourneyDueCron] Synced ${result.scanned} students — ${result.notified} admin alert batches refreshed`,
        );
      }
    } catch (e) {
      console.error('[JourneyDueCron] Error:', e.message);
    }
  };

  run();
  cronInterval = setInterval(run, 60 * 60 * 1000);
  console.log('[JourneyDueCron] Started — runs every 60 minutes');
};

const stop = () => {
  if (cronInterval) {
    clearInterval(cronInterval);
    cronInterval = null;
  }
};

module.exports = { start, stop };
