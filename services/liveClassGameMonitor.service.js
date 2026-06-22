/**
 * Live GlückArena game monitor for teachers during online classes.
 * Shows which batch students are playing, completed, or haven't started a journey game.
 */

const GameSet = require('../models/GameSet');
const GameAttempt = require('../models/GameAttempt');
const User = require('../models/User');
const { normalizeBatch, batchesAlign } = require('../utils/effectiveStudentBatch');

function gameAppliesToBatch(gameSet, meetingBatch) {
  const keys = Array.isArray(gameSet.targetBatchKeys) ? gameSet.targetBatchKeys : [];
  if (!keys.length) return true;
  return keys.some((k) => batchesAlign(k, meetingBatch));
}

function getClassWindow(meeting) {
  const now = Date.now();
  const startMs = meeting.startTime ? new Date(meeting.startTime).getTime() : now - 60 * 60 * 1000;
  const durationMin = Number(meeting.duration) > 0 ? Number(meeting.duration) : 60;
  const endMs = startMs + durationMin * 60 * 1000;
  // Allow early join + short overrun after class ends
  const windowStart = new Date(startMs - 30 * 60 * 1000);
  const windowEnd = new Date(Math.max(endMs + 30 * 60 * 1000, now + 5 * 60 * 1000));
  return { windowStart, windowEnd };
}

function progressPercent(attempt) {
  const total = Number(attempt?.totalQuestions) || 0;
  const done = Number(attempt?.correctAnswers) || 0;
  if (total > 0) return Math.min(100, Math.round((done / total) * 100));
  if (Number(attempt?.score) > 0) return Math.min(100, Number(attempt.score));
  return 0;
}

async function getGamesForMeeting(meeting) {
  if (meeting.courseDay == null || meeting.courseDay === '') {
    return [];
  }
  const courseDay = Number(meeting.courseDay);
  if (!Number.isFinite(courseDay)) return [];

  const sets = await GameSet.find({
    isPublished: true,
    isDeleted: { $ne: true },
    courseDay,
    targetLanguage: 'German',
  })
    .select('_id title gameType courseDay sequenceLetter level difficulty xpReward questionCount targetBatchKeys')
    .sort({ sequenceLetter: 1, title: 1 })
    .lean();

  return sets.filter((s) => gameAppliesToBatch(s, meeting.batch));
}

/**
 * @param {object} meeting - MeetingLink lean doc with attendees
 * @param {string|null} gameSetId - optional; defaults to first game for the day
 */
async function getLiveGameMonitor(meeting, gameSetId = null) {
  const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
  const studentIds = attendees.map((a) => a.studentId).filter(Boolean);
  const games = await getGamesForMeeting(meeting);

  let selectedGame = null;
  if (gameSetId) {
    selectedGame = games.find((g) => String(g._id) === String(gameSetId)) || null;
  } else {
    selectedGame = games[0] || null;
  }

  const { windowStart, windowEnd } = getClassWindow(meeting);

  if (!selectedGame || !studentIds.length) {
    const students = await User.find({ _id: { $in: studentIds } })
      .select('name email batch level regNo')
      .lean();
    return {
      meeting: summarizeMeeting(meeting),
      window: { start: windowStart, end: windowEnd },
      games,
      selectedGame,
      summary: { total: studentIds.length, playing: 0, completed: 0, notStarted: studentIds.length },
      students: students.map((u) => ({
        studentId: String(u._id),
        name: u.name || '',
        email: u.email || '',
        batch: u.batch || '',
        level: u.level || '',
        regNo: u.regNo || '',
        status: 'not_started',
        activeAttempt: null,
        bestCompleted: null,
        progressPercent: 0,
      })),
      liveLeaderboard: [],
      generatedAt: new Date().toISOString(),
    };
  }

  const [students, attempts] = await Promise.all([
    User.find({ _id: { $in: studentIds } })
      .select('name email batch level regNo')
      .lean(),
    GameAttempt.find({
      studentId: { $in: studentIds },
      gameSetId: selectedGame._id,
      startedAt: { $gte: windowStart, $lte: windowEnd },
      status: { $in: ['in-progress', 'completed'] },
    })
      .select('studentId status score xpEarned accuracy correctAnswers totalQuestions startedAt completedAt timeSpentSeconds')
      .sort({ startedAt: -1 })
      .lean(),
  ]);

  const attemptsByStudent = new Map();
  for (const att of attempts) {
    const sid = String(att.studentId);
    if (!attemptsByStudent.has(sid)) attemptsByStudent.set(sid, []);
    attemptsByStudent.get(sid).push(att);
  }

  const studentRows = students.map((u) => {
    const sid = String(u._id);
    const mine = attemptsByStudent.get(sid) || [];
    const active = mine.find((a) => a.status === 'in-progress') || null;
    const completed = mine
      .filter((a) => a.status === 'completed')
      .sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;

    let status = 'not_started';
    if (active) status = 'playing';
    else if (completed) status = 'completed';

    const ref = active || completed;
    return {
      studentId: sid,
      name: u.name || '',
      email: u.email || '',
      batch: u.batch || '',
      level: u.level || '',
      regNo: u.regNo || '',
      status,
      activeAttempt: active
        ? {
            attemptId: String(active._id),
            score: active.score || 0,
            accuracy: active.accuracy || 0,
            progressPercent: progressPercent(active),
            startedAt: active.startedAt,
            correctAnswers: active.correctAnswers || 0,
            totalQuestions: active.totalQuestions || 0,
          }
        : null,
      bestCompleted: completed
        ? {
            attemptId: String(completed._id),
            score: completed.score || 0,
            xpEarned: completed.xpEarned || 0,
            accuracy: completed.accuracy || 0,
            completedAt: completed.completedAt,
            timeSpentSeconds: completed.timeSpentSeconds || 0,
          }
        : null,
      progressPercent: active ? progressPercent(active) : completed ? 100 : 0,
    };
  });

  studentRows.sort((a, b) => {
    const order = { playing: 0, completed: 1, not_started: 2 };
    const cmp = (order[a.status] ?? 9) - (order[b.status] ?? 9);
    if (cmp !== 0) return cmp;
    const scoreA = a.activeAttempt?.score ?? a.bestCompleted?.score ?? 0;
    const scoreB = b.activeAttempt?.score ?? b.bestCompleted?.score ?? 0;
    return scoreB - scoreA;
  });

  const playing = studentRows.filter((s) => s.status === 'playing').length;
  const completed = studentRows.filter((s) => s.status === 'completed').length;
  const notStarted = studentRows.filter((s) => s.status === 'not_started').length;

  const liveLeaderboard = studentRows
    .filter((s) => s.status === 'playing' || s.status === 'completed')
    .map((s, i) => ({
      rank: i + 1,
      studentId: s.studentId,
      name: s.name,
      status: s.status,
      score: s.activeAttempt?.score ?? s.bestCompleted?.score ?? 0,
      accuracy: s.activeAttempt?.accuracy ?? s.bestCompleted?.accuracy ?? 0,
      progressPercent: s.progressPercent,
      isLive: s.status === 'playing',
    }));

  return {
    meeting: summarizeMeeting(meeting),
    window: { start: windowStart, end: windowEnd },
    games,
    selectedGame,
    summary: { total: studentRows.length, playing, completed, notStarted },
    students: studentRows,
    liveLeaderboard,
    generatedAt: new Date().toISOString(),
  };
}

function summarizeMeeting(meeting) {
  return {
    _id: meeting._id,
    topic: meeting.topic || 'Class',
    batch: meeting.batch,
    plan: meeting.plan,
    startTime: meeting.startTime,
    duration: meeting.duration,
    status: meeting.status,
    courseDay: meeting.courseDay,
  };
}

module.exports = { getLiveGameMonitor, getGamesForMeeting };
