/**
 * CRM Portal Proxy — forwards requests to the external Gluck CRM API.
 * All routes are protected by verifyToken (mounted in app.js).
 * The CRM Bearer token stays on the server and is never exposed to the browser.
 */

const express = require('express');
const axios = require('axios');
const { isAdmin } = require('../middleware/auth');
const { sendManualWhatsappMessage, isWhatsappManualSendEnabled, isWhatsappAutomatedJobsEnabled } = require('../services/whatsappCrmService');
const { compareBoardWithPortal } = require('../services/crmPortalCompare');

const router = express.Router();

const CRM_BASE =
  process.env.CRM_PORTAL_API_BASE ||
  'https://s3wpekt2qj.ap-south-1.awsapprunner.com/api/v1';
const CRM_TOKEN = process.env.WEB_FORM_API_KEY || process.env.CRM_PORTAL_API_TOKEN || 'GluckGlobalWeb2026';

const E164_PHONE_RE = /^\+\d{7,19}$/;

function normalizeE164Phone(raw) {
  if (raw == null) return '';
  let phone = String(raw).trim().replace(/[\s\-().]/g, '');
  if (!phone) return '';
  if (!phone.startsWith('+')) {
    phone = phone.startsWith('00') ? `+${phone.slice(2)}` : `+${phone}`;
  }
  return phone;
}

const CRM_HEADERS = {
  Authorization: `Bearer ${CRM_TOKEN}`,
  'Content-Type': 'application/json',
};

/** CRM upstream 401/403 must not reach the SPA as 401/403 (auth interceptor logs user out). */
function sendUpstreamError(res, err) {
  const upstreamStatus = err.response?.status;
  const upstreamData = err.response?.data;

  if (upstreamStatus === 401 || upstreamStatus === 403) {
    console.error('[crm-portal] CRM auth rejected:', upstreamStatus, upstreamData);
    return res.status(502).json({
      success: false,
      message:
        upstreamData?.message ||
        'CRM API rejected this request. Check WEB_FORM_API_KEY / CRM token on the server.',
      crmStatus: upstreamStatus,
    });
  }

  const status = upstreamStatus || 502;
  return res.status(status).json(
    upstreamData || { success: false, message: err.message }
  );
}

/** Forward a GET request, passing through all query params */
async function proxyGet(upstreamPath, req, res) {
  try {
    const response = await axios.get(`${CRM_BASE}${upstreamPath}`, {
      headers: CRM_HEADERS,
      params: req.query,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

/** Forward a POST request, passing through the request body */
async function proxyPost(upstreamPath, req, res) {
  try {
    const response = await axios.post(`${CRM_BASE}${upstreamPath}`, req.body, {
      headers: CRM_HEADERS,
    });
    res.status(response.status).json(response.data);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}

// Only admins can access CRM data
router.use(isAdmin);

// ── Enrollment Board ─────────────────────────────────────────────────────────
router.get('/enrollment-board', (req, res) =>
  proxyGet('/sales-dashboard/enrollment-board', req, res)
);
router.get('/enrollment-board/filter', (req, res) =>
  proxyGet('/sales-dashboard/enrollment-board/filter', req, res)
);
router.get('/enrollment-board/advanced/fields', (req, res) =>
  proxyGet('/sales-dashboard/enrollment-board/advanced/fields', req, res)
);
router.post('/enrollment-board/advanced/field-values', (req, res) =>
  proxyPost('/sales-dashboard/enrollment-board/advanced/field-values', req, res)
);
router.post('/enrollment-board/advanced/query', (req, res) =>
  proxyPost('/sales-dashboard/enrollment-board/advanced/query', req, res)
);
router.post('/enrollment-board/compare-portal', async (req, res) => {
  try {
    const result = await compareBoardWithPortal('enrollment', {
      simple: req.body?.simple || {},
      advanced: req.body?.advanced || null,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[crm-portal] enrollment compare-portal:', err.message);
    res.status(err.message?.includes('grouped') ? 400 : 502).json({
      success: false,
      message: err.response?.data?.message || err.message || 'Failed to compare with portal',
    });
  }
});

// ── Language Team Board ───────────────────────────────────────────────────────
router.get('/language-team-board', (req, res) =>
  proxyGet('/students/language-team-board', req, res)
);
router.get('/language-team-board/filter', (req, res) =>
  proxyGet('/students/language-team-board/filter', req, res)
);
router.get('/language-team-board/advanced/fields', (req, res) =>
  proxyGet('/students/language-team-board/advanced/fields', req, res)
);
router.post('/language-team-board/advanced/field-values', (req, res) =>
  proxyPost('/students/language-team-board/advanced/field-values', req, res)
);
router.post('/language-team-board/advanced/query', (req, res) =>
  proxyPost('/students/language-team-board/advanced/query', req, res)
);
router.post('/language-team-board/compare-portal', async (req, res) => {
  try {
    const result = await compareBoardWithPortal('language', {
      simple: req.body?.simple || {},
      advanced: req.body?.advanced || null,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[crm-portal] language compare-portal:', err.message);
    res.status(err.message?.includes('grouped') ? 400 : 502).json({
      success: false,
      message: err.response?.data?.message || err.message || 'Failed to compare with portal',
    });
  }
});

// ── WhatsApp ─────────────────────────────────────────────────────────────────
router.get('/whatsapp/status', (_req, res) => {
  const manualEnabled = isWhatsappManualSendEnabled();
  const automatedEnabled = isWhatsappAutomatedJobsEnabled();
  res.json({
    success: true,
    enabled: manualEnabled,
    manualEnabled,
    automatedEnabled,
    message: manualEnabled
      ? (automatedEnabled
        ? 'Manual and automated WhatsApp sends are enabled.'
        : 'Manual send enabled. Automated jobs (absence alerts, etc.) are off.')
      : 'Manual WhatsApp sending is disabled on this server.',
  });
});

router.post('/whatsapp/send-message', async (req, res) => {
  const body = { ...(req.body || {}) };
  const message = String(body.message || '').trim();
  const phone = normalizeE164Phone(body.phone_number);
  const studentName = String(body.student_name || body.name || 'Student').trim();

  if (!phone || !E164_PHONE_RE.test(phone)) {
    return res.status(422).json({
      success: false,
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'phone_number must be E.164 format: + followed by 7–19 digits (e.g. +919311099671)',
    });
  }
  if (!message) {
    return res.status(422).json({
      success: false,
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'message is required',
    });
  }

  const result = await sendManualWhatsappMessage({
    phone_number: phone,
    message,
    department: body.department || 'Language',
    student_id: body.student_id ?? undefined,
  });

  if (result.ok) {
    const data = result.data?.data || {};
    console.log(`[crm-portal] ✅ WhatsApp sent to ${phone} (${studentName}) via CRM send-message API`);
    return res.status(result.status || 201).json({
      success: true,
      deliveryUncertain: true,
      message: 'CRM accepted the WhatsApp request (delivery not confirmed)',
      crmEndpoint: `${CRM_BASE}/student-portal/whatsapp/send-message`,
      data: {
        student_id: data.student_id ?? body.student_id ?? null,
        phone_number: data.phone_number || phone,
        message: data.message || message,
        department: data.department || body.department || 'Language',
        sent_at: data.sent_at || new Date().toISOString(),
      },
    });
  }

  const crmStatus = result.status;
  let crmMessage =
    result.error?.message || 'WhatsApp delivery failed. Please try again or contact support.';

  if (crmStatus === 503) {
    crmMessage =
      'Manual WhatsApp sending is disabled. Set WHATSAPP_MANUAL_SEND_ENABLED=true in .env and restart node app.js.';
  } else if (crmStatus === 500) {
    crmMessage =
      'The CRM WhatsApp API returned HTTP 500 for this phone number. The API is working (other numbers succeed) — this number may be invalid, not on WhatsApp, or rejected by Meta. Try a known-good number (e.g. +94769178622) or ask the CRM team to check delivery logs for this recipient.';
  } else if (crmStatus === 401 || crmStatus === 403) {
    crmMessage =
      crmMessage || 'CRM API rejected this request. Check WEB_FORM_API_KEY on the server.';
  }

  console.error(`[crm-portal] ❌ WhatsApp failed for ${phone} (${studentName}) — HTTP ${crmStatus}`);

  // Always 200 so the SPA shows the message in the form (not a generic HTTP error).
  return res.status(200).json({
    success: false,
    message: crmMessage,
    crmStatus,
    disabled: crmStatus === 503,
  });
});

module.exports = router;
