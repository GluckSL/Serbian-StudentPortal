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
const { EXCLUDE_TEST, batchMatchFilter } = require('../utils/analyticsFilters');
const { totalSessionMinutes } = require('../utils/dgSessionMetrics');
const {
  resolveAnalyticsStudentIds,
  getAnalyticsFilterOptions,
  parseDateRange,
} = require('./portalAnalytics.service');

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

// ── Cohort / filter resolution ────────────────────────────────────────────────

/**
 * Resolves the set of student ObjectIds that match the given filters.
 * Extends portal-analytics cohort rules to also exclude test accounts.
 */
async function resolveStudentIds({ cohort, batch, level } = {}) {
  return resolveAnalyticsStudentIds({ cohort, batch, level });
}

// ── Core aggregations ────────────────────────────────────────────────────────

/** Sum ExerciseAttempt.timeSpentSeconds grouped by studentId within [from, to]. */
async function aggregateExerciseSeconds(from, to, studentIds) {
  const match = {
    startedAt: { $gte: from, $lte: to },
    ...EXCLUDE_TEST_LOOKUP_SKIP,
  };
  if (studentIds) match.studentId = { $in: studentIds };

  return ExerciseAttempt.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$studentId',
        seconds: { $sum: '$timeSpentSeconds' },
        attempts: { $sum: 1 },
        lastAt: { $max: '$startedAt' },
      },
    },
  ]);
}

/** Sum DGSession time in seconds grouped by studentId within [from, to]. */
async function aggregateDGSeconds(from, to, studentIds) {
  const match = {
    createdAt: { $gte: from, $lte: to },
  };
  if (studentIds) match.studentId = { $in: studentIds };

  const sessions = await DGSession.find(match)
    .select('studentId timePerSceneMs logs createdAt updatedAt completed moduleId')
    .lean();

  const byStudent = {};
  for (const s of sessions) {
    const sid = String(s.studentId);
    const secs = totalSessionMinutes(s) * 60;
    if (!byStudent[sid]) byStudent[sid] = { seconds: 0, sessions: 0, lastAt: null };
    byStudent[sid].seconds += secs;
    byStudent[sid].sessions += 1;
    const at = s.createdAt ? new Date(s.createdAt) : null;
    if (at && (!byStudent[sid].lastAt || at > byStudent[sid].lastAt)) byStudent[sid].lastAt = at;
  }

  return Object.entries(byStudent).map(([id, v]) => ({
    _id: new mongoose.Types.ObjectId(id),
    seconds: Math.round(v.seconds),
    attempts: v.sessions,
    lastAt: v.lastAt,
  }));
}

/** Sum GameAttempt.timeSpentSeconds grouped by studentId within [from, to]. */
async function aggregateArenaSeconds(from, to, studentIds) {
  const match = {
    startedAt: { $gte: from, $lte: to },
  };
  if (studentIds) match.studentId = { $in: studentIds };

  return GameAttempt.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$studentId',
        seconds: { $sum: '$timeSpentSeconds' },
        attempts: { $sum: 1 },
        lastAt: { $max: '$startedAt' },
      },
    },
  ]);
}

// Not a real exclusion since we exclude at the student-resolution level;
// but kept as sentinel for clarity.
const EXCLUDE_TEST_LOOKUP_SKIP = {};

// ── Daily trend (line chart data) ────────────────────────────────────────────

/**
 * Returns an array of daily totals { date: 'YYYY-MM-DD', exercises, digibot, arena, total }
 * within [from, to] for the resolved student set.
 */
async function getDailyTrend(from, to, studentIds) {
  function bucketPipeline(Model, dateField) {
    const match = { [dateField]: { $gte: from, $lte: to } };
    if (studentIds) match.studentId = { $in: studentIds };
    return Model.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: `$${dateField}`, timezone: 'Asia/Kolkata' },
          },
          seconds: { $sum: '$timeSpentSeconds' },
        },
      },
    ]);
  }

  const [exerciseDays, arenaDays, dgSessions] = await Promise.all([
    bucketPipeline(ExerciseAttempt, 'startedAt'),
    bucketPipeline(GameAttempt, 'startedAt'),
    (async () => {
      const dgMatch = { createdAt: { $gte: from, $lte: to } };
      if (studentIds) dgMatch.studentId = { $in: studentIds };
      const sessions = await DGSession.find(dgMatch)
        .select('timePerSceneMs logs createdAt updatedAt')
        .lean();
      const byDay = {};
      for (const s of sessions) {
        const secs = totalSessionMinutes(s) * 60;
        const key = new Date(s.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        byDay[key] = (byDay[key] || 0) + secs;
      }
      return Object.entries(byDay).map(([_id, seconds]) => ({ _id, seconds: Math.round(seconds) }));
    })(),
  ]);

  // Collect all dates
  const dateSet = new Set([
    ...exerciseDays.map((d) => d._id),
    ...arenaDays.map((d) => d._id),
    ...dgSessions.map((d) => d._id),
  ]);

  const exMap = Object.fromEntries(exerciseDays.map((d) => [d._id, d.seconds]));
  const arMap = Object.fromEntries(arenaDays.map((d) => [d._id, d.seconds]));
  const dgMap = Object.fromEntries(dgSessions.map((d) => [d._id, d.seconds]));

  return [...dateSet].sort().map((date) => ({
    date,
    exercises: exMap[date] || 0,
    digibot: dgMap[date] || 0,
    arena: arMap[date] || 0,
    total: (exMap[date] || 0) + (dgMap[date] || 0) + (arMap[date] || 0),
  }));
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

  // 1. Resolve cohort student IDs
  const cohortIds = await resolveStudentIds({
    cohort: cohort === 'overall' ? undefined : cohort,
    batch: opts.batch,
    level: opts.level,
  });

  // 2. Pull base student list with profile data (include test accounts unless explicitly hidden)
  const includeTest = opts.includeTestAccounts !== false;
  const studentFilter = {
    role: 'STUDENT',
    ...(includeTest ? {} : EXCLUDE_TEST),
  };
  if (cohortIds !== null) studentFilter._id = { $in: cohortIds };

  const batchRx = batchMatchFilter(opts.batch);
  if (batchRx) studentFilter.batch = batchRx;

  const searchFilter = buildStudentSearchFilter(opts.search);
  if (searchFilter) Object.assign(studentFilter, searchFilter);

  const students = await User.find(studentFilter)
    .select('_id name email regNo batch level subscription goStatus currentCourseDay isTestAccount')
    .lean();

  const studentIds = students.map((s) => s._id);
  const studentMap = Object.fromEntries(students.map((s) => [String(s._id), s]));

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

  // 3. Parallel aggregations
  const [exerciseRows, dgRows, arenaRows, trend] = await Promise.all([
    aggregateExerciseSeconds(from, to, studentIds),
    aggregateDGSeconds(from, to, studentIds),
    aggregateArenaSeconds(from, to, studentIds),
    getDailyTrend(from, to, studentIds),
  ]);

  // 4. Merge into per-student map
  const merged = {};
  const init = (sid) => {
    if (!merged[sid]) merged[sid] = { exercisesSeconds: 0, digibotSeconds: 0, arenaSeconds: 0, lastLearningAt: null };
  };

  for (const r of exerciseRows) {
    const sid = String(r._id);
    init(sid);
    merged[sid].exercisesSeconds = r.seconds || 0;
    if (r.lastAt && (!merged[sid].lastLearningAt || r.lastAt > merged[sid].lastLearningAt)) merged[sid].lastLearningAt = r.lastAt;
  }
  for (const r of dgRows) {
    const sid = String(r._id);
    init(sid);
    merged[sid].digibotSeconds = r.seconds || 0;
    if (r.lastAt && (!merged[sid].lastLearningAt || r.lastAt > merged[sid].lastLearningAt)) merged[sid].lastLearningAt = r.lastAt;
  }
  for (const r of arenaRows) {
    const sid = String(r._id);
    init(sid);
    merged[sid].arenaSeconds = r.seconds || 0;
    if (r.lastAt && (!merged[sid].lastLearningAt || r.lastAt > merged[sid].lastLearningAt)) merged[sid].lastLearningAt = r.lastAt;
  }

  // 5. Build flat rows for all students (include those with zero time)
  let rows = students.map((s) => {
    const sid = String(s._id);
    const m = merged[sid] || { exercisesSeconds: 0, digibotSeconds: 0, arenaSeconds: 0, lastLearningAt: null };
    const totalSeconds = m.exercisesSeconds + m.digibotSeconds + m.arenaSeconds;
    return {
      studentId: sid,
      name: s.name,
      email: s.email,
      regNo: s.regNo,
      batch: s.batch || (s.goStatus === 'GO' && s.subscription === 'SILVER' ? 'GO-SILVER' : ''),
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

  // 6. Sort
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

  // 7. KPIs
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
  const exercisesSeconds = exerciseAttempts.reduce((s, a) => s + (a.timeSpentSeconds || 0), 0);
  const digibotSeconds = dgSessions.reduce((s, sess) => s + totalSessionMinutes(sess) * 60, 0);
  const arenaSeconds = arenaAttempts.reduce((s, a) => s + (a.timeSpentSeconds || 0), 0);

  // Journey day completion for currentCourseDay
  let dayCompletion = null;
  try {
    // Lazy require avoids circular dependency issues at module load time
    // eslint-disable-next-line global-require
    const { computeJourneyDayCompletion } = require('./journeyDayCompletion.service');
    const batchForCompletion = student.batch || (student.goStatus === 'GO' && student.subscription === 'SILVER' ? 'GO-SILVER' : '');
    const day = student.currentCourseDay || 1;
    dayCompletion = await computeJourneyDayCompletion(sid, batchForCompletion, day, {
      includeRecordings: false,
      includeDg: true,
      studentLevel: student.level || '',
      studentPlan: student.subscription || '',
      goStatus: student.goStatus || '',
    });
  } catch (_) {
    // Non-fatal: some students may not be in an active journey batch
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
        timeSpentSeconds: a.timeSpentSeconds || 0,
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

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  getOverview,
  getStudentDetail,
  getDailyTrend,
  getAnalyticsFilterOptions,
  parseLtDateRange,
};
