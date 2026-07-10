'use strict';
/**
 * Crucial Students Service
 *
 * Returns Platinum (new-batch) students whose total engagement on their
 * current-week exercise days is under 1 hour.
 *
 * Week structure (7-day journey weeks):
 *   Exercise days  → positions 2, 4, 5  (e.g. week 1 = days 2,4,5; week 2 = days 9,11,12)
 *   Live-class days → positions 1, 3, 6, 7
 *
 * Engagement is summed from ExerciseAttempts, DGSessions, and GameAttempts
 * that are linked to the student's current week's exercise-day journey days.
 *
 * Live classes: last 2 MeetingLink entries per batch where courseDay ≤
 * student's currentCourseDay, checked against MeetingLink.attendance.
 */

const User = require('../models/User');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGSession = require('../models/DGSession');
const GameAttempt = require('../models/GameAttempt');
const MeetingLink = require('../models/MeetingLink');
const BatchConfig = require('../models/BatchConfig');
const DigitalExercise = require('../models/DigitalExercise');
const DGModule = require('../models/DGModule');
const GameSet = require('../models/GameSet');
const { totalSessionMinutes } = require('../utils/dgSessionMetrics');
const { MAX_ATTEMPT_SECONDS } = require('../utils/exerciseAttemptMetrics');

const ONE_HOUR_SECONDS = 3600;
const EXERCISE_POSITIONS = [2, 4, 5]; // positions within each 7-day week
const LIVE_CLASS_LOOKBACK = 2;
const LAST_N_EXERCISE_DAYS = 3;       // how many most-recent exercise days to use

/**
 * Returns the last N exercise journey days that have elapsed for a student.
 *
 * Exercise days are fixed at positions 2, 4, 5 inside every 7-day week:
 *   Week 1 → days 2, 4, 5
 *   Week 2 → days 9, 11, 12
 *   Week 3 → days 16, 18, 19  etc.
 *
 * We collect ALL exercise days from day 1 up to currentCourseDay, then
 * take the last LAST_N_EXERCISE_DAYS.  This means a student on day 9 gets
 * [4, 5, 9] and a student on day 5 gets [2, 4, 5].
 */
function getExerciseDaysForStudent(currentCourseDay) {
  const day = Math.max(1, currentCourseDay || 1);

  // Build every exercise day from week 1 up to the student's current day
  const all = [];
  let weekStart = 0;
  while (true) {
    const weekExDays = EXERCISE_POSITIONS.map(pos => weekStart + pos);
    const inRange = weekExDays.filter(d => d <= day);
    all.push(...inRange);
    if (inRange.length < EXERCISE_POSITIONS.length) break; // partial or empty week — stop
    weekStart += 7;
  }

  if (!all.length) return [];

  // Return the last LAST_N_EXERCISE_DAYS (most recent)
  return all.slice(-LAST_N_EXERCISE_DAYS);
}

function weekLabel(currentCourseDay) {
  const day = Math.max(1, currentCourseDay || 1);
  return Math.ceil(day / 7);
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Fetch crucial students data */
async function getCrucialStudents() {
  const newBatches = await BatchConfig.find({ batchType: 'new' })
    .select('batchName')
    .lean();
  const newBatchNames = newBatches.map(b => b.batchName);

  if (!newBatchNames.length) return emptyResult();

  const students = await User.find({
    subscription: 'PLATINUM',
    batch: { $in: newBatchNames },
    role: 'STUDENT',
    isTestAccount: { $ne: true },
    studentStatus: 'ONGOING',
  })
    .select('_id name email phoneNumber whatsappNumber batch level currentCourseDay')
    .lean();

  if (!students.length) return emptyResult();

  const studentIds = students.map(s => s._id);

  // ── Per-student exercise day windows ────────────────────────────────────
  const studentExDays = {};         // sid → [journeyDay, ...]
  const allExerciseDays = new Set();

  for (const s of students) {
    const days = getExerciseDaysForStudent(s.currentCourseDay);
    studentExDays[String(s._id)] = days;
    days.forEach(d => allExerciseDays.add(d));
  }

  const exerciseDaysArr = [...allExerciseDays];

  // ── Content IDs for those journey days ──────────────────────────────────
  let exercises = [], dgModules = [], gameSets = [];

  if (exerciseDaysArr.length) {
    [exercises, dgModules, gameSets] = await Promise.all([
      DigitalExercise.find({
        courseDay: { $in: exerciseDaysArr },
        isDeleted: { $ne: true },
      }).select('_id courseDay').lean(),

      DGModule.find({
        courseDay: { $in: exerciseDaysArr },
        isActive: true,
      }).select('_id courseDay').lean(),

      GameSet.find({
        courseDay: { $in: exerciseDaysArr },
        isPublished: true,
        isDeleted: { $ne: true },
      }).select('_id courseDay').lean(),
    ]);
  }

  // courseDay lookup maps
  const exCD = {}; exercises.forEach(e => { exCD[String(e._id)] = e.courseDay; });
  const dgCD = {}; dgModules.forEach(m => { dgCD[String(m._id)] = m.courseDay; });
  const gsCD = {}; gameSets.forEach(g => { gsCD[String(g._id)] = g.courseDay; });

  const exerciseIds = exercises.map(e => e._id);
  const dgModuleIds = dgModules.map(m => m._id);
  const gameSetIds  = gameSets.map(g => g._id);

  // ── Fetch engagement data ────────────────────────────────────────────────
  const [exerciseAttempts, dgSessionsAll, arenaAttempts] = await Promise.all([
    exerciseIds.length
      ? ExerciseAttempt.find({
          studentId: { $in: studentIds },
          exerciseId: { $in: exerciseIds },
          status: 'completed',
          timeSpentSeconds: { $gt: 0 },
        }).select('studentId exerciseId timeSpentSeconds').lean()
      : Promise.resolve([]),

    dgModuleIds.length
      ? DGSession.find({
          studentId: { $in: studentIds },
          moduleId: { $in: dgModuleIds },
        }).select('studentId moduleId timePerSceneMs logs').lean()
      : Promise.resolve([]),

    gameSetIds.length
      ? GameAttempt.find({
          studentId: { $in: studentIds },
          gameSetId: { $in: gameSetIds },
          timeSpentSeconds: { $gt: 0 },
        }).select('studentId gameSetId timeSpentSeconds').lean()
      : Promise.resolve([]),
  ]);

  // Accumulate per student, only for their specific exercise days
  const exerciseSecByStudent = {};
  for (const a of exerciseAttempts) {
    const sid = String(a.studentId);
    const courseDay = exCD[String(a.exerciseId)];
    if (courseDay == null) continue;
    if (!(studentExDays[sid] || []).includes(courseDay)) continue;
    const sec = Math.min(a.timeSpentSeconds, MAX_ATTEMPT_SECONDS);
    exerciseSecByStudent[sid] = (exerciseSecByStudent[sid] || 0) + sec;
  }

  const dgSecByStudent = {};
  for (const s of dgSessionsAll) {
    const sid = String(s.studentId);
    const courseDay = dgCD[String(s.moduleId)];
    if (courseDay == null) continue;
    if (!(studentExDays[sid] || []).includes(courseDay)) continue;
    const secs = Math.round(totalSessionMinutes(s) * 60);
    if (secs > 0) dgSecByStudent[sid] = (dgSecByStudent[sid] || 0) + secs;
  }

  const arenaSecByStudent = {};
  for (const a of arenaAttempts) {
    const sid = String(a.studentId);
    const courseDay = gsCD[String(a.gameSetId)];
    if (courseDay == null) continue;
    if (!(studentExDays[sid] || []).includes(courseDay)) continue;
    arenaSecByStudent[sid] = (arenaSecByStudent[sid] || 0) + (a.timeSpentSeconds || 0);
  }

  // ── Live class attendance: last 2 meetings per batch ────────────────────
  const batchSet = new Set(students.map(s => s.batch).filter(Boolean));

  // Fetch all meetings for all new batches with courseDay set
  const allMeetings = await MeetingLink.find({
    batch: { $in: [...batchSet] },
    courseDay: { $gt: 0 },
    status: { $ne: 'cancelled' },
  })
    .select('_id batch courseDay attendance')
    .sort({ batch: 1, courseDay: -1 })
    .lean();

  // Group by normalised batch name
  const meetingsByBatch = {};
  for (const m of allMeetings) {
    const b = String(m.batch || '').trim();
    if (!meetingsByBatch[b]) meetingsByBatch[b] = [];
    meetingsByBatch[b].push(m);
  }

  // Per student: how many of the last 2 live classes they attended
  const liveByStudent = {}; // sid → { attended, total }

  for (const s of students) {
    const sid = String(s._id);
    const batchKey = String(s.batch || '').trim();
    const meetings = (meetingsByBatch[batchKey] || [])
      .filter(m => m.courseDay <= (s.currentCourseDay || 0))
      .slice(0, LIVE_CLASS_LOOKBACK);

    let attended = 0;
    for (const m of meetings) {
      const rec = (m.attendance || []).find(a => String(a.studentId) === sid);
      if (rec && rec.attended) attended++;
    }
    liveByStudent[sid] = { attended, total: meetings.length };
  }

  // ── Build crucial students list ──────────────────────────────────────────
  const crucialStudents = [];

  for (const s of students) {
    const sid = String(s._id);
    const exDays = studentExDays[sid] || [];

    // Students with no exercise days yet (brand new, week 1 day 1) are skipped
    if (!exDays.length) continue;

    const exerciseSec = exerciseSecByStudent[sid] || 0;
    const dgSec       = dgSecByStudent[sid]       || 0;
    const arenaSec    = arenaSecByStudent[sid]     || 0;
    const totalSec    = exerciseSec + dgSec + arenaSec;

    if (totalSec < ONE_HOUR_SECONDS) {
      const live = liveByStudent[sid] || { attended: 0, total: 0 };
      crucialStudents.push({
        studentId: sid,
        name:  s.name  || '—',
        email: s.email || '—',
        phone: s.phoneNumber || s.whatsappNumber || '—',
        batch: s.batch || '—',
        level: s.level || '—',
        currentCourseDay: s.currentCourseDay || 0,
        weekNum: weekLabel(s.currentCourseDay),
        exerciseDays: exDays,
        totalSeconds:    totalSec,
        totalMinutes:    Math.round(totalSec / 60),
        exercisesSeconds: exerciseSec,
        digibotSeconds:   dgSec,
        arenaSeconds:     arenaSec,
        liveClassesAttended: live.attended,
        liveClassesTotal:    live.total,
      });
    }
  }

  crucialStudents.sort((a, b) => a.totalSeconds - b.totalSeconds);

  const batchSetOut = new Set(crucialStudents.map(s => s.batch).filter(Boolean));
  const availableBatches = [...batchSetOut].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true }),
  );

  const totalMinutesAll = crucialStudents.reduce((sum, r) => sum + r.totalMinutes, 0);
  const avgMinutes = crucialStudents.length
    ? Math.round(totalMinutesAll / crucialStudents.length)
    : 0;

  const generatedAt = new Date().toLocaleString('sr-Latn-RS', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return {
    students: crucialStudents,
    availableBatches,
    summary: {
      total: crucialStudents.length,
      avgMinutes,
      windowLabel: 'Last 3 exercise days (positions 2, 4, 5 per week)',
      generatedAt,
    },
  };
}

function emptyResult() {
  return {
    students: [],
    availableBatches: [],
    summary: {
      total: 0,
      avgMinutes: 0,
      windowLabel: 'Last 3 exercise days (positions 2, 4, 5 per week)',
      generatedAt: new Date().toLocaleString('sr-Latn-RS', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      }),
    },
  };
}

function sortCrucialStudents(students, sort) {
  const list = [...students];
  switch (sort) {
    case 'highest':
    case 'nearest_hour':
      list.sort((a, b) => b.totalSeconds - a.totalSeconds);
      break;
    case 'lowest':
    default:
      list.sort((a, b) => a.totalSeconds - b.totalSeconds);
      break;
  }
  return list;
}

module.exports = {
  getCrucialStudents,
  sortCrucialStudents,
  EXERCISE_POSITIONS,
};
