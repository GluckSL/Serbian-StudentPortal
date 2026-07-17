// config/documentEmailConfig.js — SMTP for Document Management "Send Email" only
const nodemailer = require('nodemailer');
const { emailsEnabled, wrapTransporter } = require('./emailKillSwitch');

const DOCS_FROM_NAME = process.env.DOCS_EMAIL_FROM_NAME || 'Glück Global';
const DOCS_FROM_ADDRESS =
  process.env.DOCS_EMAIL_FROM || process.env.DOCS_EMAIL_USER || 'info@gluckglobal.com';

function getDocumentFromAddress() {
  return `"${DOCS_FROM_NAME}" <${DOCS_FROM_ADDRESS}>`;
}

/** CC on every document-management email (comma-separated in DOCS_EMAIL_CC). */
function getDocumentCc() {
  const raw =
    process.env.DOCS_EMAIL_CC || 'yogendra@gluckglobal.com';
  return raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
}

function isDocumentEmailConfigured() {
  return emailsEnabled() && !!(process.env.DOCS_EMAIL_USER && process.env.DOCS_EMAIL_PASS);
}

let documentTransporter = null;

function getDocumentTransporter() {
  if (!isDocumentEmailConfigured()) {
    return null;
  }
  if (!documentTransporter) {
    documentTransporter = wrapTransporter(
      nodemailer.createTransport({
        host: process.env.DOCS_EMAIL_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: Number(process.env.DOCS_EMAIL_PORT || process.env.EMAIL_PORT) || 587,
        secure: process.env.DOCS_EMAIL_SECURE === 'true',
        auth: {
          user: process.env.DOCS_EMAIL_USER,
          pass: process.env.DOCS_EMAIL_PASS,
        },
      })
    );
  }
  return documentTransporter;
}

/**
 * Email student when admin rejects a document and requests re-upload.
 */
async function sendDocumentReuploadEmail({ studentName, studentEmail, documentName, reason, isAgreement = false }) {
  if (!isDocumentEmailConfigured() || !studentEmail) return false;

  const portalUrl = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');
  const docsUrl = `${portalUrl}/student-documents`;
  const safeReason = String(reason || 'Please upload a clearer or complete document.').trim();
  const safeName = String(studentName || 'Student').trim();
  const safeDoc = String(documentName || 'document').trim();

  const transporter = getDocumentTransporter();
  await transporter.sendMail({
    from: getDocumentFromAddress(),
    to: studentEmail,
    cc: getDocumentCc(),
    subject: `Action required: re-upload ${isAgreement ? 'agreement' : 'document'} — Glück Global`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #b91c1c; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 18px;">Document update required</h2>
        </div>
        <div style="padding: 24px; background: #fff;">
          <p>Dear <strong>${safeName}</strong>,</p>
          <p>Your submission <strong>${safeDoc}</strong> was reviewed and needs to be uploaded again.</p>
          <p style="background: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 14px; color: #7f1d1d;">
            <strong>Reason from admin:</strong><br>${safeReason.replace(/\n/g, '<br>')}
          </p>
          <p>Please sign in to the student portal, open <strong>My Documents</strong>, and upload the corrected file.</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${docsUrl}" style="background: #1a237e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
              Open My Documents
            </a>
          </div>
          <p style="font-size: 13px; color: #666;">If you have questions, reply to this email or contact your advisor.</p>
          <p>Regards,<br><strong>Glück Global Team</strong></p>
        </div>
      </div>
    `
  });
  return true;
}

/**
 * Email student when admin approves a document or signed agreement.
 */
async function sendDocumentApprovedEmail({ studentName, studentEmail, documentName, isAgreement = false }) {
  if (!isDocumentEmailConfigured() || !studentEmail) return false;

  const portalUrl = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');
  const docsUrl = `${portalUrl}/student-documents`;
  const safeName = String(studentName || 'Student').trim();
  const safeDoc = String(documentName || 'document').trim();
  const itemLabel = isAgreement ? 'agreement' : 'document';
  const headline = isAgreement ? 'Your agreement has been approved' : 'Your document has been verified';

  const transporter = getDocumentTransporter();
  await transporter.sendMail({
    from: getDocumentFromAddress(),
    to: studentEmail,
    cc: getDocumentCc(),
    subject: `${headline} — Glück Global`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #15803d; color: white; padding: 20px; text-align: center;">
          <h2 style="margin: 0; font-size: 18px;">${headline}</h2>
        </div>
        <div style="padding: 24px; background: #fff;">
          <p>Dear <strong>${safeName}</strong>,</p>
          <p>Good news — your ${itemLabel} <strong>${safeDoc}</strong> has been reviewed and <strong>approved</strong> by our team.</p>
          <p>You can sign in to the student portal to view your updated status and any other required documents.</p>
          <div style="text-align: center; margin: 24px 0;">
            <a href="${docsUrl}" style="background: #1a237e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
              Open Student Portal — My Documents
            </a>
          </div>
          <p style="font-size: 13px; color: #666;">Portal link: <a href="${docsUrl}">${docsUrl}</a></p>
          <p>If you have questions, reply to this email or contact your advisor.</p>
          <p>Regards,<br><strong>Glück Global Team</strong></p>
        </div>
      </div>
    `
  });
  return true;
}

/**
 * Email student when admin uploads a document on their behalf.
 */
async function sendDocumentAddedByAdminEmail({ studentName, studentEmail, documentName }) {
  if (!isDocumentEmailConfigured() || !studentEmail) return false;

  const portalUrl = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');
  const docsUrl = `${portalUrl}/student-documents`;
  const safeName = String(studentName || 'Student').trim();
  const safeDoc = String(documentName || 'document').trim();

  const transporter = getDocumentTransporter();
  await transporter.sendMail({
    from: getDocumentFromAddress(),
    to: studentEmail,
    cc: getDocumentCc(),
    subject: `New document added to your portal — ${safeDoc}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden;">
        <div style="background: linear-gradient(135deg, #1a237e 0%, #3949ab 100%); color: white; padding: 22px; text-align: center;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 600;">Glück Global</h2>
          <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">Student Document Portal</p>
        </div>
        <div style="padding: 28px 24px; background: #ffffff;">
          <p style="margin: 0 0 12px; font-size: 15px; color: #334155;">Dear <strong>${safeName}</strong>,</p>
          <p style="margin: 0 0 16px; font-size: 15px; color: #475569; line-height: 1.5;">
            A new document has been added to your account by our admin team.
          </p>
          <div style="background: #f0f4ff; border-left: 4px solid #3949ab; padding: 14px 16px; border-radius: 0 8px 8px 0; margin: 0 0 20px;">
            <p style="margin: 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">Document</p>
            <p style="margin: 6px 0 0; font-size: 17px; font-weight: 600; color: #1a237e;">${safeDoc}</p>
          </div>
          <p style="margin: 0 0 20px; font-size: 14px; color: #475569;">
            Sign in to review the file, download it if needed, and complete any remaining uploads from your checklist.
          </p>
          <div style="text-align: center; margin: 28px 0 8px;">
            <a href="${docsUrl}" style="display: inline-block; background: #1565c0; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
              Check it out
            </a>
          </div>
          <p style="margin: 20px 0 0; font-size: 12px; color: #94a3b8; text-align: center;">
            Or open: <a href="${docsUrl}" style="color: #3949ab;">${docsUrl}</a>
          </p>
        </div>
        <div style="background: #f8fafc; padding: 14px 24px; text-align: center; font-size: 12px; color: #94a3b8;">
          Glück Global &bull; This is an automated message. Please do not reply unless you need assistance.
        </div>
      </div>
    `
  });
  return true;
}

module.exports = {
  getDocumentTransporter,
  getDocumentFromAddress,
  getDocumentCc,
  isDocumentEmailConfigured,
  sendDocumentReuploadEmail,
  sendDocumentApprovedEmail,
  sendDocumentAddedByAdminEmail,
};
