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

module.exports = {
  getDocumentTransporter,
  getDocumentFromAddress,
  getDocumentCc,
  isDocumentEmailConfigured,
};
