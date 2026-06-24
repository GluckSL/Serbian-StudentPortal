const User = require('../models/User');
const transporter = require('../config/emailConfig');
const sanitizeHtml = require('sanitize-html');
const {
  normalizeBatchKey,
  isGoStudentsTarget,
  isGoStudentRecord,
  normalizeBatchList,
  findTeachersForTargetBatches
} = require('./announcementRecipients');

const ANNOUNCEMENT_HTML_SANITIZE_OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'mark',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'a',
    'span'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['style']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  allowedStyles: {
    span: {
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/, /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\)$/],
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/, /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\)$/]
    }
  },
  transformTags: {
    a: (tagName, attribs) => {
      const href = String(attribs.href || '').trim();
      return {
        tagName,
        attribs: {
          href,
          target: '_blank',
          rel: 'noreferrer noopener'
        }
      };
    }
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(value) {
  return escapeHtml(String(value ?? '')).replace(/\r?\n/g, '<br/>');
}

function sanitizeAnnouncementHtml(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const normalized = /[<>]/.test(value) ? value : textToHtml(value);
  return sanitizeHtml(normalized, ANNOUNCEMENT_HTML_SANITIZE_OPTIONS);
}

async function sendAnnouncementEmails({ recipients, subject, body, title }) {
  if (!recipients.length) return { sent: 0, failed: 0 };

  const escapedTitle = escapeHtml(title);
  const bodyHtml = sanitizeAnnouncementHtml(body);

  const results = await Promise.allSettled(
    recipients.map(({ email, recipientName, studentName }) => {
      const safeRecipientName = escapeHtml(recipientName || studentName || 'there');

      const html = `
        <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;">
          <p style="margin:0 0 12px 0; font-weight:700;">Announcement</p>

          <p style="margin:0 0 12px 0;">
            Hi <strong>${safeRecipientName}</strong>,
          </p>

          <p style="margin:0 0 16px 0;">
            <strong>${escapedTitle}</strong>
          </p>

          <div style="margin:0 0 16px 0;">${bodyHtml}</div>

          <p style="margin:0;">
            Thanks,<br/>
            <span style="font-weight:700;">Gluck Global Pvt Ltd</span>
          </p>
        </div>
      `;

      return transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html
      });
    })
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  return { sent, failed };
}

/**
 * Sends website+email announcement to students in target batches.
 * @returns {{ totalRecipients: number, sentCount: number, failedCount: number, sentAt: Date }}
 */
async function dispatchWebsiteEmailAnnouncement({
  targetBatches,
  title,
  body,
  emailSubject,
  emailBody
}) {
  const targetKeys = normalizeBatchList(targetBatches);
  const students = await User.find({
    role: 'STUDENT',
    email: { $nin: [null, ''] }
  })
    .select('name email batch goStatus')
    .lean();

  const includeGoStudents = (targetBatches || []).some((target) => isGoStudentsTarget(target));
  const studentRecipients = students
    .filter((s) => {
      if (includeGoStudents && isGoStudentRecord(s)) return true;
      return targetKeys.includes(normalizeBatchKey(s.batch));
    })
    .map((s) => ({
      email: String(s.email || '').trim().toLowerCase(),
      recipientName: String(s.name || '').trim()
    }))
    .filter((r) => r.email);

  const teacherRecipients = (await findTeachersForTargetBatches(targetBatches, targetKeys)).map((t) => ({
    email: t.email,
    recipientName: t.name
  }));

  const recipientsByEmail = new Map();
  for (const recipient of [...studentRecipients, ...teacherRecipients]) {
    if (!recipientsByEmail.has(recipient.email)) recipientsByEmail.set(recipient.email, recipient);
  }

  const cleanedRecipients = Array.from(recipientsByEmail.values());

  const { sent, failed } = await sendAnnouncementEmails({
    recipients: cleanedRecipients,
    subject: emailSubject,
    body: emailBody,
    title
  });

  return {
    totalRecipients: cleanedRecipients.length,
    sentCount: sent,
    failedCount: failed,
    sentAt: new Date()
  };
}

module.exports = {
  dispatchWebsiteEmailAnnouncement,
  sendAnnouncementEmails
};
