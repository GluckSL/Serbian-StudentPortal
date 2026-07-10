/**
 * Runs at local midnight (default Asia/Colombo): advance each student's journey day.
 * Lenient batches: always +1 (capped). Strict batches: +1 only if day-task completion % meets the batch threshold.
 *
 * Safety nets so students are NEVER left behind:
 *  1. Midnight cron  — primary trigger.
 *  2. Startup catch-up — runs 5 s after server boot if today's rollover was missed.
 *  3. Hourly catch-up — runs every hour; no-ops instantly when already done today.
 */
const cron = require('node-cron');
const { applyJourneyDayRollovers } = require('../services/journeyDayAdvance.service');
const CronJobLog = require('../models/CronJobLog');

const JOB_NAME = 'journeyDayRollover';
const TZ = process.env.JOURNEY_ROLLOVER_TZ || 'Asia/Colombo';

/** Today's date string (YYYY-MM-DD) in the rollover timezone. */
function todayInTz() {
  return new Date().toLocaleDateString('sr-Latn-RS', { timeZone: TZ }); // en-CA → YYYY-MM-DD
}

/**
 * Run the rollover only if it hasn't already run today (in rollover TZ).
 * Persists the run date to MongoDB so restarts don't re-run on the same calendar day.
 */
async function runRolloverIfNeeded(reason = 'scheduled') {
  const today = todayInTz();

  const existing = await CronJobLog.findOne({ jobName: JOB_NAME }).lean();
  if (existing && existing.lastRunDate === today) {
    return; // already ran today — silent no-op
  }

  console.log(`📅 [Journey rollover] Starting ${reason} run for ${today} …`);
  try {
    await applyJourneyDayRollovers();
    await CronJobLog.findOneAndUpdate(
      { jobName: JOB_NAME },
      { $set: { lastRunDate: today, lastRunAt: new Date() }, $inc: { runCount: 1 } },
      { upsert: true }
    );
    console.log(`✅ [Journey rollover] ${reason} run complete for ${today}.`);
  } catch (err) {
    console.error(`❌ [Journey rollover] ${reason} run failed:`, err.message);
  }
}

function scheduleJourneyDayRollover() {
  // 1. Primary: midnight cron.
  cron.schedule(
    '0 0 * * *',
    () => { runRolloverIfNeeded('midnight cron'); },
    { timezone: TZ }
  );

  // 2. Hourly safety net — catches up within 60 min if midnight was missed.
  cron.schedule(
    '0 * * * *',
    () => { runRolloverIfNeeded('hourly catch-up'); },
    { timezone: TZ }
  );

  // 3. Startup catch-up — runs 5 s after boot for an immediate fix.
  setTimeout(() => {
    runRolloverIfNeeded('startup catch-up').catch((err) => {
      console.error('❌ [Journey rollover] Startup catch-up error:', err.message);
    });
  }, 5000);

  console.log(`⏰ Journey day rollover scheduled (daily 00:00 ${TZ}, hourly safety net active)`);
}

module.exports = { scheduleJourneyDayRollover };
