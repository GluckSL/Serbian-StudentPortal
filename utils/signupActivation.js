/**
 * utils/signupActivation.js
 *
 * Public signup: portal User is created only when payment is verified
 * (Razorpay success or admin approval of bank-transfer proof).
 * Welcome email with Web App ID / password is sent at activation.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const SignupApplication = require('../models/StudentSignupApplication');
const transporter = require('../config/emailConfig');
const { generateRegNo } = require('./userRegistration');
const { decryptPassword } = require('./passwordRecoverable');
const { setUserPassword } = require('./setUserPassword');
const { buildSignupApprovedWelcomeEmail, buildSignupRejectedEmail } = require('./emailTemplates');

function toObjectId(id) {
  if (id == null || id === '') return null;
  try {
    const s = String(id);
    return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
  } catch {
    return null;
  }
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findUserByEmailInsensitive(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  let user = await User.findOne({ email: normalized });
  if (!user) {
    user = await User.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') },
    });
  }
  return user;
}

async function findSignupApplicationForUser(userId, paymentRequestId) {
  const uid = toObjectId(userId);
  const prId = toObjectId(paymentRequestId);

  if (prId) {
    let byPr = await SignupApplication.findOne({ paymentRequestId: prId })
      .select('+passwordRecoverable +passwordHash')
      .lean();
    if (!byPr && paymentRequestId) {
      byPr = await SignupApplication.findOne({ paymentRequestId: String(paymentRequestId) })
        .select('+passwordRecoverable +passwordHash')
        .lean();
    }
    if (byPr) return byPr;
  }

  if (!uid) return null;

  const byUser = await SignupApplication.findOne({
    userId: uid,
    status: { $in: ['payment_pending', 'proof_submitted', 'documents_done', 'email_verified', 'draft', 'approved'] },
  })
    .sort({ updatedAt: -1 })
    .select('+passwordRecoverable +passwordHash')
    .lean();
  if (byUser) return byUser;

  return SignupApplication.findOne({ userId: uid })
    .sort({ updatedAt: -1 })
    .select('+passwordRecoverable +passwordHash')
    .lean();
}

async function findSignupApplicationByToken(applicationToken) {
  if (!applicationToken) return null;
  return SignupApplication.findOne({ applicationToken })
    .select('+passwordRecoverable +passwordHash')
    .lean();
}

/**
 * Create or reuse portal User from a signup application (after payment verified).
 * @param {import('mongoose').Document|object} appDoc
 * @param {{ isActive?: boolean, batch?: string }} [opts]
 */
async function provisionPublicSignupUser(appDoc, opts = {}) {
  const app =
    appDoc?.toObject && typeof appDoc.toObject === 'function'
      ? appDoc.toObject({ getters: false, virtuals: false })
      : { ...appDoc };

  if (!app.email || !app.passwordHash) {
    throw new Error('Signup application is missing email or password.');
  }

  const isActive = opts.isActive !== false;

  if (app.userId) {
    const linked = await User.findById(app.userId).select('+passwordRecoverable');
    if (linked) {
      if (linked.isActive && !isActive) {
        throw new Error('Linked student account is already active.');
      }
      linked.isActive = isActive;
      linked.studentStatus = 'ONGOING';
      if (!linked.passwordRecoverable && app.passwordRecoverable) {
        linked.passwordRecoverable = app.passwordRecoverable;
      }
      await linked.save();
      return linked;
    }
  }

  const existing = await findUserByEmailInsensitive(app.email);
  if (existing) {
    if (existing.role !== 'STUDENT') {
      throw new Error('This email is registered with a non-student account.');
    }
    if (existing.isActive && !isActive) {
      throw new Error('An active student account with this email already exists.');
    }
    existing.isActive = isActive;
    existing.studentStatus = 'ONGOING';
    if (app.passwordHash) {
      existing.password = app.passwordHash;
      existing.passwordChangedAt = existing.passwordChangedAt || new Date();
    }
    if (app.passwordRecoverable) existing.passwordRecoverable = app.passwordRecoverable;
    existing.mustChangePassword = false;
    existing.signupSource = existing.signupSource || 'public_signup';
    await existing.save();
    await SignupApplication.updateOne({ _id: app._id }, { userId: existing._id }).catch(() => {});
    return existing;
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const regNo = await generateRegNo('STUDENT');
    const user = new User({
      name: app.name,
      email: String(app.email).trim().toLowerCase(),
      regNo,
      role: 'STUDENT',
      studentStatus: 'ONGOING',
      subscription: app.subscription,
      level: app.level,
      batch: opts.batch || process.env.SIGNUP_DEFAULT_BATCH || 'Unassigned',
      medium: app.medium?.length ? app.medium : ['English'],
      phoneNumber: app.phoneNumber || '',
      whatsappNumber: app.whatsappNumber || '',
      address: app.address || '',
      age: app.age ?? null,
      nationality: app.nationality || '',
      otherLanguageKnown: app.otherLanguageKnown || '',
      languageLevelOpted: app.languageLevelOpted || app.level || '',
      qualifications: app.qualifications || '',
      leadSource: app.leadSource || '',
      signupSource: 'public_signup',
      isActive,
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      password: app.passwordHash,
      passwordRecoverable: app.passwordRecoverable || undefined,
    });

    try {
      await user.save();
      await SignupApplication.updateOne({ _id: app._id }, { userId: user._id }).catch(() => {});
      return user;
    } catch (err) {
      if (err.code === 11000 && (err.keyPattern || {}).regNo) continue;
      throw err;
    }
  }

  throw new Error('Could not allocate a unique registration number.');
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

async function resolvePasswordForWelcomeEmail(user, signupApp) {
  const plain = await resolveSignupPlainPassword(user, signupApp);
  if (plain) return { plain, generated: false };

  const hasStored = !!(user?.passwordRecoverable || signupApp?.passwordRecoverable);
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

async function sendPublicSignupWelcomeEmail(user, signupApp) {
  const { plain: plainPassword } = await resolvePasswordForWelcomeEmail(user, signupApp);
  const loginUrl = `${process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://portal.gluckglobal.rs'}/login`;
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
}

/**
 * Approve a signup application (bank transfer proof path): create account + welcome email.
 * @param {string} applicationToken
 * @param {{ batch?: string, skipEmail?: boolean }} [opts]
 */
async function approvePublicSignupApplication(applicationToken, opts = {}) {
  const app = await SignupApplication.findOne({ applicationToken })
    .select('+passwordHash +passwordRecoverable');
  if (!app) {
    return { ok: false, reason: 'application_not_found' };
  }
  if (app.status === 'approved') {
    const existing = app.userId ? await User.findById(app.userId) : null;
    if (existing?.isActive) {
      return { ok: true, alreadyApproved: true, userId: existing._id, regNo: existing.regNo };
    }
  }
  if (app.status !== 'proof_submitted') {
    return { ok: false, reason: 'invalid_status', status: app.status };
  }

  const user = await provisionPublicSignupUser(app, { isActive: true, batch: opts.batch });
  user.isActive = true;
  user.studentStatus = 'ONGOING';
  await user.save();

  app.status = 'approved';
  app.userId = user._id;
  await app.save();

  if (!opts.skipEmail) {
    await sendPublicSignupWelcomeEmail(user, app.toObject());
  }

  return {
    ok: true,
    userId: user._id,
    regNo: user.regNo,
    emailSent: !opts.skipEmail,
  };
}

async function sendPublicSignupRejectionEmail(app, rejectionReason) {
  const frontendUrl = process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://portal.gluckglobal.rs';
  const signupUrl = `${frontendUrl}/signup/apply?token=${app.applicationToken}`;
  const mail = buildSignupRejectedEmail({
    name: app.name,
    email: app.email,
    amount: app.proofPaidAmount ?? app.amount,
    currency: app.currency || 'INR',
    rejectionReason,
    signupUrl,
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: app.email,
    subject: mail.subject,
    html: mail.html,
  });
}

/**
 * Reject a signup application (bank transfer proof path): notify student by email.
 * @param {string} applicationToken
 * @param {{ rejectionReason?: string, adminId?: import('mongoose').Types.ObjectId }} [opts]
 */
async function rejectPublicSignupApplication(applicationToken, opts = {}) {
  const app = await SignupApplication.findOne({ applicationToken });
  if (!app) {
    return { ok: false, reason: 'application_not_found' };
  }
  if (app.status === 'approved') {
    return { ok: false, reason: 'already_approved', status: app.status };
  }
  if (app.status !== 'proof_submitted') {
    return { ok: false, reason: 'invalid_status', status: app.status };
  }

  const rejectionReason = String(opts.rejectionReason || '').trim();
  app.status = 'rejected';
  app.rejectionReason = rejectionReason;
  app.rejectedAt = new Date();
  app.rejectedBy = opts.adminId || null;
  await app.save();

  await sendPublicSignupRejectionEmail(app.toObject(), rejectionReason);

  return {
    ok: true,
    emailSent: true,
    rejectionReason: rejectionReason || undefined,
  };
}

/**
 * Activate student (if needed) and send welcome email with regNo + password.
 * Used after Razorpay verify or Payment Hub approval (legacy rows with userId).
 */
async function activatePublicSignupStudent(studentId, opts = {}) {
  let user = await User.findById(studentId).select(
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

  await sendPublicSignupWelcomeEmail(user, signupApp);

  if (signupApp?._id) {
    await SignupApplication.updateOne({ _id: signupApp._id }, { status: 'approved', userId: user._id }).catch(() => {});
  } else {
    await SignupApplication.updateMany(
      { userId: user._id, status: { $ne: 'approved' } },
      { status: 'approved' }
    ).catch(() => {});
  }

  return {
    ok: true,
    emailSent: true,
  };
}

/**
 * Razorpay instant payment: create active account and send welcome email.
 */
async function activatePublicSignupAfterRazorpay(applicationToken) {
  const app = await SignupApplication.findOne({ applicationToken })
    .select('+passwordHash +passwordRecoverable');
  if (!app) {
    return { ok: false, reason: 'application_not_found' };
  }

  const user = await provisionPublicSignupUser(app, { isActive: true });
  await sendPublicSignupWelcomeEmail(user, app.toObject());

  app.status = 'approved';
  app.userId = user._id;
  app.paymentMethod = 'razorpay';
  await app.save();

  return { ok: true, userId: user._id, regNo: user.regNo, emailSent: true };
}

module.exports = {
  approvePublicSignupApplication,
  rejectPublicSignupApplication,
  activatePublicSignupAfterRazorpay,
  activatePublicSignupStudent,
  provisionPublicSignupUser,
  findSignupApplicationForUser,
  findSignupApplicationByToken,
  resolveSignupPlainPassword,
  resolvePasswordForWelcomeEmail,
  sendPublicSignupWelcomeEmail,
  sendPublicSignupRejectionEmail,
};
