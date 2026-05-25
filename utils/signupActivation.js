/**
 * utils/signupActivation.js
 *
 * Activate public-signup students after payment approval and send welcome email
 * with Web App ID, email, and password chosen during signup.
 */

const User = require('../models/User');
const SignupApplication = require('../models/StudentSignupApplication');
const transporter = require('../config/emailConfig');
const { decryptPassword } = require('./passwordRecoverable');
const { buildSignupApprovedWelcomeEmail } = require('./emailTemplates');

async function findSignupApplicationForUser(userId, paymentRequestId) {
  if (paymentRequestId) {
    const byPr = await SignupApplication.findOne({ paymentRequestId })
      .select('+passwordRecoverable')
      .lean();
    if (byPr) return byPr;
  }
  return SignupApplication.findOne({
    userId,
    status: { $in: ['payment_pending', 'documents_done', 'email_verified', 'draft'] },
  })
    .sort({ updatedAt: -1 })
    .select('+passwordRecoverable')
    .lean();
}

async function resolveSignupPlainPassword(user, app) {
  let plain = decryptPassword(user?.passwordRecoverable);
  if (plain) return plain;

  let recoverable = app?.passwordRecoverable;
  if (!recoverable && app?._id) {
    const fresh = await SignupApplication.findById(app._id).select('+passwordRecoverable').lean();
    recoverable = fresh?.passwordRecoverable;
  }
  plain = decryptPassword(recoverable);
  if (plain && user?._id && recoverable && !user.passwordRecoverable) {
    await User.updateOne({ _id: user._id }, { passwordRecoverable: recoverable });
  }
  return plain || null;
}

/**
 * Activate student (if needed) and send welcome email with regNo + password.
 * @param {string|import('mongoose').Types.ObjectId} studentId
 * @param {{ paymentRequestId?: string, forceWelcomeEmail?: boolean }} [opts]
 */
async function activatePublicSignupStudent(studentId, opts = {}) {
  const user = await User.findById(studentId);
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

  const plainPassword = await resolveSignupPlainPassword(user, signupApp);
  const loginUrl = `${process.env.FRONTEND_URL || 'https://gluckstudentsportal.com'}/login`;
  const welcomeMail = buildSignupApprovedWelcomeEmail({
    name: user.name,
    regNo: user.regNo,
    email: user.email,
    password: plainPassword || '(use the password you chose during signup)',
    loginUrl,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: welcomeMail.subject,
    html: welcomeMail.html,
  });

  if (signupApp) {
    await SignupApplication.updateOne(
      { _id: signupApp._id },
      { status: 'approved' }
    ).catch(() => {});
  } else {
    await SignupApplication.updateMany(
      { userId: user._id, status: { $ne: 'approved' } },
      { status: 'approved' }
    ).catch(() => {});
  }

  return { ok: true, emailSent: true, hadPassword: !!plainPassword };
}

module.exports = {
  activatePublicSignupStudent,
  resolveSignupPlainPassword,
  findSignupApplicationForUser,
};
