/**
 * WhatsApp CRM integration.
 * Automated jobs and manual CRM sends both use student-portal/whatsapp/send-message
 * (Language Dept business number). The legacy webhook only acknowledges receipt and
 * does not confirm WhatsApp delivery.
 */
const axios = require('axios');

const E164_PHONE_RE = /^\+\d{7,19}$/;

/** Normalize to E.164 (+ followed by digits). Fixes common SL local format (+07… → +947…). */
function normalizeE164Phone(raw) {
  if (raw == null) return '';
  let phone = String(raw).trim().replace(/[\s\-().]/g, '');
  if (!phone) return '';
  if (!phone.startsWith('+')) {
    phone = phone.startsWith('00') ? `+${phone.slice(2)}` : `+${phone}`;
  }
  // Sri Lanka numbers sometimes stored as +07XXXXXXXX instead of +947XXXXXXXX
  if (/^\+0\d{8,}$/.test(phone)) {
    phone = `+94${phone.slice(2)}`;
  }
  return phone;
}

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
 * Send a single automated WhatsApp notification via the CRM send-message API.
 *
 * @param {object} params
 * @param {string} params.phone       - Recipient phone / WhatsApp number (e.g. "+94771234567")
 * @param {string} params.name        - Recipient display name
 * @param {string} params.type        - One of NOTIFICATION_TYPES values (logged only)
 * @param {string} params.message     - Human-readable message text
 * @param {object} [params.data]      - Optional extra context (studentId forwarded when present)
 * @returns {Promise<boolean>}        - true on success, false on failure
 */
async function sendWhatsappNotification({ phone, name, type, message, data = {} }) {
  if (!isWhatsappAutomatedJobsEnabled()) {
    console.log(`[WhatsApp] ⏸ Skipped "${type}" for ${name} (${phone}) — automated jobs disabled`);
    return false;
  }

  const phone_number = normalizeE164Phone(phone);
  if (!phone_number) {
    console.warn(`[WhatsApp] Skipping "${type}" for ${name} — no phone number on record`);
    return false;
  }
  if (!E164_PHONE_RE.test(phone_number)) {
    console.warn(`[WhatsApp] Skipping "${type}" for ${name} — invalid phone: ${phone}`);
    return false;
  }

  const payload = { phone_number, message, department: 'Language' };
  const rawStudentId = data?.studentId ?? data?.student_id;
  if (rawStudentId != null && rawStudentId !== '') {
    const numericId = parseInt(String(rawStudentId), 10);
    if (Number.isFinite(numericId) && numericId >= 1) {
      payload.student_id = numericId;
    }
  }

  try {
    const response = await axios.post(
      `${CRM_BASE}/student-portal/whatsapp/send-message`,
      payload,
      { headers: CRM_HEADERS, timeout: 30000 }
    );
    const sentAt = response.data?.data?.sent_at;
    console.log(
      `[WhatsApp] ✅ CRM accepted "${type}" for ${name} (${phone_number})` +
        (sentAt ? ` — sent_at ${sentAt}` : '')
    );
    return true;
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`[WhatsApp] ❌ Failed "${type}" for ${name} (${phone_number}) — HTTP ${status}: ${body}`);
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

  phone_number = normalizeE164Phone(phone_number);
  if (!phone_number || !E164_PHONE_RE.test(phone_number)) {
    return {
      ok: false,
      status: 422,
      error: { message: 'phone_number must be E.164 format: + followed by 7–19 digits' },
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

/**
 * Load all automation batch-targeting settings from the DB as a map.
 * Call once at the start of a cron job, then use isBatchAllowedBySettings() per student.
 *
 * @returns {Promise<Record<string, {allBatches: boolean, targetBatches: string[]}>>}
 */
async function getBatchSettingsMap() {
  try {
    const WhatsappAutomationSettings = require('../models/WhatsappAutomationSettings');
    const allSettings = await WhatsappAutomationSettings.find().lean();
    const map = {};
    for (const s of allSettings) {
      map[s.automationType] = s;
    }
    return map;
  } catch (err) {
    console.warn('[WhatsApp] getBatchSettingsMap error — failing open:', err.message);
    return {};
  }
}

/**
 * Synchronous check: is this student's batch allowed for the given automation type?
 * Always returns true if no settings found (fail-open — backward compatible).
 *
 * @param {Record<string, any>} settingsMap  - result of getBatchSettingsMap()
 * @param {string} automationType            - one of NOTIFICATION_TYPES values
 * @param {string|undefined} studentBatch    - e.g. "35" or "Batch 35"
 * @returns {boolean}
 */
function normalizeBatchName(batch) {
  if (!batch) return '';
  return String(batch).toLowerCase().replace(/^batch\s*/i, '').trim();
}

function isBatchAllowedBySettings(settingsMap, automationType, studentBatch) {
  const setting = settingsMap[automationType];
  if (!setting || setting.allBatches || !setting.targetBatches || setting.targetBatches.length === 0) {
    return true;
  }
  if (!studentBatch) return false;
  const normalized = normalizeBatchName(studentBatch);
  return setting.targetBatches.some((b) => normalizeBatchName(b) === normalized);
}

module.exports = {
  sendWhatsappNotification,
  sendBulkWhatsappNotifications,
  sendManualWhatsappMessage,
  normalizeE164Phone,
  isWhatsappSendEnabled,
  isWhatsappManualSendEnabled,
  isWhatsappAutomatedJobsEnabled,
  getBatchSettingsMap,
  isBatchAllowedBySettings,
  NOTIFICATION_TYPES,
  CRM_BASE,
};
