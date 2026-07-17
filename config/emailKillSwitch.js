/**
 * Global email kill-switch.
 *
 * When EMAILS_ENABLED is not "true" / "1" / "yes", every nodemailer sendMail
 * is blocked (no SMTP). Covers student, admin, teacher, payment, and docs mail.
 *
 * Set EMAILS_ENABLED=true in .env to re-enable outbound email.
 */

const nodemailer = require('nodemailer');

function emailsEnabled() {
  const v = String(process.env.EMAILS_ENABLED ?? '').trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes' || v === 'on';
}

function summarizeRecipients(mailOptions = {}) {
  const parts = [mailOptions.to, mailOptions.cc, mailOptions.bcc]
    .flat()
    .filter(Boolean)
    .map((x) => (typeof x === 'string' ? x : x?.address || String(x)))
    .join(', ');
  return parts || '(no recipients)';
}

function blockedResult() {
  return {
    messageId: 'blocked-emails-disabled',
    accepted: [],
    rejected: [],
    pending: [],
    response: 'EMAILS_ENABLED is off — outbound email blocked',
  };
}

function wrapTransporter(transporter) {
  if (!transporter || transporter.__emailsKillSwitchWrapped) return transporter;

  const originalSendMail = transporter.sendMail.bind(transporter);
  transporter.sendMail = function sendMailGuarded(mailOptions, callback) {
    if (emailsEnabled()) {
      return originalSendMail(mailOptions, callback);
    }

    const to = summarizeRecipients(mailOptions);
    const subject = mailOptions?.subject || '(no subject)';
    console.warn(`[Email] BLOCKED (EMAILS_ENABLED off) → ${to} | ${subject}`);

    const result = blockedResult();
    if (typeof callback === 'function') {
      callback(null, result);
      return result;
    }
    return Promise.resolve(result);
  };

  transporter.__emailsKillSwitchWrapped = true;
  return transporter;
}

/** Patch nodemailer.createTransport so every new transporter is guarded. */
function installEmailKillSwitch() {
  if (nodemailer.__emailsKillSwitchInstalled) return;
  const originalCreateTransport = nodemailer.createTransport.bind(nodemailer);
  nodemailer.createTransport = function createTransportGuarded(...args) {
    return wrapTransporter(originalCreateTransport(...args));
  };
  nodemailer.__emailsKillSwitchInstalled = true;

  if (emailsEnabled()) {
    console.log('[Email] Outbound email ENABLED (EMAILS_ENABLED=true)');
  } else {
    console.warn('[Email] Outbound email DISABLED — nothing will be sent (set EMAILS_ENABLED=true to re-enable)');
  }
}

module.exports = {
  emailsEnabled,
  wrapTransporter,
  installEmailKillSwitch,
};
