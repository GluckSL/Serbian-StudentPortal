/**
 * Late Join / Early Exit Alert — Day 1 and Day 3 classes
 *
 * Runs every 15 minutes. After a live class on courseDay 1 or 3 ends
 * and Zoom attendance has been fetched, this job inspects each student's
 * attendance row and flags:
 *
 *   • LATE JOIN  — student's joinTime is > LATE_THRESHOLD_MINUTES after
 *                  the scheduled class startTime.
 *
 *   • EARLY EXIT — student attended (attended: true) but their durationMinutes
 *                  is less than EARLY_EXIT_MIN_PCT % of the full class duration,
 *                  meaning they left well before the class ended.
 *
 * Each meeting is processed at most once (tracked via CronJobLog).
 *
 * Recipients: aiswarya@gluckglobal.com, sourav@gluckglobal.com
 */

const cron        = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const CronJobLog  = require('../models/CronJobLog');
const transporter = require('../config/emailConfig');
const { buildLateJoinEarlyExitEmail } = require('../utils/emailTemplates');

const TZ                    = 'Asia/Colombo';
const LOG_PREFIX            = '[LateJoinEarlyExit]';
const ALERT_COURSE_DAYS     = [1, 3];        // courseDay values to watch
const LATE_THRESHOLD_MIN    = 10;            // minutes after startTime = "late"
const EARLY_EXIT_MIN_PCT    = 75;            // % of class duration; below = "early exit"
const REPORT_RECIPIENTS     = ['aiswarya@gluckglobal.com', 'sourav@gluckglobal.com'];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('sr-Latn-RS', { timeZone: TZ });
}

function shortDateLabel(date) {
  return new Date(date).toLocaleDateString('sr-Latn-RS', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    timeZone: TZ,
  });
}

function fullDateLabel() {
  return new Date().toLocaleDateString('sr-Latn-RS', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

async function alreadyProcessed(meetingId) {
  return !!(await CronJobLog.findOne({ jobName: `lateExitAlert:${meetingId}` }).lean());
}

async function markProcessed(meetingId) {
  await CronJobLog.findOneAndUpdate(
    { jobName: `lateExitAlert:${meetingId}` },
    { $set: { lastRunDate: todayStr(), lastRunAt: new Date() }, $inc: { runCount: 1 } },
    { upsert: true },
  );
}

// ─────────────────────────────────────────────────────────────
// Core logic
// ─────────────────────────────────────────────────────────────

async function processLateJoinEarlyExitAlerts() {
  // Find ended Day-1 / Day-3 meetings with attendance already recorded
  const meetings = await MeetingLink.find({
    courseDay:           { $in: ALERT_COURSE_DAYS },
    status:              'ended',
    attendanceRecorded:  true,
  })
    .select('_id batch courseDay startTime duration topic attendance')
    .lean();

  if (!meetings.length) {
    return; // silent – no meetings yet
  }

  for (const meeting of meetings) {
    if (await alreadyProcessed(String(meeting._id))) continue;

    const meetingDurationMin = Number(meeting.duration) || 60;
    const classStart         = new Date(meeting.startTime);
    const classEnd           = new Date(classStart.getTime() + meetingDurationMin * 60_000);
    const earlyExitCutoffMin = (meetingDurationMin * EARLY_EXIT_MIN_PCT) / 100; // must stay >= this many min

    const lateJoiners  = [];
    const earlyExiters = [];

    for (const row of meeting.attendance || []) {
      // Skip students who were fully absent
      const wasPresent = row.attended === true || row.durationMinutes > 0;
      if (!wasPresent) continue;

      const durationMins = Number(row.durationMinutes) || 0;

      // ── Late join check ────────────────────────────────────
      // Use the status flag first; fall back to computing the delta from joinTime
      let lateByMinutes = 0;
      if (row.status === 'late') {
        if (row.joinTime) {
          const joinedAt = new Date(row.joinTime);
          lateByMinutes = Math.max(0, Math.round((joinedAt - classStart) / 60_000));
        } else {
          // status is 'late' but joinTime not stored — estimate from duration
          lateByMinutes = Math.max(0, Math.round(meetingDurationMin - durationMins));
        }
        if (lateByMinutes >= LATE_THRESHOLD_MIN) {
          lateJoiners.push({
            name:          row.name  || '(Unknown)',
            email:         row.email || '',
            lateByMinutes,
          });
        }
      } else if (row.joinTime) {
        // Double-check even if not flagged 'late' by the system
        const joinedAt = new Date(row.joinTime);
        lateByMinutes = Math.round((joinedAt - classStart) / 60_000);
        if (lateByMinutes >= LATE_THRESHOLD_MIN) {
          lateJoiners.push({
            name:          row.name  || '(Unknown)',
            email:         row.email || '',
            lateByMinutes,
          });
        }
      }

      // ── Early exit check ───────────────────────────────────
      // If they attended but stayed less than EARLY_EXIT_MIN_PCT of the class
      if (durationMins > 0 && durationMins < earlyExitCutoffMin) {
        const leftEarlyByMinutes = Math.round(meetingDurationMin - durationMins);
        const attendedPct        = Math.round((durationMins / meetingDurationMin) * 100);
        earlyExiters.push({
          name:               row.name  || '(Unknown)',
          email:              row.email || '',
          attendedMinutes:    Math.round(durationMins),
          leftEarlyByMinutes,
          attendedPct,
        });
      }
    }

    // Always mark as processed so we don't re-check this meeting
    await markProcessed(String(meeting._id));

    if (!lateJoiners.length && !earlyExiters.length) {
      console.log(
        `${LOG_PREFIX} ✅ ${meeting.batch} Day ${meeting.courseDay} — no late joins or early exits.`
      );
      continue;
    }

    // Sort: worst (most late / most early) first
    lateJoiners.sort((a, b) => b.lateByMinutes - a.lateByMinutes);
    earlyExiters.sort((a, b) => a.attendedPct - b.attendedPct);

    const classDuration = `${meetingDurationMin} min`;
    const classDate     = shortDateLabel(meeting.startTime);
    const reportDate    = fullDateLabel();

    const { subject, html } = buildLateJoinEarlyExitEmail({
      batchName:    meeting.batch,
      courseDay:    meeting.courseDay,
      classDate,
      classTopic:   meeting.topic || '',
      classDuration,
      lateJoiners,
      earlyExiters,
      reportDate,
    });

    await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global Portal'}" <${process.env.EMAIL_USER}>`,
      to:   REPORT_RECIPIENTS.join(', '),
      subject,
      html,
    });

    console.log(
      `${LOG_PREFIX} ✅ Alert sent for ${meeting.batch} Day ${meeting.courseDay} (${classDate}) — ` +
      `${lateJoiners.length} late, ${earlyExiters.length} early exit(s).`
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────────────────────

function scheduleLateJoinEarlyExitAlerts() {
  // Run every 15 minutes — attendance is fetched 15 min after class ends,
  // so this job will pick it up in the very next check cycle.
  cron.schedule('*/15 * * * *', () => {
    processLateJoinEarlyExitAlerts().catch((err) =>
      console.error(`${LOG_PREFIX} ❌ Job error:`, err.message),
    );
  }, { timezone: TZ });

  console.log(
    `⏰ ${LOG_PREFIX} Scheduled — every 15 min (Day 1 & Day 3 late join / early exit alerts)`
  );
}

module.exports = { scheduleLateJoinEarlyExitAlerts, processLateJoinEarlyExitAlerts };
