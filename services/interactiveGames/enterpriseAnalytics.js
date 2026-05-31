// services/interactiveGames/enterpriseAnalytics.js — enterprise admin + teacher analytics

const advancedAnalytics = require('./advancedAnalytics');
const multiplayerService = require('./multiplayer');
const GameAttempt = require('../../models/GameAttempt');
const XpTransaction = require('../../models/XpTransaction');
const StudentDailyChallenge = require('../../models/StudentDailyChallenge');
const LeagueMembership = require('../../models/LeagueMembership');
const ArenaRoom = require('../../models/ArenaRoom');
const adaptiveLearning = require('./adaptiveLearning');

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function getAdminEnterpriseDashboard({ from, to } = {}) {
  const end = to ? new Date(to) : new Date();
  const start = from ? new Date(from) : daysAgo(30);

  const [retention, live, multiplayer, challengePart, xpEconomy, sessions] = await Promise.all([
    advancedAnalytics.getRetentionAnalytics({ from: start, to: end }),
    multiplayerService.getLiveStats(),
    ArenaRoom.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    StudentDailyChallenge.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: null, total: { $sum: 1 }, completed: { $sum: { $cond: ['$isCompleted', 1, 0] } } } },
    ]),
    XpTransaction.aggregate([
      { $match: { createdAt: { $gte: start, $lte: end } } },
      { $group: { _id: '$source', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
    ]),
    GameAttempt.aggregate([
      { $match: { status: 'completed', completedAt: { $gte: start, $lte: end } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } }, avgSec: { $avg: '$timeSpentSeconds' }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const retentionCurve = await GameAttempt.aggregate([
    { $match: { status: 'completed', completedAt: { $gte: start } } },
    { $group: { _id: { $dayOfYear: '$completedAt' }, users: { $addToSet: '$studentId' } } },
    { $project: { date: '$_id', count: { $size: '$users' } } },
    { $sort: { date: 1 } },
    { $limit: 30 },
  ]);

  return {
    ...retention,
    liveOnlinePlayers: live.onlinePlayers,
    liveActiveRooms: live.activeRooms,
    multiplayerByStatus: multiplayer,
    challengeParticipation: challengePart[0] || { total: 0, completed: 0 },
    xpBySource: xpEconomy,
    sessionTrend: sessions,
    retentionCurve,
    churnIndicators: {
      highRisk: retention.cohorts?.length || 0,
      retentionRiskArchitecture: retention.churnRiskArchitecture,
    },
  };
}

async function getTeacherEnterpriseDashboard(teacherId, classroomId) {
  const classroomsService = require('./classrooms');
  const base = classroomId
    ? await classroomsService.getClassroomAnalytics(teacherId, classroomId)
    : null;

  const studentIds = base?.rankings?.map(r => r._id) || [];
  const adaptive = studentIds.length
    ? await adaptiveLearning.getClassroomAdaptiveInsights(studentIds)
    : { struggling: [] };

  const weakVocab = {};
  const weakGrammar = {};
  for (const s of adaptive.struggling || []) {
    (s.weakVocabulary || []).forEach(v => {
      weakVocab[v.key] = (weakVocab[v.key] || 0) + v.errorCount;
    });
    (s.weakGrammar || []).forEach(g => {
      weakGrammar[g.key] = (weakGrammar[g.key] || 0) + g.errorCount;
    });
  }

  const topWeakVocab = Object.entries(weakVocab).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([word, count]) => ({ word, count }));
  const topWeakGrammar = Object.entries(weakGrammar).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([pattern, count]) => ({ pattern, count }));

  return {
    ...base,
    weakestVocabulary: topWeakVocab,
    weakestGrammar: topWeakGrammar,
    strugglingStudents: adaptive.struggling,
    leagueActivity: await LeagueMembership.countDocuments({ studentId: { $in: studentIds } }),
  };
}

module.exports = { getAdminEnterpriseDashboard, getTeacherEnterpriseDashboard };
