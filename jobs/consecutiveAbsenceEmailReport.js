/**
 * Nightly Language-Team digest — students with 2+ consecutive class absences.
 *
 * Runs every night at 12:00 AM IST (Asia/Colombo = UTC+5:30).
 *
 * Logic:
 *   1. Fetch all active ONGOING students.
 *   2. For each student, pull their last MEETINGS_TO_CHECK recorded meetings
 *      for their batch and walk backward counting consecutive absences.
 *   3. Collect every student whose streak is >= CONSECUTIVE_THRESHOLD (2).
 *   4. Send a single HTML digest email (with a sortable table) to the
 *      Language Team inbox.  If no students qualify, no email is sent.
 *
 * The email is a digest — one message per night regardless of how many
 * students qualify — so there is no per-student flag or duplicate-guard needed.
 */

const cron = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const { buildConsecutiveAbsenceLanguageTeamEmail } = require('../utils/emailTemplates');

// ── Configuration ────────────────────────────────────────────────────────────

/** Minimum consecutive absences to include a student in the report. */
const CONSECUTIVE_THRESHOLD = 2;

/** How many recent meetings per student to scan. */
const MEETINGS_TO_CHECK = 10;

/** Recipient — Language Team inbox. Falls back to the primary EMAIL_USER. */
const LANGUAGE_TEAM_EMAIL =
  process.env.LANGUAGE_SCHOOL_EMAIL ||
  process.env.EMAIL_USER ||
  'languageschool@gluckglobal.com';

// ── Core logic ────────────────────────────────────────────────────────────────

async function processConsecutiveAbsenceEmailReport() {
  const students = await User.find({ role: 'STUDENT', isActive: true, studentStatus: 'ONGOING' })
    .select('_id name email batch assignedTeacher')
    .lean();

  if (!students.length) {
    console.log('[ConsecutiveAbsenceReport] No active students found — skipping.');
    return;
  }

  // Build a map of teacher IDs we need to resolve → name
  const teacherIdSet = new Set(
    students.map((s) => String(s.assignedTeacher)).filter(Boolean)
  );
  const teacherMap = {};
  if (teacherIdSet.size) {
    const teachers = await User.find({ _id: { $in: [...teacherIdSet] } })
      .select('_id name')
      .lean();
    teachers.forEach((t) => {
      teacherMap[String(t._id)] = t.name;
    });
  }

  const absentStudents = [];

  for (const student of students) {
    try {
      const recentMeetings = await MeetingLink.find({
        batch: student.batch,
        attendanceRecorded: true,
        'attendance.studentId': student._id,
      })
        .sort({ startTime: -1 })
        .limit(MEETINGS_TO_CHECK)
        .select('startTime attendance')
        .lean();

      if (recentMeetings.length < CONSECUTIVE_THRESHOLD) continue;

      // Walk from most-recent backward; count consecutive absences
      let streak = 0;
      let lastAttended = null;

      for (const meeting of recentMeetings) {
        const record = meeting.attendance.find(
          (a) => String(a.studentId) === String(student._id)
        );
        if (record && !record.attended) {
          streak++;
        } else {
          // First meeting where student was present — record the date
          if (record && record.attended) {
            lastAttended = meeting.startTime;
          }
          break;
        }
      }

      if (streak < CONSECUTIVE_THRESHOLD) continue;

      absentStudents.push({
        name: student.name,
        email: student.email,
        batch: student.batch,
        streak,
        lastAttended: lastAttended || null,
        assignedTeacher: student.assignedTeacher
          ? teacherMap[String(student.assignedTeacher)] || null
          : null,
      });
    } catch (err) {
      console.error(
        `[ConsecutiveAbsenceReport] ❌ Error processing ${student.name}:`,
        err.message
      );
    }
  }

  if (!absentStudents.length) {
    console.log('[ConsecutiveAbsenceReport] ✅ No students with 2+ consecutive absences — email not sent.');
    return;
  }

  // Sort: highest streak first, then alphabetically by batch
  absentStudents.sort((a, b) => b.streak - a.streak || a.batch.localeCompare(b.batch));

  const reportDate = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  const { subject, html } = buildConsecutiveAbsenceLanguageTeamEmail({
    absentStudents,
    reportDate,
  });

  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global Portal'}" <${process.env.EMAIL_USER}>`,
    to: LANGUAGE_TEAM_EMAIL,
    subject,
    html,
  });

  console.log(
    `[ConsecutiveAbsenceReport] ✅ Report sent to ${LANGUAGE_TEAM_EMAIL} — ${absentStudents.length} student(s) flagged.`
  );
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function scheduleConsecutiveAbsenceEmailReport() {
  // 12:00 AM IST every night (Asia/Colombo = Asia/Kolkata = UTC+5:30)
  cron.schedule(
    '0 0 * * *',
    () => {
      processConsecutiveAbsenceEmailReport().catch((err) =>
        console.error('[ConsecutiveAbsenceReport] ❌ Job error:', err.message)
      );
    },
    { timezone: 'Asia/Colombo' }
  );
  console.log(
    '📅 [ConsecutiveAbsenceReport] Scheduled — nightly 12:00 AM IST; Language Team digest for 2+ consecutive absences'
  );
}

module.exports = { scheduleConsecutiveAbsenceEmailReport, processConsecutiveAbsenceEmailReport };
