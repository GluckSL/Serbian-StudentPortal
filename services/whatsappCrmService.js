/**
 * WhatsApp CRM webhook service.
 * All notification jobs call sendWhatsappNotification() to POST to the CRM.
 */
const axios = require('axios');

const WEBHOOK_URL =
  process.env.WHATSAPP_CRM_WEBHOOK_URL ||
  'https://s3wpekt2qj.ap-south-1.awsapprunner.com/api/v1/student-poratal/webhook';

/**
 * Notification type constants — one per action.
 * Must match the types expected by the CRM on the other end.
 */
const NOTIFICATION_TYPES = {
  CLASS_REMINDER: 'CLASS_REMINDER',
  ABSENT_DURING_CLASS: 'ABSENT_DURING_CLASS',
  ABSENT_AFTER_CLASS: 'ABSENT_AFTER_CLASS',
  MISSED_ACTIVITIES: 'MISSED_ACTIVITIES',
  EXCESSIVE_ABSENCES: 'EXCESSIVE_ABSENCES',
  WEEKLY_PROGRESS_REPORT: 'WEEKLY_PROGRESS_REPORT',
  CONSECUTIVE_ABSENCE: 'CONSECUTIVE_ABSENCE',
};

/**
 * Send a single WhatsApp notification via the CRM webhook.
 *
 * @param {object} params
 * @param {string} params.phone       - Recipient phone / WhatsApp number (e.g. "+94771234567")
 * @param {string} params.name        - Recipient display name
 * @param {string} params.type        - One of NOTIFICATION_TYPES values
 * @param {string} params.message     - Human-readable message text
 * @param {object} [params.data]      - Optional extra context forwarded to the CRM
 * @returns {Promise<boolean>}        - true on success, false on failure
 */
async function sendWhatsappNotification({ phone, name, type, message, data = {} }) {
  if (!phone) {
    console.warn(`[WhatsApp] Skipping "${type}" for ${name} — no phone number on record`);
    return false;
  }

  const payload = { phone, name, type, message, data };

  try {
    await axios.post(WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    console.log(`[WhatsApp] ✅ Sent "${type}" to ${name} (${phone})`);
    return true;
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[WhatsApp] ❌ Failed "${type}" for ${name} (${phone}) — HTTP ${status}: ${body}`);
    return false;
  }
}

/**
 * Send the same notification to a list of recipients.
 * Returns a summary { attempted, successful, failed }.
 *
 * @param {Array<{phone, name}>} recipients
 * @param {string} type
 * @param {Function} messageFn   - (recipient) => string
 * @param {Function} [dataFn]    - (recipient) => object
 */
async function sendBulkWhatsappNotifications(recipients, type, messageFn, dataFn = () => ({})) {
  let successful = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const ok = await sendWhatsappNotification({
      phone: recipient.phone,
      name: recipient.name,
      type,
      message: messageFn(recipient),
      data: dataFn(recipient),
    });
    ok ? successful++ : failed++;
  }

  return { attempted: recipients.length, successful, failed };
}

module.exports = {
  sendWhatsappNotification,
  sendBulkWhatsappNotifications,
  NOTIFICATION_TYPES,
};
