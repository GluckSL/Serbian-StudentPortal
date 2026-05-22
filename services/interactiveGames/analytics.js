// services/interactiveGames/analytics.js — admin analytics aggregations

const mongoose = require('mongoose');
const User = require('../../models/User');
const GameSet = require('../../models/GameSet');
const GameAttempt = require('../../models/GameAttempt');
const GameAnswer = require('../../models/GameAnswer');
const GameQuestion = require('../../models/GameQuestion');
const XpTransaction = require('../../models/XpTransaction');

function parseDateRange(query) {
  const to = query.dateTo ? new Date(query.dateTo) : new Date();
  const from = query.dateFrom
    ? new Date(query.dateFrom)
    : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);
  to.setUTCHours(23, 59, 59, 999);
  return { from, to };
}

function attemptMatch(from, to, gameType, gameSetId, studentIds) {
  const match = { createdAt: { $gte: from, $lte: to } };
  if (gameType) match.gameType = gameType;
  if (gameSetId) match.gameSetId = new mongoose.Types.ObjectId(gameSetId);
  if (studentIds?.length) match.studentId = { $in: studentIds };
  return match;
}

async function resolveBatchStudents(batch) {
  if (!batch) return { students: [], studentIds: [] };
  const students = await User.find({ role: 'STUDENT', batch })
    .select('_id name batch')
    .lean();
  return { students, studentIds: students.map((s) => s._id) };
}

async function getStudentPerformance(from, to, gameType, gameSetId, batch, batchStudents) {
  const match = attemptMatch(from, to, gameType, gameSetId, batchStudents?.studentIds);

  const perStudent = await GameAttempt.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$studentId',
        attempts: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        totalTimeSeconds: { $sum: '$timeSpentSeconds' },
        totalXp: { $sum: '$xpEarned' },
        totalScore: { $sum: '$score' },
        avgAccuracy: { $avg: '$accuracy' },
        lastActivity: { $max: '$createdAt' },
      },
    },
    { $sort: { totalTimeSeconds: -1, totalXp: -1 } },
    ...(batch ? [] : [{ $limit: 250 }]),
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        studentId: '$_id',
        name: { $ifNull: ['$user.name', 'Student'] },
        batch: { $ifNull: ['$user.batch', ''] },
        attempts: 1,
        completed: 1,
        totalTimeSeconds: 1,
        totalXp: 1,
        totalScore: 1,
        avgAccuracy: { $round: ['$avgAccuracy', 0] },
        lastActivity: 1,
      },
    },
  ]);

  if (!batch || !batchStudents?.students?.length) {
    return perStudent.map((r) => ({
      ...r,
      avgAccuracy: r.avgAccuracy || 0,
    }));
  }

  const statsMap = new Map(perStudent.map((r) => [String(r.studentId), r]));
  return batchStudents.students
    .map((s) => {
      const row = statsMap.get(String(s._id));
      if (row) return row;
      return {
        studentId: s._id,
        name: s.name || 'Student',
        batch: s.batch || batch,
        attempts: 0,
        completed: 0,
        totalTimeSeconds: 0,
        totalXp: 0,
        totalScore: 0,
        avgAccuracy: 0,
        lastActivity: null,
      };
    })
    .sort((a, b) => b.totalTimeSeconds - a.totalTimeSeconds || b.totalXp - a.totalXp);
}

async function getAdminDashboard(query = {}) {
  const { from, to } = parseDateRange(query);
  const batchStudents = await resolveBatchStudents(query.batch);
  const studentIds = batchStudents.studentIds;
  const baseMatch = attemptMatch(from, to, query.gameType, query.gameSetId, studentIds);
  const xpMatch = { createdAt: { $gte: from, $lte: to } };
  if (studentIds.length) xpMatch.studentId = { $in: studentIds };

  const answerMatch = { submittedAt: { $gte: from, $lte: to } };
  if (studentIds.length) answerMatch.studentId = { $in: studentIds };

  const [
    attemptStats,
    xpTotal,
    dailyActive,
    mostPlayed,
    hardestQuestions,
    sessionDuration,
    rageQuit,
    leaderboardEngagement,
    dailyTrend,
    studentStats,
  ] = await Promise.all([
    GameAttempt.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          started: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          abandoned: { $sum: { $cond: [{ $eq: ['$status', 'abandoned'] }, 1, 0] } },
          avgAccuracy: { $avg: '$accuracy' },
          totalCorrect: { $sum: '$correctAnswers' },
          totalQuestions: { $sum: '$totalQuestions' },
        },
      },
    ]),
    XpTransaction.aggregate([
      { $match: xpMatch },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    GameAttempt.aggregate([
      { $match: { ...baseMatch, status: 'completed' } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }, players: { $addToSet: '$studentId' } } },
      { $project: { date: '$_id', count: { $size: '$players' } } },
      { $sort: { date: 1 } },
    ]),
    GameAttempt.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$gameSetId', plays: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
      { $sort: { plays: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'gamesets', localField: '_id', foreignField: '_id', as: 'set' } },
      { $unwind: { path: '$set', preserveNullAndEmptyArrays: true } },
      { $project: { gameSetId: '$_id', title: '$set.title', gameType: '$set.gameType', plays: 1, completed: 1 } },
    ]),
    GameAnswer.aggregate([
      { $match: answerMatch },
      { $group: { _id: '$questionId', total: { $sum: 1 }, wrong: { $sum: { $cond: ['$isCorrect', 0, 1] } } } },
      { $addFields: { errorRate: { $cond: [{ $gt: ['$total', 0] }, { $divide: ['$wrong', '$total'] }, 0] } } },
      { $match: { total: { $gte: 3 } } },
      { $sort: { errorRate: -1 } },
      { $limit: 10 },
      { $lookup: { from: 'gamequestions', localField: '_id', foreignField: '_id', as: 'q' } },
      { $unwind: { path: '$q', preserveNullAndEmptyArrays: true } },
    ]),
    GameAttempt.aggregate([
      { $match: { ...baseMatch, status: 'completed', timeSpentSeconds: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$timeSpentSeconds' } } },
    ]),
    GameAttempt.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          abandoned: { $sum: { $cond: [{ $eq: ['$status', 'abandoned'] }, 1, 0] } },
        },
      },
    ]),
    // Proxy: students with completed games in period (leaderboard engagement proxy)
    GameAttempt.aggregate([
      { $match: { ...baseMatch, status: 'completed', score: { $gt: 0 } } },
      { $group: { _id: '$studentId' } },
      { $count: 'engagedPlayers' },
    ]),
    GameAttempt.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          attempts: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    getStudentPerformance(from, to, query.gameType, query.gameSetId, query.batch, batchStudents),
  ]);

  const stats = attemptStats[0] || {};
  const started = stats.started || 0;
  const completed = stats.completed || 0;
  const abandoned = stats.abandoned || 0;
  const rage = rageQuit[0] || { total: 0, abandoned: 0 };

  return {
    dateRange: { from, to },
    kpis: {
      attemptsStarted: started,
      attemptsCompleted: completed,
      completionRate: started ? Math.round((completed / started) * 100) : 0,
      averageAccuracy: Math.round(stats.avgAccuracy || 0),
      totalXpEarned: xpTotal[0]?.total || 0,
      avgSessionSeconds: Math.round(sessionDuration[0]?.avg || 0),
      rageQuitPercent: rage.total ? Math.round((rage.abandoned / rage.total) * 100) : 0,
      leaderboardEngagedPlayers: leaderboardEngagement[0]?.engagedPlayers || 0,
      uniqueStudents: studentStats.filter((s) => s.attempts > 0).length,
      studentsInBatch: batchStudents.students.length || null,
    },
    filters: { batch: query.batch || null, gameType: query.gameType || null },
    studentStats,
    mostPlayedGames: mostPlayed,
    hardestQuestions: hardestQuestions.map(h => ({
      questionId: h._id,
      word: h.q?.word,
      correctSentence: h.q?.correctSentence,
      total: h.total,
      wrong: h.wrong,
      errorRate: Math.round((h.errorRate || 0) * 100),
    })),
    dailyActivePlayers: dailyActive,
    attemptsTrend: dailyTrend.map(d => ({ date: d._id, attempts: d.attempts, completed: d.completed })),
  };
}

module.exports = { getAdminDashboard, parseDateRange };
