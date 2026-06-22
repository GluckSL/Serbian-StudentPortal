/**
 * Portal-absence reminder — email for ONGOING students who haven't logged in for 3+ days.
 *
 * Runs daily at 08:00 IST (02:30 UTC).
 *
 * Logic:
 *   1. Find ONGOING active students whose lastLogin was > 3 days ago.
 *   2. Send one motivational email per day for the next 3 days (3 emails total).
 *   3. After 3 reminders, stop until the student logs in again.
 *   4. On login, portalAbsenceReminderCount resets (see recordStudentLogin).
 */
const cron = require('node-cron');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const { buildPortalAbsenceReminderEmail } = require('../utils/emailTemplates');

const ABSENCE_THRESHOLD_DAYS = 3;
const MAX_REMINDERS_PER_STREAK = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const LOGIN_URL = process.env.FRONTEND_URL
  ? `${process.env.FRONTEND_URL}/login`
  : 'https://portal.gluckglobal.com/login';

function wasReminderSentToday(sentAt, now) {
  if (!sentAt) return false;
  const sent = new Date(sentAt);
  return (
    sent.getUTCFullYear() === now.getUTCFullYear() &&
    sent.getUTCMonth() === now.getUTCMonth() &&
    sent.getUTCDate() === now.getUTCDate()
  );
}

async function processPortalAbsenceReminders() {
  const now = new Date();
  const thresholdDate = new Date(now - ABSENCE_THRESHOLD_DAYS * MS_PER_DAY);

  const students = await User.find({
    role: 'STUDENT',
    isActive: true,
    studentStatus: 'ONGOING',
    lastLogin: { $lt: thresholdDate, $ne: null },
  })
    .select('_id name email lastLogin portalAbsenceReminderSentAt portalAbsenceReminderCount')
    .lean();

  let sent = 0;
  let skipped = 0;

  for (const student of students) {
    try {
      const reminderCount = student.portalAbsenceReminderCount || 0;

      if (reminderCount >= MAX_REMINDERS_PER_STREAK) {
        skipped++;
        continue;
      }

      if (wasReminderSentToday(student.portalAbsenceReminderSentAt, now)) {
        skipped++;
        continue;
      }

      const daysSince = Math.floor(
        (now - new Date(student.lastLogin)) / MS_PER_DAY
      );

      const { subject, html } = buildPortalAbsenceReminderEmail({
        name: student.name,
        daysSince,
        loginUrl: LOGIN_URL,
        reminderNumber: reminderCount + 1,
      });

      await transporter.sendMail({
        from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global'}" <${process.env.EMAIL_USER}>`,
        to: student.email,
        subject,
        html,
      });

      await User.findByIdAndUpdate(student._id, {
        $set: {
          portalAbsenceReminderSentAt: now,
          portalAbsenceReminderCount: reminderCount + 1,
        },
      });

      sent++;
      console.log(
        `[PortalAbsenceReminder] ✅ Reminder ${reminderCount + 1}/${MAX_REMINDERS_PER_STREAK} → ${student.name} (${student.email}) — ${daysSince} days absent`
      );
    } catch (err) {
      console.error(
        `[PortalAbsenceReminder] ❌ Failed for ${student.name} (${student.email}):`,
        err.message
      );
    }
  }

  console.log(
    `[PortalAbsenceReminder] Done. Sent: ${sent}, Skipped: ${skipped}`
  );
}

function schedulePortalAbsenceReminders() {
  cron.schedule('30 2 * * *', () => {
    processPortalAbsenceReminders().catch((err) =>
      console.error('[PortalAbsenceReminder] ❌ Job error:', err.message)
    );
  });
  console.log(
    '📅 [PortalAbsenceReminder] Scheduled — daily 08:00 IST; 3 emails over 3 days after 3+ days absent'
  );
}

module.exports = { schedulePortalAbsenceReminders, processPortalAbsenceReminders };
