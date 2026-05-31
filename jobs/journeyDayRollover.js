/**
 * Runs at local midnight (default Asia/Colombo): advance each student’s journey day.
 * Lenient batches: always +1 (capped). Strict batches: +1 only if day-task completion % meets the batch threshold.
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
