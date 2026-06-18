'use strict';
/**
 * Language Tracking Analytics Service
 *
 * Aggregates learning time across three surfaces only:
 *   - Digital Exercises  (ExerciseAttempt.timeSpentSeconds)
 *   - DG Bot             (DGSession time via dgSessionMetrics)
 *   - GlückArena         (GameAttempt.timeSpentSeconds)
 *
 * Reuses cohort/batch resolution from portalAnalytics.service.js to keep
 * platinum/go definitions consistent across the entire admin.
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGSession = require('../models/DGSession');
const GameAttempt = require('../models/GameAttempt');
const { EXCLUDE_TEST, batchMatchFilters } = require('../utils/analyticsFilters');
const { totalSessionMinutes } = require('../utils/dgSessionMetrics');
const { effectiveTimeSpentSeconds, MAX_ATTEMPT_SECONDS } = require('../utils/exerciseAttemptMetrics');
const {
  getAnalyticsFilterOptions,
  parseDateRange,
} = require('./portalAnalytics.service');
const { goBatchForStudent } = require('../utils/goSilverTrack');
const { journeyWeekFromDay, weekDayRange } = require('../utils/oldBatchDgWeekAccess');

// ── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Parse `from` / `to` from query params (ISO date strings).
 * Defaults to the last 30 days.
 */
function parseLtDateRange(query) {
  const result = parseDateRange(query);
  // parseDateRange returns { from, to } as Date objects
  return result;
}

// ── Core aggregations ────────────────────────────────────────────────────────

const TZ = 'Asia/Kolkata';

/** Sum effective exercise time grouped by studentId within [from, to].
 *  Returns { byStudent, byDay } from a single aggregation pipeline. */
async function aggregateExerciseSeconds(from, to, studentIds) {
  const match = {
    startedAt: { $gte: from, $lte: to },
  };
  if (studentIds) match.studentId = { $in: studentIds };

  const results = await ExerciseAttempt.aggregate([
    { $match: match },
    {
      $facet: {
        byStudent: [
          { $match: { status: 'completed', timeSpentSeconds: { $gt: 0 } } },
          {
            $group: {
              _id: '$studentId',
              seconds: { $sum: { $min: ['$timeSpentSeconds', MAX_ATTEMPT_SECONDS] } },
              attempts: { $sum: 1 },
              lastAt: { $max: '$startedAt' },
            },
          },
        ],
        byDay: [
          { $match: { status: 'completed', timeSpentSeconds: { $gt: 0 } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: TZ } },
              seconds: { $sum: { $min: ['$timeSpentSeconds', MAX_ATTEMPT_SECONDS] } },
            },
          },
        ],
      },
    },
  ]);

  const { byStudent = [], byDay = [] } = results[0] || {};
  return { byStudent, byDay };
}

/** Sum DGSession time in seconds grouped by studentId within [from, to].
 *  Returns { byStudent, byDay } from a single pass (computation requires JS). */
async function aggregateDGSeconds(from, to, studentIds) {
  const match = {
    createdAt: { $gte: from, $lte: to },
  };
  if (studentIds) match.studentId = { $in: studentIds };

  const sessions = await DGSession.find(match)
    .select('studentId timePerSceneMs logs createdAt updatedAt completed moduleId')
    .lean();

  const byStudent = {};
  const byDay = {};

  for (const s of sessions) {
    const sid = String(s.studentId);
    const secs = totalSessionMinutes(s) * 60;
    if (secs <= 0) continue;

    if (!byStudent[sid]) byStudent[sid] = { seconds: 0, sessions: 0, lastAt: null };
    byStudent[sid].seconds += secs;
    byStudent[sid].sessions += 1;
    const at = s.createdAt ? new Date(s.createdAt) : null;
    if (at && (!byStudent[sid].lastAt || at > byStudent[sid].lastAt)) byStudent[sid].lastAt = at;

    const key = new Date(s.createdAt).toLocaleDateString('en-CA', { timeZone: TZ });
    byDay[key] = (byDay[key] || 0) + secs;
  }

  return {
    byStudent: Object.entries(byStudent).map(([id, v]) => ({
      _id: new mongoose.Types.ObjectId(id),
      seconds: Math.round(v.seconds),
      attempts: v.sessions,
      lastAt: v.lastAt,
    })),
    byDay: Object.entries(byDay).map(([key, seconds]) => ({ _id: key, seconds: Math.round(seconds) })),
  };
}

/** Sum GameAttempt.timeSpentSeconds grouped by studentId within [from, to].
 *  Returns { byStudent, byDay } from a single aggregation pipeline. */
async function aggregateArenaSeconds(from, to, studentIds) {
  const match = {
    startedAt: { $gte: from, $lte: to },
  };
  if (studentIds) match.studentId = { $in: studentIds };

  const results = await GameAttempt.aggregate([
    { $match: match },
    {
      $facet: {
        byStudent: [
          {
            $group: {
              _id: '$studentId',
              seconds: { $sum: '$timeSpentSeconds' },
              attempts: { $sum: 1 },
              lastAt: { $max: '$startedAt' },
            },
          },
        ],
        byDay: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$startedAt', timezone: TZ } },
              seconds: { $sum: '$timeSpentSeconds' },
            },
          },
        ],
      },
    },
  ]);

  const { byStudent = [], byDay = [] } = results[0] || {};
  return { byStudent, byDay };
}

// ── Daily trend builder ──────────────────────────────────────────────────────

/**
 * Merges per-source day arrays into a unified sorted trend.
 * Each source should be an array of { _id: 'YYYY-MM-DD', seconds }.
 */
function buildTrendFromDayData(exerciseDays, dgDays, arenaDays) {
  const dateSet = new Set([
    ...exerciseDays.map((d) => d._id),
    ...dgDays.map((d) => d._id),
    ...arenaDays.map((d) => d._id),
  ]);

  if (!dateSet.size) return [];

  const exMap = Object.fromEntries(exerciseDays.map((d) => [d._id, d.seconds]));
  const dgMap = Object.fromEntries(dgDays.map((d) => [d._id, d.seconds]));
  const arMap = Object.fromEntries(arenaDays.map((d) => [d._id, d.seconds]));

  return [...dateSet].sort().map((date) => ({
    date,
    exercises: exMap[date] || 0,
    digibot: dgMap[date] || 0,
    arena: arMap[date] || 0,
    total: (exMap[date] || 0) + (dgMap[date] || 0) + (arMap[date] || 0),
  }));
}

/**
 * Backward-compatible wrapper: queries all three sources and builds the trend.
 * Used by external callers that still pass (from, to, studentIds).
 */
async function getDailyTrend(from, to, studentIds) {
  const [exData, dgData, arData] = await Promise.all([
    aggregateExerciseSeconds(from, to, studentIds),
    aggregateDGSeconds(from, to, studentIds),
    aggregateArenaSeconds(from, to, studentIds),
  ]);
  return buildTrendFromDayData(exData.byDay, dgData.byDay, arData.byDay);
}

// ── Student search ───────────────────────────────────────────────────────────

/**
 * Builds a MongoDB filter for free-text search across profile fields.
 * Supports multi-word queries (each word must match at least one field).
 */
function buildStudentSearchFilter(search) {
  const trimmed = String(search || '').trim();
  if (!trimmed) return null;

  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  const tokenClause = (token) => {
    const re = new RegExp(escape(token), 'i');
    const or = [{ name: re }, { email: re }, { regNo: re }, { batch: re }, { level: re }];
    if (/go[- ]?silver/i.test(token)) {
      or.push({ goStatus: 'GO', subscription: 'SILVER' });
    } else if (/^go$/i.test(token)) {
      or.push({ goStatus: 'GO' });
    } else if (/^platinum$/i.test(token)) {
      or.push({ subscription: 'PLATINUM', goStatus: { $ne: 'GO' } });
    }
    return { $or: or };
  };

  if (tokens.length === 1) return tokenClause(tokens[0]);
  return { $and: tokens.map(tokenClause) };
}

// ── Main overview aggregation ─────────────────────────────────────────────────

/**
 * Returns KPIs + paginated student rows.
 *
 * @param {object} opts
 * @param {string} opts.from      ISO date
 * @param {string} opts.to        ISO date
 * @param {string} [opts.cohort]  'overall' | 'platinum' | 'go'
 * @param {string} [opts.batch]
 * @param {string} [opts.level]
 * @param {string} [opts.search]  name / email / regNo partial match
 * @param {number} [opts.page]
 * @param {number} [opts.limit]
 * @param {string} [opts.sort]    'totalSeconds' | 'name' | 'currentCourseDay' | 'completionPercent'
 */
async function getOverview(opts = {}) {
  const { from, to } = parseLtDateRange(opts);
  const cohort = opts.cohort || 'overall';
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 25));
  const sortField = opts.sort || 'totalSeconds';
  const includeTest = opts.includeTestAccounts === true || opts.includeTestAccounts === 'true';

  // 1. Build the student filter once — merges cohort/batch/level/search into a single query
  const studentFilter = {
    role: 'STUDENT',
    ...(includeTest ? {} : EXCLUDE_TEST),
  };

  if (cohort === 'platinum') {
    studentFilter.subscription = 'PLATINUM';
    studentFilter.goStatus = { $ne: 'GO' };
  } else if (cohort === 'go') {
    studentFilter.goStatus = 'GO';
  }

  const batchFilter = batchMatchFilters(opts.batch);
  if (batchFilter) studentFilter.batch = batchFilter;

  if (opts.level) {
    const levelVal = String(opts.level || '').trim().toUpperCase();
    if (['A1','A2','B1','B2','C1','C2'].includes(levelVal)) {
      studentFilter.level = levelVal;
    }
  }

  const searchFilter = buildStudentSearchFilter(opts.search);
  if (searchFilter) Object.assign(studentFilter, searchFilter);

  // 2. Single User query — no more separate resolveStudentIds call
  const students = await User.find(studentFilter)
    .select('_id name email regNo batch level subscription goStatus currentCourseDay isTestAccount')
    .lean();

  const studentIds = students.map((s) => s._id);

  if (!studentIds.length) {
    return {
      kpis: { totalLearningHours: 0, activeStudents: 0, avgMinutesPerStudent: 0, topSource: 'exercises' },
      trend: [],
      students: [],
      total: 0,
      page,
      limit,
    };
  }

  // 3. Parallel aggregations — each returns { byStudent, byDay }
  const [exData, dgData, arData] = await Promise.all([
    aggregateExerciseSeconds(from, to, studentIds),
    aggregateDGSeconds(from, to, studentIds),
    aggregateArenaSeconds(from, to, studentIds),
  ]);

  // 4. Build trend from day data (no separate queries)
  const trend = buildTrendFromDayData(exData.byDay, dgData.byDay, arData.byDay);

  // 5. Merge per-student data
  const merged = {};
  const init = (sid) => {
    if (!merged[sid]) merged[sid] = { exercisesSeconds: 0, digibotSeconds: 0, arenaSeconds: 0, lastLearningAt: null };
  };

  for (const r of exData.byStudent) {
    const sid = String(r._id);
    init(sid);
    merged[sid].exercisesSeconds = r.seconds || 0;
    if (r.lastAt && (!merged[sid].lastLearningAt || r.lastAt > merged[sid].lastLearningAt)) merged[sid].lastLearningAt = r.lastAt;
  }
  for (const r of dgData.byStudent) {
    const sid = String(r._id);
    init(sid);
    merged[sid].digibotSeconds = r.seconds || 0;
    if (r.lastAt && (!merged[sid].lastLearningAt || r.lastAt > merged[sid].lastLearningAt)) merged[sid].lastLearningAt = r.lastAt;
  }
  for (const r of arData.byStudent) {
    const sid = String(r._id);
    init(sid);
    merged[sid].arenaSeconds = r.seconds || 0;
    if (r.lastAt && (!merged[sid].lastLearningAt || r.lastAt > merged[sid].lastLearningAt)) merged[sid].lastLearningAt = r.lastAt;
  }

  // 6. Build flat rows for all students (include those with zero time)
  let rows = students.map((s) => {
    const sid = String(s._id);
    const m = merged[sid] || { exercisesSeconds: 0, digibotSeconds: 0, arenaSeconds: 0, lastLearningAt: null };
    const totalSeconds = m.exercisesSeconds + m.digibotSeconds + m.arenaSeconds;
    return {
      studentId: sid,
      name: s.name,
      email: s.email,
      regNo: s.regNo,
      batch: s.batch || (s.goStatus === 'GO' && s.subscription === 'SILVER' ? goBatchForStudent(s) : ''),
      level: s.level,
      subscription: s.subscription,
      goStatus: s.goStatus || null,
      currentCourseDay: s.currentCourseDay || 1,
      totalSeconds,
      exercisesSeconds: m.exercisesSeconds,
      digibotSeconds: m.digibotSeconds,
      arenaSeconds: m.arenaSeconds,
      lastLearningAt: m.lastLearningAt,
      isTestAccount: !!s.isTestAccount,
    };
  });

  // 7. Sort
  const SORT_DIRS = { totalSeconds: -1, currentCourseDay: -1, name: 1, completionPercent: -1 };
  const dir = SORT_DIRS[sortField] ?? -1;
  rows.sort((a, b) => {
    const av = a[sortField] ?? 0;
    const bv = b[sortField] ?? 0;
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });

  const total = rows.length;
  const pagedRows = rows.slice((page - 1) * limit, page * limit);
  const topStudents = [...rows]
    .sort((a, b) => b.totalSeconds - a.totalSeconds)
    .slice(0, 10);

  // 8. KPIs
  const totalSecs = rows.reduce((s, r) => s + r.totalSeconds, 0);
  const activeCount = rows.filter((r) => r.totalSeconds > 0).length;
  const avgMins = activeCount > 0 ? Math.round((totalSecs / activeCount) / 60) : 0;

  const exSecs = rows.reduce((s, r) => s + r.exercisesSeconds, 0);
  const dgSecs = rows.reduce((s, r) => s + r.digibotSeconds, 0);
  const arSecs = rows.reduce((s, r) => s + r.arenaSeconds, 0);
  const topSource = exSecs >= dgSecs && exSecs >= arSecs ? 'exercises' : dgSecs >= arSecs ? 'digibot' : 'arena';

  return {
    kpis: {
      totalLearningHours: Math.round((totalSecs / 3600) * 10) / 10,
      activeStudents: activeCount,
      totalStudents: students.length,
      avgMinutesPerStudent: avgMins,
      topSource,
      exercisesHours: Math.round((exSecs / 3600) * 10) / 10,
      digibotHours: Math.round((dgSecs / 3600) * 10) / 10,
      arenaHours: Math.round((arSecs / 3600) * 10) / 10,
    },
    trend,
    students: pagedRows,
    topStudents,
    total,
    page,
    limit,
  };
}

// ── Student detail ─────────────────────────────────────────────────────────────

/**
 * Full per-student breakdown:
 *   - Recent exercise attempts (last 20)
 *   - DG Bot sessions (last 20)
 *   - Arena attempts (last 20)
 *   - Current journey day completion via journeyDayCompletion
 */
async function getStudentDetail(studentId, opts = {}) {
  const { from, to } = parseLtDateRange(opts);
  const sid = mongoose.Types.ObjectId.isValid(String(studentId))
    ? new mongoose.Types.ObjectId(String(studentId))
    : null;
  if (!sid) throw new Error('INVALID_STUDENT_ID');

  const student = await User.findById(sid)
    .select('_id name email regNo batch level subscription goStatus currentCourseDay')
    .lean();
  if (!student) throw new Error('STUDENT_NOT_FOUND');

  const dateFilter = { studentId: sid, startedAt: { $gte: from, $lte: to } };
  const dgDateFilter = { studentId: sid, createdAt: { $gte: from, $lte: to } };

  const [exerciseAttempts, dgSessions, arenaAttempts] = await Promise.all([
    ExerciseAttempt.find(dateFilter)
      .sort({ startedAt: -1 })
      .limit(20)
      .populate('exerciseId', 'title')
      .lean(),
    DGSession.find(dgDateFilter)
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('moduleId', 'title')
      .lean(),
    GameAttempt.find({ studentId: sid, startedAt: { $gte: from, $lte: to } })
      .sort({ startedAt: -1 })
      .limit(20)
      .lean(),
  ]);

  // Time totals
  const exercisesSeconds = exerciseAttempts.reduce(
    (s, a) => s + effectiveTimeSpentSeconds(a),
    0,
  );
  const digibotSeconds = dgSessions.reduce((s, sess) => s + totalSessionMinutes(sess) * 60, 0);
  const arenaSeconds = arenaAttempts.reduce((s, a) => s + (a.timeSpentSeconds || 0), 0);

  // Journey day completion for currentCourseDay
  let dayCompletion = null;
  const batchForCompletion = student.batch || (student.goStatus === 'GO' && student.subscription === 'SILVER'
    ? goBatchForStudent(student)
    : '');
  if (batchForCompletion) {
    try {
      const day = student.currentCourseDay || 1;
      // Lazy require avoids circular dependency issues at module load time
      // eslint-disable-next-line global-require
      const { computeJourneyDayCompletion } = require('./journeyDayCompletion.service');
      dayCompletion = await computeJourneyDayCompletion(sid, batchForCompletion, day, {
        includeRecordings: false,
        includeDg: true,
        studentLevel: student.level || '',
        studentPlan: student.subscription || '',
        goStatus: student.goStatus || '',
      });
    } catch (err) {
      console.warn('[language-tracking] dayCompletion failed', String(sid), err.message);
    }
  }

  return {
    student: {
      studentId: String(student._id),
      name: student.name,
      email: student.email,
      regNo: student.regNo,
      batch: student.batch || '',
      level: student.level,
      subscription: student.subscription,
      goStatus: student.goStatus || null,
      currentCourseDay: student.currentCourseDay || 1,
    },
    timeSummary: {
      exercisesSeconds: Math.round(exercisesSeconds),
      digibotSeconds: Math.round(digibotSeconds),
      arenaSeconds: Math.round(arenaSeconds),
      totalSeconds: Math.round(exercisesSeconds + digibotSeconds + arenaSeconds),
    },
    dayCompletion: dayCompletion
      ? {
          day: student.currentCourseDay || 1,
          complete: dayCompletion.complete,
          completionPercent: dayCompletion.completionPercent,
          doneTasks: dayCompletion.doneTasks,
          totalTasks: dayCompletion.totalTasks,
          incompleteTasks: dayCompletion.incompleteTasks || [],
          breakdown: dayCompletion.breakdown || {},
        }
      : null,
    sessions: {
      exercises: exerciseAttempts.map((a) => ({
        id: String(a._id),
        title: a.exerciseId?.title || 'Exercise',
        startedAt: a.startedAt,
        completedAt: a.completedAt || null,
        status: a.status,
        timeSpentSeconds: effectiveTimeSpentSeconds(a),
        scorePercentage: a.scorePercentage || 0,
      })),
      digibot: dgSessions.map((s) => ({
        id: String(s._id),
        title: s.moduleId?.title || 'DG Bot',
        startedAt: s.createdAt,
        completedAt: s.completedAt || null,
        completed: !!s.completed,
        timeSpentSeconds: Math.round(totalSessionMinutes(s) * 60),
        score: s.score || 0,
      })),
      arena: arenaAttempts.map((a) => ({
        id: String(a._id),
        gameType: a.gameType,
        startedAt: a.startedAt,
        completedAt: a.completedAt || null,
        status: a.status,
        timeSpentSeconds: a.timeSpentSeconds || 0,
        score: a.score || 0,
        xpEarned: a.xpEarned || 0,
        accuracy: a.accuracy || 0,
      })),
    },
  };
}

// ── Journey week / day (admin) ───────────────────────────────────────────────

function resolveBatchForCompletion(student) {
  if (student.batch) return String(student.batch);
  if (student.goStatus === 'GO' && student.subscription === 'SILVER') return goBatchForStudent(student);
  return '';
}

function mapDayCompletionPayload(completion, day) {
  if (!completion) return null;
  const classBreakdown = completion.breakdown?.classes || { done: 0, total: 0 };
  const incompleteTasks = (completion.incompleteTasks || []).filter((t) => t.kind !== 'class');
  return {
    day,
    complete: completion.complete,
    completionPercent: completion.completionPercent,
    doneTasks: completion.doneTasks - (classBreakdown.done || 0),
    totalTasks: completion.totalTasks - (classBreakdown.total || 0),
    incompleteTasks,
    breakdown: completion.breakdown || {},
  };
}

async function loadStudentForJourney(studentId) {
  const sid = mongoose.Types.ObjectId.isValid(String(studentId))
    ? new mongoose.Types.ObjectId(String(studentId))
    : null;
  if (!sid) throw new Error('INVALID_STUDENT_ID');
  const student = await User.findById(sid)
    .select('_id name email regNo batch level subscription goStatus currentCourseDay')
    .lean();
  if (!student) throw new Error('STUDENT_NOT_FOUND');
  return { sid, student };
}

async function computeDayCompletionForStudent(student, day) {
  const { computeJourneyDayCompletion } = require('./journeyDayCompletion.service');
  const batchForCompletion = resolveBatchForCompletion(student);
  const completion = await computeJourneyDayCompletion(student._id, batchForCompletion, day, {
    includeRecordings: false,
    includeDg: true,
    studentLevel: student.level || '',
    studentPlan: student.subscription || '',
    goStatus: student.goStatus || '',
  });
  return mapDayCompletionPayload(completion, day);
}

/**
 * Completion summary for each day in a journey week (days 1–7, 8–14, …).
 */
async function getStudentWeekSummary(studentId, weekNum) {
  const { student } = await loadStudentForJourney(studentId);
  const currentCourseDay = student.currentCourseDay || 1;
  const currentWeek = journeyWeekFromDay(currentCourseDay);
  const week = Math.max(1, Math.min(Math.floor(Number(weekNum) || 1), currentWeek));
  const { start, end } = weekDayRange(week);

  const futureDays = [];
  const activeDays = [];
  for (let day = start; day <= end; day += 1) {
    if (day > currentCourseDay) {
      futureDays.push({ day, isFuture: true, complete: false, completionPercent: 0, doneTasks: 0, totalTasks: 0, incompleteCount: 0 });
    } else {
      activeDays.push(day);
    }
  }

  const dayResults = await Promise.all(
    activeDays.map(async (day) => {
      try {
        const payload = await computeDayCompletionForStudent(student, day);
        return { day, isFuture: false, complete: payload.complete, completionPercent: payload.completionPercent, doneTasks: payload.doneTasks, totalTasks: payload.totalTasks, incompleteCount: payload.incompleteTasks.length };
      } catch (err) {
        console.warn('[language-tracking] week day completion failed', String(student._id), day, err.message);
        return { day, isFuture: false, complete: false, completionPercent: 0, doneTasks: 0, totalTasks: 0, incompleteCount: 0, error: true };
      }
    }),
  );

  const days = [...dayResults, ...futureDays].sort((a, b) => a.day - b.day);

  return {
    student: {
      studentId: String(student._id),
      name: student.name,
      regNo: student.regNo,
      batch: student.batch || '',
      level: student.level,
      currentCourseDay,
    },
    week,
    weekStartDay: start,
    weekEndDay: end,
    currentWeek,
    days,
  };
}

/**
 * Full task list for a specific journey day (any day up to currentCourseDay).
 */
async function getStudentDayDetail(studentId, dayNum) {
  const { student } = await loadStudentForJourney(studentId);
  const currentCourseDay = student.currentCourseDay || 1;
  const day = Math.max(1, Math.floor(Number(dayNum) || 1));
  if (day > currentCourseDay) {
    const err = new Error('DAY_NOT_REACHED');
    err.day = day;
    err.currentCourseDay = currentCourseDay;
    throw err;
  }

  let dayCompletion = null;
  try {
    dayCompletion = await computeDayCompletionForStudent(student, day);
  } catch (_) {
    dayCompletion = null;
  }

  return {
    student: {
      studentId: String(student._id),
      name: student.name,
      email: student.email,
      regNo: student.regNo,
      batch: student.batch || '',
      level: student.level,
      currentCourseDay,
    },
    dayCompletion,
  };
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  getOverview,
  getStudentDetail,
  getStudentWeekSummary,
  getStudentDayDetail,
  getDailyTrend,
  getAnalyticsFilterOptions,
  parseLtDateRange,
};
