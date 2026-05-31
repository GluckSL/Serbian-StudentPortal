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

/** Format numeric suffix: STUD001–STUD999 (3 digits), STUD1000+ (4+ digits). */
function formatRegNo(prefix, num) {
  const n = Number(num);
  if (!Number.isFinite(n) || n < 1) throw new Error('Invalid regNo number');
  const minDigits = n >= 1000 ? 4 : 3;
  return prefix + String(n).padStart(minDigits, '0');
}

/**
 * Find the highest numeric regNo suffix for `role` (string sort breaks after STUD999).
 * Returns `{ prefix, nextNumber }`.
 */
async function getRegNoSeed(role) {
  const roleKey = typeof role === 'string' ? role.trim().toUpperCase() : '';
  if (!roleKey) throw new Error('Role is required to generate regNo');

  const prefix = REGNO_PREFIX[roleKey] || roleKey.substring(0, 2).toUpperCase();
  const suffixLenExpr = { $subtract: [{ $strLenCP: '$regNo' }, prefix.length] };

  const rows = await User.aggregate([
    { $match: { role: roleKey, regNo: { $regex: `^${prefix}\\d+$` } } },
    {
      $project: {
        num: {
          $convert: {
            input: { $substrCP: ['$regNo', prefix.length, suffixLenExpr] },
            to: 'int',
            onError: null,
            onNull: null,
          },
        },
      },
    },
    { $match: { num: { $ne: null } } },
    { $group: { _id: null, maxNum: { $max: '$num' } } },
  ]);

  const maxNum = rows[0]?.maxNum || 0;
  return { prefix, nextNumber: maxNum + 1 };
}

/**
 * Generate a unique regNo for `role`.
 * On rare race conditions the caller should retry with a fresh allocator.
 */
async function generateRegNo(role) {
  const { prefix, nextNumber } = await getRegNoSeed(role);
  return formatRegNo(prefix, nextNumber);
}

/**
 * In-memory sequence for bulk creates (e.g. Monday sync) so each row gets STUD1001, STUD1002, …
 */
function createRegNoAllocator(role) {
  let prefix;
  let next;
  let initialized = false;

  return async function allocRegNo() {
    if (!initialized) {
      const seed = await getRegNoSeed(role);
      prefix = seed.prefix;
      next = seed.nextNumber;
      initialized = true;
    }
    const regNo = formatRegNo(prefix, next);
    next += 1;
    return regNo;
  };
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
  formatRegNo,
  generateRegNo,
  createRegNoAllocator,
  generatePassword,
  normalizePhone,
};
