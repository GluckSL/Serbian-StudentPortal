/**
 * utils/userRegistration.js
 *
 * Shared helpers for generating student regNo / passwords and normalizing
 * phone numbers. Used by routes/auth.js, services/crmStudentUpsert.js, and
 * any other place that creates portal user accounts.
 */

const User = require('../models/User');

// ─── regNo prefix map ────────────────────────────────────────────────────────

const REGNO_PREFIX = {
  STUDENT: 'STUD',
  TEACHER: 'T',
  ADMIN: 'AD',
  SUB_ADMIN: 'SAD',
  TEACHER_ADMIN: 'TA',
};

/**
 * Find the highest existing regNo for `role` and return the next integer seed.
 * Returns `{ prefix, nextNumber }`.
 */
async function getRegNoSeed(role) {
  const roleKey = typeof role === 'string' ? role.trim().toUpperCase() : '';
  if (!roleKey) throw new Error('Role is required to generate regNo');

  const prefix = REGNO_PREFIX[roleKey] || roleKey.substring(0, 2).toUpperCase();

  const lastUser = await User.findOne({
    role: roleKey,
    regNo: { $regex: `^${prefix}\\d+$` },
  })
    .sort({ regNo: -1 })
    .lean();

  let nextNumber = 1;
  if (lastUser?.regNo) {
    const match = lastUser.regNo.match(new RegExp(`^${prefix}(\\d+)$`));
    if (match) nextNumber = parseInt(match[1], 10) + 1;
  }

  return { prefix, nextNumber };
}

/**
 * Generate a unique regNo for `role`.
 * On rare race conditions the caller should retry with `getRegNoSeed` + offset.
 */
async function generateRegNo(role) {
  const { prefix, nextNumber } = await getRegNoSeed(role);
  return prefix + String(nextNumber).padStart(3, '0');
}

// ─── Password generation ──────────────────────────────────────────────────────

const PASSWORD_PREFIX = {
  STUDENT: 'Student',
  TEACHER: 'Teacher',
  ADMIN: 'Admin',
  SUB_ADMIN: 'SubAdmin',
  TEACHER_ADMIN: 'TeacherAdmin',
};

/**
 * Deterministic password for a newly created account:
 * `<RolePrefix><last3ofRegNo>@<year>`  e.g. `Student042@2026`
 */
function generatePassword(role, regNo) {
  const roleKey = typeof role === 'string' ? role.trim().toUpperCase() : '';
  if (!roleKey) throw new Error('Role is required to generate password');
  const prefix = PASSWORD_PREFIX[roleKey] || roleKey;
  const last3 = String(regNo || '').slice(-3);
  const year = new Date().getFullYear();
  return `${prefix}${last3}@${year}`;
}

// ─── Phone normalization ──────────────────────────────────────────────────────

/**
 * Strip all non-digit characters, then prefix with '+' for a canonical
 * E.164-ish string used in duplicate matching.
 * Returns '' if input is empty/null.
 */
function normalizePhone(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D/g, '');
  return digits ? '+' + digits : '';
}

module.exports = {
  getRegNoSeed,
  generateRegNo,
  generatePassword,
  normalizePhone,
};
