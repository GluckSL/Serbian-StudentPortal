/**
 * WhatsApp absence alerts — two separate passes per run.
 *
 * Pass A — Early join reminder (5 min after startTime, class still live):
 *   Finds meetings that started 5+ minutes ago, are still ongoing, and have
 *   not yet had an early-join reminder sent (earlyJoinReminderSent !== true).
 *   Uses JoinLog (portal click data) to identify who hasn't clicked Join yet,
 *   and sends them a WhatsApp nudge + email.  Atomic claim via findOneAndUpdate
 *   so the reminder fires exactly once per meeting even if the cron overlaps.
 *
 * Pass B — After-class absence (attendance already recorded by autoFetchAttendance):
 *   Finds meetings where attendanceRecorded=true and absenceWhatsappSent!=true,
 *   sends a post-class absence WhatsApp to every student who attended=false.
 */
'use strict';

const cron = require('node-cron');
const MeetingLink = require('../../models/MeetingLink');
const User = require('../../models/User');
const transporter = require('../../config/emailConfig');
const { sendWhatsappNotification, NOTIFICATION_TYPES, getBatchSettingsMap, isBatchAllowedBySettings } = require('../../services/whatsappCrmService');
const { getJoinLogDataForMeeting } = require('../../services/joinLogHelpers');
const { sendLiveJoinReminderEmails } = require('../../services/classJoinReminderEmail');
const { resolveStudentPhone } = require('../../services/studentReminderHelpers');

// ── Pass A: early join reminder (5 min after class starts) ───────────────────

async function processEarlyJoinReminder(batchSettings = {}) {
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);

  // Find unprocessed ongoing meetings that started 5+ min ago
  const candidates = await MeetingLink.find({
    status: { $in: ['scheduled', 'started'] },
    startTime: { $lte: fiveMinAgo },
    earlyJoinReminderSent: { $ne: true },
    'attendees.0': { $exists: true },
  })
    .select('_id startTime duration topic batch plan joinUrl link attendees assignedTeacher timezone')
    .lean();

  // Only process meetings whose end time is still in the future
  const ongoing = candidates.filter((m) => {
    const endTime = new Date(m.startTime.getTime() + (m.duration || 60) * 60000);
    return endTime > now;
  });

  for (const m of ongoing) {
    // Atomic claim — marks the flag so only one cron run processes each meeting
    const claimed = await MeetingLink.findOneAndUpdate(
      { _id: m._id, earlyJoinReminderSent: { $ne: true } },
      { $set: { earlyJoinReminderSent: true, earlyJoinReminderSentAt: now } },
      { new: false }
    );
    if (!claimed) continue; // another process already claimed it

    if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.ABSENT_DURING_CLASS, m.batch)) {
      console.log(`[AbsenceAlert] ⏭ Skipped early-join for "${m.topic}" (batch: ${m.batch}) — not in targeted batches`);
      continue;
    }

    const topic = m.topic || 'Your class';
    const { hasJoin } = await getJoinLogDataForMeeting(m._id);

    // Students who are on the attendee list but haven't clicked Join in the portal
    const notJoined = m.attendees.filter(
      (a) => a.studentId && !hasJoin.has(String(a.studentId))
    );

    if (!notJoined.length) continue;

    // ── WhatsApp (short nudge) ──────────────────────────────────────────────
    const portalUrl = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');
    for (const attendee of notJoined) {
      const user = await User.findById(attendee.studentId)
        .select('whatsappNumber phoneNumber')
        .lean();
      const phone = resolveStudentPhone(user);
      await sendWhatsappNotification({
        phone,
        name: attendee.name,
        type: NOTIFICATION_TYPES.ABSENT_DURING_CLASS,
        message: `Hi ${attendee.name}, "${topic}" started 5 min ago — please join now: ${portalUrl}/login`,
        data: {
          meetingId: m._id,
          topic,
          batch: m.batch,
          startTime: m.startTime,
        },
      });
    }

    // ── Email (reuse existing live-join reminder template) ──────────────────
    const recipients = notJoined.map((a) => ({ name: a.name, email: a.email }));
    const teacherDoc = m.assignedTeacher
      ? await User.findById(m.assignedTeacher).select('name').lean()
      : null;
    const teacherName = teacherDoc?.name || '';

    await sendLiveJoinReminderEmails(m, transporter, recipients, teacherName).catch((err) =>
      console.error('[AbsenceAlert] ❌ Email send error for', topic, ':', err.message)
    );

    console.log(
      `[AbsenceAlert] ✅ Early join reminders sent for "${topic}" (batch: ${m.batch}) — ${notJoined.length} student(s) not yet in portal`
    );
  }
}

// ── Pass B: after-class alerts ────────────────────────────────────────────────

async function processAfterClassAbsence(batchSettings = {}) {
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

    if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.ABSENT_AFTER_CLASS, meeting.batch)) {
      console.log(`[AbsenceAlert] ⏭ Skipped after-class for "${meeting.topic}" (batch: ${meeting.batch}) — not in targeted batches`);
      continue;
    }

    const topic = meeting.topic || 'Your class';
    const absentees = meeting.attendance.filter((a) => !a.attended);

    for (const entry of absentees) {
      const user = await User.findById(entry.studentId).select('whatsappNumber phoneNumber').lean();
      const phone = resolveStudentPhone(user) || entry.whatsappNumber || '';
      await sendWhatsappNotification({
        phone,
        name: entry.name,
        type: NOTIFICATION_TYPES.ABSENT_AFTER_CLASS,
        message: `Hi ${entry.name}, you were absent from "${topic}" on ${meeting.startTime?.toLocaleDateString()}. Log in or contact your teacher if you need help.`,
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
  const batchSettings = await getBatchSettingsMap();
  await processEarlyJoinReminder(batchSettings).catch((err) =>
    console.error('[AbsenceAlert] ❌ Early-join pass error:', err.message)
  );
  await processAfterClassAbsence(batchSettings).catch((err) =>
    console.error('[AbsenceAlert] ❌ After-class pass error:', err.message)
  );
}

function scheduleAbsenceAlerts() {
  cron.schedule('*/5 * * * *', () => {
    processAbsenceAlerts().catch((err) =>
      console.error('[AbsenceAlert] ❌ Job error:', err.message)
    );
  });
  console.log('📅 [WhatsApp] Absence alerts scheduled (every 5 min — early join + after class)');
}

module.exports = { scheduleAbsenceAlerts, processAbsenceAlerts, processEarlyJoinReminder, processAfterClassAbsence };
