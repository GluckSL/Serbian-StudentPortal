// config/documentEmailConfig.js — SMTP for Document Management "Send Email" only
const nodemailer = require('nodemailer');

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
  return !!(process.env.DOCS_EMAIL_USER && process.env.DOCS_EMAIL_PASS);
}

let documentTransporter = null;

function getDocumentTransporter() {
  if (!isDocumentEmailConfigured()) {
    return null;
  }
  if (!documentTransporter) {
    documentTransporter = nodemailer.createTransport({
      host: process.env.DOCS_EMAIL_HOST || process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: Number(process.env.DOCS_EMAIL_PORT || process.env.EMAIL_PORT) || 587,
      secure: process.env.DOCS_EMAIL_SECURE === 'true',
      auth: {
        user: process.env.DOCS_EMAIL_USER,
        pass: process.env.DOCS_EMAIL_PASS,
      },
    });
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

module.exports = {
  getDocumentTransporter,
  getDocumentFromAddress,
  getDocumentCc,
  isDocumentEmailConfigured,
  sendDocumentReuploadEmail,
  sendDocumentApprovedEmail,
};
