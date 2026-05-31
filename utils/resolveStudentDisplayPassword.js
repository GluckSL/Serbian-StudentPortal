/**
 * Resolve plaintext password for ADMIN student directory display.
 * Order: decrypt user.passwordRecoverable → signup application → bcrypt match on standard generated passwords.
 */

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const EmailChangeRequest = require('../models/EmailChangeRequest');
const { readRecoverablePassword, storeRecoverablePassword } = require('./passwordRecoverable');
const { resolveSignupPlainPassword } = require('./signupActivation');

const PASSWORD_PREFIX = {
  STUDENT: 'Student',
  TEACHER: 'Teacher',
  ADMIN: 'Admin',
  SUB_ADMIN: 'SubAdmin',
  TEACHER_ADMIN: 'TeacherAdmin',
};

function passwordCandidates(role, regNo, createdAt) {
  const roleKey = typeof role === 'string' ? role.trim().toUpperCase() : '';
  const prefix = PASSWORD_PREFIX[roleKey] || roleKey;
  const reg = String(regNo || '');
  const numericTail = (reg.match(/(\d+)$/)?.[1] || '').trim();
  const tailKeys = [
    String(reg || '').slice(-3),
    String(reg || '').slice(-4),
    numericTail,
  ].filter(Boolean);
  const tails = [...new Set(tailKeys)];

  const prefixes = [...new Set([prefix, String(prefix).toLowerCase()])];
  const years = new Set([new Date().getFullYear()]);
  if (createdAt) {
    const y = new Date(createdAt).getFullYear();
    if (Number.isFinite(y)) years.add(y);
  }
  const now = new Date().getFullYear();
  for (let y = now - 8; y <= now + 1; y += 1) years.add(y);
  const yearList = [...years].sort((a, b) => b - a);

  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (!p) return;
    const k = String(p);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };

  for (const pf of prefixes) {
    for (const tail of tails) {
      for (const year of yearList) {
        add(`${pf}${tail}@${year}`);
      }
      // Legacy/custom formats occasionally omit @year
      add(`${pf}${tail}`);
    }
  }

  return out;
}

async function backfillRecoverable(userId, plain) {
  const stored = storeRecoverablePassword(plain);
  if (!stored) return;
  await User.updateOne({ _id: userId }, { passwordRecoverable: stored }).catch(() => {});
}

async function passwordFromEmailChangeRequests(user) {
  const requests = await EmailChangeRequest.find({ userId: user._id })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(10)
    .select('newPasswordEncrypted')
    .lean();

  for (const row of requests) {
    const plain = readRecoverablePassword(row?.newPasswordEncrypted);
    if (!plain || !user.password) continue;
    try {
      if (await bcrypt.compare(plain, user.password)) {
        return plain;
      }
    } catch {
      /* ignore compare errors */
    }
  }
  return null;
}

async function loadUserForPasswordResolve(user) {
  if (!user?._id) return user;
  const hasHash = typeof user.password === 'string' && user.password.length > 0;
  const hasRecoverableField = Object.prototype.hasOwnProperty.call(user, 'passwordRecoverable');
  if (hasHash && hasRecoverableField) return user;

  const fresh = await User.findById(user._id).select('password passwordRecoverable role regNo createdAt').lean();
  return fresh || user;
}

/** Only return plaintext when it still matches the stored bcrypt hash. */
async function plainMatchesCurrentHash(plain, passwordHash) {
  if (!plain || !passwordHash) return false;
  try {
    return await bcrypt.compare(plain, passwordHash);
  } catch {
    return false;
  }
}

/**
 * @param {object} user - Mongoose User document (needs password hash for fallback)
 * @param {{ listView?: boolean }} [options] - listView skips slow bcrypt/signup fallbacks (student directory)
 * @returns {Promise<string|null>}
 */
async function resolveStudentDisplayPassword(user, options = {}) {
  const { listView = false } = options;
  if (!user || user.role !== 'STUDENT') return null;

  user = await loadUserForPasswordResolve(user);

  let plain = readRecoverablePassword(user.passwordRecoverable);
  if (plain && (await plainMatchesCurrentHash(plain, user.password))) {
    return plain;
  }

  // Directory list: skip bcrypt brute-force and extra DB lookups (recoverable already tried above).
  if (listView) return null;

  plain = await resolveSignupPlainPassword(user, null);
  if (plain && (await plainMatchesCurrentHash(plain, user.password))) {
    if (!user.passwordRecoverable) await backfillRecoverable(user._id, plain);
    return plain;
  }

  // Email change / first-login setup (pending or approved requests).
  try {
    plain = await passwordFromEmailChangeRequests(user);
    if (plain && (await plainMatchesCurrentHash(plain, user.password))) {
      if (!user.passwordRecoverable) await backfillRecoverable(user._id, plain);
      return plain;
    }
  } catch {
    /* ignore fallback lookup errors */
  }

  if (!user.password) return null;

  for (const candidate of passwordCandidates(user.role, user.regNo, user.createdAt)) {
    try {
      if (await bcrypt.compare(candidate, user.password)) {
        if (!user.passwordRecoverable) await backfillRecoverable(user._id, candidate);
        return candidate;
      }
    } catch {
      /* ignore compare errors */
    }
  }

  return null;
}

module.exports = { resolveStudentDisplayPassword, passwordCandidates };
