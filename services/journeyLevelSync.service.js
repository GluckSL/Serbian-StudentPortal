/**
 * Maps the 200-day student journey (currentCourseDay) to CEFR level.
 * 1–42 → A1, 43–84 → A2, 85–145 → B1, 146–200 → B2
 */

const User = require('../models/User');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');

const JOURNEY_LEVEL_RANGES = [
  { min: 1, max: 42, level: 'A1' },
  { min: 43, max: 84, level: 'A2' },
  { min: 85, max: 145, level: 'B1' },
  { min: 146, max: 200, level: 'B2' }
];

function normalizeJourneyDay(day) {
  const n = parseInt(String(day), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(200, Math.max(1, n));
}

function levelForJourneyDay(day) {
  const d = normalizeJourneyDay(day);
  for (const r of JOURNEY_LEVEL_RANGES) {
    if (d >= r.min && d <= r.max) return r.level;
  }
  return 'B2';
}

/** True when this student follows the GO / GO-SILVER 200-day journey program. */
function usesJourneyDayLevelSync(student) {
  if (!student) return false;
  if (String(student.goStatus || '').toUpperCase() === 'GO') return true;
  const keys = allStudentBatchStringsForContent(student);
  return keys.some((k) => String(k).toUpperCase() === 'GO-SILVER');
}

/**
 * Merge `level` into an existing $set object for a journey-day update.
 * @param {number} journeyDay
 * @param {object} [setFields]
 * @param {{ student?: object, force?: boolean }} [opts]
 */
function withJourneyLevelInSet(journeyDay, setFields = {}, opts = {}) {
  const { student, force = false } = opts;
  if (!force && student && !usesJourneyDayLevelSync(student)) {
    return setFields;
  }
  return { ...setFields, level: levelForJourneyDay(journeyDay) };
}

/**
 * If the student's stored level does not match their journey day, update it.
 * @returns {Promise<{ synced: boolean, level?: string, previousLevel?: string }>}
 */
async function ensureStudentLevelMatchesJourneyDay(studentId) {
  const student = await User.findById(studentId)
    .select('role goStatus batch subscription level currentCourseDay')
    .lean();
  if (!student || student.role !== 'STUDENT') return { synced: false };
  if (!usesJourneyDayLevelSync(student)) return { synced: false };

  const day = normalizeJourneyDay(student.currentCourseDay);
  const expected = levelForJourneyDay(day);
  const current = String(student.level || 'A1').toUpperCase();
  if (current === expected) return { synced: false, level: expected };

  await User.updateOne({ _id: studentId }, { $set: { level: expected } });
  console.log(
    `📈 [Journey level] Student ${studentId}: ${current} → ${expected} (journey day ${day})`
  );
  return { synced: true, level: expected, previousLevel: current };
}

module.exports = {
  JOURNEY_LEVEL_RANGES,
  normalizeJourneyDay,
  levelForJourneyDay,
  usesJourneyDayLevelSync,
  withJourneyLevelInSet,
  ensureStudentLevelMatchesJourneyDay
};
