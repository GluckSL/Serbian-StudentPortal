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
  'aiswarya@gluckglobal.com',
  'saranyal@gluckglobal.com',
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
  if (!batchKeys.length) return { missedDates: [], invitedCount: 0, batchClassDays: 0 };

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
    .select('startTime duration status attendance attendees courseDay topic')
    .lean();

  const missedDates = [];
  const seenDays = new Set();
  const batchDays = new Set();
  let invitedCount = 0;
  const studentId = student._id;
  const studentEmail = String(student.email || '').toLowerCase().trim();

  for (const meeting of meetings) {
    if (isContentBlockedForStudent(student, { courseDay: meeting.courseDay, level: student.level })) {
      continue;
    }
    const dayKey = new Date(meeting.startTime).toLocaleDateString('sr-Latn-RS', {
      timeZone: 'Asia/Colombo',
    });
    batchDays.add(dayKey);

    // Only count classes the student was actually scheduled for — batch/plan
    // matching alone also picks up sessions (e.g. test or subgroup classes)
    // the student was never invited to.
    const invited = (meeting.attendees || []).some(
      (a) =>
        (a.studentId && String(a.studentId) === String(studentId)) ||
        (a.email && studentEmail && String(a.email).toLowerCase().trim() === studentEmail)
    );
    if (!invited) continue;
    invitedCount++;

    if (isMeetingMissed(meeting, studentId, studentEmail)) {
      // Count at most one missed class per calendar day — duplicate meeting
      // docs for the same session would otherwise inflate the count.
      if (seenDays.has(dayKey)) continue;
      seenDays.add(dayKey);
      missedDates.push(meeting.startTime);
    }
  }

  return { missedDates, invitedCount, batchClassDays: batchDays.size };
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
  const unscheduledStudents = [];

  for (const student of students) {
    try {
      const { missedDates, invitedCount, batchClassDays } =
        await collectMissedClassesForStudent(student, since);

      // Batch held classes but the student was on none of the rosters —
      // they can't be counted as "missed", but hiding them would mask a
      // scheduling gap, so they get their own section in the report.
      if (invitedCount === 0 && batchClassDays >= MIN_MISSED_CLASSES) {
        unscheduledStudents.push({
          name: student.name,
          batch: student.batch,
          batchClassDays,
        });
        continue;
      }

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

  if (!flaggedStudents.length && !unscheduledStudents.length) {
    console.log(
      `[MissedClassMorningReport] ✅ No students with ${MIN_MISSED_CLASSES}+ missed live classes in the last ${LOOKBACK_DAYS} days — email not sent.`
    );
    return;
  }

  const batchNumber = (batch) => {
    const m = String(batch || '').match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
  };
  flaggedStudents.sort(
    (a, b) =>
      batchNumber(a.batch) - batchNumber(b.batch) ||
      b.missedCount - a.missedCount ||
      String(a.name).localeCompare(String(b.name))
  );
  unscheduledStudents.sort(
    (a, b) =>
      batchNumber(a.batch) - batchNumber(b.batch) || String(a.name).localeCompare(String(b.name))
  );

  const reportDate = new Date().toLocaleDateString('sr-Latn-RS', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const { subject, html } = buildMissedLiveClassMorningReportEmail({
    flaggedStudents,
    unscheduledStudents,
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
    `[MissedClassMorningReport] ✅ Report sent to ${REPORT_RECIPIENTS.join(', ')} — ${flaggedStudents.length} flagged, ${unscheduledStudents.length} not on any roster.`
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

module.exports = {
  scheduleConsecutiveAbsenceEmailReport,
  processConsecutiveAbsenceEmailReport,
  collectMissedClassesForStudent,
};
