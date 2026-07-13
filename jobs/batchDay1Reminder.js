/**
 * Batch Day-1 Launch Reminder — sends excitement emails to students when
 * their batch's first live class is about to begin.
 *
 * Two emails per batch:
 *   • "Eve" email  — sent at midnight the day BEFORE the first scheduled class
 *   • "Day 1" email — sent at midnight ON the first scheduled class day
 *
 * Launch date resolution (first match wins):
 *   1. Earliest scheduled MeetingLink with courseDay 1, else earliest scheduled class
 *   2. levelCalendarDates.A1.startDate when level schedule is active
 *   3. batchStartDate (legacy fallback)
 *
 * Uses CronJobLog with keys  batchDay1Reminder:<batchName>:eve
 * and  batchDay1Reminder:<batchName>:day1  so each email is sent at most
 * once per calendar date (safe across server restarts).
 *
 * Only batches with journeyActive: true and a resolvable launch date are eligible.
 * Students must be ONGOING + isActive to receive the email.
 *
 * Regular same-day / 30-minute class reminders are handled separately by
 * jobs/classDayReminder.js and jobs/zoomMeetingReminderEmails.js.
 */

const cron = require('node-cron');
const BatchConfig = require('../models/BatchConfig');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const CronJobLog = require('../models/CronJobLog');
const transporter = require('../config/emailConfig');
const { buildBatchDay1ReminderEmail } = require('../utils/emailTemplates');
const { hasLevelScheduleDates } = require('../utils/journeyDay');

const TZ = 'Asia/Colombo'; // IST (+05:30)
const LOG_PREFIX = '[BatchDay1Reminder]';

/** Returns YYYY-MM-DD string for a Date in the given timezone. */
function toDateStr(date, tz = TZ) {
  return date.toLocaleDateString('en-CA', { timeZone: tz }); // en-CA → YYYY-MM-DD
}

/** Adds (or subtracts) whole days to a YYYY-MM-DD string without timezone drift. */
function shiftDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toDateStr(dt, 'UTC'); // already a UTC date, no tz shift needed
}

/** Human-readable date for email body e.g. "30 June 2026". */
function formatDisplayDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/**
 * Resolve the calendar date used for eve/day-1 launch emails.
 * Prefers the first scheduled live class, then A1 level date, then batchStartDate.
 */
function resolveLaunchDateStr(batch, firstClassStartTime) {
  if (firstClassStartTime) {
    return toDateStr(new Date(firstClassStartTime));
  }
  if (hasLevelScheduleDates(batch)) {
    const a1Start = batch.levelCalendarDates?.A1?.startDate;
    if (a1Start) return toDateStr(new Date(a1Start));
  }
  if (batch.batchStartDate) {
    return toDateStr(new Date(batch.batchStartDate));
  }
  return null;
}

/** Map batch name → earliest relevant scheduled class startTime. */
async function loadFirstScheduledClassByBatch() {
  const [day1Rows, earliestRows] = await Promise.all([
    MeetingLink.aggregate([
      { $match: { status: 'scheduled', courseDay: 1, startTime: { $type: 'date' } } },
      { $sort: { startTime: 1 } },
      { $group: { _id: '$batch', startTime: { $first: '$startTime' } } },
    ]),
    MeetingLink.aggregate([
      { $match: { status: 'scheduled', startTime: { $type: 'date' } } },
      { $sort: { startTime: 1 } },
      { $group: { _id: '$batch', startTime: { $first: '$startTime' } } },
    ]),
  ]);

  const map = new Map();
  for (const row of earliestRows) {
    map.set(String(row._id), row.startTime);
  }
  for (const row of day1Rows) {
    map.set(String(row._id), row.startTime);
  }
  return map;
}

/** Returns true if we already sent this job key today. */
async function alreadySentToday(jobKey, todayStr) {
  const log = await CronJobLog.findOne({ jobName: jobKey }).lean();
  return log && log.lastRunDate === todayStr;
}

/** Mark this job key as done for today. */
async function markSent(jobKey, todayStr) {
  await CronJobLog.findOneAndUpdate(
    { jobName: jobKey },
    { $set: { lastRunDate: todayStr, lastRunAt: new Date() }, $inc: { runCount: 1 } },
    { upsert: true },
  );
}

/**
 * Core logic: find batches whose first class day is today or tomorrow,
 * then email all eligible students.
 */
async function processBatchDay1Reminders() {
  const todayStr = toDateStr(new Date());
  const tomorrowStr = shiftDateStr(todayStr, 1);

  const [batches, firstClassByBatch] = await Promise.all([
    BatchConfig.find({ journeyActive: true }).lean(),
    loadFirstScheduledClassByBatch(),
  ]);

  let totalSent = 0;
  let totalSkipped = 0;

  for (const batch of batches) {
    const firstClassStartTime = firstClassByBatch.get(String(batch.batchName)) || null;
    const startDateStr = resolveLaunchDateStr(batch, firstClassStartTime);
    if (!startDateStr) continue;

    let reminderType = null;
    if (startDateStr === tomorrowStr) reminderType = 'eve';
    else if (startDateStr === todayStr) reminderType = 'day1';

    if (!reminderType) continue;

    const jobKey = `batchDay1Reminder:${batch.batchName}:${reminderType}`;

    if (await alreadySentToday(jobKey, todayStr)) {
      console.log(`${LOG_PREFIX} ⏭ Already sent '${reminderType}' for "${batch.batchName}" today — skipping`);
      continue;
    }

    const students = await User.find({
      role: 'STUDENT',
      isActive: true,
      studentStatus: 'ONGOING',
      batch: batch.batchName,
    }).select('name email').lean();

    if (!students.length) {
      console.log(`${LOG_PREFIX} ℹ No eligible students found for batch "${batch.batchName}" (${reminderType})`);
      await markSent(jobKey, todayStr);
      continue;
    }

    const displayDate = formatDisplayDate(startDateStr);
    const source = firstClassStartTime
      ? 'scheduled class'
      : hasLevelScheduleDates(batch)
        ? 'A1 level date'
        : 'batch start date';
    let batchSent = 0;

    for (const student of students) {
      try {
        const { subject, html } = buildBatchDay1ReminderEmail({
          name: student.name,
          batchName: batch.batchName,
          type: reminderType,
          startDate: displayDate,
        });

        await transporter.sendMail({
          from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global'}" <${process.env.EMAIL_USER}>`,
          to: student.email,
          subject,
          html,
        });

        batchSent++;
        console.log(`${LOG_PREFIX} ✅ [${reminderType}] → ${student.name} (${student.email}) — batch "${batch.batchName}"`);
      } catch (err) {
        totalSkipped++;
        console.error(`${LOG_PREFIX} ❌ Failed for ${student.name} (${student.email}):`, err.message);
      }
    }

    await markSent(jobKey, todayStr);
    totalSent += batchSent;
    console.log(
      `${LOG_PREFIX} Batch "${batch.batchName}" [${reminderType}] (${source}, ${startDateStr}): sent ${batchSent}/${students.length}`
    );
  }

  console.log(`${LOG_PREFIX} Done for ${todayStr}. Total sent: ${totalSent}, failed: ${totalSkipped}`);
}

/**
 * Schedule the job at midnight IST so it runs at the very start of each day,
 * aligned with the journey day rollover.
 */
function scheduleBatchDay1Reminders() {
  cron.schedule('0 0 * * *', () => {
    processBatchDay1Reminders().catch((err) =>
      console.error(`${LOG_PREFIX} ❌ Job error:`, err.message),
    );
  }, { timezone: TZ });

  // Startup catch-up: runs 10 s after boot so missed midnight sends are recovered
  setTimeout(() => {
    processBatchDay1Reminders().catch((err) =>
      console.error(`${LOG_PREFIX} ❌ Startup catch-up error:`, err.message),
    );
  }, 10_000);

  console.log(`⏰ ${LOG_PREFIX} Scheduled — daily 00:00 ${TZ} (first-class eve + launch reminders)`);
}

module.exports = {
  scheduleBatchDay1Reminders,
  processBatchDay1Reminders,
  resolveLaunchDateStr,
  toDateStr,
  shiftDateStr,
  formatDisplayDate,
};
