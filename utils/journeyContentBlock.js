/**
 * Admin-blocked journey levels (e.g. A2 starters cannot access A1 days 1–42).
 * Day ranges align with journeyLevelSync / payment-journey-metrics.
 */

const { JOURNEY_LEVEL_RANGES, levelForJourneyDay } = require('../services/journeyLevelSync.service');

const VALID_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function normalizeBlockedJourneyLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return [...new Set(
    levels
      .map((l) => String(l || '').toUpperCase().trim())
      .filter((l) => VALID_LEVELS.includes(l))
  )];
}

function dayRangeForLevel(level) {
  const key = String(level || '').toUpperCase();
  const r = JOURNEY_LEVEL_RANGES.find((x) => x.level === key);
  return r ? { min: r.min, max: r.max, level: key } : null;
}

/** Ranges for blocked levels, sorted by min day. */
function blockedDayRanges(blockedLevels) {
  return normalizeBlockedJourneyLevels(blockedLevels)
    .map(dayRangeForLevel)
    .filter(Boolean)
    .sort((a, b) => a.min - b.min);
}

function isCourseDayAdminBlocked(blockedLevels, courseDay) {
  const blocked = blockedDayRanges(blockedLevels);
  if (!blocked.length) return false;
  const cd = Number(courseDay);
  if (!Number.isFinite(cd)) return false;
  return blocked.some((r) => cd >= r.min && cd <= r.max);
}

function isLevelAdminBlocked(blockedLevels, level) {
  const blocked = normalizeBlockedJourneyLevels(blockedLevels);
  if (!blocked.length || !level) return false;
  return blocked.includes(String(level).toUpperCase());
}

/**
 * True when student must not access this content (module, exercise, recording, etc.).
 */
function isContentBlockedForStudent(student, { courseDay, level } = {}) {
  const blocked = normalizeBlockedJourneyLevels(student?.blockedJourneyLevels);
  if (!blocked.length) return false;
  if (isLevelAdminBlocked(blocked, level)) return true;
  if (isCourseDayAdminBlocked(blocked, courseDay)) return true;
  return false;
}

/**
 * Mongo filter fragment: student-visible content that is NOT admin-blocked.
 */
function buildNotBlockedContentFilter(blockedLevels) {
  const blocked = normalizeBlockedJourneyLevels(blockedLevels);
  if (!blocked.length) return {};

  const ranges = blockedDayRanges(blocked);
  const courseDayOr = [{ courseDay: null }, { courseDay: { $exists: false } }];
  let cursor = 1;
  for (const r of ranges) {
    if (cursor < r.min) {
      courseDayOr.push({ courseDay: { $gte: cursor, $lte: r.min - 1 } });
    }
    cursor = r.max + 1;
  }
  if (cursor <= 200) {
    courseDayOr.push({ courseDay: { $gte: cursor } });
  }

  return {
    $and: [
      { $or: courseDayOr },
      {
        $or: [
          { level: { $nin: blocked } },
          { level: null },
          { level: { $exists: false } }
        ]
      }
    ]
  };
}

function levelMetaForAdmin(blockedLevels) {
  return JOURNEY_LEVEL_RANGES.filter((r) => ['A1', 'A2', 'B1', 'B2'].includes(r.level)).map((r) => ({
    level: r.level,
    dayStart: r.min,
    dayEnd: r.max,
    blocked: normalizeBlockedJourneyLevels(blockedLevels).includes(r.level)
  }));
}

/** CEFR levels a student may see (profile level minus admin-blocked levels). */
function getEffectiveAccessibleLevels(studentLevel, blockedLevels) {
  const { getAccessibleLevels } = require('./levelAccessControl');
  const blocked = normalizeBlockedJourneyLevels(blockedLevels);
  return getAccessibleLevels(studentLevel || 'A1').filter((l) => !blocked.includes(l));
}

function filterOutBlockedLevels(levels, blockedLevels) {
  const blocked = normalizeBlockedJourneyLevels(blockedLevels);
  if (!blocked.length) return levels;
  return (levels || []).filter((l) => !blocked.includes(String(l).toUpperCase()));
}

/** Merge admin-blocked rules into an existing `$and` query array (digital exercises, etc.). */
function appendNotBlockedToAndClauses(andClauses, blockedLevels) {
  const nb = buildNotBlockedContentFilter(blockedLevels);
  if (nb.$and) andClauses.push(...nb.$and);
}

/**
 * Exercise ObjectIds the student is allowed to see/attempt (null = no block, all allowed).
 */
async function getAllowedExerciseObjectIds(student) {
  const blocked = normalizeBlockedJourneyLevels(student?.blockedJourneyLevels);
  if (!blocked.length) return null;
  const DigitalExercise = require('../models/DigitalExercise');
  const andClauses = [{ isDeleted: { $ne: true } }];
  appendNotBlockedToAndClauses(andClauses, blocked);
  const docs = await DigitalExercise.find({ $and: andClauses }).select('_id').lean();
  return docs.map((d) => d._id);
}

async function countExerciseAttemptsForStudent(studentId, student, extraMatch = {}) {
  const mongoose = require('mongoose');
  const ExerciseAttempt = require('../models/ExerciseAttempt');
  const match = {
    studentId: new mongoose.Types.ObjectId(String(studentId)),
    ...extraMatch
  };
  const allowedIds = await getAllowedExerciseObjectIds(student);
  if (allowedIds !== null) {
    if (!allowedIds.length) return 0;
    match.exerciseId = { $in: allowedIds };
  }
  return ExerciseAttempt.countDocuments(match);
}

module.exports = {
  VALID_LEVELS,
  normalizeBlockedJourneyLevels,
  dayRangeForLevel,
  blockedDayRanges,
  levelForJourneyDay,
  isCourseDayAdminBlocked,
  isLevelAdminBlocked,
  isContentBlockedForStudent,
  buildNotBlockedContentFilter,
  levelMetaForAdmin,
  getEffectiveAccessibleLevels,
  filterOutBlockedLevels,
  appendNotBlockedToAndClauses,
  getAllowedExerciseObjectIds,
  countExerciseAttemptsForStudent
};
