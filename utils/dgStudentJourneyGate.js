const User = require('../models/User');
const { getJourneyAccessForStudent } = require('./studentJourneyAccess');
const {
  computeDgUnlockedWeek,
  dgModuleUnlockedForWeekly,
  weekDayRange,
} = require('./oldBatchDgWeekAccess');

/**
 * Journey + batch access for DG Bot student routes (aligned with digital exercises).
 */
async function getStudentDgJourneyAccess(userId) {
  const u = await User.findById(userId)
    .select('currentCourseDay role level batch goStatus subscription')
    .lean();
  if (!u || String(u.role || '').toUpperCase() !== 'STUDENT') {
    return {
      enabled: true,
      learningEnabled: true,
      dgBotEnabled: true,
      unlockMode: 'daily',
      dgUnlockedWeek: 29,
      courseDay: 1,
      batchKeys: [],
    };
  }
  const journeyAccess = await getJourneyAccessForStudent(u);
  const unlockMode = journeyAccess.dgUnlockMode === 'weekly' ? 'weekly' : 'daily';
  let dgUnlockedWeek = 1;
  if (unlockMode === 'weekly' && journeyAccess.dgBotEnabled) {
    dgUnlockedWeek = await computeDgUnlockedWeek(userId, journeyAccess.batchKeys || []);
  } else if (unlockMode === 'daily') {
    dgUnlockedWeek = Math.ceil((journeyAccess.courseDay || 1) / 7);
  }

  return {
    enabled: journeyAccess.enabled,
    learningEnabled: journeyAccess.learningEnabled !== false,
    dgBotEnabled: journeyAccess.dgBotEnabled !== false,
    unlockMode,
    dgUnlockedWeek,
    courseDay: journeyAccess.courseDay,
    batchKeys: journeyAccess.batchKeys || [],
  };
}

/** Unassigned journey day = always visible once published; otherwise unlocked up to current day. */
function dgModuleUnlockedForStudentDay(moduleCourseDay, studentCourseDay) {
  const cd = moduleCourseDay;
  if (cd == null || cd === undefined) return true;
  const n = Number(cd);
  if (!Number.isFinite(n)) return true;
  return n <= Number(studentCourseDay);
}

/**
 * Central unlock check using access from getStudentDgJourneyAccess.
 */
function dgModuleUnlockedForAccess(access, moduleCourseDay) {
  if (!access || access.dgBotEnabled === false) return false;
  if (access.unlockMode === 'weekly') {
    return dgModuleUnlockedForWeekly(moduleCourseDay, access.dgUnlockedWeek ?? 1);
  }
  return dgModuleUnlockedForStudentDay(moduleCourseDay, access.courseDay);
}

function dgWeekLockMessage(access, moduleCourseDay) {
  const cd = moduleCourseDay;
  if (cd == null || cd === undefined) return null;
  const n = Number(cd);
  if (!Number.isFinite(n)) return null;
  const requiredWeek = Math.ceil(n / 7);
  const unlocked = access.dgUnlockedWeek ?? 1;
  if (requiredWeek <= unlocked) return null;
  const range = weekDayRange(requiredWeek);
  return {
    message: `Complete all DG Bot modules for days ${weekDayRange(unlocked).start}–${weekDayRange(unlocked).end} to unlock week ${requiredWeek} (days ${range.start}–${range.end}).`,
    code: 'DG_WEEK_LOCKED',
    unlockedWeek: unlocked,
    requiredWeek,
    moduleCourseDay: n,
  };
}

module.exports = {
  getStudentDgJourneyAccess,
  dgModuleUnlockedForStudentDay,
  dgModuleUnlockedForAccess,
  dgWeekLockMessage,
};
