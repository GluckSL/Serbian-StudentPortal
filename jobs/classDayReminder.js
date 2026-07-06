/**
 * Day-of-class morning reminder — runs daily at 6:00 AM IST.
 *
 * Finds every MeetingLink scheduled for later today and sends each enrolled
 * student a short WhatsApp message and a short email ("you have class today
 * at HH:MM"). The pre-class 30-minute reminders are handled separately by
 * jobs/whatsapp/classReminder.js (WhatsApp) and jobs/zoomMeetingReminderEmails.js
 * (email).
 *
 * Uses the morningReminderSent flag on MeetingLink with an atomic claim so
 * each meeting is reminded at most once, safe across restarts and multiple
 * server instances. WhatsApp sends respect the CRM batch settings and the
 * global automated-jobs gate; emails are always sent (matches how the other
 * email jobs are wired in app.js).
 */
const cron = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const {
  sendWhatsappNotification,
  NOTIFICATION_TYPES,
  getBatchSettingsMap,
  isBatchAllowedBySettings,
  isWhatsappAutomatedJobsEnabled,
} = require('../services/whatsappCrmService');

const TZ = 'Asia/Colombo'; // IST (+05:30)
const LOG_PREFIX = '[ClassDayReminder]';
const PORTAL_URL = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');

function formatClassTime(startTime, timeZone = TZ) {
  return new Date(startTime).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/** End of the current day in IST (Asia/Colombo is +05:30 year-round). */
function endOfTodayIST(now = new Date()) {
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD
  return new Date(`${dateStr}T23:59:59.999+05:30`);
}

function buildMorningReminderEmail({ name, topic, timeStr, batch }) {
  const subject = `🎓 Class today at ${timeStr} — ${topic} (Glück Global)`;
  const html = `
              <div style="font-family: Arial, sans-serif; background:#f9f9f9; padding:20px;">
                <div style="max-width:600px; margin:auto; background:#fff; padding:24px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                  <div style="background:#000e89; border-radius:8px; padding:16px; text-align:center;">
                    <h2 style="color:white; margin:0; font-size:20px;">Glück Global — Class today</h2>
                  </div>
                  <p style="margin:20px 0 0 0; color:#333; font-size:15px; line-height:1.7;">Hi <strong>${name}</strong>,</p>
                  <p style="margin:12px 0 0 0; color:#333; font-size:15px; line-height:1.7;">
                    Quick reminder — your German class <strong>"${topic}"</strong> is today at <strong>${timeStr}</strong> (Batch ${batch}).
                  </p>
                  <p style="margin:12px 0 0 0; color:#333; font-size:15px; line-height:1.7;">
                    Sign in to the <a href="${PORTAL_URL}/login" style="color:#000e89;">student portal</a>, open <strong>My Class</strong>, and click <strong>Join now</strong> when it is time.
                  </p>
                  <p style="margin:20px 0 0 0; color:#888; font-size:13px;">See you in class!<br><strong>Glück Global</strong></p>
                </div>
              </div>
            `;
  return { subject, html };
}

async function processClassDayReminders() {
  const now = new Date();
  const windowEnd = endOfTodayIST(now);
  if (now >= windowEnd) return;

  const whatsappEnabled = isWhatsappAutomatedJobsEnabled();
  const batchSettings = whatsappEnabled ? await getBatchSettingsMap() : null;

  const candidates = await MeetingLink.find({
    status: 'scheduled',
    morningReminderSent: { $ne: true },
    'attendees.0': { $exists: true },
    startTime: { $gt: now, $lte: windowEnd },
  }).limit(200);

  if (!candidates.length) return;

  for (const doc of candidates) {
    // Atomic claim to prevent duplicate sends across concurrent runs
    const meeting = await MeetingLink.findOneAndUpdate(
      {
        _id: doc._id,
        status: 'scheduled',
        morningReminderSent: { $ne: true },
        startTime: { $gt: now, $lte: windowEnd },
      },
      { $set: { morningReminderSent: true, morningReminderSentAt: new Date() } },
      { new: true }
    );
    if (!meeting) continue;

    await sendMorningRemindersForMeeting(meeting, { whatsappEnabled, batchSettings });
  }
}

/** Sends the morning WhatsApp + email reminders for one (already claimed) meeting. */
async function sendMorningRemindersForMeeting(meeting, { whatsappEnabled, batchSettings }) {
  const topic = meeting.topic || 'Your German class';
  const timeStr = formatClassTime(meeting.startTime, meeting.timezone || TZ);
  const whatsappAllowed =
    whatsappEnabled &&
    isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.CLASS_REMINDER, meeting.batch);

  let emailsSent = 0;
  let whatsappSent = 0;

  for (const attendee of meeting.attendees) {
    const name = attendee.name || 'Student';

    if (attendee.email) {
      try {
        const { subject, html } = buildMorningReminderEmail({
          name,
          topic,
          timeStr,
          batch: meeting.batch,
        });
        await transporter.sendMail({
          from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global'}" <${process.env.EMAIL_USER}>`,
          to: attendee.email,
          subject,
          html,
        });
        emailsSent++;
      } catch (err) {
        console.error(`${LOG_PREFIX} ❌ Email failed for ${name} (${attendee.email}):`, err.message);
      }
    }

    if (whatsappAllowed) {
      try {
        let phone = attendee.whatsappNumber || attendee.phone || '';
        if (!phone && attendee.studentId) {
          const user = await User.findById(attendee.studentId)
            .select('whatsappNumber phoneNumber')
            .lean();
          phone = user?.whatsappNumber || user?.phoneNumber || '';
        }
        await sendWhatsappNotification({
          phone,
          name,
          type: NOTIFICATION_TYPES.CLASS_REMINDER,
          message: `Hi ${name}, you have German class today! "${topic}" starts at ${timeStr}. Join via the Glück Global student portal: ${PORTAL_URL}/login`,
          data: {
            meetingId: meeting._id,
            topic,
            startTime: meeting.startTime,
            batch: meeting.batch,
            reminder: 'MORNING_DAY_OF_CLASS',
          },
        });
        whatsappSent++;
      } catch (err) {
        console.error(`${LOG_PREFIX} ❌ WhatsApp failed for ${name}:`, err.message);
      }
    }
  }

  console.log(
    `${LOG_PREFIX} ✅ "${topic}" (${meeting.batch}, ${timeStr}) — ${emailsSent} emails, ${whatsappSent} WhatsApp${whatsappAllowed ? '' : ' (WhatsApp gated off)'}`
  );
  return { emailsSent, whatsappSent, whatsappAllowed };
}

function scheduleClassDayReminders() {
  cron.schedule(
    '0 6 * * *',
    () => {
      processClassDayReminders().catch((err) =>
        console.error(`${LOG_PREFIX} ❌ Job error:`, err.message)
      );
    },
    { timezone: TZ }
  );
  console.log(`⏰ ${LOG_PREFIX} Scheduled — daily 06:00 ${TZ} (day-of-class WhatsApp + email reminders)`);
}

module.exports = {
  scheduleClassDayReminders,
  processClassDayReminders,
  sendMorningRemindersForMeeting,
};
