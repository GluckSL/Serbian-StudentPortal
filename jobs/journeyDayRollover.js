/**
 * Runs at local midnight (default Asia/Colombo): apply pending journey day advances for students
 * who attended their current-day live class (pendingJourneyDayAdvance === true).
 */
const cron = require('node-cron');
const { applyJourneyDayRollovers } = require('../services/journeyDayAdvance.service');

const TZ = process.env.JOURNEY_ROLLOVER_TZ || 'Asia/Colombo';

function scheduleJourneyDayRollover() {
  cron.schedule(
    '0 0 * * *',
    () => {
      applyJourneyDayRollovers().catch((err) => {
        console.error('❌ [Journey rollover] Job error:', err.message);
      });
    },
    { timezone: TZ }
  );
  console.log(`⏰ Journey day rollover scheduled (daily 00:00 ${TZ})`);
}

module.exports = { scheduleJourneyDayRollover };
