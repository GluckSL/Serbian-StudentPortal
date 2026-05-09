const User = require('../models/User');
const { getJourneyAccessForStudent } = require('./studentJourneyAccess');

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
      courseDay: 1,
    };
  }
  const journeyAccess = await getJourneyAccessForStudent(u);
  return {
    enabled: journeyAccess.enabled,
    learningEnabled: journeyAccess.learningEnabled !== false,
    courseDay: journeyAccess.courseDay,
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

module.exports = {
  getStudentDgJourneyAccess,
  dgModuleUnlockedForStudentDay,
};
