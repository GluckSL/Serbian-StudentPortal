/**
 * Task 3 — WhatsApp alerts for missed activities and excessive absences.
 *
 * Runs daily at 9 AM (Asia/Colombo).
 *
 * Alert A — Missed activities:
 *   Students who have not completed any exercise in the past 7 days.
 *
 * Alert B — Excessive absences:
 *   Students absent in 5 or more of their last 10 recorded classes.
 */
const cron = require('node-cron');
const MeetingLink = require('../../models/MeetingLink');
const ExerciseAttempt = require('../../models/ExerciseAttempt');
const User = require('../../models/User');
const { sendWhatsappNotification, NOTIFICATION_TYPES, getBatchSettingsMap, isBatchAllowedBySettings } = require('../../services/whatsappCrmService');

// ── Alert A: missed activities (no exercise completed in last 7 days) ──────────

async function processMissedActivities(batchSettings) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetch all active students
  const students = await User.find({ role: 'STUDENT', isActive: true })
    .select('_id name whatsappNumber phoneNumber batch')
    .lean();

  for (const student of students) {
    if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.MISSED_ACTIVITIES, student.batch)) continue;

    const recentCompleted = await ExerciseAttempt.countDocuments({
      studentId: student._id,
      status: 'completed',
      completedAt: { $gte: sevenDaysAgo },
    });

    if (recentCompleted > 0) continue;

    const phone = student.whatsappNumber || student.phoneNumber || '';
    await sendWhatsappNotification({
      phone,
      name: student.name,
      type: NOTIFICATION_TYPES.MISSED_ACTIVITIES,
      message: `Hi ${student.name}, you haven't completed any activities in the past 7 days. Log in to the portal and continue your learning journey — consistency is key!`,
      data: {
        studentId: student._id,
        batch: student.batch,
        lastActivityCheck: sevenDaysAgo,
      },
    });
  }

  console.log('[MissedActivities] ✅ Missed-activity alerts processed');
}

// ── Alert B: excessive absences (5+ absent in last 10 recorded classes) ────────

async function processExcessiveAbsences(batchSettings) {
  const students = await User.find({ role: 'STUDENT', isActive: true })
    .select('_id name whatsappNumber phoneNumber batch')
    .lean();

  for (const student of students) {
    if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.EXCESSIVE_ABSENCES, student.batch)) continue;
    // Get last 10 recorded meetings for this student's batch
    const recentMeetings = await MeetingLink.find({
      batch: student.batch,
      attendanceRecorded: true,
      'attendance.studentId': student._id,
    })
      .sort({ startTime: -1 })
      .limit(10)
      .lean();

    if (recentMeetings.length < 3) continue; // not enough data yet

    let absentCount = 0;
    for (const meeting of recentMeetings) {
      const record = meeting.attendance.find(
        (a) => String(a.studentId) === String(student._id)
      );
      if (record && !record.attended) absentCount++;
    }

    if (absentCount < 5) continue;

    const phone = student.whatsappNumber || student.phoneNumber || '';
    await sendWhatsappNotification({
      phone,
      name: student.name,
      type: NOTIFICATION_TYPES.EXCESSIVE_ABSENCES,
      message: `Hi ${student.name}, you have been absent in ${absentCount} of your last ${recentMeetings.length} classes (Batch: ${student.batch}). Please contact your teacher to discuss your attendance.`,
      data: {
        studentId: student._id,
        batch: student.batch,
        absentCount,
        totalChecked: recentMeetings.length,
      },
    });
  }

  console.log('[MissedActivities] ✅ Excessive-absence alerts processed');
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function processMissedActivitiesAndAbsences() {
  const batchSettings = await getBatchSettingsMap();
  await processMissedActivities(batchSettings).catch((err) =>
    console.error('[MissedActivities] ❌ Missed-activities error:', err.message)
  );
  await processExcessiveAbsences(batchSettings).catch((err) =>
    console.error('[MissedActivities] ❌ Excessive-absences error:', err.message)
  );
}

function scheduleMissedActivitiesAlerts() {
  // Daily at 09:00 Asia/Colombo (UTC+5:30 → 03:30 UTC)
  cron.schedule('30 3 * * *', () => {
    processMissedActivitiesAndAbsences().catch((err) =>
      console.error('[MissedActivities] ❌ Job error:', err.message)
    );
  });
  console.log('📅 [WhatsApp] Missed-activities alerts scheduled (daily 09:00 IST)');
}

module.exports = { scheduleMissedActivitiesAlerts, processMissedActivitiesAndAbsences };
