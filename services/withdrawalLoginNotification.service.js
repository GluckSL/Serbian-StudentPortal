// services/withdrawalLoginNotification.service.js
// Alerts when uncertain/withdrawn students attempt login or confirm YES/NO on the modal.

const transporter = require('../config/emailConfig');

const WITHDRAWAL_ALERT_RECIPIENTS = [
  'selvaganesh@gluckglobal.com',
  'ceo@gluckglobal.com',
  'sourav@gluckglobal.com',
];

function getFromAddress() {
  const user = process.env.EMAIL_USER || process.env.SMTP_USER;
  const fromName = process.env.EMAIL_FROM_NAME || 'Glück Global Student Portal';
  if (!user) return fromName;
  return `"${fromName}" <${user}>`;
}

function formatIstDate(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detailRow(label, value, zebra) {
  const bg = zebra ? 'background:#f8f9fa;' : '';
  return `
    <tr>
      <td style="padding:10px 14px;${bg}color:#6c757d;font-size:13px;font-weight:600;width:38%;border-bottom:1px solid #eef1f4;">${escHtml(label)}</td>
      <td style="padding:10px 14px;${bg}color:#1f2937;font-size:13px;border-bottom:1px solid #eef1f4;">${escHtml(value || 'N/A')}</td>
    </tr>`;
}

function buildStudentDetailsTable(user, extras = {}) {
  const rows = [
    ['Student Name', user.name],
    ['Student ID (Reg No)', user.regNo],
    ['Email Address', user.email],
    ['Phone Number', user.phoneNumber],
    ['Current Batch', user.batch],
    ['Student Status', user.studentStatus],
    ['Subscription', user.subscription],
    ['Level', user.level],
    ['Services Opted', user.servicesOpted],
    ['Teacher In Charge', user.teacherIncharge],
    ['Button Clicked', extras.buttonClicked],
    ['Login Attempt At (IST)', extras.loginAttemptAt],
    ['Modal Response At (IST)', extras.responseAt],
    ['IP Address', extras.ip],
    ['Device / Browser', extras.userAgent],
  ].filter(([, value]) => value !== undefined);

  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e9ecef;border-radius:8px;overflow:hidden;">
      ${rows.map(([label, value], i) => detailRow(label, value, i % 2 === 0)).join('')}
    </table>`;
}

function buildEmailShell({ title, badge, bannerHtml, bodyHtml }) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f2f8;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f8;padding:32px 16px;">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 32px rgba(74,44,143,0.12);">
  <tr>
    <td style="background:linear-gradient(135deg,#3d2578 0%,#7b61ff 55%,#9d8aff 100%);padding:28px 32px;">
      <p style="margin:0 0 6px;color:rgba(255,255,255,0.75);font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Glück Global Portal</p>
      <table width="100%"><tr>
        <td><h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">${escHtml(title)}</h1></td>
        <td align="right" style="vertical-align:top;">
          <span style="display:inline-block;background:rgba(255,255,255,0.2);color:#fff;font-size:11px;font-weight:700;padding:6px 12px;border-radius:20px;">${escHtml(badge)}</span>
        </td>
      </tr></table>
    </td>
  </tr>
  ${bannerHtml}
  <tr><td style="padding:28px 32px 32px;">${bodyHtml}</td></tr>
  <tr>
    <td style="background:#f8f9fb;padding:16px 32px;border-top:1px solid #e9ecef;">
      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Automated alert from Glück Global Student Portal · Do not reply</p>
    </td>
  </tr>
</table>
</td></tr></table>
</body></html>`;
}

async function sendWithdrawalAlert({ subject, html }) {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    const msg = 'Email not configured (EMAIL_HOST, EMAIL_USER, EMAIL_PASS required)';
    console.error(`[withdrawal-alert] ${msg}`);
    return { ok: false, error: msg };
  }

  try {
    const info = await transporter.sendMail({
      from: getFromAddress(),
      to: WITHDRAWAL_ALERT_RECIPIENTS,
      subject,
      html,
    });
    console.log(
      `[withdrawal-alert] Sent to ${WITHDRAWAL_ALERT_RECIPIENTS.join(', ')} | messageId=${info.messageId}`
    );
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[withdrawal-alert] Send failed:', err.message, err.response || '');
    return { ok: false, error: err.message };
  }
}

/** Fired when student passes login but must see the confirmation modal. */
async function sendWithdrawalLoginAttemptEmail(user, meta = {}) {
  const loginAttemptAt = formatIstDate(meta.loginAttemptTime || new Date());
  const banner = `
    <tr>
      <td style="background:#fff8e1;border-left:4px solid #f59e0b;padding:14px 32px;">
        <p style="margin:0;color:#92400e;font-size:14px;line-height:1.5;">
          <strong>Login attempt detected.</strong> Valid credentials were entered. Student has
          <strong>Uncertain / Withdrawn</strong> status and is viewing the confirmation modal
          (no button clicked yet).
        </p>
      </td>
    </tr>`;

  const body = `
    <h2 style="margin:0 0 14px;color:#1f2937;font-size:16px;">Student details at login</h2>
    ${buildStudentDetailsTable(user, {
      loginAttemptAt,
      responseAt: 'Pending — awaiting YES or NO',
      ip: meta.ip,
      userAgent: meta.userAgent,
    })}
    <p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.5;">
      A follow-up email will be sent when the student clicks <strong>YES</strong> or <strong>NO</strong>.
    </p>`;

  const html = buildEmailShell({
    title: 'Uncertain / Withdrawn — Login Attempt',
    badge: (user.batch || 'ALERT').toUpperCase(),
    bannerHtml: banner,
    bodyHtml: body,
  });

  return sendWithdrawalAlert({
    subject: `🔔 Login Attempt: ${user.name} (${user.regNo}) — ${user.batch || 'Uncertain/Withdrawn'}`,
    html,
  });
}

/** Fired when student clicks YES or NO on the confirmation modal. */
async function sendWithdrawalDecisionEmail(user, meta = {}) {
  const decision = meta.decision === 'YES' ? 'YES' : 'NO';
  const isYes = decision === 'YES';
  const decisionLabel = isYes
    ? '✅ YES — Wants to remain active and continue application/program'
    : '❌ NO — Confirmed withdrawal, no longer wishes to be part of Gluck Global';

  const banner = `
    <tr>
      <td style="background:${isYes ? '#ecfdf5' : '#fef2f2'};border-left:4px solid ${isYes ? '#10b981' : '#ef4444'};padding:14px 32px;">
        <p style="margin:0;color:${isYes ? '#065f46' : '#991b1b'};font-size:15px;font-weight:700;">${decisionLabel}</p>
      </td>
    </tr>`;

  const body = `
    <h2 style="margin:0 0 14px;color:#1f2937;font-size:16px;">Full student record &amp; response</h2>
    ${buildStudentDetailsTable(user, {
      buttonClicked: decision,
      loginAttemptAt: formatIstDate(meta.loginAttemptTime),
      responseAt: formatIstDate(meta.responseAt || new Date()),
      ip: meta.ip,
      userAgent: meta.userAgent,
    })}
    <div style="margin-top:20px;background:#e8f4fd;border-left:4px solid #3b82f6;border-radius:0 8px 8px 0;padding:14px 18px;">
      <p style="margin:0 0 6px;color:#1e40af;font-size:13px;font-weight:700;">Recommended action</p>
      <p style="margin:0;color:#1e3a8a;font-size:13px;line-height:1.5;">
        ${
          isYes
            ? 'Student wants to continue. Re-activate their batch and follow up in CRM.'
            : 'Student confirmed withdrawal. Update CRM and close pending tasks.'
        }
      </p>
    </div>`;

  const html = buildEmailShell({
    title: `Student Clicked ${decision}`,
    badge: decision,
    bannerHtml: banner,
    bodyHtml: body,
  });

  return sendWithdrawalAlert({
    subject: `${isYes ? '✅' : '❌'} Portal Response: ${user.name} (${user.regNo}) clicked ${decision}`,
    html,
  });
}

module.exports = {
  WITHDRAWAL_ALERT_RECIPIENTS,
  sendWithdrawalLoginAttemptEmail,
  sendWithdrawalDecisionEmail,
};
