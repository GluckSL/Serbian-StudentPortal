/**
 * Daily task reminder — runs at 12:00 PM Asia/Colombo every day.
 *
 * For every active ONGOING student whose current journey day has incomplete
 * exercises or DG bot tasks (live class excluded — consistent with the
 * Language Tracking admin view), we send:
 *
 *  - A short WhatsApp nudge (if WHATSAPP_AUTOMATED_JOBS_ENABLED=true)
 *  - A short email with the task list and a portal login button
 *
 * Sends at most once per student per calendar day (Asia/Colombo) via CronJobLog dedup.
 */
'use strict';

const cron = require('node-cron');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const { getIncompleteTasksForStudent } = require('../services/languageTrackingReminders.service');
const { sendWhatsappNotification, NOTIFICATION_TYPES, isWhatsappAutomatedJobsEnabled, getBatchSettingsMap, isBatchAllowedBySettings } = require('../services/whatsappCrmService');
const { buildDailyTaskReminderEmail } = require('../utils/emailTemplates');
const {
  resolveStudentPhone,
  portalLoginUrl,
  wasReminderSentToday,
  markReminderSentToday,
} = require('../services/studentReminderHelpers');

const JOB_PREFIX = 'dailyTaskReminder';

// ── Core processor ────────────────────────────────────────────────────────────

async function processDailyTaskReminders() {
  const students = await User.find({
    role: 'STUDENT',
    isActive: true,
    studentStatus: 'ONGOING',
  })
    .select('_id name email batch level subscription goStatus currentCourseDay whatsappNumber phoneNumber')
    .lean();

  const batchSettings = await getBatchSettingsMap();

  let sent = 0;
  let skipped = 0;

  for (const student of students) {
    try {
      if (!isBatchAllowedBySettings(batchSettings, NOTIFICATION_TYPES.DAILY_TASK_REMINDER, student.batch)) {
        skipped++;
        continue;
      }

      // Skip if already reminded today
      if (await wasReminderSentToday(JOB_PREFIX, student._id)) {
        skipped++;
        continue;
      }

      const { incompleteTasks, day, totalTasks, doneTasks } = await getIncompleteTasksForStudent(student);

      // Nothing left to do — no reminder needed
      if (!incompleteTasks.length) {
        skipped++;
        continue;
      }

      const portalUrl = portalLoginUrl();

      // ── WhatsApp (gated) ────────────────────────────────────────────────
      if (isWhatsappAutomatedJobsEnabled()) {
        const phone = resolveStudentPhone(student);
        const waMsg = `Hi ${student.name}, ${incompleteTasks.length} task(s) left for Day ${day}. Complete today: ${portalUrl}`;
        await sendWhatsappNotification({
          phone,
          name: student.name,
          type: NOTIFICATION_TYPES.DAILY_TASK_REMINDER,
          message: waMsg,
          data: { studentId: student._id, day, doneTasks, totalTasks },
        });
      }

      // ── Email (always runs) ─────────────────────────────────────────────
      if (student.email) {
        const { subject, html, text } = buildDailyTaskReminderEmail({
          name: student.name,
          day,
          incompleteTasks,
          portalUrl: process.env.FRONTEND_URL || 'https://gluckstudentsportal.com',
        });
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: student.email,
          subject,
          html,
          text,
        });
      }

      await markReminderSentToday(JOB_PREFIX, student._id);
      sent++;
    } catch (err) {
      console.error(`[DailyTaskReminder] ❌ Error for student ${student._id} (${student.name}):`, err.message);
    }
  }

  console.log(`[DailyTaskReminder] ✅ Done — ${sent} reminder(s) sent, ${skipped} skipped`);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function scheduleDailyTaskReminder() {
  // 12:00 PM Asia/Colombo daily
  cron.schedule('0 12 * * *', () => {
    processDailyTaskReminders().catch((err) =>
      console.error('[DailyTaskReminder] ❌ Job error:', err.message)
    );
  }, { timezone: 'Asia/Colombo' });
  console.log('📅 [DailyTaskReminder] Scheduled — runs at 12:00 PM Asia/Colombo daily');
}

module.exports = { scheduleDailyTaskReminder, processDailyTaskReminders };
