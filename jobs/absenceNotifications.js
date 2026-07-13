/**
 * Absence Notification Jobs
 *
 * 1. Milestone Absence Alert (daily 9 PM IST)
 *    ─ Checks live classes tagged with courseDay 1, 3, or 6 where attendance
 *      has been recorded. Emails the language team with every absent student.
 *    ─ Each meeting is reported at most ONCE (tracked via CronJobLog).
 *
 * 2. Weekly Missed-Classes Digest (every Monday 9 AM IST)
 *    ─ Collects all ended meetings from the past 7 days with recorded attendance.
 *    ─ Lists every ONGOING student who missed at least one class, grouped by student.
 *
 * Recipients: aiswarya@gluckglobal.com, sourav@gluckglobal.com
 */

const cron        = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const User        = require('../models/User');
const CronJobLog  = require('../models/CronJobLog');
const transporter = require('../config/emailConfig');
const {
  buildMilestoneAbsenceAlertEmail,
  buildWeeklyMissedClassesEmail,
} = require('../utils/emailTemplates');

const TZ               = 'Asia/Colombo';
const LOG_PREFIX_MS    = '[MilestoneAbsence]';
const LOG_PREFIX_WK    = '[WeeklyAbsence]';
const MILESTONE_DAYS   = [1, 3, 6];   // courseDay values that trigger the alert
const REPORT_RECIPIENTS = ['aiswarya@gluckglobal.com', 'sourav@gluckglobal.com'];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** YYYY-MM-DD string for a Date in IST. */
function toDateStrIST(date = new Date()) {
  return date.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Human-readable date label e.g. "Mon, 30 Jun 2026". */
function shortDateLabel(date) {
  return new Date(date).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    timeZone: TZ,
  });
}

/** Human-readable full date e.g. "Monday, 30 June 2026". */
function fullDateLabel(date) {
  return new Date(date).toLocaleDateString('en-IN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Absent students from a single meeting.
 * Returns [{name, email}] for any attendee row where attended is false.
 */
function absentStudentsFromMeeting(meeting) {
  return (meeting.attendance || [])
    .filter((row) => !row.attended)
    .map((row) => ({
      name:  row.name  || '(Unknown)',
      email: row.email || '',
    }));
}

/**
 * Mark a per-meeting log key so we don't re-notify.
 * Uses CronJobLog with jobName = `milestoneAbsence:${meetingId}`.
 */
async function markMeetingNotified(meetingId, todayStr) {
  await CronJobLog.findOneAndUpdate(
    { jobName: `milestoneAbsence:${meetingId}` },
    { $set: { lastRunDate: todayStr, lastRunAt: new Date() }, $inc: { runCount: 1 } },
    { upsert: true },
  );
}

async function isMeetingAlreadyNotified(meetingId) {
  const log = await CronJobLog.findOne({ jobName: `milestoneAbsence:${meetingId}` }).lean();
  return !!log;
}

// ─────────────────────────────────────────────────────────────
// 1. MILESTONE ABSENCE ALERT  (daily 9 PM IST)
// ─────────────────────────────────────────────────────────────

async function processMilestoneAbsenceAlerts() {
  const todayStr = toDateStrIST();

  // Find all milestone meetings (Day 1, 3, 6) where attendance has been recorded
  const meetings = await MeetingLink.find({
    courseDay:           { $in: MILESTONE_DAYS },
    status:              'ended',
    attendanceRecorded:  true,
  })
    .select('_id batch courseDay startTime attendance topic')
    .lean();

  if (!meetings.length) {
    console.log(`${LOG_PREFIX_MS} No milestone meetings with recorded attendance found.`);
    return;
  }

  // Filter out meetings already reported
  const unreported = [];
  for (const m of meetings) {
    if (!(await isMeetingAlreadyNotified(m._id.toString()))) {
      unreported.push(m);
    }
  }

  if (!unreported.length) {
    console.log(`${LOG_PREFIX_MS} All milestone meetings already notified — nothing to do.`);
    return;
  }

  // Build groups: one group per (batch × courseDay) meeting
  const groups = [];
  for (const meeting of unreported) {
    const absent = absentStudentsFromMeeting(meeting);
    if (!absent.length) {
      // Everyone attended — still mark as notified so we skip it next time
      await markMeetingNotified(meeting._id.toString(), todayStr);
      console.log(`${LOG_PREFIX_MS} ✅ No absences for ${meeting.batch} Day ${meeting.courseDay} — marked.`);
      continue;
    }

    groups.push({
      batchName:      meeting.batch,
      courseDay:      meeting.courseDay,
      dateLabel:      shortDateLabel(meeting.startTime),
      absentStudents: absent,
    });

    await markMeetingNotified(meeting._id.toString(), todayStr);
  }

  if (!groups.length) {
    console.log(`${LOG_PREFIX_MS} No absences to report — email not sent.`);
    return;
  }

  // Sort groups: by courseDay then batch
  groups.sort((a, b) => a.courseDay - b.courseDay || a.batchName.localeCompare(b.batchName));

  const reportDate = fullDateLabel(new Date());
  const { subject, html } = buildMilestoneAbsenceAlertEmail({ groups, reportDate });

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global Portal'}" <${process.env.EMAIL_USER}>`,
    to:   REPORT_RECIPIENTS.join(', '),
    subject,
    html,
  });

  const totalAbsent = groups.reduce((s, g) => s + g.absentStudents.length, 0);
  console.log(
    `${LOG_PREFIX_MS} ✅ Alert sent — ${groups.length} meeting group(s), ${totalAbsent} absent student(s).`
  );
}

// ─────────────────────────────────────────────────────────────
// 2. WEEKLY MISSED-CLASSES DIGEST  (every Monday 9 AM IST)
// ─────────────────────────────────────────────────────────────

async function processWeeklyAbsenceSummary() {
  const now     = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // All ended meetings in the past 7 days with recorded attendance
  const meetings = await MeetingLink.find({
    status:             'ended',
    attendanceRecorded: true,
    startTime:          { $gte: weekAgo, $lt: now },
  })
    .select('_id batch courseDay startTime attendance topic')
    .lean();

  if (!meetings.length) {
    console.log(`${LOG_PREFIX_WK} No meetings with attendance in the past 7 days.`);
    return;
  }

  // Build a map: studentId/email → { name, batch, missedDays[] }
  // We use email as the stable key since some rows may lack studentId
  const studentMap = new Map();

  // Get all ONGOING students indexed by email for batch lookup
  const ongoingStudents = await User.find({
    role: 'STUDENT', isActive: true, studentStatus: 'ONGOING',
  }).select('_id email name batch').lean();
  const studentBatchByEmail = new Map(
    ongoingStudents.map((s) => [String(s.email || '').toLowerCase().trim(), s.batch || '']),
  );

  for (const meeting of meetings) {
    const absent = absentStudentsFromMeeting(meeting);
    for (const row of absent) {
      const key = String(row.email || row.name).toLowerCase().trim();
      if (!key) continue;
      if (!studentMap.has(key)) {
        const batch = studentBatchByEmail.get(String(row.email || '').toLowerCase().trim()) || meeting.batch;
        studentMap.set(key, { name: row.name, batch, missedCount: 0, missedDays: [] });
      }
      const entry = studentMap.get(key);
      entry.missedCount++;
      entry.missedDays.push({
        courseDay: meeting.courseDay || '?',
        dateLabel: shortDateLabel(meeting.startTime),
        topic:     meeting.topic || '',
      });
    }
  }

  if (!studentMap.size) {
    console.log(`${LOG_PREFIX_WK} No missed classes this week — email not sent.`);
    return;
  }

  // Sort by missed count desc then name asc
  const students = Array.from(studentMap.values()).sort(
    (a, b) => b.missedCount - a.missedCount || a.name.localeCompare(b.name),
  );

  // Week range label
  const fmt = (d) =>
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
  const weekRange = `${fmt(weekAgo)} – ${fmt(now)}`;

  const reportDate = fullDateLabel(now);
  const { subject, html } = buildWeeklyMissedClassesEmail({ weekRange, students, reportDate });

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global Portal'}" <${process.env.EMAIL_USER}>`,
    to:   REPORT_RECIPIENTS.join(', '),
    subject,
    html,
  });

  console.log(
    `${LOG_PREFIX_WK} ✅ Weekly digest sent — ${students.length} student(s) with missed classes (week: ${weekRange}).`
  );
}

// ─────────────────────────────────────────────────────────────
// Schedulers
// ─────────────────────────────────────────────────────────────

function scheduleMilestoneAbsenceAlerts() {
  // Daily at 9 PM IST — most classes end before then, so attendance is already fetched
  cron.schedule('0 21 * * *', () => {
    processMilestoneAbsenceAlerts().catch((err) =>
      console.error(`${LOG_PREFIX_MS} ❌ Job error:`, err.message),
    );
  }, { timezone: TZ });

  console.log(`⏰ ${LOG_PREFIX_MS} Scheduled — daily 21:00 IST (Day 1/3/6 absence alerts)`);
}

function scheduleWeeklyAbsenceSummary() {
  // Every Monday at 9 AM IST
  cron.schedule('0 9 * * 1', () => {
    processWeeklyAbsenceSummary().catch((err) =>
      console.error(`${LOG_PREFIX_WK} ❌ Job error:`, err.message),
    );
  }, { timezone: TZ });

  console.log(`⏰ ${LOG_PREFIX_WK} Scheduled — every Monday 09:00 IST (weekly missed-classes digest)`);
}

module.exports = {
  scheduleMilestoneAbsenceAlerts,
  scheduleWeeklyAbsenceSummary,
  processMilestoneAbsenceAlerts,
  processWeeklyAbsenceSummary,
};
