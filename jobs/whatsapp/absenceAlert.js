/**
 * Task 2 — WhatsApp absence alerts.
 *
 * Runs every 5 minutes. Two separate passes per run:
 *
 * Pass A — During class (30 min after startTime, while meeting is still live):
 *   Finds meetings that started 30+ min ago and are still within their duration,
 *   checks attendees who haven't joined yet (attendance entry is absent/missing),
 *   and sends a "you haven't joined yet" alert.
 *
 * Pass B — After class (attendance already recorded by autoFetchAttendance):
 *   Finds meetings where attendanceRecorded=true and absenceWhatsappSent!=true,
 *   sends a post-class absence notification to every student who attended=false.
 */
const cron = require('node-cron');
const MeetingLink = require('../../models/MeetingLink');
const User = require('../../models/User');
const { sendWhatsappNotification, NOTIFICATION_TYPES } = require('../../services/whatsappCrmService');

// ── helpers ──────────────────────────────────────────────────────────────────

async function resolvePhone(studentId, fallbackPhone) {
  if (fallbackPhone) return fallbackPhone;
  if (!studentId) return '';
  const user = await User.findById(studentId).select('whatsappNumber phoneNumber').lean();
  return user?.whatsappNumber || user?.phoneNumber || '';
}

// ── Pass A: during-class alerts ───────────────────────────────────────────────

async function processDuringClassAbsence() {
  const now = new Date();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

  // Meetings that started 30+ min ago but whose end time is still in the future
  const meetings = await MeetingLink.find({
    status: { $in: ['scheduled', 'started'] },
    startTime: { $lte: thirtyMinAgo },
    attendanceRecorded: { $ne: true },
    'attendees.0': { $exists: true },
  }).lean();

  const eligible = meetings.filter((m) => {
    const endTime = new Date(m.startTime.getTime() + (m.duration || 60) * 60000);
    return endTime > now;
  });

  for (const m of eligible) {
    const topic = m.topic || 'Your class';

    // Build a set of studentIds who are confirmed present in the attendance array
    const presentIds = new Set(
      (m.attendance || [])
        .filter((a) => a.attended || a.status === 'attended')
        .map((a) => String(a.studentId))
    );

    for (const attendee of m.attendees) {
      if (presentIds.has(String(attendee.studentId))) continue;

      const phone = await resolvePhone(attendee.studentId, attendee.whatsappNumber || '');
      await sendWhatsappNotification({
        phone,
        name: attendee.name,
        type: NOTIFICATION_TYPES.ABSENT_DURING_CLASS,
        message: `Hi ${attendee.name}, your class "${topic}" is currently ongoing and you haven't joined yet. Please join now: ${m.joinUrl || m.link || ''}`,
        data: {
          meetingId: m._id,
          topic,
          batch: m.batch,
          startTime: m.startTime,
          joinUrl: m.joinUrl || m.link,
        },
      });
    }
  }
}

// ── Pass B: after-class alerts ────────────────────────────────────────────────

async function processAfterClassAbsence() {
  const meetings = await MeetingLink.find({
    attendanceRecorded: true,
    absenceWhatsappSent: { $ne: true },
    'attendance.0': { $exists: true },
  }).limit(80);

  for (const doc of meetings) {
    // Atomic claim
    const meeting = await MeetingLink.findOneAndUpdate(
      { _id: doc._id, attendanceRecorded: true, absenceWhatsappSent: { $ne: true } },
      { $set: { absenceWhatsappSent: true, absenceWhatsappSentAt: new Date() } },
      { new: true }
    );
    if (!meeting) continue;

    const topic = meeting.topic || 'Your class';
    const absentees = meeting.attendance.filter((a) => !a.attended);

    for (const entry of absentees) {
      const phone = await resolvePhone(entry.studentId, entry.whatsappNumber || '');
      await sendWhatsappNotification({
        phone,
        name: entry.name,
        type: NOTIFICATION_TYPES.ABSENT_AFTER_CLASS,
        message: `Hi ${entry.name}, you were marked absent from the class "${topic}" (Batch: ${meeting.batch}) on ${meeting.startTime?.toLocaleDateString()}. Please reach out to your teacher if you need help catching up.`,
        data: {
          meetingId: meeting._id,
          topic,
          batch: meeting.batch,
          classDate: meeting.startTime,
          attendanceStatus: 'absent',
        },
      });
    }

    if (absentees.length > 0) {
      console.log(`[AbsenceAlert] ✅ After-class alerts sent for "${topic}" — ${absentees.length} absent`);
    }
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function processAbsenceAlerts() {
  await processDuringClassAbsence().catch((err) =>
    console.error('[AbsenceAlert] ❌ During-class pass error:', err.message)
  );
  await processAfterClassAbsence().catch((err) =>
    console.error('[AbsenceAlert] ❌ After-class pass error:', err.message)
  );
}

function scheduleAbsenceAlerts() {
  cron.schedule('*/5 * * * *', () => {
    processAbsenceAlerts().catch((err) =>
      console.error('[AbsenceAlert] ❌ Job error:', err.message)
    );
  });
  console.log('📅 [WhatsApp] Absence alerts scheduled (every 5 min — during + after class)');
}

module.exports = { scheduleAbsenceAlerts, processAbsenceAlerts };
