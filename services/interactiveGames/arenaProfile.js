// services/interactiveGames/arenaProfile.js — student arena profile

const StudentArenaProfile = require('../../models/StudentArenaProfile');
const StudentGameStats = require('../../models/StudentGameStats');
const GameAttempt = require('../../models/GameAttempt');
const StudentAchievement = require('../../models/StudentAchievement');
const LeagueMembership = require('../../models/LeagueMembership');
const { weekKey } = require('./streaks');

function xpToLevel(totalXp) {
  return Math.max(1, Math.floor(Math.sqrt((totalXp || 0) / 100)) + 1);
}

async function getProfile(studentId, viewerId = null) {
  const [profile, stats, recent, league] = await Promise.all([
    StudentArenaProfile.findOneAndUpdate(
      { studentId },
      { $setOnInsert: { studentId } },
      { upsert: true, new: true }
    ).lean(),
    StudentGameStats.findOne({ studentId }).lean(),
    GameAttempt.find({ studentId, status: 'completed' })
      .sort({ completedAt: -1 })
      .limit(10)
      .populate('gameSetId', 'title gameType icon')
      .lean(),
    LeagueMembership.findOne({ studentId, weekKey: weekKey() }).lean(),
  ]);

  const achievements = await StudentAchievement.find({ studentId, isUnlocked: true })
    .limit(12)
    .populate('achievementId')
    .lean();

  const level = xpToLevel(stats?.totalXp);
  if (stats && stats.arenaLevel !== level) {
    await StudentGameStats.updateOne({ studentId }, { $set: { arenaLevel: level } });
  }

  return {
    profile,
    stats: stats ? { ...stats, arenaLevel: level, accuracy: stats.totalAnswers
      ? Math.round((stats.totalCorrectAnswers / stats.totalAnswers) * 100) : 0 } : null,
    recentActivity: recent.map(a => ({
      gameSetId: a.gameSetId?._id,
      title: a.gameSetId?.title,
      gameType: a.gameType,
      score: a.score,
      xpEarned: a.xpEarned,
      accuracy: a.accuracy,
      completedAt: a.completedAt,
    })),
    league: league ? { tier: league.tier, weeklyXp: league.weeklyXp, rank: league.rank } : null,
    achievements: achievements.map(a => ({
      key: a.achievementId?.key,
      title: a.achievementId?.title,
      icon: a.achievementId?.icon,
      unlockedAt: a.unlockedAt,
    })),
    isOwner: !viewerId || String(viewerId) === String(studentId),
  };
}

async function updateProfile(studentId, data) {
  const allowed = ['displayName', 'bio', 'frameKey', 'favoriteGameSetId', 'showcaseBadgeKeys', 'isPublic'];
  const patch = {};
  for (const k of allowed) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  const profile = await StudentArenaProfile.findOneAndUpdate(
    { studentId },
    { $set: patch, $setOnInsert: { studentId } },
    { upsert: true, new: true }
  );
  return profile;
}

module.exports = { getProfile, updateProfile, xpToLevel };
