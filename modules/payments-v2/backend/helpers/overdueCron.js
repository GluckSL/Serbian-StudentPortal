const paymentService = require('../services/paymentService');

let cronInterval = null;

const start = () => {
  if (cronInterval) return;
  // Run every hour
  cronInterval = setInterval(async () => {
    try {
      const result = await paymentService.detectAndMarkOverdue();
      if (result.updatedCount > 0) {
        console.log(`[OverdueCron] Marked ${result.updatedCount} requests as overdue`);
      }
    } catch (e) {
      console.error('[OverdueCron] Error:', e.message);
    }
  }, 60 * 60 * 1000);

  console.log('[OverdueCron] Started — runs every 60 minutes');
};

const stop = () => {
  if (cronInterval) { clearInterval(cronInterval); cronInterval = null; }
};

module.exports = { start, stop };
