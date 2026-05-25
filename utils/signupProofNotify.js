'use strict';

const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Build nodemailer attachment(s) for a signup payment proof upload.
 */
async function buildSignupProofAttachments(file, screenshotKey) {
  const attachments = [];

  if (file?.buffer) {
    attachments.push({
      filename: file.originalname || 'payment-proof',
      content: file.buffer,
      contentType: file.mimetype || undefined,
    });
    return attachments;
  }

  if (!screenshotKey) return attachments;

  const key = String(screenshotKey);
  if (key.startsWith('http://') || key.startsWith('https://')) {
    try {
      const res = await axios.get(key, { responseType: 'arraybuffer', timeout: 30000 });
      const urlPath = new URL(key).pathname;
      const baseName = path.basename(urlPath) || 'payment-proof.jpg';
      attachments.push({
        filename: baseName,
        content: Buffer.from(res.data),
        contentType: res.headers['content-type'] || undefined,
      });
    } catch (err) {
      console.warn('[signupProofNotify] could not fetch proof URL:', err.message);
    }
    return attachments;
  }

  const localPath = path.isAbsolute(key)
    ? key
    : path.join(__dirname, '..', 'uploads', key.replace(/^signup-proofs[/\\]/, 'signup-proofs/'));

  if (fs.existsSync(localPath)) {
    attachments.push({
      filename: path.basename(localPath),
      path: localPath,
    });
  }

  return attachments;
}

function parseAdminNotifyEmails() {
  const raw = process.env.SIGNUP_ADMIN_NOTIFY_EMAILS || 'finance@gluckglobal.com';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

module.exports = {
  buildSignupProofAttachments,
  parseAdminNotifyEmails,
};
