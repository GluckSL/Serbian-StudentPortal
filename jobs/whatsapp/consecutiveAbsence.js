/**
 * Task 5 — WhatsApp alert for 3+ consecutive class absences.
 *
 * Runs daily at 10:00 (Asia/Colombo → 04:30 UTC).
 *
 * For each active student:
 *   1. Fetch their last N recorded meetings (ordered newest first).
 *   2. Walk from the most recent backward — count how many are consecutive absences.
 *   3. If the streak reaches 3 or more, send an alert to the student AND their teacher.
 *
 * Uses a per-student flag (stored on User) to avoid re-sending the same alert
 * until the student attends a class and the streak resets.
 */
const cron = require('node-cron');
const MeetingLink = require('../../models/MeetingLink');
const User = require('../../models/User');
const { sendWhatsappNotification, NOTIFICATION_TYPES, getBatchSettingsMap, isBatchAllowedBySettings } = require('../../services/whatsappCrmService');

const CONSECUTIVE_THRESHOLD = 3;
const MEETINGS_TO_CHECK = 10; // look back this many recorded meetings

// We track alerting state on the User doc so we don't spam daily.
// Field: consecutiveAbsenceAlertSentAt — if set and student is still absent, we skip.
// Field: consecutiveAbsenceAlertStreak — last streak count we alerted on.

async function processConsecutiveAbsences() {
  const batchSettings = await getBatchSettingsMap();

  const students = await User.find({ role: 'STUDENT', isActive: true })
    .select('_id name whatsappNumber phoneNumber batch assignedTeacher consecutiveAbsenceAlertSentAt consecutiveAbsenceAlertStreak')
    .lean();

  let alertsSent = 0;

  for (const student of students) {
    if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.CONSECUTIVE_ABSENCE, student.batch)) continue;
    try {
      const recentMeetings = await MeetingLink.find({
        batch: student.batch,
        attendanceRecorded: true,
        'attendance.studentId': student._id,
      })
        .sort({ startTime: -1 })
        .limit(MEETINGS_TO_CHECK)
        .lean();

      if (recentMeetings.length < CONSECUTIVE_THRESHOLD) continue;

      // Count consecutive absences from the most recent meeting backward
      let streak = 0;
      for (const meeting of recentMeetings) {
        const record = meeting.attendance.find(
          (a) => String(a.studentId) === String(student._id)
        );
        if (record && !record.attended) {
          streak++;
        } else {
          break; // streak broken
        }
      }

      if (streak < CONSECUTIVE_THRESHOLD) {
        // Streak broken — clear the alert flag so it can fire again next time
        if (student.consecutiveAbsenceAlertStreak) {
          await User.findByIdAndUpdate(student._id, {
            $unset: { consecutiveAbsenceAlertSentAt: 1, consecutiveAbsenceAlertStreak: 1 },
          });
        }
        continue;
      }

      // Skip if we already alerted at this same streak length today
      const alreadyAlertedToday =
        student.consecutiveAbsenceAlertSentAt &&
        student.consecutiveAbsenceAlertStreak === streak &&
        new Date() - new Date(student.consecutiveAbsenceAlertSentAt) < 20 * 60 * 60 * 1000; // 20h guard

      if (alreadyAlertedToday) continue;

      // ── Send to student ──
      const phone = student.whatsappNumber || student.phoneNumber || '';
      await sendWhatsappNotification({
        phone,
        name: student.name,
        type: NOTIFICATION_TYPES.CONSECUTIVE_ABSENCE,
        message: `Hi ${student.name}, you have been absent for ${streak} consecutive classes in Batch ${student.batch}. Please contact your teacher or the admin team so we can support you. We miss you in class! 🙏`,
        data: {
          studentId: student._id,
          batch: student.batch,
          consecutiveAbsences: streak,
          role: 'STUDENT',
        },
      });

      // ── Send to assigned teacher ──
      if (student.assignedTeacher) {
        const teacher = await User.findById(student.assignedTeacher)
          .select('name whatsappNumber phoneNumber')
          .lean();
        if (teacher) {
          const teacherPhone = teacher.whatsappNumber || teacher.phoneNumber || '';
          await sendWhatsappNotification({
            phone: teacherPhone,
            name: teacher.name,
            type: NOTIFICATION_TYPES.CONSECUTIVE_ABSENCE,
            message: `Hi ${teacher.name}, your student ${student.name} (Batch: ${student.batch}) has been absent for ${streak} consecutive classes. Please follow up with them.`,
            data: {
              studentId: student._id,
              studentName: student.name,
              batch: student.batch,
              consecutiveAbsences: streak,
              role: 'TEACHER',
            },
          });
        }
      }

      // Record that we sent this alert
      await User.findByIdAndUpdate(student._id, {
        $set: {
          consecutiveAbsenceAlertSentAt: new Date(),
          consecutiveAbsenceAlertStreak: streak,
        },
      });

      alertsSent++;
      console.log(`[ConsecutiveAbsence] ✅ Alert sent for ${student.name} — ${streak} consecutive absences`);
    } catch (err) {
      console.error(`[ConsecutiveAbsence] ❌ Error for ${student.name}:`, err.message);
    }
  }

  console.log(`[ConsecutiveAbsence] Done. Alerts sent: ${alertsSent}`);
}

function scheduleConsecutiveAbsenceAlerts() {
  // Daily at 10:00 Asia/Colombo (04:30 UTC)
  cron.schedule('30 4 * * *', () => {
    processConsecutiveAbsences().catch((err) =>
      console.error('[ConsecutiveAbsence] ❌ Job error:', err.message)
    );
  });
  console.log('📅 [WhatsApp] Consecutive-absence alerts scheduled (daily 10:00 IST)');
}

module.exports = { scheduleConsecutiveAbsenceAlerts, processConsecutiveAbsences };
