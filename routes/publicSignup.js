/**
 * routes/publicSignup.js
 *
 * Public student self-signup wizard — no JWT required.
 * Mounted at /api/public-signup in app.js.
 *
 * Step 1: POST /start          – create application + send OTP
 *         POST /verify-email   – verify OTP, save password hash
 * Step 2: POST /documents      – optional file uploads
 *         GET  /catalog        – CEFR + plan pricing
 * Step 3: POST /finalize       – save level/plan/currency, provision pending user
 *         POST /razorpay/create-order
 *         POST /razorpay/verify
 *         POST /payment-proof  – screenshot → Req Payment queue
 * Utils:  GET  /:token         – resume state
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Razorpay = require('razorpay');
const multer = require('multer');
const rateLimit = require('express-rate-limit');

const SignupApplication = require('../models/StudentSignupApplication');
const SignupEmailOtp = require('../models/SignupEmailOtp');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const { generateRegNo } = require('../utils/userRegistration');
const { setUserPassword } = require('../utils/setUserPassword');
const {
  buildSignupEmailOtpEmail,
  buildSignupProofReceivedAdminEmail,
} = require('../utils/emailTemplates');
const {
  buildSignupProofAttachments,
  parseAdminNotifyEmails,
} = require('../utils/signupProofNotify');
const { storeRecoverablePassword } = require('../utils/passwordRecoverable');
const { activatePublicSignupStudent } = require('../utils/signupActivation');
const {
  isAllowedStudentPlan,
  isServicePlan,
  getServicePlanAmount,
} = require('../utils/studentSubscriptionPlans');
const {
  paymentProofFileFilter,
  PROOF_FILTER_ERROR,
  PROOF_MAX_BYTES,
} = require('../utils/paymentProofFileFilter');

// Payment v2 services (require lazily to avoid circular init issues)
const getPaymentService = () => require('../modules/payments-v2/backend/services/paymentService');
const proofR2 = require('../modules/payments-v2/backend/services/paymentProofR2Service');
const PaymentHubCatalog = require('../modules/payments-v2/backend/models/PaymentHubCatalog');
const PaymentRequest = require('../modules/payments-v2/backend/models/PaymentRequest');

// ─── Razorpay ────────────────────────────────────────────────────────────────
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || '',
  key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

// ─── Rate limiters ───────────────────────────────────────────────────────────

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.ip || 'unknown';
}

const sharedRateOpts = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  keyGenerator: (req) => clientIp(req),
};

const startLimiter = rateLimit({ ...sharedRateOpts, windowMs: 15 * 60 * 1000, max: 10, message: { msg: 'Too many requests. Try again in 15 minutes.' } });
const otpVerifyLimiter = rateLimit({ ...sharedRateOpts, windowMs: 15 * 60 * 1000, max: 15, message: { msg: 'Too many verification attempts.' } });
const finalizeLimiter = rateLimit({ ...sharedRateOpts, windowMs: 15 * 60 * 1000, max: 10, message: { msg: 'Too many attempts.' } });
const rzpLimiter = rateLimit({ ...sharedRateOpts, windowMs: 15 * 60 * 1000, max: 10, message: { msg: 'Too many payment attempts.' } });

// ─── File upload for signup documents (step 2) ───────────────────────────────

const docsDir = path.join(__dirname, '../uploads/signup-docs');
fs.mkdirSync(docsDir, { recursive: true });

const docStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, docsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10) || '.pdf';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});
const docsUpload = multer({
  storage: docsDir && proofR2.isPaymentR2Configured() ? multer.memoryStorage() : docStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(jpe?g|png|gif|webp|pdf|doc|docx)$/i.test(file.originalname || '');
    cb(null, ok || true); // accept everything; extra validation below if needed
  },
}).array('documents', 6);

// Payment proof upload for step 3 proof path
const proofUploadDir = path.join(__dirname, '../uploads/signup-proofs');
fs.mkdirSync(proofUploadDir, { recursive: true });

const proofStorage = proofR2.isPaymentR2Configured()
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, proofUploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').slice(0, 10) || '.jpg';
        cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
      },
    });

const proofUpload = multer({
  storage: proofStorage,
  limits: { fileSize: PROOF_MAX_BYTES },
  fileFilter: paymentProofFileFilter,
}).single('screenshot');

function handleProofUpload(req, res, next) {
  proofUpload(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ msg: 'File is too large. Maximum size is 15 MB.' });
    }
    return res.status(400).json({ msg: err.message || PROOF_FILTER_ERROR });
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive email lookup (legacy rows may not be lowercased). */
async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  let user = await User.findOne({ email: normalized }).lean();
  if (!user) {
    user = await User.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(normalized)}$`, 'i') },
    }).lean();
  }
  return user;
}

/** Only block signup when the account can actually log in (aligns with auth login). */
function blocksPublicSignupStart(user) {
  if (!user) return false;
  return user.isActive !== false;
}

const RESUMABLE_APP_STATUSES = ['draft', 'email_verified', 'documents_done', 'payment_pending'];

/** Infer INR vs LKR from phone / WhatsApp on the application. */
function detectCurrencyFromPhone(phone, whatsapp) {
  const sources = [phone, whatsapp].filter((s) => String(s || '').trim());
  for (const raw of sources) {
    const t = String(raw).trim();
    const digits = t.replace(/\D/g, '');
    if (!digits) continue;
    if (/^(\+?94|0094)/.test(t.replace(/\s/g, '')) || digits.startsWith('94')) return 'LKR';
    if (/^(\+?91|0091)/.test(t.replace(/\s/g, '')) || digits.startsWith('91')) return 'INR';
    if ((digits.length === 10 && digits.startsWith('07')) || (digits.length === 9 && digits.startsWith('7'))) {
      return 'LKR';
    }
    if (digits.length === 10 && /^[6-9]/.test(digits)) return 'INR';
  }
  return 'INR';
}

/** Find or create an application by applicationToken */
async function findApp(token) {
  if (!token) return null;
  return SignupApplication.findOne({ applicationToken: token }).select('+passwordHash');
}

/** Finance / admin inbox for manual payment proof (override via SIGNUP_ADMIN_NOTIFY_EMAILS) */
const ADMIN_NOTIFY_EMAILS = parseAdminNotifyEmails();

/** Get (or resolve) the system admin ID used as paymentRequest.requestedBy */
async function getSystemAdminId() {
  if (process.env.SIGNUP_SYSTEM_ADMIN_ID) return process.env.SIGNUP_SYSTEM_ADMIN_ID;
  const admin = await User.findOne({ role: 'ADMIN' }).select('_id').lean();
  return admin?._id || null;
}

/** Compute amount for level + subscription from catalog */
async function getCatalogAmount(level, subscription, currency) {
  const catalog = await PaymentHubCatalog.getOrCreate();
  const curr = (currency || 'INR').toUpperCase();
  const sub = String(subscription || '').trim().toUpperCase();

  if (isServicePlan(sub)) {
    return getServicePlanAmount(sub, curr, catalog.referenceRows || []);
  }

  const cefrRow = catalog.cefrRows?.find((r) => r.code === level);
  if (cefrRow) {
    return curr === 'LKR' ? cefrRow.lkr : cefrRow.inr;
  }
  return 0;
}

// ─── GET /catalog — public pricing ───────────────────────────────────────────

router.get('/catalog', async (_req, res) => {
  try {
    const catalog = await PaymentHubCatalog.getOrCreate();
    return res.json({
      success: true,
      cefr: catalog.cefrRows || [],
      reference: catalog.referenceRows || [],
    });
  } catch (err) {
    console.error('[GET /public-signup/catalog]', err);
    return res.status(500).json({ msg: 'Failed to load pricing.' });
  }
});

// ─── GET /:token — resume application ────────────────────────────────────────

router.get('/:token', async (req, res) => {
  try {
    const app = await SignupApplication.findOne({ applicationToken: req.params.token }).lean();
    if (!app) return res.status(404).json({ msg: 'Application not found.' });
    // Never expose passwordHash to client
    const { passwordHash: _ph, ...safe } = app;
    return res.json({ success: true, data: safe });
  } catch (err) {
    console.error('[GET /public-signup/:token]', err);
    return res.status(500).json({ msg: 'Server error.' });
  }
});

// ─── POST /start — step 1: personal info + send OTP ──────────────────────────

router.post('/start', startLimiter, async (req, res) => {
  try {
    const {
      applicationToken,
      name,
      email: rawEmail,
      phoneNumber,
      whatsappNumber,
      address,
      age,
      nationality,
      medium,
      otherLanguageKnown,
      languageLevelOpted,
      qualifications,
      leadSource,
      subscription,
    } = req.body;

    const email = normalizeEmail(rawEmail);
    if (!email || !email.includes('@')) {
      return res.status(400).json({ msg: 'A valid email address is required.' });
    }
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ msg: 'Full name is required.' });
    }

    const existingUser = await findUserByEmail(email);
    if (existingUser && blocksPublicSignupStart(existingUser)) {
      if (existingUser.role !== 'STUDENT') {
        return res.status(400).json({
          msg: 'This email is already registered with a staff account. Please use a different email or contact support.',
        });
      }
      return res.status(400).json({ msg: 'An account with this email already exists. Please log in.' });
    }

    // Find or create application
    let app;
    if (applicationToken) {
      app = await findApp(applicationToken);
    }
    if (!app) {
      app = await SignupApplication.findOne({
        email,
        status: { $in: RESUMABLE_APP_STATUSES },
      }).sort({ updatedAt: -1 });
    }
    if (!app) {
      app = new SignupApplication({ email });
    }

    // Link pending portal user from an earlier payment step (inactive until approved)
    if (!app.userId && existingUser?.role === 'STUDENT' && existingUser.isActive === false) {
      app.userId = existingUser._id;
    }

    const previousEmail = app.email;

    // Update personal fields
    app.name = String(name).trim();
    app.email = email;
    app.phoneNumber = phoneNumber || app.phoneNumber || '';
    app.whatsappNumber = whatsappNumber || app.whatsappNumber || '';
    app.address = address || app.address || '';
    app.age = age ? Number(age) : (app.age ?? null);
    app.nationality = nationality || app.nationality || '';
    app.medium = Array.isArray(medium) ? medium : (medium ? [medium] : app.medium);
    app.otherLanguageKnown = otherLanguageKnown || app.otherLanguageKnown || '';
    app.languageLevelOpted = languageLevelOpted || app.languageLevelOpted || '';
    app.qualifications = qualifications || app.qualifications || '';
    app.leadSource = leadSource || app.leadSource || '';
    if (subscription) {
      const sub = String(subscription).trim().toUpperCase();
      if (isAllowedStudentPlan(sub)) {
        app.subscription = sub;
      }
    }

    const emailChanged = !!(app.emailVerifiedAt && previousEmail && previousEmail !== email);
    const alreadyVerified = !!(app.emailVerifiedAt && !emailChanged);

    if (emailChanged) {
      app.emailVerifiedAt = null;
    }
    await app.save();

    if (alreadyVerified) {
      return res.json({
        success: true,
        applicationToken: app.applicationToken,
        alreadyVerified: true,
        msg: 'Your details have been updated.',
      });
    }

    app.emailVerifiedAt = null;
    await app.save();

    // Issue OTP
    await SignupEmailOtp.deleteMany({ applicationToken: app.applicationToken });
    const otp = String(crypto.randomInt(100000, 999999));
    const otpHash = await bcrypt.hash(otp, await bcrypt.genSalt(10));
    await SignupEmailOtp.create({
      email: app.email,
      applicationToken: app.applicationToken,
      otpHash,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    const { subject, html } = buildSignupEmailOtpEmail({ name: app.name, otp, expiresMinutes: 10 });
    await transporter.sendMail({ from: process.env.EMAIL_USER, to: app.email, subject, html });
    console.log('[public-signup/start] OTP sent to user email:', app.email);

    return res.json({
      success: true,
      applicationToken: app.applicationToken,
      msg: `A 6-digit verification code was sent to ${app.email}. Enter it to continue.`,
    });
  } catch (err) {
    console.error('[POST /public-signup/start]', err);
    return res.status(500).json({ msg: 'Could not send verification code. Please try again.' });
  }
});

// ─── POST /verify-email — step 1: verify OTP + save password hash ─────────────

router.post('/verify-email', otpVerifyLimiter, async (req, res) => {
  try {
    const { applicationToken, otp, password, confirmPassword } = req.body;
    if (!applicationToken || !otp || !password) {
      return res.status(400).json({ msg: 'Token, OTP, and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ msg: 'Password must be at least 8 characters.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ msg: 'Passwords do not match.' });
    }

    const app = await SignupApplication.findOne({ applicationToken }).select('+passwordHash');
    if (!app) return res.status(400).json({ msg: 'Application not found. Please restart signup.' });

    const otpDoc = await SignupEmailOtp.findOne({ applicationToken, used: false });
    if (!otpDoc || otpDoc.expiresAt < new Date()) {
      if (otpDoc) await SignupEmailOtp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ msg: 'Verification code expired. Please go back and request a new one.' });
    }

    otpDoc.attempts += 1;
    if (otpDoc.attempts > 6) {
      await SignupEmailOtp.deleteOne({ _id: otpDoc._id });
      return res.status(400).json({ msg: 'Too many incorrect attempts. Please request a new code.' });
    }
    await otpDoc.save();

    const valid = await bcrypt.compare(String(otp).trim(), otpDoc.otpHash);
    if (!valid) {
      return res.status(400).json({ msg: 'Incorrect verification code. Please try again.' });
    }

    otpDoc.used = true;
    await otpDoc.save();

    app.emailVerifiedAt = new Date();
    app.passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    app.passwordRecoverable = storeRecoverablePassword(password);
    if (!app.passwordRecoverable) {
      console.error('[public-signup/verify-email] Could not store recoverable password copy');
    }
    app.status = 'email_verified';
    await app.save();

    return res.json({
      success: true,
      applicationToken: app.applicationToken,
      msg: 'Email verified. Proceed to the next step.',
    });
  } catch (err) {
    console.error('[POST /public-signup/verify-email]', err);
    return res.status(500).json({ msg: 'Verification failed. Please try again.' });
  }
});

// ─── POST /documents — step 2: optional document uploads ─────────────────────

router.post('/documents', (req, res, next) => docsUpload(req, res, next), async (req, res) => {
  try {
    const { applicationToken } = req.body;
    const app = await SignupApplication.findOne({ applicationToken });
    if (!app) return res.status(400).json({ msg: 'Application not found.' });
    if (!app.emailVerifiedAt) return res.status(400).json({ msg: 'Email must be verified first.' });

    if (req.files && req.files.length > 0) {
      for (const f of req.files) {
        let fileKey;
        if (proofR2.isPaymentR2Configured() && f.buffer) {
          const ext = path.extname(f.originalname || '').slice(0, 10) || '.pdf';
          const r2Key = `signup-docs/${app.applicationToken}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
          const { publicUrl } = await proofR2.putPaymentProof(f.buffer, r2Key, f.mimetype);
          fileKey = publicUrl || r2Key;
        } else {
          fileKey = `signup-docs/${f.filename}`;
        }
        app.documents.push({ fileKey, originalName: f.originalname, mimeType: f.mimetype });
      }
    }
    app.status = 'documents_done';
    await app.save();

    return res.json({
      success: true,
      applicationToken: app.applicationToken,
      uploadedCount: req.files?.length || 0,
      msg: req.files?.length ? `${req.files.length} document(s) uploaded.` : 'Documents step saved.',
    });
  } catch (err) {
    console.error('[POST /public-signup/documents]', err);
    return res.status(500).json({ msg: 'Document upload failed. Please try again.' });
  }
});

// ─── POST /finalize — step 3a: save level/plan + provision pending user ───────

router.post('/finalize', finalizeLimiter, async (req, res) => {
  try {
    const { applicationToken, level, subscription, currency } = req.body;
    if (!applicationToken || !level || !subscription) {
      return res.status(400).json({ msg: 'applicationToken, level, and subscription are required.' });
    }

    const app = await SignupApplication.findOne({ applicationToken }).select('+passwordHash +passwordRecoverable');
    if (!app) return res.status(400).json({ msg: 'Application not found.' });
    if (!app.emailVerifiedAt) return res.status(400).json({ msg: 'Please complete email verification first.' });
    if (!app.passwordHash) return res.status(400).json({ msg: 'Password not set. Please go back and verify your email.' });
    if (app.status === 'approved') return res.status(400).json({ msg: 'This application is already approved.' });

    const curr = (currency || detectCurrencyFromPhone(app.phoneNumber, app.whatsappNumber) || 'INR').toUpperCase();
    const amount = await getCatalogAmount(level, subscription, curr);

    app.level = level;
    app.languageLevelOpted = app.languageLevelOpted || level;
    app.subscription = subscription;
    app.currency = curr;
    app.amount = amount;

    // Provision User if not yet created
    if (!app.userId) {
      const exists = await findUserByEmail(app.email);
      if (exists && blocksPublicSignupStart(exists)) {
        if (exists.role !== 'STUDENT') {
          return res.status(400).json({
            msg: 'This email is already registered with a staff account. Please use a different email.',
          });
        }
        return res.status(400).json({ msg: 'An active account with this email already exists.' });
      }

      const regNo = await generateRegNo('STUDENT');
      const user = new User({
        name: app.name,
        email: app.email,
        regNo,
        role: 'STUDENT',
        studentStatus: 'ONGOING',
        subscription: app.subscription,
        level: app.level,
        batch: process.env.SIGNUP_DEFAULT_BATCH || 'Unassigned',
        medium: app.medium?.length ? app.medium : ['English'],
        phoneNumber: app.phoneNumber || '',
        whatsappNumber: app.whatsappNumber || '',
        address: app.address || '',
        age: app.age || null,
        nationality: app.nationality || '',
        otherLanguageKnown: app.otherLanguageKnown || '',
        languageLevelOpted: app.languageLevelOpted || '',
        qualifications: app.qualifications || '',
        leadSource: app.leadSource || '',
        signupSource: 'public_signup',
        isActive: false, // activated after payment
        mustChangePassword: false,
      });

      user.password = app.passwordHash;
      if (app.passwordRecoverable) user.passwordRecoverable = app.passwordRecoverable;
      await user.save();
      app.userId = user._id;
    } else if (app.passwordRecoverable) {
      const existing = await User.findById(app.userId);
      if (existing && !existing.passwordRecoverable) {
        existing.passwordRecoverable = app.passwordRecoverable;
        await existing.save();
      }
    }

    app.status = 'payment_pending';
    await app.save();

    return res.json({
      success: true,
      applicationToken: app.applicationToken,
      amount,
      currency: curr,
      level,
      subscription,
      msg: 'Almost there! Choose a payment method to complete your registration.',
    });
  } catch (err) {
    console.error('[POST /public-signup/finalize]', err);
    if (err.code === 11000) {
      return res.status(400).json({ msg: 'This email is already registered. Please log in or use a different email.' });
    }
    return res.status(500).json({ msg: 'Could not save your details. Please try again.' });
  }
});

// ─── POST /razorpay/create-order ─────────────────────────────────────────────

router.post('/razorpay/create-order', rzpLimiter, async (req, res) => {
  try {
    const { applicationToken } = req.body;
    const app = await SignupApplication.findOne({ applicationToken });
    if (!app) return res.status(400).json({ msg: 'Application not found.' });
    if (app.status !== 'payment_pending') return res.status(400).json({ msg: 'Please complete previous steps first.' });

    const amountPaise = Math.round((app.amount || 0) * 100);
    if (amountPaise <= 0) return res.status(400).json({ msg: 'Invalid payment amount. Please go back and select a plan.' });

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR', // Razorpay only supports INR
      receipt: `signup_${app.applicationToken.slice(0, 16)}`,
      notes: { signupApplicationId: app.applicationToken, studentEmail: app.email },
    });

    app.razorpayOrderId = order.id;
    await app.save();

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      studentName: app.name,
      studentEmail: app.email,
    });
  } catch (err) {
    console.error('[POST /public-signup/razorpay/create-order]', err);
    return res.status(500).json({ msg: 'Failed to initiate payment. Please try again.' });
  }
});

// ─── POST /razorpay/verify ────────────────────────────────────────────────────

router.post('/razorpay/verify', rzpLimiter, async (req, res) => {
  try {
    const { applicationToken, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
    if (!applicationToken || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({ msg: 'All Razorpay fields are required.' });
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');
    if (expected !== razorpaySignature) {
      return res.status(400).json({ msg: 'Payment verification failed. Please contact support.' });
    }

    const app = await SignupApplication.findOne({ applicationToken }).select('+passwordHash +passwordRecoverable');
    if (!app || !app.userId) return res.status(400).json({ msg: 'Application not found.' });

    const user = await User.findById(app.userId);
    if (!user) return res.status(400).json({ msg: 'Student account not found.' });

    user.isActive = true;
    user.studentStatus = 'ONGOING';
    await user.save();

    app.razorpayPaymentId = razorpayPaymentId;
    app.paymentMethod = 'razorpay';
    app.status = 'approved';
    await app.save();

    activatePublicSignupStudent(user._id, { paymentRequestId: app.paymentRequestId }).catch((e) =>
      console.error('[signup/razorpay/verify] welcome email failed:', e?.message)
    );

    return res.json({
      success: true,
      msg: 'Payment successful! Your account has been created. Check your email for login details.',
    });
  } catch (err) {
    console.error('[POST /public-signup/razorpay/verify]', err);
    return res.status(500).json({ msg: 'Payment verification failed. Please contact support.' });
  }
});

// ─── POST /payment-proof — step 3: upload payment screenshot → Req Payment ───

router.post('/payment-proof', handleProofUpload, async (req, res) => {
  try {
    const { applicationToken, paidAmount, paymentDateTime, accountHolderName } = req.body;
    if (!req.file) return res.status(400).json({ msg: 'Please upload a payment screenshot or PDF.' });

    const app = await SignupApplication.findOne({ applicationToken });
    if (!app || !app.userId) return res.status(400).json({ msg: 'Application not found. Please restart signup.' });
    if (app.status === 'approved') return res.status(400).json({ msg: 'This application is already approved.' });
    if (app.status !== 'payment_pending') return res.status(400).json({ msg: 'Please complete previous steps first.' });

    const user = await User.findById(app.userId).lean();
    if (!user) return res.status(400).json({ msg: 'Student account not found.' });

    // Upload screenshot
    let screenshotKey;
    const f = req.file;
    if (proofR2.isPaymentR2Configured() && f.buffer) {
      const ext = path.extname(f.originalname || '').slice(0, 10) || '.jpg';
      const r2Key = `signup-proofs/${app.applicationToken}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const { publicUrl } = await proofR2.putPaymentProof(f.buffer, r2Key, f.mimetype);
      screenshotKey = publicUrl || r2Key;
    } else {
      screenshotKey = `signup-proofs/${f.filename}`;
    }

    // Create a PaymentRequest for this student (system-generated)
    const adminId = await getSystemAdminId();
    const dueDate = new Date();
    const pr = await PaymentRequest.create({
      studentId: app.userId,
      requestedBy: adminId,
      amount: app.amount,
      currency: app.currency || 'INR',
      paymentType: 'LANGUAGE_FEE',
      dueDate,
      remarks: `Public signup — ${app.name} (${app.email})`,
      amountRemaining: app.amount,
      source: 'PUBLIC_SIGNUP',
      status: 'REQUESTED',
    });

    const parsedPaid = parseFloat(paidAmount);
    const paid =
      Number.isFinite(parsedPaid) && parsedPaid > 0 ? parsedPaid : app.amount;
    const payDt = paymentDateTime ? new Date(paymentDateTime) : new Date();
    const payDtValid = !Number.isNaN(payDt.getTime()) ? payDt : new Date();
    const holder = String(accountHolderName || '').trim();

    // Submit the proof
    const paymentSvc = getPaymentService();
    const submission = await paymentSvc.submitPayment({
      paymentRequestId: pr._id,
      studentId: app.userId,
      paidAmount: paid,
      currency: app.currency || 'INR',
      screenshotKey,
      screenshotOriginalName: f.originalname,
      screenshotMimeType: f.mimetype,
      screenshotSize: f.size,
      paymentMethod: 'Bank Transfer',
      paymentDateTime: payDtValid,
      accountHolderName: holder || app.name,
    });

    app.paymentRequestId = pr._id;
    app.submissionId = submission._id;
    app.paymentMethod = 'proof';
    await app.save();

    // Notify finance team (screenshot attached)
    const adminUrl = `${process.env.FRONTEND_URL || 'https://gluckstudentsportal.com'}/admin/payment-request`;
    const attachments = await buildSignupProofAttachments(f, screenshotKey);
    const notifyMail = buildSignupProofReceivedAdminEmail({
      studentName: app.name,
      studentEmail: app.email,
      regNo: user.regNo,
      phoneNumber: app.phoneNumber,
      whatsappNumber: app.whatsappNumber,
      nationality: app.nationality,
      address: app.address,
      learnFromLanguage: app.otherLanguageKnown,
      level: app.level,
      subscription: app.subscription,
      amount: app.amount,
      currency: app.currency || 'INR',
      paymentMethod: 'Bank transfer (manual proof)',
      proofFileName: f.originalname,
      proofNote: attachments.length
        ? 'Payment screenshot is attached to this email.'
        : 'Screenshot could not be attached — open the admin panel to view the proof.',
      adminUrl,
    });
    transporter
      .sendMail({
        from: process.env.EMAIL_USER,
        to: ADMIN_NOTIFY_EMAILS.join(', '),
        subject: notifyMail.subject,
        html: notifyMail.html,
        attachments,
      })
      .catch((e) => console.error('[signup/payment-proof] admin notify failed:', e?.message));

    return res.json({
      success: true,
      msg: 'Your payment proof has been submitted. Our team will review it and activate your account within 24 hours. You will receive an email with your login details.',
    });
  } catch (err) {
    console.error('[POST /public-signup/payment-proof]', err);
    return res.status(500).json({ msg: 'Could not submit payment proof. Please try again.' });
  }
});

module.exports = router;
