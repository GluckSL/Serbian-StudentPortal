/**
 * Maps the 200-day student journey (currentCourseDay) to CEFR level.
 * 1–42 → A1, 43–84 → A2, 85–145 → B1, 146–200 → B2
 */

const User = require('../models/User');

const JOURNEY_LEVEL_RANGES = [
  { min: 1, max: 42, level: 'A1' },
  { min: 43, max: 84, level: 'A2' },
  { min: 85, max: 145, level: 'B1' },
  { min: 146, max: 200, level: 'B2' }
];

const { clampStandardJourneyDay } = require('../utils/journeyDay');

function normalizeJourneyDay(day) {
  const n = parseInt(String(day), 10);
  if (!Number.isFinite(n)) return 1;
  if (n === 0) return 0;
  return clampStandardJourneyDay(n);
}

function levelForJourneyDay(day) {
  const d = normalizeJourneyDay(day);
  if (d === 0) return 'A1';
  for (const r of JOURNEY_LEVEL_RANGES) {
    if (d >= r.min && d <= r.max) return r.level;
  }
  return 'B2';
}

const JOURNEY_LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function firstJourneyDayForLevel(level) {
  const key = String(level || 'A1').toUpperCase();
  const range = JOURNEY_LEVEL_RANGES.find((r) => r.level === key);
  return range ? range.min : 1;
}

/** CEFR levels below the given level on the journey track (e.g. A2 → ['A1']). */
function levelsBelowJourneyLevel(level) {
  const key = String(level || 'A1').toUpperCase();
  const idx = JOURNEY_LEVEL_ORDER.indexOf(key);
  return idx > 0 ? JOURNEY_LEVEL_ORDER.slice(0, idx) : [];
}

/**
 * When an admin raises a student's CEFR level ahead of their journey day,
 * align currentCourseDay and block skipped lower levels (e.g. A2 starter at day 43 blocks A1).
 */
function buildAdminLevelJumpUpdate(newLevel, existingUser, setFields = {}) {
  const normalized = String(newLevel || 'A1').toUpperCase();
  const targetDay = firstJourneyDayForLevel(normalized);
  const currentDay = normalizeJourneyDay(existingUser?.currentCourseDay);
  const out = { ...setFields };

  if (currentDay < targetDay) {
    Object.assign(
      out,
      withJourneyLevelInSet(
        targetDay,
        {
          currentCourseDay: targetDay,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        },
        { force: true }
      )
    );
    const below = levelsBelowJourneyLevel(normalized);
    if (below.length && currentDay < targetDay - 1) {
      const { normalizeBlockedJourneyLevels } = require('../utils/journeyContentBlock');
      const existing = normalizeBlockedJourneyLevels(existingUser?.blockedJourneyLevels);
      out.blockedJourneyLevels = [...new Set([...existing, ...below])];
    }
  } else {
    out.level = normalized;
  }

  return out;
}

/** All portal students follow journey-day → level mapping when their day changes. */
function usesJourneyDayLevelSync(student) {
  if (!student) return false;
  if (student.role && student.role !== 'STUDENT') return false;
  return true;
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
    .select('role goStatus batch subscription level currentCourseDay blockedJourneyLevels')
    .lean();
  if (!student || student.role !== 'STUDENT') return { synced: false };
  if (!usesJourneyDayLevelSync(student)) return { synced: false };

  const day = normalizeJourneyDay(student.currentCourseDay);
  const expected = levelForJourneyDay(day);
  const current = String(student.level || 'A1').toUpperCase();
  if (current === expected) return { synced: false, level: expected };

  const { normalizeBlockedJourneyLevels, isLevelAdminBlocked, isCourseDayAdminBlocked } =
    require('../utils/journeyContentBlock');
  const blocked = normalizeBlockedJourneyLevels(student.blockedJourneyLevels);
  if (isCourseDayAdminBlocked(blocked, day) || isLevelAdminBlocked(blocked, expected)) {
    return { synced: false, level: current };
  }

  await User.updateOne({ _id: studentId }, { $set: { level: expected } });
  console.log(
    `📈 [Journey level] Student ${studentId}: ${current} → ${expected} (journey day ${day})`
  );
  return { synced: true, level: expected, previousLevel: current };
}

/**
 * Fix stored levels for students in a batch whose level does not match currentCourseDay.
 * @returns {Promise<{ updated: number }>}
 */
async function syncJourneyLevelsForBatch(batchRegex) {
  const students = await User.find({ role: 'STUDENT', batch: batchRegex })
    .select('_id currentCourseDay level')
    .lean();
  const ops = [];
  for (const s of students) {
    const expected = levelForJourneyDay(s.currentCourseDay);
    if (String(s.level || 'A1').toUpperCase() !== expected) {
      ops.push({
        updateOne: {
          filter: { _id: s._id },
          update: { $set: { level: expected } }
        }
      });
    }
  }
  if (ops.length) await User.bulkWrite(ops);
  return { updated: ops.length };
}

module.exports = {
  JOURNEY_LEVEL_RANGES,
  JOURNEY_LEVEL_ORDER,
  normalizeJourneyDay,
  levelForJourneyDay,
  firstJourneyDayForLevel,
  levelsBelowJourneyLevel,
  buildAdminLevelJumpUpdate,
  usesJourneyDayLevelSync,
  withJourneyLevelInSet,
  ensureStudentLevelMatchesJourneyDay,
  syncJourneyLevelsForBatch
};
