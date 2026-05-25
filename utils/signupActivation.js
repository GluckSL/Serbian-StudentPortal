/**
 * utils/signupActivation.js
 *
 * Activate public-signup students after payment approval and send welcome email
 * with Web App ID, email, and password chosen during signup.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const SignupApplication = require('../models/StudentSignupApplication');
const transporter = require('../config/emailConfig');
const { decryptPassword } = require('./passwordRecoverable');
const { setUserPassword } = require('./setUserPassword');
const { buildSignupApprovedWelcomeEmail } = require('./emailTemplates');

function toObjectId(id) {
  if (id == null || id === '') return null;
  try {
    const s = String(id);
    return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
  } catch {
    return null;
  }
}

async function findSignupApplicationForUser(userId, paymentRequestId) {
  const uid = toObjectId(userId);
  const prId = toObjectId(paymentRequestId);

  if (prId) {
    let byPr = await SignupApplication.findOne({ paymentRequestId: prId })
      .select('+passwordRecoverable')
      .lean();
    if (!byPr && paymentRequestId) {
      byPr = await SignupApplication.findOne({ paymentRequestId: String(paymentRequestId) })
        .select('+passwordRecoverable')
        .lean();
    }
    if (byPr) return byPr;
  }

  if (!uid) return null;

  const byUser = await SignupApplication.findOne({
    userId: uid,
    status: { $in: ['payment_pending', 'documents_done', 'email_verified', 'draft', 'approved'] },
  })
    .sort({ updatedAt: -1 })
    .select('+passwordRecoverable')
    .lean();
  if (byUser) return byUser;

  return SignupApplication.findOne({ userId: uid })
    .sort({ updatedAt: -1 })
    .select('+passwordRecoverable')
    .lean();
}

async function resolveSignupPlainPassword(user, app) {
  let recoverableOnUser = user?.passwordRecoverable;
  if (!recoverableOnUser && user?._id) {
    const freshUser = await User.findById(user._id).select('passwordRecoverable').lean();
    recoverableOnUser = freshUser?.passwordRecoverable;
  }

  let plain = decryptPassword(recoverableOnUser);
  if (plain) return plain;

  let recoverable = app?.passwordRecoverable;
  if (!recoverable && app?._id) {
    const fresh = await SignupApplication.findById(app._id).select('+passwordRecoverable').lean();
    recoverable = fresh?.passwordRecoverable;
  }
  if (!recoverable && user?._id) {
    const anyApp = await SignupApplication.findOne({ userId: user._id })
      .sort({ updatedAt: -1 })
      .select('+passwordRecoverable')
      .lean();
    recoverable = anyApp?.passwordRecoverable;
  }

  plain = decryptPassword(recoverable);
  if (plain && user?._id && recoverable && !user.passwordRecoverable) {
    await User.updateOne({ _id: user._id }, { passwordRecoverable: recoverable });
  }
  return plain || null;
}

function generateWelcomePassword() {
  const base = crypto.randomBytes(9).toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
  return `${base.slice(0, 10)}9`;
}

/**
 * Resolve signup password for the welcome email; if missing or undecryptable, set a new one.
 * @returns {Promise<{ plain: string, generated: boolean }>}
 */
async function resolvePasswordForWelcomeEmail(user, signupApp) {
  const plain = await resolveSignupPlainPassword(user, signupApp);
  if (plain) return { plain, generated: false };

  const hasStored = !!(
    user?.passwordRecoverable ||
    signupApp?.passwordRecoverable
  );
  if (hasStored) {
    console.error(
      `[signupActivation] passwordRecoverable present but decrypt failed for ${user.regNo} — check PASSWORD_RECOVERABLE_KEY`
    );
  } else {
    console.warn(
      `[signupActivation] No passwordRecoverable for ${user.regNo}; generating password for welcome email`
    );
  }

  const generated = generateWelcomePassword();
  await setUserPassword(user, generated, { save: true });
  return { plain: generated, generated: true };
}

/**
 * Activate student (if needed) and send welcome email with regNo + password.
 * @param {string|import('mongoose').Types.ObjectId} studentId
 * @param {{ paymentRequestId?: string, forceWelcomeEmail?: boolean }} [opts]
 */
async function activatePublicSignupStudent(studentId, opts = {}) {
  const user = await User.findById(studentId).select(
    'name email regNo passwordRecoverable isActive studentStatus signupSource'
  );
  if (!user) {
    console.error('[signupActivation] User not found:', studentId);
    return { ok: false, reason: 'user_not_found' };
  }

  const signupApp = await findSignupApplicationForUser(user._id, opts.paymentRequestId);

  if (user.signupSource !== 'public_signup' && !signupApp && !opts.paymentRequestId) {
    return { ok: false, reason: 'not_public_signup' };
  }

  if (!user.isActive) {
    user.isActive = true;
    user.studentStatus = 'ONGOING';
    await user.save();
  }

  const { plain: plainPassword, generated } = await resolvePasswordForWelcomeEmail(user, signupApp);
  const loginUrl = `${process.env.FRONTEND_URL || 'https://gluckstudentsportal.com'}/login`;
  const welcomeMail = buildSignupApprovedWelcomeEmail({
    name: user.name,
    regNo: user.regNo,
    email: user.email,
    password: plainPassword,
    loginUrl,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: welcomeMail.subject,
    html: welcomeMail.html,
  });

  user.lastCredentialsEmailSent = new Date();
  await user.save().catch(() => {});

  if (signupApp) {
    await SignupApplication.updateOne({ _id: signupApp._id }, { status: 'approved' }).catch(() => {});
  } else {
    await SignupApplication.updateMany(
      { userId: user._id, status: { $ne: 'approved' } },
      { status: 'approved' }
    ).catch(() => {});
  }

  return {
    ok: true,
    emailSent: true,
    hadPassword: !generated,
    passwordGenerated: generated,
  };
}

module.exports = {
  activatePublicSignupStudent,
  resolveSignupPlainPassword,
  resolvePasswordForWelcomeEmail,
  findSignupApplicationForUser,
};
