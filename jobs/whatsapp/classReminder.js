/**
 * Task 1 — Pre-class WhatsApp reminder.
 *
 * Runs every minute. Finds MeetingLinks starting within the next 30 minutes
 * that have not yet had a WhatsApp reminder sent, then notifies every enrolled
 * student and the assigned teacher.
 */
const cron = require('node-cron');
const MeetingLink = require('../../models/MeetingLink');
const User = require('../../models/User');
const { sendWhatsappNotification, NOTIFICATION_TYPES, getBatchSettingsMap, isBatchAllowedBySettings } = require('../../services/whatsappCrmService');
const { classReminderStudent, classReminderTeacher } = require('../../utils/whatsappNotificationMessages');

const REMINDER_WINDOW_MINUTES = 30;
const PORTAL_URL = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');

async function processClassReminders() {
  const batchSettings = await getBatchSettingsMap();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

  // Find meetings starting within the window that haven't had a WhatsApp reminder yet
  const meetings = await MeetingLink.find({
    status: 'scheduled',
    reminderWhatsappSent: { $ne: true },
    'attendees.0': { $exists: true },
    startTime: { $gt: now, $lte: windowEnd },
  }).limit(80);

  if (meetings.length === 0) return;

  for (const doc of meetings) {
    // Atomic claim to prevent duplicate sends across concurrent runs
    const meeting = await MeetingLink.findOneAndUpdate(
      {
        _id: doc._id,
        status: 'scheduled',
        reminderWhatsappSent: { $ne: true },
        startTime: { $gt: now, $lte: windowEnd },
      },
      { $set: { reminderWhatsappSent: true, reminderWhatsappSentAt: new Date() } },
      { new: true }
    );
    if (!meeting) continue;

    if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.CLASS_REMINDER, meeting.batch)) {
      console.log(`[ClassReminder] ⏭ Skipped "${meeting.topic}" (batch: ${meeting.batch}) — not in targeted batches`);
      continue;
    }

    const minutesUntilStart = Math.round((meeting.startTime - now) / 60000);
    const topic = meeting.topic || 'Your class';
    const joinUrl = meeting.joinUrl || meeting.link || '';

    // --- Notify each student (portal only — no Zoom link in WhatsApp) ---
    for (const attendee of meeting.attendees) {
      const phone = attendee.whatsappNumber || attendee.phone || '';
      // Fetch fresh user data to get the whatsappNumber stored on User doc
      let userPhone = phone;
      if (!userPhone && attendee.studentId) {
        const user = await User.findById(attendee.studentId).select('whatsappNumber phoneNumber').lean();
        userPhone = user?.whatsappNumber || user?.phoneNumber || '';
      }

      await sendWhatsappNotification({
        phone: userPhone,
        name: attendee.name,
        type: NOTIFICATION_TYPES.CLASS_REMINDER,
        message: classReminderStudent({
          name: attendee.name,
          topic,
          minutesUntilStart,
          portalUrl: PORTAL_URL,
          batch: meeting.batch,
        }),
        data: {
          meetingId: meeting._id,
          topic,
          startTime: meeting.startTime,
          batch: meeting.batch,
          portalUrl: `${PORTAL_URL}/login`,
        },
      });
    }

    // --- Notify the assigned teacher ---
    if (meeting.assignedTeacher) {
      const teacher = await User.findById(meeting.assignedTeacher)
        .select('name whatsappNumber phoneNumber')
        .lean();
      if (teacher) {
        const teacherPhone = teacher.whatsappNumber || teacher.phoneNumber || '';
        await sendWhatsappNotification({
          phone: teacherPhone,
          name: teacher.name,
          type: NOTIFICATION_TYPES.CLASS_REMINDER,
          message: classReminderTeacher({
            name: teacher.name,
            topic,
            minutesUntilStart,
            batch: meeting.batch,
          }) + ` (Batch ${meeting.batch}). Start: ${meeting.startUrl || joinUrl}`,
          data: {
            meetingId: meeting._id,
            topic,
            startTime: meeting.startTime,
            batch: meeting.batch,
            role: 'TEACHER',
            startUrl: meeting.startUrl || joinUrl,
          },
        });
      }
    }

    console.log(`[ClassReminder] ✅ Reminders sent for "${topic}" (${meeting.batch})`);
  }
}

function scheduleClassReminders() {
  cron.schedule('* * * * *', () => {
    processClassReminders().catch((err) =>
      console.error('[ClassReminder] ❌ Job error:', err.message)
    );
  });
  console.log(`📅 [WhatsApp] Class reminders scheduled (every minute, ${REMINDER_WINDOW_MINUTES} min window)`);
}

module.exports = { scheduleClassReminders, processClassReminders };
