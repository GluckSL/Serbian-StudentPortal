/**
 * Task 4 — Weekly WhatsApp self-comparison progress report.
 *
 * Runs every Sunday at 08:00 (Asia/Colombo → 02:30 UTC).
 *
 * For each active student compares:
 *   - Classes attended this week vs last week
 *   - Exercises completed this week vs last week
 *   - Time spent on learning modules this week vs last week (minutes)
 *
 * Sends a personalised WhatsApp summary to each student.
 */
const cron = require('node-cron');
const MeetingLink = require('../../models/MeetingLink');
const ExerciseAttempt = require('../../models/ExerciseAttempt');
const StudentProgress = require('../../models/StudentProgress');
const User = require('../../models/User');
const { sendWhatsappNotification, NOTIFICATION_TYPES, getBatchSettingsMap, isBatchAllowedBySettings } = require('../../services/whatsappCrmService');

// ── helpers ───────────────────────────────────────────────────────────────────

function weekBoundaries(weeksAgo = 0) {
  const now = new Date();
  // Start of current week (Sunday 00:00)
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setDate(now.getDate() - now.getDay());
  startOfThisWeek.setHours(0, 0, 0, 0);

  const start = new Date(startOfThisWeek.getTime() - weeksAgo * 7 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { start, end };
}

async function countClassesAttended(studentId, batch, start, end) {
  const meetings = await MeetingLink.find({
    batch,
    attendanceRecorded: true,
    startTime: { $gte: start, $lt: end },
    'attendance.studentId': studentId,
  }).lean();

  return meetings.filter((m) => {
    const rec = m.attendance.find((a) => String(a.studentId) === String(studentId));
    return rec?.attended;
  }).length;
}

async function countExercisesCompleted(studentId, start, end) {
  return ExerciseAttempt.countDocuments({
    studentId,
    status: 'completed',
    completedAt: { $gte: start, $lt: end },
  });
}

async function sumTimeSpent(studentId, start, end) {
  // StudentProgress.timeSpent tracks cumulative minutes per module.
  // We approximate weekly time by looking at records updated within the window.
  const records = await StudentProgress.find({
    studentId,
    updatedAt: { $gte: start, $lt: end },
  })
    .select('timeSpent')
    .lean();
  return records.reduce((acc, r) => acc + (r.timeSpent || 0), 0);
}

function buildMessage(student, stats) {
  const { thisWeek, lastWeek } = stats;
  return (
    `Hi ${student.name}! This week: ${thisWeek.classes} classes, ${thisWeek.exercises} exercises, ` +
    `${thisWeek.timeSpent} min study (last week: ${lastWeek.classes}, ${lastWeek.exercises}, ${lastWeek.timeSpent} min). Keep going!`
  );
}

// ── Main report processor ─────────────────────────────────────────────────────

async function processWeeklyReports() {
  const batchSettings = await getBatchSettingsMap();
  const thisWeekRange = weekBoundaries(0);
  const lastWeekRange = weekBoundaries(1);

  const students = await User.find({ role: 'STUDENT', isActive: true })
    .select('_id name whatsappNumber phoneNumber batch')
    .lean();

  console.log(`[WeeklyReport] Processing ${students.length} student(s)...`);
  let sent = 0;

  for (const student of students) {
    if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.WEEKLY_PROGRESS_REPORT, student.batch)) continue;
    try {
      const [
        thisClasses, lastClasses,
        thisExercises, lastExercises,
        thisTime, lastTime,
      ] = await Promise.all([
        countClassesAttended(student._id, student.batch, thisWeekRange.start, thisWeekRange.end),
        countClassesAttended(student._id, student.batch, lastWeekRange.start, lastWeekRange.end),
        countExercisesCompleted(student._id, thisWeekRange.start, thisWeekRange.end),
        countExercisesCompleted(student._id, lastWeekRange.start, lastWeekRange.end),
        sumTimeSpent(student._id, thisWeekRange.start, thisWeekRange.end),
        sumTimeSpent(student._id, lastWeekRange.start, lastWeekRange.end),
      ]);

      const stats = {
        thisWeek: { classes: thisClasses, exercises: thisExercises, timeSpent: thisTime },
        lastWeek: { classes: lastClasses, exercises: lastExercises, timeSpent: lastTime },
      };

      const phone = student.whatsappNumber || student.phoneNumber || '';
      const ok = await sendWhatsappNotification({
        phone,
        name: student.name,
        type: NOTIFICATION_TYPES.WEEKLY_PROGRESS_REPORT,
        message: buildMessage(student, stats),
        data: {
          studentId: student._id,
          batch: student.batch,
          reportWeek: thisWeekRange.start,
          stats,
        },
      });
      if (ok) sent++;
    } catch (err) {
      console.error(`[WeeklyReport] ❌ Error for ${student.name}:`, err.message);
    }
  }

  console.log(`[WeeklyReport] ✅ Reports sent: ${sent}/${students.length}`);
}

function scheduleWeeklyReports() {
  // Every Sunday at 08:00 Asia/Colombo (UTC+5:30 = 02:30 UTC)
  cron.schedule('30 2 * * 0', () => {
    processWeeklyReports().catch((err) =>
      console.error('[WeeklyReport] ❌ Job error:', err.message)
    );
  });
  console.log('📅 [WhatsApp] Weekly progress reports scheduled (Sundays 08:00 IST)');
}

module.exports = { scheduleWeeklyReports, processWeeklyReports };
