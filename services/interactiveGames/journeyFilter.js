// services/interactiveGames/journeyFilter.js
// GlückArena: journey day + batch targeting (mirrors Learning Modules / DG Bot)

const GameSet = require('../../models/GameSet');
const User = require('../../models/User');
const { getJourneyAccessForStudent } = require('../../utils/studentJourneyAccess');
const {
  minimumAssignedContentDay,
  studentAssignedCourseDayOrClause,
  TRIAL_JOURNEY_DAY,
} = require('../../utils/journeyDay');
const { studentTargetBatchKeys, moduleTargetingQuery } = require('../../utils/batchTargeting');
const {
  appendNotBlockedToAndClauses,
  isContentBlockedForStudent
} = require('../../utils/journeyContentBlock');

async function loadStudent(studentId) {
  return User.findById(studentId).select('batch level subscription goStatus currentCourseDay blockedJourneyLevels role').lean();
}

/**
 * Build a Mongoose filter for visible game sets for this student.
 */
async function buildStudentFilter(studentId) {
  try {
    const student = await loadStudent(studentId);
    const access = await getJourneyAccessForStudent(student);
    const onTrialDay =
      !!access?.trialDayEnabled && Number(access?.courseDay) === TRIAL_JOURNEY_DAY;
    const courseDay = onTrialDay
      ? TRIAL_JOURNEY_DAY
      : (access?.contentUnlockDay ?? access?.courseDay ?? 0);
    const minDay = minimumAssignedContentDay(student, access?.trialDayEnabled);
    const batchKeys = studentTargetBatchKeys(student);

    const andClauses = [
      studentAssignedCourseDayOrClause(courseDay, minDay),
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

  if (set.courseDay != null && set.courseDay !== undefined) {
    try {
      const student = await loadStudent(studentId);
      const access = await getJourneyAccessForStudent(student);
      const minDay = minimumAssignedContentDay(student, access?.trialDayEnabled);
      const onTrialDay =
        !!access?.trialDayEnabled && Number(access?.courseDay) === TRIAL_JOURNEY_DAY;
      const unlockDay = onTrialDay
        ? TRIAL_JOURNEY_DAY
        : (access?.contentUnlockDay ?? access?.courseDay ?? 0);
      const n = Number(set.courseDay);
      if (Number.isFinite(n) && n < minDay) return true;
      if (unlockDay < n) return true;
    } catch { /* allow */ }
  }

  const student = await loadStudent(studentId);
  const keys = studentTargetBatchKeys(student);
  const batchKeys = set.targetBatchKeys || [];
  if (batchKeys.length && !keys.some((k) => batchKeys.includes(k))) return true;
  return false;
}

module.exports = { buildStudentFilter, isGated, hasArenaAccess };
