// services/interactiveGames/leaderboard.js
// GlückArena: leaderboard aggregation pipelines

const mongoose = require('mongoose');
const GameAttempt = require('../../models/GameAttempt');
const StudentGameStats = require('../../models/StudentGameStats');
const cache = require('./cache');

const USER_LOOKUP = {
  from: 'users',
  localField: 'studentId',
  foreignField: '_id',
  as: 'user',
};

function userFieldsProject() {
  return {
    _id: 0,
    studentId: 1,
    name: { $ifNull: [{ $arrayElemAt: ['$user.name', 0] }, 'Student'] },
    avatarUrl: { $ifNull: [{ $arrayElemAt: ['$user.profilePic', 0] }, ''] },
    totalXp: 1,
    gamesCompleted: 1,
    bestScore: 1,
    accuracy: 1,
  };
}

/**
 * Get global leaderboard by XP earned in the given period.
 * period: 'daily' | 'weekly' | 'all'
 * Returns { leaderboard: [...], studentRank: null | number }
 */
async function getGlobalLeaderboard(period, studentId) {
  const cacheKey = cache.leaderboardKey(null, period);
  const cached = await cache.get(cacheKey);
  if (cached && !studentId) return cached;

  const result = period === 'all'
    ? await _getGlobalLeaderboardAllTime(studentId)
    : await _getGlobalLeaderboardFromAttempts(period, studentId);

  if (!studentId) await cache.set(cacheKey, result, period === 'daily' ? 60 : 120);
  return result;
}

/** All-time board from denormalised StudentGameStats (matches profile stats banner). */
async function _getGlobalLeaderboardAllTime(studentId) {
  const pipeline = [
    {
      $match: {
        $or: [{ totalXp: { $gt: 0 } }, { gamesCompleted: { $gt: 0 } }],
      },
    },
    { $sort: { totalXp: -1, bestScore: -1, gamesCompleted: -1 } },
    { $limit: 50 },
    {
      $addFields: {
        studentId: '$studentId',
        accuracy: {
          $cond: [
            { $gt: ['$totalAnswers', 0] },
            {
              $round: [
                { $multiply: [{ $divide: ['$totalCorrectAnswers', '$totalAnswers'] }, 100] },
                0,
              ],
            },
            0,
          ],
        },
      },
    },
    { $lookup: USER_LOOKUP },
    { $project: userFieldsProject() },
  ];

  const rows = await StudentGameStats.aggregate(pipeline);
  const leaderboard = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const studentRank = await _resolveStudentRank(leaderboard, studentId, async (sid) => {
    const idx = leaderboard.findIndex((r) => String(r.studentId) === String(sid));
    if (idx !== -1) return leaderboard[idx].rank;
    const me = await StudentGameStats.findOne({ studentId: sid }).lean();
    if (!me || (!me.totalXp && !me.gamesCompleted)) return null;
    const better = await StudentGameStats.countDocuments({
      $or: [
        { totalXp: { $gt: me.totalXp || 0 } },
        { totalXp: me.totalXp || 0, bestScore: { $gt: me.bestScore || 0 } },
      ],
    });
    return better + 1;
  });

  return { leaderboard: leaderboard.slice(0, 20), period: 'all', studentRank };
}

/** Daily / weekly boards from completed attempts in the window. */
async function _getGlobalLeaderboardFromAttempts(period, studentId) {
  const matchStage = { status: 'completed' };

  if (period === 'daily') {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    matchStage.completedAt = { $gte: startOfDay };
  } else if (period === 'weekly') {
    const startOfWeek = new Date();
    startOfWeek.setUTCHours(0, 0, 0, 0);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - startOfWeek.getUTCDay());
    matchStage.completedAt = { $gte: startOfWeek };
  }

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: '$studentId',
        studentId: { $first: '$studentId' },
        totalXp: { $sum: { $ifNull: ['$xpEarned', 0] } },
        gamesCompleted: { $sum: 1 },
        bestScore: { $max: '$score' },
        accuracy: { $avg: '$accuracy' },
      },
    },
    { $match: { gamesCompleted: { $gt: 0 } } },
    { $sort: { totalXp: -1, bestScore: -1 } },
    { $limit: 50 },
    {
      $addFields: {
        accuracy: { $round: [{ $ifNull: ['$accuracy', 0] }, 0] },
      },
    },
    { $lookup: USER_LOOKUP },
    { $project: userFieldsProject() },
  ];

  const rows = await GameAttempt.aggregate(pipeline);
  const leaderboard = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  const studentRank = await _resolveStudentRank(leaderboard, studentId, async (sid) => {
    const idx = leaderboard.findIndex((r) => String(r.studentId) === String(sid));
    if (idx !== -1) return leaderboard[idx].rank;

    const myRow = await GameAttempt.aggregate([
      { $match: { ...matchStage, studentId: sid } },
      {
        $group: {
          _id: '$studentId',
          totalXp: { $sum: { $ifNull: ['$xpEarned', 0] } },
        },
      },
    ]);
    if (!myRow.length || !myRow[0].totalXp) return null;

    const myXp = myRow[0].totalXp;
    const betterCount = await GameAttempt.aggregate([
      { $match: matchStage },
      { $group: { _id: '$studentId', totalXp: { $sum: { $ifNull: ['$xpEarned', 0] } } } },
      { $match: { totalXp: { $gt: myXp } } },
      { $count: 'n' },
    ]);
    return (betterCount[0]?.n ?? 0) + 1;
  });

  return { leaderboard: leaderboard.slice(0, 20), period, studentRank };
}

async function _resolveStudentRank(leaderboard, studentId, rankOutsideTop50) {
  if (!studentId) return null;
  const sid = typeof studentId === 'string' ? new mongoose.Types.ObjectId(studentId) : studentId;
  const idx = leaderboard.findIndex((r) => String(r.studentId) === String(sid));
  if (idx !== -1) return leaderboard[idx].rank;
  return rankOutsideTop50(sid);
}

/**
 * Per-game leaderboard: top scores for a specific game set.
 */
async function getPerGameLeaderboard(gameSetId, { limit = 20, studentId } = {}) {
  const cacheKey = cache.leaderboardKey(String(gameSetId), 'all');
  const cached = await cache.get(cacheKey);
  if (cached && !studentId) return cached;

  const result = await _getPerGameLeaderboardUncached(gameSetId, { limit, studentId });
  if (!studentId) await cache.set(cacheKey, result, 90);
  return result;
}

async function _getPerGameLeaderboardUncached(gameSetId, { limit = 20, studentId } = {}) {
  const sid = typeof gameSetId === 'string' ? new mongoose.Types.ObjectId(gameSetId) : gameSetId;

  const pipeline = [
    { $match: { gameSetId: sid, status: 'completed' } },
    { $sort: { score: -1, timeSpentSeconds: 1 } },
    {
      $group: {
        _id: '$studentId',
        studentId: { $first: '$studentId' },
        bestScore: { $max: '$score' },
        bestTime: { $min: '$timeSpentSeconds' },
        accuracy: { $max: '$accuracy' },
        attempts: { $sum: 1 },
      },
    },
    { $sort: { bestScore: -1, bestTime: 1 } },
    { $limit: limit },
    { $lookup: USER_LOOKUP },
    {
      $project: {
        _id: 0,
        studentId: 1,
        name: { $ifNull: [{ $arrayElemAt: ['$user.name', 0] }, 'Student'] },
        avatarUrl: { $ifNull: [{ $arrayElemAt: ['$user.profilePic', 0] }, ''] },
        bestScore: 1,
        bestTime: 1,
        accuracy: 1,
        attempts: 1,
      },
    },
  ];

  const rows = await GameAttempt.aggregate(pipeline);
  const leaderboard = rows.map((r, i) => ({ ...r, rank: i + 1 }));

  let studentRank = null;
  if (studentId) {
    const idx = leaderboard.findIndex((r) => String(r.studentId) === String(studentId));
    studentRank = idx !== -1 ? leaderboard[idx].rank : null;
  }

  return { leaderboard, studentRank };
}

module.exports = { getGlobalLeaderboard, getPerGameLeaderboard };
