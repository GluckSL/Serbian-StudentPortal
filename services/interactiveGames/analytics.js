// services/interactiveGames/analytics.js — admin analytics aggregations

const mongoose = require('mongoose');
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

function attemptMatch(from, to, gameType, gameSetId) {
  const match = { createdAt: { $gte: from, $lte: to } };
  if (gameType) match.gameType = gameType;
  if (gameSetId) match.gameSetId = new mongoose.Types.ObjectId(gameSetId);
  return match;
}

async function getAdminDashboard(query = {}) {
  const { from, to } = parseDateRange(query);
  const baseMatch = attemptMatch(from, to, query.gameType, query.gameSetId);

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
      { $match: { createdAt: { $gte: from, $lte: to } } },
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
      { $match: { submittedAt: { $gte: from, $lte: to } } },
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
    },
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
