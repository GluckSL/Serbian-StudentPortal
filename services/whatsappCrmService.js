/**
 * WhatsApp CRM integration.
 * - Automated jobs → student-portal/webhook (CLASS_REMINDER, ABSENT_*, etc.)
 * - Manual CRM portal sends → student-portal/whatsapp/send-message (Language Dept number)
 */
const axios = require('axios');

const CRM_BASE =
  process.env.CRM_PORTAL_API_BASE ||
  'https://s3wpekt2qj.ap-south-1.awsapprunner.com/api/v1';
const CRM_TOKEN =
  process.env.WEB_FORM_API_KEY || process.env.CRM_PORTAL_API_TOKEN || 'GluckGlobalWeb2026';
const CRM_HEADERS = {
  Authorization: `Bearer ${CRM_TOKEN}`,
  'Content-Type': 'application/json',
};

const WEBHOOK_URL =
  process.env.WHATSAPP_CRM_WEBHOOK_URL ||
  `${CRM_BASE}/student-portal/webhook`;

/** Master kill switch — WHATSAPP_SEND_ENABLED=false disables everything. */
function isWhatsappSendEnabled() {
  return String(process.env.WHATSAPP_SEND_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/** Manual send from Admin → CRM → WhatsApp tab. */
function isWhatsappManualSendEnabled() {
  if (!isWhatsappSendEnabled()) return false;
  return String(process.env.WHATSAPP_MANUAL_SEND_ENABLED ?? 'true').toLowerCase() !== 'false';
}

/** Automated cron jobs (class reminders, absence alerts, etc.). */
function isWhatsappAutomatedJobsEnabled() {
  if (!isWhatsappSendEnabled()) return false;
  return String(process.env.WHATSAPP_AUTOMATED_JOBS_ENABLED ?? 'true').toLowerCase() !== 'false';
}

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
  DAILY_TASK_REMINDER: 'DAILY_TASK_REMINDER',
  PAYMENT_OVERDUE_REMINDER: 'PAYMENT_OVERDUE_REMINDER',
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
  if (!isWhatsappAutomatedJobsEnabled()) {
    console.log(`[WhatsApp] ⏸ Skipped "${type}" for ${name} (${phone}) — automated jobs disabled`);
    return false;
  }

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

/**
 * Send a manual WhatsApp from the CRM portal UI.
 * Uses the documented CRM send-message API (Language Department business number).
 */
async function sendManualWhatsappMessage({ phone_number, message, department = 'Language', student_id }) {
  if (!isWhatsappManualSendEnabled()) {
    console.log(`[WhatsApp] ⏸ Skipped manual message to ${phone_number} — manual send disabled`);
    return {
      ok: false,
      status: 503,
      error: { message: 'Manual WhatsApp sending is disabled on this server.' },
    };
  }

  const payload = { phone_number, message, department };
  if (student_id != null && student_id !== '') {
    payload.student_id = student_id;
  }

  try {
    const response = await axios.post(
      `${CRM_BASE}/student-portal/whatsapp/send-message`,
      payload,
      { headers: CRM_HEADERS, timeout: 30000 }
    );
    console.log(
      `[WhatsApp] ✅ Manual message via CRM send-message API → ${phone_number}`,
      response.data?.data?.sent_at || ''
    );
    return { ok: true, status: response.status, data: response.data };
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data || { message: err.message };
    console.error(
      `[WhatsApp] ❌ Manual send failed for ${phone_number} — HTTP ${status}:`,
      JSON.stringify(body)
    );
    return { ok: false, status: status || 502, error: body };
  }
}

module.exports = {
  sendWhatsappNotification,
  sendBulkWhatsappNotifications,
  sendManualWhatsappMessage,
  isWhatsappSendEnabled,
  isWhatsappManualSendEnabled,
  isWhatsappAutomatedJobsEnabled,
  NOTIFICATION_TYPES,
  CRM_BASE,
};
