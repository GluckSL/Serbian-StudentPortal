/**
 * Student Portal → external WhatsApp / CRM webhook (JSON envelope).
 * URL: process.env.STUDENT_PORTAL_CRM_WEBHOOK_URL or settings.webhookUrlOverride
 */
const axios = require('axios');
const CrmStudentPortalSettings = require('../models/CrmStudentPortalSettings');

const SETTINGS_KEY = 'default';

const ALL_EVENT_KEYS = [
  'STUDENT_CREATED',
  'STUDENT_UPDATED',
  'STUDENT_DELETED',
  'TEACHER_CREATED',
  'TEACHER_UPDATED',
  'TEACHER_DELETED',
  'REMINDER_CREATED',
  'REMINDER_UPDATED',
  'REMINDER_DELETED',
  'FEEDBACK_CREATED',
  'FEEDBACK_UPDATED',
  'MANUAL_ANNOUNCEMENT_TRIGGER'
];

function defaultEnabledEvents() {
  const o = {};
  for (const k of ALL_EVENT_KEYS) {
    o[k] = k !== 'FEEDBACK_UPDATED';
  }
  return o;
}

function isTeacherRole(role) {
  return role === 'TEACHER' || role === 'TEACHER_ADMIN';
}

function sanitizeUserDoc(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete plain.password;
  return plain;
}

function sanitizeMeetingLink(doc) {
  if (!doc) return null;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  if (plain.zoomPassword) plain.zoomPassword = '[redacted]';
  return plain;
}

function sanitizeFeedbackDoc(doc) {
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
}

function mergeMeta(settings, overrides = {}) {
  const base = settings?.metaDefaults || {};
  return {
    remainderFrom: overrides.remainderFrom ?? base.remainderFrom ?? '',
    participate: overrides.participate ?? base.participate ?? '',
    feedbackForm: overrides.feedbackForm ?? base.feedbackForm ?? '',
    ...overrides
  };
}

function eventEnabled(settings, event) {
  const map = settings?.enabledEvents;
  if (!map || typeof map !== 'object') return true;
  if (Object.prototype.hasOwnProperty.call(map, event)) {
    return map[event] !== false;
  }
  return true;
}

function resolveWebhookUrl(settings) {
  const override = (settings?.webhookUrlOverride || '').trim();
  if (override) return override;
  return (process.env.STUDENT_PORTAL_CRM_WEBHOOK_URL || '').trim();
}

async function getOrCreateSettings() {
  let doc = await CrmStudentPortalSettings.findOne({ key: SETTINGS_KEY });
  if (!doc) {
    doc = await CrmStudentPortalSettings.create({
      key: SETTINGS_KEY,
      enabledEvents: defaultEnabledEvents()
    });
  }
  if (!doc.enabledEvents || Object.keys(doc.enabledEvents).length === 0) {
    doc.enabledEvents = { ...defaultEnabledEvents(), ...(doc.enabledEvents || {}) };
    await doc.save();
  }
  return doc;
}

/**
 * Fire-and-forget: schedule dispatch without blocking the HTTP handler.
 */
function scheduleDispatchEvent(payload) {
  setImmediate(() => {
    dispatchEvent(payload).catch((err) =>
      console.error('[StudentPortalCRM] scheduleDispatchEvent error:', err.message)
    );
  });
}

/**
 * POST one event to the CRM webhook. Does not throw; logs and updates settings lastError on failure.
 */
async function dispatchEvent({ event, entity, metaOverrides = {} }) {
  let settings;
  try {
    settings = await getOrCreateSettings();
  } catch (e) {
    console.error('[StudentPortalCRM] getOrCreateSettings failed:', e.message);
    return { ok: false, skipped: true, reason: 'settings' };
  }

  if (!eventEnabled(settings, event)) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  const url = resolveWebhookUrl(settings);
  if (!url) {
    console.warn('[StudentPortalCRM] No webhook URL configured; skip', event);
    return { ok: false, skipped: true, reason: 'no_url' };
  }

  const body = {
    source: 'gluck-portal',
    event,
    occurredAt: new Date().toISOString(),
    entity: entity || {},
    meta: mergeMeta(settings, metaOverrides)
  };

  try {
    await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });
    await CrmStudentPortalSettings.updateOne(
      { key: SETTINGS_KEY },
      { $set: { lastDispatchAt: new Date(), lastDispatchSuccessAt: new Date(), lastDispatchError: '' } }
    );
    console.log(`[StudentPortalCRM] ✅ ${event}`);
    return { ok: true };
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    const errText = `HTTP ${status || '?'}: ${msg}`;
    console.error(`[StudentPortalCRM] ❌ ${event} — ${errText}`);
    try {
      await CrmStudentPortalSettings.updateOne(
        { key: SETTINGS_KEY },
        { $set: { lastDispatchAt: new Date(), lastDispatchError: errText.slice(0, 2000) } }
      );
    } catch (_) {}
    return { ok: false, error: errText };
  }
}

function userEventForRole(role, action) {
  if (role === 'STUDENT') {
    return `STUDENT_${action}`;
  }
  if (isTeacherRole(role)) {
    return `TEACHER_${action}`;
  }
  return null;
}

module.exports = {
  ALL_EVENT_KEYS,
  defaultEnabledEvents,
  getOrCreateSettings,
  dispatchEvent,
  scheduleDispatchEvent,
  sanitizeUserDoc,
  sanitizeMeetingLink,
  sanitizeFeedbackDoc,
  mergeMeta,
  resolveWebhookUrl,
  isTeacherRole,
  userEventForRole,
  SETTINGS_KEY
};
