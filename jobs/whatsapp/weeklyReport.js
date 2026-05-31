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
const { sendWhatsappNotification, NOTIFICATION_TYPES } = require('../../services/whatsappCrmService');

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

function trend(thisWeek, lastWeek) {
  if (lastWeek === 0 && thisWeek === 0) return 'same';
  if (thisWeek > lastWeek) return 'up';
  if (thisWeek < lastWeek) return 'down';
  return 'same';
}

function trendEmoji(t) {
  if (t === 'up') return '📈';
  if (t === 'down') return '📉';
  return '➡️';
}

function buildMessage(student, stats) {
  const { thisWeek, lastWeek } = stats;
  const lines = [
    `Hi ${student.name}! Here is your weekly progress report 📊`,
    '',
    `🎓 Classes attended : ${thisWeek.classes} (last week: ${lastWeek.classes}) ${trendEmoji(trend(thisWeek.classes, lastWeek.classes))}`,
    `✅ Exercises done   : ${thisWeek.exercises} (last week: ${lastWeek.exercises}) ${trendEmoji(trend(thisWeek.exercises, lastWeek.exercises))}`,
    `⏱ Time on modules  : ${thisWeek.timeSpent} min (last week: ${lastWeek.timeSpent} min) ${trendEmoji(trend(thisWeek.timeSpent, lastWeek.timeSpent))}`,
    '',
  ];

  const improvements = [];
  if (thisWeek.classes > lastWeek.classes) improvements.push('attendance');
  if (thisWeek.exercises > lastWeek.exercises) improvements.push('exercise completion');
  if (thisWeek.timeSpent > lastWeek.timeSpent) improvements.push('study time');

  if (improvements.length > 0) {
    lines.push(`Great job improving your ${improvements.join(' and ')} this week! Keep it up! 💪`);
  } else if (improvements.length === 0 && (thisWeek.classes > 0 || thisWeek.exercises > 0)) {
    lines.push('Keep going — consistency is what builds fluency! 🌟');
  } else {
    lines.push('It looks like a quiet week. Try to log in and do at least one activity today! 🚀');
  }

  return lines.join('\n');
}

// ── Main report processor ─────────────────────────────────────────────────────

async function processWeeklyReports() {
  const thisWeekRange = weekBoundaries(0);
  const lastWeekRange = weekBoundaries(1);

  const students = await User.find({ role: 'STUDENT', isActive: true })
    .select('_id name whatsappNumber phoneNumber batch')
    .lean();

  console.log(`[WeeklyReport] Processing ${students.length} student(s)...`);
  let sent = 0;

  for (const student of students) {
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
