// services/interactiveGames/advancedAnalytics.js — retention, cohorts, DAU/WAU/MAU

const GameAttempt = require('../../models/GameAttempt');
const GameAnswer = require('../../models/GameAnswer');
const StudentGameStats = require('../../models/StudentGameStats');
const XpTransaction = require('../../models/XpTransaction');

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function getRetentionAnalytics({ from, to } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : daysAgo(30);

  const [dau, wau, mau, sessionDur, funnel] = await Promise.all([
    activeUsers(1),
    activeUsers(7),
    activeUsers(30),
    GameAttempt.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: start, $lte: end }, timeSpentSeconds: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$timeSpentSeconds' } } },
    ]),
    funnelAnalysis(start, end),
  ]);

  const cohorts = await cohortRetention(start, end);

  return {
    dau: dau[0]?.count || 0,
    wau: wau[0]?.count || 0,
    mau: mau[0]?.count || 0,
    avgSessionSeconds: Math.round(sessionDur[0]?.avg || 0),
    funnel,
    cohorts,
    churnRiskArchitecture: {
      enabled: true,
      signals: ['inactive_7d', 'streak_lost', 'zero_xp_week'],
    },
    heatmap: await learningHeatmap(start, end),
  };
}

async function activeUsers(days) {
  const since = daysAgo(days);
  return GameAttempt.aggregate([
    { $match: { startedAt: { $gte: since } } },
    { $group: { _id: '$studentId' } },
    { $count: 'count' },
  ]);
}

async function funnelAnalysis(start, end) {
  const started = await GameAttempt.countDocuments({ startedAt: { $gte: start, $lte: end } });
  const completed = await GameAttempt.countDocuments({ status: 'completed', completedAt: { $gte: start, $lte: end } });
  const withXp = await XpTransaction.distinct('studentId', { createdAt: { $gte: start, $lte: end } });
  return {
    started,
    completed,
    completionRate: started ? Math.round((completed / started) * 100) : 0,
    earnedXp: withXp.length,
  };
}

async function cohortRetention(start, end) {
  const firstPlays = await GameAttempt.aggregate([
    { $match: { status: 'completed' } },
    { $group: { _id: '$studentId', firstAt: { $min: '$completedAt' } } },
    { $match: { firstAt: { $gte: start, $lte: end } } },
    { $limit: 200 },
  ]);
  return firstPlays.map(c => ({
    studentId: c._id,
    cohortWeek: c.firstAt.toISOString().slice(0, 10),
  }));
}

async function learningHeatmap(start, end) {
  return GameAnswer.aggregate([
    { $match: { submittedAt: { $gte: start, $lte: end } } },
    { $group: {
      _id: { hour: { $hour: '$submittedAt' }, dow: { $dayOfWeek: '$submittedAt' } },
      count: { $sum: 1 },
      wrong: { $sum: { $cond: ['$isCorrect', 0, 1] } },
    } },
    { $sort: { count: -1 } },
    { $limit: 50 },
  ]);
}

module.exports = { getRetentionAnalytics };
