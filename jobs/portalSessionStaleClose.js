const cron = require('node-cron');
const { closeStaleSessions } = require('../services/portalAnalytics.service');

function schedulePortalSessionStaleClose() {
  cron.schedule(
    '* * * * *',
    () => {
      closeStaleSessions()
        .then((r) => {
          if (r.closed > 0) {
            console.log(`⏱ [Portal analytics] Auto-closed ${r.closed} stale session(s)`);
          }
        })
        .catch((err) => {
          console.error('❌ [Portal analytics] Stale session job:', err.message);
        });
    },
    { timezone: process.env.PORTAL_ANALYTICS_CRON_TZ || 'UTC' }
  );
  console.log('⏰ Portal session stale-close job scheduled (every minute)');
}

module.exports = { schedulePortalSessionStaleClose };
