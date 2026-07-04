// routes/batchLeaderboard.js
// Batch-scoped leaderboard for students (own batch) and admin/teacher (any batch)

const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const User = require('../models/User');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGSession = require('../models/DGSession');
const StudentLoginStreak = require('../models/StudentLoginStreak');
const XpTransaction = require('../models/XpTransaction');
const GameSet = require('../models/GameSet');
const GameAttempt = require('../models/GameAttempt');
const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const DGModule = require('../models/DGModule');
const SprechenExamModule = require('../models/SprechenExamModule');
const SprechenExamSession = require('../models/SprechenExamSession');
const BatchConfig = require('../models/BatchConfig');
const { computeJourneyDayCompletion } = require('../services/journeyDayCompletion.service');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');
const { buildStudentFilter } = require('../services/interactiveGames/journeyFilter');
const { studentTargetBatchKeys, moduleTargetingQuery } = require('../utils/batchTargeting');
const { utcMidnightMs, journeyDayRangeStart } = require('../utils/journeyDay');

const MS_PER_DAY = 86_400_000;

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function calendarDateForJourneyDay(cfg, journeyDay) {
  if (!cfg?.batchStartDate) return null;
  const trial = !!cfg.trialDayEnabled;
  const jd = Number(journeyDay);
  if (trial && jd === 0) {
    const base = cfg.trialAccessStartDate || cfg.batchStartDate;
    return new Date(utcMidnightMs(base));
  }
  const offset = trial ? jd : Math.max(0, jd - 1);
  return new Date(utcMidnightMs(cfg.batchStartDate) + offset * MS_PER_DAY);
}

function emptyTaskProgress(courseDay, period) {
  return {
    courseDay,
    period,
    liveClasses: { done: 0, total: 0 },
    exercises: { done: 0, total: 0 },
    gluckBuddy: { done: 0, total: 0 },
    arena: { done: 0, total: 0 },
  };
}

/** Glück Buddy = DG Bot practice + Sprechen speaking modules (not Glück Exam). */
async function countGluckBuddyProgress(studentId, student, days, period, start, end, journeyAccess = null) {
  const batchKeys = batchKeysFromStudent(student);
  const dgStudent = {
    batch: batchKeys[0] || '',
    goStatus: student.goStatus,
    subscription: student.subscription,
  };
  const useDateFilter = period === 'weekly';
  const includeDg = journeyAccess?.dgBotEnabled !== false;

  const dgQuery = includeDg
    ? DGModule.find({
        isActive: true,
        visibleToStudents: true,
        courseDay: { $in: days },
        ...moduleTargetingQuery(studentTargetBatchKeys(dgStudent)),
      })
        .select('_id')
        .lean()
    : Promise.resolve([]);

  const [dgModules, sprechenModules] = await Promise.all([
    dgQuery,
    SprechenExamModule.find({
      isActive: true,
      visibleToStudents: true,
      courseDay: { $in: days },
      weeklyTestEnabled: { $ne: true },
      examEnabled: { $ne: true },
    })
      .select('_id')
      .lean(),
  ]);

  const dgIds = dgModules.map((m) => m._id);
  const sprechenIds = sprechenModules.map((m) => m._id);
  const total = dgIds.length + sprechenIds.length;
  if (!total) return { done: 0, total: 0 };

  let dgDone = 0;
  let sprechenDone = 0;

  if (dgIds.length) {
    const dgMatch = { studentId, moduleId: { $in: dgIds }, completed: true };
    if (useDateFilter) dgMatch.completedAt = { $gte: start, $lte: end };
    dgDone = (await DGSession.distinct('moduleId', dgMatch)).length;
  }
  if (sprechenIds.length) {
    const spMatch = { studentId, moduleId: { $in: sprechenIds }, completed: true };
    if (useDateFilter) spMatch.completedAt = { $gte: start, $lte: end };
    sprechenDone = (await SprechenExamSession.distinct('moduleId', spMatch)).length;
  }

  return { done: dgDone + sprechenDone, total };
}

function resolveStudentCourseDay(student, trialDayEnabled = false) {
  const raw = student?.currentCourseDay;
  if (raw != null && Number.isFinite(Number(raw))) {
    const n = Number(raw);
    if (n === 0 && trialDayEnabled) return 0;
    return Math.min(200, Math.max(trialDayEnabled ? 0 : 1, Math.floor(n)));
  }
  return trialDayEnabled ? 0 : 1;
}

/** Task progress for today (single journey day). */
async function buildTodayTaskProgress(studentId, student, journeyAccess, courseDay, batchKeys) {
  const empty = emptyTaskProgress(courseDay, 'today');

  if (journeyAccess?.learningEnabled === false && journeyAccess?.dgBotEnabled === false) {
    return empty;
  }

  const completionOpts = {
    includeDg: journeyAccess?.dgBotEnabled !== false,
    includeLiveClasses: true,
    includeRecordings: false,
    studentLevel: student.level,
    studentPlan: student.subscription,
    goStatus: student.goStatus,
    subscription: student.subscription,
  };

  const [completion, arena, gluckBuddy] = await Promise.all([
    computeJourneyDayCompletion(studentId, batchKeys, courseDay, completionOpts),
    (async () => {
      try {
        const filter = await buildStudentFilter(studentId);
        const sets = await GameSet.find({ ...filter, courseDay }).select('_id').lean();
        if (!sets.length) return { done: 0, total: 0 };
        const setIds = sets.map((s) => s._id);
        const played = await GameAttempt.distinct('gameSetId', {
          studentId,
          gameSetId: { $in: setIds },
          status: 'completed',
        });
        return { done: played.length, total: sets.length };
      } catch {
        return { done: 0, total: 0 };
      }
    })(),
    countGluckBuddyProgress(studentId, student, [courseDay], 'today', null, null, journeyAccess),
  ]);

  const breakdown = completion?.breakdown || {};
  return {
    courseDay,
    period: 'today',
    liveClasses: {
      done: breakdown.classes?.done ?? 0,
      total: breakdown.classes?.total ?? 0,
    },
    exercises: {
      done: breakdown.exercises?.done ?? 0,
      total: breakdown.exercises?.total ?? 0,
    },
    gluckBuddy,
    arena,
  };
}

/** Resolve journey days that fall inside the selected leaderboard period. */
async function journeyDaysInPeriod(student, period, courseDay, trialDayEnabled, cfgOverride = undefined) {
  const minDay = journeyDayRangeStart(trialDayEnabled);
  const cappedDay = Math.min(200, Math.max(minDay, courseDay));

  if (period === 'overall') {
    const days = [];
    for (let d = minDay; d <= cappedDay; d++) days.push(d);
    return days;
  }

  if (period === 'today') {
    return [cappedDay];
  }

  // weekly — journey days whose calendar date is in this week
  const { start, end } = getDateRange('weekly');
  const batchName = student.batch || batchKeysFromStudent(student)[0];
  let cfg = cfgOverride;
  if (cfg === undefined && batchName) {
    cfg = await BatchConfig.findOne({
      batchName: new RegExp(`^${escapeRegExp(String(batchName).trim())}$`, 'i'),
    }).lean();
  }

  if (cfg?.batchStartDate) {
    const days = [];
    for (let d = minDay; d <= cappedDay; d++) {
      const cal = calendarDateForJourneyDay(cfg, d);
      if (cal && cal.getTime() >= start.getTime() && cal.getTime() <= end.getTime()) {
        days.push(d);
      }
    }
    if (days.length) return days;
  }

  // Fallback: last 7 unlocked journey days
  const weekStartDay = Math.max(minDay, cappedDay - 6);
  const days = [];
  for (let d = weekStartDay; d <= cappedDay; d++) days.push(d);
  return days;
}

/** Per-student exercise completed/total for the selected period (same pool for both). */
async function attachExerciseProgress(students, period, scores) {
  const allExercises = await DigitalExercise.find({
    isDeleted: { $ne: true },
    visibleToStudents: true,
    isActive: true,
    courseDay: { $ne: null },
  })
    .select('_id courseDay')
    .lean();

  const idsByDay = new Map();
  for (const ex of allExercises) {
    const day = Number(ex.courseDay);
    if (!Number.isFinite(day)) continue;
    if (!idsByDay.has(day)) idsByDay.set(day, new Set());
    idsByDay.get(day).add(String(ex._id));
  }

  const { start, end } = getDateRange(period);
  const useDateFilter = period !== 'overall';
  const studentIds = students.map((s) => s._id);

  const attempts = studentIds.length
    ? await ExerciseAttempt.find({
        studentId: { $in: studentIds },
        status: 'completed',
        ...(useDateFilter ? { completedAt: { $gte: start, $lte: end } } : {}),
      })
        .select('studentId exerciseId scorePercentage')
        .lean()
    : [];

  const attemptsByStudent = new Map();
  for (const att of attempts) {
    const sid = String(att.studentId);
    if (!attemptsByStudent.has(sid)) attemptsByStudent.set(sid, []);
    attemptsByStudent.get(sid).push(att);
  }

  const cfgCache = new Map();
  const trialDayEnabled = false;

  await Promise.all(
    students.map(async (s) => {
      const id = s._id.toString();
      if (!scores[id]) return;

      const batchName = String(s.batch || '').trim();
      let cfg = null;
      if (batchName) {
        if (cfgCache.has(batchName)) cfg = cfgCache.get(batchName);
        else {
          cfg = await BatchConfig.findOne({
            batchName: new RegExp(`^${escapeRegExp(batchName)}$`, 'i'),
          }).lean();
          cfgCache.set(batchName, cfg);
        }
      }

      const courseDay = resolveStudentCourseDay(s, trialDayEnabled);
      const days = await journeyDaysInPeriod(s, period, courseDay, trialDayEnabled, cfg);

      const pool = new Set();
      for (const d of days) {
        const daySet = idsByDay.get(d);
        if (daySet) {
          for (const eid of daySet) pool.add(eid);
        }
      }

      scores[id].exercisesTotal = pool.size;

      const studentAttempts = attemptsByStudent.get(id) || [];
      const completedInPool = new Set();
      const scorePcts = [];
      for (const att of studentAttempts) {
        const eid = String(att.exerciseId);
        if (!pool.has(eid)) continue;
        completedInPool.add(eid);
        if (att.scorePercentage != null && Number.isFinite(Number(att.scorePercentage))) {
          scorePcts.push(Number(att.scorePercentage));
        }
      }

      scores[id].exercisesCompleted = completedInPool.size;
      scores[id].averageScore = scorePcts.length
        ? Math.round(scorePcts.reduce((sum, n) => sum + n, 0) / scorePcts.length)
        : null;
    })
  );
}

function batchKeysFromStudent(student) {
  return allStudentBatchStringsForContent(student);
}

/** Task progress for today / weekly / overall. */
async function buildPeriodTaskProgress(studentId, student, period) {
  const { getJourneyAccessForStudent } = require('../utils/studentJourneyAccess');
  const journeyAccess = await getJourneyAccessForStudent(student);
  const trialDayEnabled = !!journeyAccess?.trialDayEnabled;
  const courseDay = resolveStudentCourseDay(student, trialDayEnabled);
  const batchKeys = batchKeysFromStudent(student);

  if (period === 'today') {
    return buildTodayTaskProgress(studentId, student, journeyAccess, courseDay, batchKeys);
  }

  const days = await journeyDaysInPeriod(student, period, courseDay, trialDayEnabled);
  const empty = emptyTaskProgress(courseDay, period);
  if (!days.length) return empty;

  const { start, end } = getDateRange(period);
  const useDateFilter = period === 'weekly';

  const batchOr = batchKeys.map((n) => ({
    batch: new RegExp(`^${escapeRegExp(n)}$`, 'i'),
  }));

  // ── Exercises ─────────────────────────────────────────────────────────────
  const exercises = journeyAccess?.learningEnabled !== false
    ? await DigitalExercise.find({
        isDeleted: { $ne: true },
        visibleToStudents: true,
        isActive: true,
        courseDay: { $in: days },
      })
        .select('_id')
        .lean()
    : [];
  const exerciseIds = exercises.map((e) => e._id);
  const exerciseTotal = exerciseIds.length;
  let exerciseDone = 0;
  if (exerciseIds.length) {
    const exMatch = {
      studentId,
      exerciseId: { $in: exerciseIds },
      status: 'completed',
    };
    if (useDateFilter) exMatch.completedAt = { $gte: start, $lte: end };
    exerciseDone = (await ExerciseAttempt.distinct('exerciseId', exMatch)).length;
  }

  // ── Live classes ──────────────────────────────────────────────────────────
  let liveTotal = 0;
  let liveDone = 0;
  if (batchOr.length) {
    const meetingFilter = {
      $or: batchOr,
      courseDay: { $in: days },
      status: { $ne: 'cancelled' },
    };
    if (period === 'weekly') {
      meetingFilter.startTime = { $gte: start, $lte: end };
    }
    const meetings = await MeetingLink.find(meetingFilter).select('_id attendance').lean();
    liveTotal = meetings.length;
    liveDone = meetings.filter((m) =>
      (m.attendance || []).some(
        (a) => String(a.studentId) === String(studentId) && a.attended === true
      )
    ).length;
  }

  // ── Glück Buddy (DG practice + Sprechen speaking) ─────────────────────────
  const gluckBuddy = await countGluckBuddyProgress(
    studentId,
    student,
    days,
    period,
    start,
    end,
    journeyAccess
  );

  // ── Arena ─────────────────────────────────────────────────────────────────
  let arena = { done: 0, total: 0 };
  if (journeyAccess?.learningEnabled !== false) {
    try {
      const filter = await buildStudentFilter(studentId);
      const sets = await GameSet.find({ ...filter, courseDay: { $in: days } }).select('_id').lean();
      const setIds = sets.map((s) => s._id);
      arena.total = setIds.length;
      if (setIds.length) {
        const arenaMatch = { studentId, gameSetId: { $in: setIds }, status: 'completed' };
        if (useDateFilter) arenaMatch.completedAt = { $gte: start, $lte: end };
        arena.done = (await GameAttempt.distinct('gameSetId', arenaMatch)).length;
      }
    } catch {
      arena = { done: 0, total: 0 };
    }
  }

  return {
    courseDay,
    period,
    liveClasses: { done: liveDone, total: liveTotal },
    exercises: { done: exerciseDone, total: exerciseTotal },
    gluckBuddy,
    arena,
  };
}

function getDateRange(period) {
  const now = new Date();
  if (period === 'overall') return { start: new Date(0), end: now };
  const start = new Date(now);
  if (period === 'today') {
    start.setUTCHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    start.setUTCHours(0, 0, 0, 0);
  }
  return { start, end: now };
}

function exerciseCompletionPercent(completed, total) {
  const done = Number(completed) || 0;
  const pool = Number(total) || 0;
  if (pool <= 0) return 0;
  return Math.round((done / pool) * 100);
}

/** Rank by learning engagement first, then exercise completion rate (aligned with Language Tracking). */
function compareLeaderboardEntries(a, b) {
  if (b.engagementMinutes !== a.engagementMinutes) {
    return b.engagementMinutes - a.engagementMinutes;
  }
  const aPct = a.exerciseCompletionPercent ?? exerciseCompletionPercent(a.exercisesCompleted, a.exercisesTotal);
  const bPct = b.exerciseCompletionPercent ?? exerciseCompletionPercent(b.exercisesCompleted, b.exercisesTotal);
  if (bPct !== aPct) return bPct - aPct;
  if (b.exercisesCompleted !== a.exercisesCompleted) return b.exercisesCompleted - a.exercisesCompleted;
  const aAvg = a.averageScore ?? 0;
  const bAvg = b.averageScore ?? 0;
  if (bAvg !== aAvg) return bAvg - aAvg;
  if (b.dgSessionsCompleted !== a.dgSessionsCompleted) return b.dgSessionsCompleted - a.dgSessionsCompleted;
  return (b.currentCourseDay || 1) - (a.currentCourseDay || 1);
}

/** Total engagement minutes: exercises + buddy + arena + live classes (period-aware). */
async function attachEngagementMinutes(students, period, scores) {
  if (!students.length) return;

  const ids = students.map((s) => s._id);
  const { start, end } = getDateRange(period);
  const useDateFilter = period !== 'overall';
  const completedAtFilter = useDateFilter ? { completedAt: { $gte: start, $lte: end } } : {};

  const [exAgg, dgAgg, spAgg, gameAgg] = await Promise.all([
    ExerciseAttempt.aggregate([
      { $match: { studentId: { $in: ids }, status: 'completed', ...completedAtFilter } },
      {
        $group: {
          _id: '$studentId',
          minutes: { $sum: { $divide: [{ $ifNull: ['$timeSpentSeconds', 0] }, 60] } },
        },
      },
    ]),
    DGSession.aggregate([
      { $match: { studentId: { $in: ids }, completed: true, ...completedAtFilter } },
      {
        $group: {
          _id: '$studentId',
          minutes: { $sum: { $divide: [{ $ifNull: ['$durationMs', 0] }, 60000] } },
        },
      },
    ]),
    SprechenExamSession.aggregate([
      { $match: { studentId: { $in: ids }, completed: true, ...completedAtFilter } },
      {
        $group: {
          _id: '$studentId',
          minutes: { $sum: { $divide: [{ $ifNull: ['$durationMs', 0] }, 60000] } },
        },
      },
    ]),
    GameAttempt.aggregate([
      { $match: { studentId: { $in: ids }, status: 'completed', ...completedAtFilter } },
      {
        $group: {
          _id: '$studentId',
          minutes: { $sum: { $divide: [{ $ifNull: ['$timeSpentSeconds', 0] }, 60] } },
        },
      },
    ]),
  ]);

  const addAggMinutes = (rows) => {
    for (const row of rows) {
      const id = row._id.toString();
      if (!scores[id]) continue;
      scores[id].engagementMinutes += Math.round(row.minutes || 0);
    }
  };

  addAggMinutes(exAgg);
  addAggMinutes(dgAgg);
  addAggMinutes(spAgg);
  addAggMinutes(gameAgg);

  const batches = [...new Set(students.map((s) => String(s.batch || '').trim()).filter(Boolean))];
  if (!batches.length) return;

  const batchOr = batches.map((n) => ({
    batch: new RegExp(`^${escapeRegExp(n)}$`, 'i'),
  }));
  const meetingFilter = {
    $or: batchOr,
    status: { $ne: 'cancelled' },
  };
  if (useDateFilter) {
    meetingFilter.startTime = { $gte: start, $lte: end };
  }

  const meetings = await MeetingLink.find(meetingFilter)
    .select('duration attendance')
    .lean();

  const studentIds = new Set(students.map((s) => s._id.toString()));
  for (const m of meetings) {
    const dur = Number(m.duration) || 0;
    if (!dur) continue;
    for (const att of m.attendance || []) {
      const sid = String(att.studentId || att.userId || '');
      if (studentIds.has(sid) && att.attended && scores[sid]) {
        scores[sid].liveClassMinutes += dur;
        scores[sid].engagementMinutes += dur;
      }
    }
  }
}

async function buildLeaderboard(batchOrBatches, period) {
  const query = {
    role: 'STUDENT',
    isTestAccount: { $ne: true },
    studentStatus: { $in: ['ONGOING', 'UNCERTAIN'] },
    batch: { $exists: true, $ne: '' },
  };
  if (batchOrBatches != null) {
    query.batch = Array.isArray(batchOrBatches)
      ? { $in: batchOrBatches }
      : batchOrBatches;
  }

  const students = await User.find(query)
    .select('_id name profilePic currentCourseDay batch')
    .lean();

  if (!students.length) return [];

  const ids = students.map((s) => s._id);
  const { start, end } = getDateRange(period);
  const today = new Date().toISOString().slice(0, 10);

  const periodFilter = (field) =>
    period !== 'overall' ? { [field]: { $gte: start, $lte: end } } : {};

  const [dgAgg, xpAgg, streaks] = await Promise.all([
    DGSession.aggregate([
      { $match: { studentId: { $in: ids }, completed: true, ...periodFilter('completedAt') } },
      { $group: { _id: '$studentId', dgSessionsCompleted: { $sum: 1 } } },
    ]),
    XpTransaction.aggregate([
      { $match: { studentId: { $in: ids }, ...periodFilter('createdAt') } },
      { $group: { _id: '$studentId', arenaXp: { $sum: '$amount' } } },
    ]),
    StudentLoginStreak.find({ studentId: { $in: ids } })
      .select('studentId currentStreak loggedDates')
      .lean(),
  ]);

  const scores = {};
  for (const s of students) {
    scores[s._id.toString()] = {
      studentId: s._id.toString(),
      name: s.name,
      profilePic: s.profilePic || '',
      currentCourseDay: s.currentCourseDay || 1,
      batch: s.batch || '',
      exercisesCompleted: 0,
      exercisesTotal: 0,
      dgSessionsCompleted: 0,
      arenaXp: 0,
      averageScore: null,
      loginPoints: 0,
      totalPoints: 0,
      exerciseCompletionPercent: 0,
      currentStreak: 0,
      loggedToday: false,
      engagementMinutes: 0,
      liveClassMinutes: 0,
    };
  }

  for (const dg of dgAgg) {
    const id = dg._id.toString();
    if (scores[id]) scores[id].dgSessionsCompleted = dg.dgSessionsCompleted;
  }
  for (const xp of xpAgg) {
    const id = xp._id.toString();
    if (scores[id]) scores[id].arenaXp = xp.arenaXp;
  }
  for (const streak of streaks) {
    const id = streak.studentId.toString();
    if (scores[id]) {
      scores[id].currentStreak = streak.currentStreak || 0;
      scores[id].loggedToday = Array.isArray(streak.loggedDates)
        ? streak.loggedDates.includes(today)
        : false;
      scores[id].loginPoints = scores[id].loggedToday ? 1 : 0;
    }
  }

  await attachExerciseProgress(students, period, scores);
  await attachEngagementMinutes(students, period, scores);

  for (const id of Object.keys(scores)) {
    const s = scores[id];
    s.exerciseCompletionPercent = exerciseCompletionPercent(s.exercisesCompleted, s.exercisesTotal);
    // Composite score mirrors rank order (engagement → completion % → exercises done)
    s.totalPoints = s.engagementMinutes * 1000 + s.exerciseCompletionPercent * 10 + s.exercisesCompleted;
  }

  return Object.values(scores)
    .sort(compareLeaderboardEntries)
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

function parseAdminBatchParam(raw) {
  const value = (raw || '').toString().trim();
  if (!value || value.toLowerCase() === 'all') return { mode: 'all', batches: null };
  const batches = value.split(',').map((b) => b.trim()).filter(Boolean);
  if (!batches.length) return { mode: 'all', batches: null };
  return { mode: 'selected', batches };
}

// ── Student: own batch only ─────────────────────────────────────────────────
router.get('/', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const period = ['today', 'weekly', 'overall'].includes(req.query.period)
      ? req.query.period
      : 'today';

    const user = await User.findById(req.user.id)
      .select('batch level subscription goStatus currentCourseDay blockedJourneyLevels')
      .lean();
    if (!user) return res.status(404).json({ message: 'Student not found' });

    const batch = user.batch;
    if (!batch) {
      return res.json({
        period, batch: null, leaderboard: [], myRank: null, myStats: null,
        batchmates: 0, todayTasks: null,
      });
    }

    const [leaderboard, todayTasks] = await Promise.all([
      buildLeaderboard(batch, period),
      buildPeriodTaskProgress(req.user.id, user, period),
    ]);
    const myEntry = leaderboard.find((e) => e.studentId === req.user.id.toString());

    return res.json({
      period, batch,
      leaderboard,
      myRank: myEntry?.rank ?? null,
      myStats: myEntry ?? null,
      batchmates: leaderboard.length,
      todayTasks,
    });
  } catch (err) {
    console.error('[BatchLeaderboard] Student error:', err);
    return res.status(500).json({ message: 'Failed to load leaderboard' });
  }
});

// ── Admin/Teacher: any batch via ?batch=XX ──────────────────────────────────
router.get('/admin', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const period = ['today', 'weekly', 'overall'].includes(req.query.period)
      ? req.query.period
      : 'today';
    const batch = (req.query.batch || '').toString().trim();

    if (!batch) {
      // Return list of distinct batches for the filter dropdown
      const batches = await User.distinct('batch', {
        role: 'STUDENT',
        batch: { $exists: true, $ne: '' },
        isTestAccount: { $ne: true },
        studentStatus: { $in: ['ONGOING', 'UNCERTAIN'] },
      });
      const sorted = batches
        .filter(Boolean)
        .sort((a, b) => {
          const na = parseInt(a, 10), nb = parseInt(b, 10);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return String(a).localeCompare(String(b));
        });
      return res.json({ batches: sorted });
    }

    const { mode, batches: selectedBatches } = parseAdminBatchParam(batch);
    const search = (req.query.search || '').toString().trim().toLowerCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const fullLeaderboard = mode === 'all'
      ? await buildLeaderboard(null, period)
      : await buildLeaderboard(
          selectedBatches.length === 1 ? selectedBatches[0] : selectedBatches,
          period
        );

    const activeCount = fullLeaderboard.filter((e) => e.engagementMinutes > 0).length;
    const loggedTodayCount = fullLeaderboard.filter((e) => e.loggedToday).length;
    const loggedOnlyCount = fullLeaderboard.filter(
      (e) => e.loggedToday && e.engagementMinutes === 0
    ).length;

    let displayList = fullLeaderboard;
    if (search) {
      displayList = fullLeaderboard.filter((e) =>
        (e.name || '').toLowerCase().includes(search)
      );
    }

    const totalStudents = displayList.length;
    const totalPages = Math.max(1, Math.ceil(totalStudents / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const leaderboard = displayList.slice(start, start + limit);

    return res.json({
      period,
      batch: mode === 'all' ? 'all' : selectedBatches.join(','),
      batches: mode === 'all' ? 'all' : selectedBatches,
      leaderboard,
      batchmates: fullLeaderboard.length,
      activeCount,
      loggedTodayCount,
      loggedOnlyCount,
      inactiveCount: Math.max(0, fullLeaderboard.length - activeCount - loggedOnlyCount),
      page: safePage,
      limit,
      totalPages,
      totalStudents,
    });
  } catch (err) {
    console.error('[BatchLeaderboard] Admin error:', err);
    return res.status(500).json({ message: 'Failed to load admin leaderboard' });
  }
});

module.exports = router;
