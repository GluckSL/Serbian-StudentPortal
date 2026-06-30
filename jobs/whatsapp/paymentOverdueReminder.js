/**
 * Payment overdue WhatsApp reminder — runs at 08:00 AM Asia/Colombo every day.
 *
 * Sends a gentle WhatsApp message to every active student who has a formal
 * overdue balance (StudentPaymentProfile.overdueAmount > 0), which corresponds
 * exactly to the "Overdue" column in the Payment Hub.
 *
 * Sends at most once per student per calendar day (Asia/Colombo) via CronJobLog.
 * Runs detectAndMarkOverdue() first so the profile data is fresh before querying.
 */
'use strict';

const cron = require('node-cron');
const StudentPaymentProfile = require('../../modules/payments-v2/backend/models/StudentPaymentProfile');
const User = require('../../models/User');
const { sendWhatsappNotification, NOTIFICATION_TYPES } = require('../../services/whatsappCrmService');
const {
  resolveStudentPhone,
  wasReminderSentToday,
  markReminderSentToday,
} = require('../../services/studentReminderHelpers');

const JOB_PREFIX = 'paymentOverdueReminder';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formats the primary non-zero overdue amount for the message.
 * Shows the first currency with an overdue balance; falls back to the aggregate.
 */
function formatOverdueAmount(profile) {
  const breakdown = profile.currencyBreakdown || [];
  for (const entry of breakdown) {
    if ((entry.overdueAmount || 0) > 0) {
      return `${entry.currency} ${Number(entry.overdueAmount).toLocaleString()}`;
    }
  }
  // Fallback: aggregate (may mix currencies, rare)
  return `${Number(profile.overdueAmount).toLocaleString()}`;
}

// ── Core processor ────────────────────────────────────────────────────────────

async function processPaymentOverdueReminders() {
  // Refresh overdue statuses before querying so the profile data is current
  try {
    const { detectAndMarkOverdue } = require('../../modules/payments-v2/backend/services/paymentService');
    const result = await detectAndMarkOverdue();
    if (result.updatedCount > 0) {
      console.log(`[PaymentOverdueReminder] Marked ${result.updatedCount} request(s) as overdue before run`);
    }
  } catch (err) {
    console.warn('[PaymentOverdueReminder] ⚠ detectAndMarkOverdue failed:', err.message);
  }

  // Find all profiles with formal overdue balance
  const overdueProfiles = await StudentPaymentProfile.find({
    overdueAmount: { $gt: 0 },
  })
    .select('studentId overdueAmount overdueCount currencyBreakdown')
    .lean();

  let sent = 0;
  let skipped = 0;

  for (const profile of overdueProfiles) {
    try {
      const student = await User.findById(profile.studentId)
        .select('name whatsappNumber phoneNumber isActive studentStatus')
        .lean();

      // Skip withdrawn, inactive, or missing students
      if (!student || !student.isActive || student.studentStatus === 'WITHDREW') {
        skipped++;
        continue;
      }

      const phone = resolveStudentPhone(student);
      if (!phone) {
        skipped++;
        continue;
      }

      // Dedup: only one reminder per student per calendar day
      if (await wasReminderSentToday(JOB_PREFIX, profile.studentId)) {
        skipped++;
        continue;
      }

      const amountLabel = formatOverdueAmount(profile);
      const message =
        `Good morning ${student.name}! A gentle reminder: you have ${amountLabel} overdue on your Glück account. ` +
        `Please clear it when you can so your learning continues without interruption. ` +
        `Questions? Reply here or email support@gluckglobal.com`;

      await sendWhatsappNotification({
        phone,
        name: student.name,
        type: NOTIFICATION_TYPES.PAYMENT_OVERDUE_REMINDER,
        message,
        data: {
          studentId: profile.studentId,
          overdueAmount: profile.overdueAmount,
          overdueCount: profile.overdueCount,
        },
      });

      await markReminderSentToday(JOB_PREFIX, profile.studentId);
      sent++;
    } catch (err) {
      console.error(`[PaymentOverdueReminder] ❌ Error for student ${profile.studentId}:`, err.message);
    }
  }

  console.log(`[PaymentOverdueReminder] ✅ Done — ${sent} reminder(s) sent, ${skipped} skipped`);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function schedulePaymentOverdueReminder() {
  // 08:00 AM Asia/Colombo daily
  cron.schedule('0 8 * * *', () => {
    processPaymentOverdueReminders().catch((err) =>
      console.error('[PaymentOverdueReminder] ❌ Job error:', err.message)
    );
  }, { timezone: 'Asia/Colombo' });
  console.log('📅 [WhatsApp] Payment overdue reminders scheduled — 08:00 AM Asia/Colombo daily');
}

module.exports = { schedulePaymentOverdueReminder, processPaymentOverdueReminders };
