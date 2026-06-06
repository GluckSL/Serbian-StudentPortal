const mongoose = require('mongoose');
const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const { moduleTargetingQuery } = require('./batchTargeting');

/** Journey week 1 = days 1–7, week 2 = 8–14, etc. */
function journeyWeekFromDay(day) {
  const n = Number(day);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.ceil(n / 7);
}

function weekDayRange(week) {
  const w = Math.max(1, Math.floor(Number(week) || 1));
  return { start: (w - 1) * 7 + 1, end: w * 7 };
}

const { clampJourneyDay } = require('./journeyDay');

function normalizeCourseDay(cd) {
  if (cd == null || cd === undefined) return null;
  const n = Number(cd);
  if (!Number.isFinite(n) || n < 0) return null;
  return clampJourneyDay(n);
}

/**
 * DG modules for a journey week, scoped to student batch keys.
 */
async function dgModulesForWeek(week, batchKeys) {
  const { start, end } = weekDayRange(week);
  return DGModule.find({
    isActive: true,
    visibleToStudents: true,
    courseDay: { $gte: start, $lte: end },
    ...moduleTargetingQuery(batchKeys),
  })
    .select('_id courseDay')
    .lean();
}

/**
 * Module IDs fully completed (hub standard).
 */
async function fullyCompletedDgModuleIds(studentId, moduleIds) {
  if (!moduleIds.length) return new Set();
  const studentOid =
    typeof studentId === 'string' && mongoose.Types.ObjectId.isValid(studentId)
      ? new mongoose.Types.ObjectId(studentId)
      : studentId;
  const ids = await DGSession.distinct('moduleId', {
    studentId: studentOid,
    moduleId: { $in: moduleIds },
    completed: true,
    $or: [{ moduleFullyComplete: true }, { moduleFullyComplete: { $exists: false } }],
  });
  return new Set((ids || []).map((id) => String(id)));
}

/**
 * True when every DG module in this week (for batch) is fully complete, or there are none.
 */
async function isDgWeekComplete(studentId, week, batchKeys) {
  const modules = await dgModulesForWeek(week, batchKeys);
  if (!modules.length) return true;
  const completed = await fullyCompletedDgModuleIds(
    studentId,
    modules.map((m) => m._id)
  );
  return modules.every((m) => completed.has(String(m._id)));
}

/**
 * First incomplete week number = max unlocked week (student may access modules in that week).
 */
async function computeDgUnlockedWeek(studentId, batchKeys) {
  let week = 1;
  const maxWeek = Math.ceil(200 / 7);
  while (week < maxWeek) {
    const complete = await isDgWeekComplete(studentId, week, batchKeys);
    if (!complete) break;
    week += 1;
  }
  return week;
}

/**
 * Whether a module is unlocked under weekly old-batch DG access.
 */
function dgModuleUnlockedForWeekly(moduleCourseDay, unlockedWeek) {
  const cd = normalizeCourseDay(moduleCourseDay);
  if (cd == null) return unlockedWeek >= 1;
  return journeyWeekFromDay(cd) <= unlockedWeek;
}

module.exports = {
  journeyWeekFromDay,
  weekDayRange,
  dgModulesForWeek,
  isDgWeekComplete,
  computeDgUnlockedWeek,
  dgModuleUnlockedForWeekly,
};
