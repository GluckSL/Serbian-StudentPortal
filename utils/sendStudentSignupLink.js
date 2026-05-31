'use strict';

const transporter = require('../config/emailConfig');
const StudentSignupApplication = require('../models/StudentSignupApplication');
const { buildSignupLinkEmail } = require('./emailTemplates');

const RESUMABLE_STATUSES = ['draft', 'email_verified', 'documents_done', 'payment_pending'];

/**
 * Find or create a signup application for an existing portal student (CRM / Monday sync).
 */
async function ensureSignupApplicationForUser(user, profile = {}) {
  const email = String(user.email || '').trim().toLowerCase();
  if (!email || email.endsWith('@sync.gluckportal.local')) {
    return null;
  }

  let app = await StudentSignupApplication.findOne({
    userId: user._id,
    status: { $in: RESUMABLE_STATUSES },
  }).sort({ updatedAt: -1 });

  if (!app) {
    app = await StudentSignupApplication.findOne({
      email,
      status: { $in: RESUMABLE_STATUSES },
    }).sort({ updatedAt: -1 });
  }

  if (!app) {
    app = await StudentSignupApplication.create({
      name: user.name || profile.name || '',
      email,
      phoneNumber: user.phoneNumber || profile.phoneNumber || '',
      whatsappNumber: user.whatsappNumber || profile.whatsappNumber || '',
      address: user.address || profile.address || '',
      level: user.level || profile.level || null,
      subscription: user.subscription || profile.subscription || null,
      languageLevelOpted: user.languageLevelOpted || profile.languageLevelOpted || '',
      status: 'payment_pending',
      userId: user._id,
    });
  } else {
    if (!app.userId) {
      app.userId = user._id;
    }
    if (!app.name && user.name) app.name = user.name;
    if (!app.level && user.level) app.level = user.level;
    if (!app.subscription && user.subscription) app.subscription = user.subscription;
    if (app.status === 'draft') app.status = 'payment_pending';
    await app.save();
  }

  return app;
}

/**
 * Email the public signup wizard link so the student completes registration themselves.
 * @returns {Promise<{ ok: boolean, reason?: string, signupUrl?: string, applicationToken?: string }>}
 */
async function sendStudentSignupLinkEmail(user, profile = {}) {
  if (!transporter) return { ok: false, reason: 'no_transporter' };
  if (!user?.email || String(user.email).endsWith('@sync.gluckportal.local')) {
    return { ok: false, reason: 'no_real_email' };
  }

  const app = await ensureSignupApplicationForUser(user, profile);
  if (!app) return { ok: false, reason: 'no_application' };

  const frontendUrl = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');
  const signupUrl = `${frontendUrl}/signup/apply?token=${app.applicationToken}`;
  const linkMail = buildSignupLinkEmail({ name: user.name || profile.name || 'there', signupUrl });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: linkMail.subject,
    html: linkMail.html,
  });

  return { ok: true, signupUrl, applicationToken: app.applicationToken };
}

module.exports = {
  ensureSignupApplicationForUser,
  sendStudentSignupLinkEmail,
};
