/**
 * Morning missed-live-class digest for the Language Team.
 *
 * Runs every day at 10:00 AM IST (Asia/Colombo).
 *
 * Logic:
 *   1. Fetch all active ONGOING students.
 *   2. For each student, scan recorded ended live classes for their batch/plan (last 10 days only).
 *   3. Count fully missed classes (0% attendance) and collect the dates.
 *   4. Include students with 2 or more missed classes in that window.
 *   5. Send one HTML digest to languageschool@gluckglobal.com and sourav@gluckglobal.com.
 */

const cron = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const { buildMissedLiveClassMorningReportEmail } = require('../utils/emailTemplates');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');
const { isContentBlockedForStudent } = require('../utils/journeyContentBlock');
const { isMeetingMissed } = require('../utils/missedClassReminder');

/** Only count live classes that started within this many days (inclusive). */
const LOOKBACK_DAYS = 10;

/** Students must have missed at least this many live classes in the lookback window. */
const MIN_MISSED_CLASSES = 2;

const REPORT_RECIPIENTS = [
  process.env.LANGUAGE_SCHOOL_EMAIL || 'languageschool@gluckglobal.com',
  'sourav@gluckglobal.com',
]
  .map((e) => String(e || '').trim().toLowerCase())
  .filter(Boolean)
  .filter((e, i, arr) => arr.indexOf(e) === i);

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lookbackStartDate() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

async function collectMissedClassesForStudent(student, since) {
  const batchKeys = allStudentBatchStringsForContent(student);
  if (!batchKeys.length) return [];

  const batchOr = batchKeys.map((k) => ({
    batch: new RegExp(`^${escapeRegExp(k)}$`, 'i'),
  }));

  const meetings = await MeetingLink.find({
    $and: [
      { plan: { $in: [student.subscription, 'ALL'] } },
      { $or: batchOr },
      { attendanceRecorded: true },
      { status: { $ne: 'cancelled' } },
      { startTime: { $gte: since } },
    ],
  })
    .sort({ startTime: -1 })
    .select('startTime duration status attendance courseDay topic')
    .lean();

  const missedDates = [];
  const studentId = student._id;
  const studentEmail = student.email;

  for (const meeting of meetings) {
    if (isContentBlockedForStudent(student, { courseDay: meeting.courseDay, level: student.level })) {
      continue;
    }
    if (isMeetingMissed(meeting, studentId, studentEmail)) {
      missedDates.push(meeting.startTime);
    }
  }

  return missedDates;
}

async function processConsecutiveAbsenceEmailReport() {
  const students = await User.find({ role: 'STUDENT', isActive: true, studentStatus: 'ONGOING' })
    .select('_id name email batch subscription level')
    .lean();

  if (!students.length) {
    console.log('[MissedClassMorningReport] No active students found — skipping.');
    return;
  }

  const since = lookbackStartDate();
  const flaggedStudents = [];

  for (const student of students) {
    try {
      const missedDates = await collectMissedClassesForStudent(student, since);
      if (missedDates.length < MIN_MISSED_CLASSES) continue;

      flaggedStudents.push({
        name: student.name,
        batch: student.batch,
        missedCount: missedDates.length,
        missedDates: missedDates.sort((a, b) => new Date(b) - new Date(a)),
      });
    } catch (err) {
      console.error(
        `[MissedClassMorningReport] ❌ Error processing ${student.name}:`,
        err.message
      );
    }
  }

  if (!flaggedStudents.length) {
    console.log(
      `[MissedClassMorningReport] ✅ No students with ${MIN_MISSED_CLASSES}+ missed live classes in the last ${LOOKBACK_DAYS} days — email not sent.`
    );
    return;
  }

  flaggedStudents.sort(
    (a, b) => b.missedCount - a.missedCount || String(a.batch).localeCompare(String(b.batch))
  );

  const reportDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const { subject, html } = buildMissedLiveClassMorningReportEmail({
    flaggedStudents,
    reportDate,
    lookbackDays: LOOKBACK_DAYS,
  });

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global Portal'}" <${process.env.EMAIL_USER}>`,
    to: REPORT_RECIPIENTS.join(', '),
    subject,
    html,
  });

  console.log(
    `[MissedClassMorningReport] ✅ Report sent to ${REPORT_RECIPIENTS.join(', ')} — ${flaggedStudents.length} student(s) flagged.`
  );
}

function scheduleConsecutiveAbsenceEmailReport() {
  cron.schedule(
    '0 10 * * *',
    () => {
      processConsecutiveAbsenceEmailReport().catch((err) =>
        console.error('[MissedClassMorningReport] ❌ Job error:', err.message)
      );
    },
    { timezone: 'Asia/Colombo' }
  );
  console.log(
    `📅 [MissedClassMorningReport] Scheduled — daily 10:00 AM IST; digest for students with ${MIN_MISSED_CLASSES}+ missed live classes in the last ${LOOKBACK_DAYS} days`
  );
}

module.exports = { scheduleConsecutiveAbsenceEmailReport, processConsecutiveAbsenceEmailReport };
