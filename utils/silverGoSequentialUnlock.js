/**
 * Silver GO students unlock journey day N+1 content only after day N is fully complete:
 * class recordings (≥90% watch), digital exercises, and DG Bot — not learning modules or live attendance.
 */

const User = require('../models/User');
const { allStudentBatchStringsForContent } = require('./effectiveStudentBatch');
const { isSilverGoStudent } = require('./goSilverTrack');
const { computeJourneyDayCompletion } = require('../services/journeyDayCompletion.service');
const { withJourneyLevelInSet } = require('../services/journeyLevelSync.service');
const { SILVER_GO_RECORDING_WATCH_RATIO, recordingWatchCountsAsComplete } = require('./recordingWatchCompletion');

function normalizeCourseDay(d) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(200, Math.max(1, n));
}

function silverGoCompletionOptions(student) {
  return {
    includeRecordings: true,
    includeDg: true,
    includeLiveClasses: false,
    includeLearningModules: false,
    recordingWatchRatio: SILVER_GO_RECORDING_WATCH_RATIO,
    studentLevel: student?.level,
    studentPlan: student?.subscription,
    goStatus: student?.goStatus,
    subscription: student?.subscription
  };
}

/**
 * Highest journey day whose content the student may access.
 * Scans backward from currentCourseDay for the first incomplete prior day.
 */
async function resolveSilverGoContentUnlock(student) {
  if (student?._resolveSilverGoCache) return student._resolveSilverGoCache;

  const batchKeys = allStudentBatchStringsForContent(student);
  const currentCourseDay = normalizeCourseDay(student?.currentCourseDay);
  const studentId = student?._id || student?.id;

  if (!isSilverGoStudent(student) || !batchKeys.length || !studentId) {
    const result = {
      isSilverGo: false,
      currentCourseDay,
      maxUnlockedContentDay: currentCourseDay,
      batchKeys
    };
    if (student) student._resolveSilverGoCache = result;
    return result;
  }

  let maxUnlockedContentDay = currentCourseDay;
  const opts = silverGoCompletionOptions(student);

  for (let d = maxUnlockedContentDay - 1; d >= 1; d--) {
    const completion = await computeJourneyDayCompletion(studentId, batchKeys, d, opts);
    if (!completion.complete) {
      maxUnlockedContentDay = d;
      break;
    }
  }

  const result = {
    isSilverGo: true,
    currentCourseDay,
    maxUnlockedContentDay,
    batchKeys
  };
  if (student) student._resolveSilverGoCache = result;
  return result;
}

/** Pull inflated currentCourseDay back to the first incomplete day (never increases). */
async function reconcileSilverGoCourseDay(studentId) {
  const student = await User.findById(studentId)
    .select('role batch goStatus subscription level currentCourseDay')
    .lean();
  if (!student || !isSilverGoStudent(student)) {
    return { adjusted: false };
  }

  const { maxUnlockedContentDay, currentCourseDay } = await resolveSilverGoContentUnlock(student);
  if (maxUnlockedContentDay >= currentCourseDay) {
    return { adjusted: false, maxUnlockedContentDay, currentCourseDay };
  }

  const result = await User.updateOne(
    { _id: studentId, role: 'STUDENT', currentCourseDay },
    {
      $set: withJourneyLevelInSet(
        maxUnlockedContentDay,
        {
          currentCourseDay: maxUnlockedContentDay,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        },
        { student }
      )
    }
  );

  return {
    adjusted: result.modifiedCount > 0,
    maxUnlockedContentDay,
    previousCourseDay: currentCourseDay
  };
}

/** True when every day strictly before `day` is complete (Silver GO gate before advancing). */
async function allPriorJourneyDaysComplete(studentId, student, day) {
  const targetDay = normalizeCourseDay(day);
  if (!isSilverGoStudent(student)) return true;
  const { maxUnlockedContentDay, currentCourseDay } = await resolveSilverGoContentUnlock(student);
  return maxUnlockedContentDay >= Math.min(currentCourseDay, targetDay);
}

module.exports = {
  SILVER_GO_RECORDING_WATCH_RATIO,
  normalizeCourseDay,
  recordingWatchCountsAsComplete,
  silverGoCompletionOptions,
  resolveSilverGoContentUnlock,
  reconcileSilverGoCourseDay,
  allPriorJourneyDaysComplete
};
