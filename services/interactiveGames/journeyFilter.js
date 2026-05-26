// services/interactiveGames/journeyFilter.js
// GlückArena: journey day + batch targeting (mirrors Learning Modules / DG Bot)

const GameSet = require('../../models/GameSet');
const User = require('../../models/User');
const { getJourneyAccessForStudent } = require('../../utils/studentJourneyAccess');
const { studentTargetBatchKeys, moduleTargetingQuery } = require('../../utils/batchTargeting');
const {
  appendNotBlockedToAndClauses,
  isContentBlockedForStudent
} = require('../../utils/journeyContentBlock');

async function loadStudent(studentId) {
  return User.findById(studentId).select('batch level subscription goStatus currentCourseDay blockedJourneyLevels').lean();
}

/**
 * Build a Mongoose filter for visible game sets for this student.
 */
async function buildStudentFilter(studentId) {
  try {
    const student = await loadStudent(studentId);
    const access = await getJourneyAccessForStudent(student);
    const courseDay = access?.courseDay ?? 0;
    const batchKeys = studentTargetBatchKeys(student);

    const andClauses = [
      { $or: [{ courseDay: null }, { courseDay: { $exists: false } }, { courseDay: { $lte: courseDay } }] },
      moduleTargetingQuery(batchKeys)
    ];
    appendNotBlockedToAndClauses(andClauses, student?.blockedJourneyLevels);
    return {
      visibleToStudents: true,
      isPublished: true,
      isDeleted: { $ne: true },
      $and: andClauses
    };
  } catch {
    return { visibleToStudents: true, isPublished: true, isDeleted: { $ne: true } };
  }
}

/**
 * Student may open GlückArena only if their batch has at least one assigned game.
 */
async function hasArenaAccess(studentId) {
  try {
    const filter = await buildStudentFilter(studentId);
    const count = await GameSet.countDocuments(filter);
    return { hasAccess: count > 0, gameCount: count };
  } catch {
    return { hasAccess: false, gameCount: 0 };
  }
}

/**
 * Returns true if the student is NOT allowed to access this specific set.
 */
async function isGated(studentId, set) {
  if (!set.visibleToStudents || !set.isPublished) return true;

  const studentForBlock = await loadStudent(studentId);
  if (isContentBlockedForStudent(studentForBlock, { courseDay: set.courseDay, level: set.level })) {
    return true;
  }

  if (set.courseDay) {
    try {
      const student = await loadStudent(studentId);
      const access = await getJourneyAccessForStudent(student);
      if ((access?.courseDay ?? 0) < set.courseDay) return true;
    } catch { /* allow */ }
  }

  const student = await loadStudent(studentId);
  const keys = studentTargetBatchKeys(student);
  const batchKeys = set.targetBatchKeys || [];
  if (batchKeys.length && !keys.some((k) => batchKeys.includes(k))) return true;
  return false;
}

module.exports = { buildStudentFilter, isGated, hasArenaAccess };
