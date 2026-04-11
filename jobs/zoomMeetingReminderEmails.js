/**
 * Sends Zoom class join-link emails ~10 minutes before start (not at schedule time).
 * Runs every minute via node-cron.
 */
const cron = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const transporter = require('../config/emailConfig');
const {
  sendInvitationEmailsToAttendees,
  DEFAULT_REMINDER_MINUTES_BEFORE
} = require('../services/zoomInvitationEmail');

async function processReminderEmails() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + DEFAULT_REMINDER_MINUTES_BEFORE * 60 * 1000);

  const candidates = await MeetingLink.find({
    status: 'scheduled',
    reminderEmailSent: { $ne: true },
    'attendees.0': { $exists: true },
    startTime: { $gt: now, $lte: windowEnd }
  }).limit(80);

  for (const doc of candidates) {
    try {
      const meeting = await MeetingLink.findOneAndUpdate(
        {
          _id: doc._id,
          status: 'scheduled',
          reminderEmailSent: { $ne: true },
          'attendees.0': { $exists: true },
          startTime: { $gt: now, $lte: windowEnd }
        },
        { $set: { reminderEmailSent: true, reminderEmailSentAt: new Date() } },
        { new: true }
      );

      if (!meeting) continue;

      const results = await sendInvitationEmailsToAttendees(meeting, transporter);

      if (results.attempted === 0) {
        meeting.emailNotificationStatus = {
          attempted: 0,
          successful: 0,
          failed: 0,
          allSent: false,
          failedStudents: [],
          lastAttempt: new Date()
        };
        await meeting.save();
        console.warn(`⚠️ Zoom reminder: no valid attendee emails for meeting ${meeting._id}`);
        continue;
      }

      if (results.attempted > 0 && results.successful === 0) {
        await MeetingLink.findByIdAndUpdate(meeting._id, {
          $set: { reminderEmailSent: false },
          $unset: { reminderEmailSentAt: 1 }
        });
        console.warn(
          `⚠️ Zoom reminder: all emails failed for meeting ${meeting._id}, will retry next run`
        );
        continue;
      }

      meeting.emailNotificationStatus = {
        attempted: results.attempted,
        successful: results.successful,
        failed: results.failed,
        allSent:
          results.failed === 0 && results.successful === results.attempted && results.attempted > 0,
        failedStudents: results.failedStudents,
        lastAttempt: new Date()
      };
      await meeting.save();
      console.log(
        `✅ Zoom reminder emails for "${meeting.topic}" (${results.successful}/${results.attempted} ok)`
      );
    } catch (e) {
      console.error('❌ Zoom reminder job error for meeting', doc._id, e.message);
      try {
        await MeetingLink.findByIdAndUpdate(doc._id, {
          $set: { reminderEmailSent: false },
          $unset: { reminderEmailSentAt: 1 }
        });
      } catch (_) {
        /* ignore */
      }
    }
  }
}

function scheduleZoomMeetingReminderEmails() {
  cron.schedule('* * * * *', () => {
    processReminderEmails().catch((err) =>
      console.error('zoomMeetingReminderEmails:', err.message)
    );
  });
  console.log(
    `📅 Scheduled: Zoom meeting reminder emails (every minute, ~${DEFAULT_REMINDER_MINUTES_BEFORE} min before start)`
  );
}

module.exports = { scheduleZoomMeetingReminderEmails, processReminderEmails };
