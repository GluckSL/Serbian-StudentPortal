/**
 * Resolve plaintext password for ADMIN student directory display.
 * Order: decrypt user.passwordRecoverable → signup application → bcrypt match on standard generated passwords.
 */

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { decryptPassword, encryptPassword } = require('./passwordRecoverable');
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
  const last3 = String(regNo || '').slice(-3);
  const years = new Set([new Date().getFullYear()]);
  if (createdAt) {
    const y = new Date(createdAt).getFullYear();
    if (Number.isFinite(y)) years.add(y);
  }
  const now = new Date().getFullYear();
  for (let y = now - 4; y <= now + 1; y += 1) years.add(y);
  return [...years]
    .sort((a, b) => b - a)
    .map((year) => `${prefix}${last3}@${year}`);
}

async function backfillRecoverable(userId, plain) {
  const encrypted = encryptPassword(plain);
  if (!encrypted) return;
  await User.updateOne({ _id: userId }, { passwordRecoverable: encrypted }).catch(() => {});
}

/**
 * @param {object} user - Mongoose User document (needs password hash for fallback)
 * @returns {Promise<string|null>}
 */
async function resolveStudentDisplayPassword(user) {
  if (!user || user.role !== 'STUDENT') return null;

  let plain = decryptPassword(user.passwordRecoverable);
  if (plain) return plain;

  plain = await resolveSignupPlainPassword(user, null);
  if (plain) {
    if (!user.passwordRecoverable) await backfillRecoverable(user._id, plain);
    return plain;
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
