// services/interactiveGames/achievements.js — automatic badge unlocks

const Achievement = require('../../models/Achievement');
const StudentAchievement = require('../../models/StudentAchievement');
const StudentGameStats = require('../../models/StudentGameStats');
const GameAttempt = require('../../models/GameAttempt');
const xpService = require('./xp');

const DEFAULT_ACHIEVEMENTS = [
  { key: 'streak_7', title: '7-Day Streak', description: 'Play GlückArena 7 days in a row', icon: 'local_fire_department', category: 'streak', criteriaType: 'streak_days', criteriaValue: 7, xpReward: 50, sortOrder: 1 },
  { key: 'correct_100', title: 'Century Club', description: '100 correct answers', icon: 'check_circle', category: 'vocabulary', criteriaType: 'correct_answers_total', criteriaValue: 100, xpReward: 75, sortOrder: 2 },
  { key: 'speed_master', title: 'Speed Master', description: 'Complete a game in under 60 seconds', icon: 'speed', category: 'speed', criteriaType: 'fast_completion', criteriaValue: 60, xpReward: 40, sortOrder: 3 },
  { key: 'flawless', title: 'Flawless', description: '100% accuracy on a completed game', icon: 'stars', category: 'accuracy', criteriaType: 'flawless_game', criteriaValue: 1, xpReward: 60, sortOrder: 4 },
  { key: 'vocab_king', title: 'Vocabulary King', description: 'Complete 20 games', icon: 'military_tech', category: 'milestone', criteriaType: 'games_completed', criteriaValue: 20, xpReward: 100, sortOrder: 5 },
  { key: 'xp_500', title: 'XP Collector', description: 'Earn 500 total XP', icon: 'bolt', category: 'milestone', criteriaType: 'total_xp', criteriaValue: 500, xpReward: 50, sortOrder: 6 },
];

async function ensureDefaultAchievements() {
  for (const a of DEFAULT_ACHIEVEMENTS) {
    await Achievement.findOneAndUpdate({ key: a.key }, { $setOnInsert: a }, { upsert: true });
  }
}

async function getStudentAchievements(studentId) {
  await ensureDefaultAchievements();
  const [defs, unlocked] = await Promise.all([
    Achievement.find({ isActive: true }).sort({ sortOrder: 1 }).lean(),
    StudentAchievement.find({ studentId }).lean(),
  ]);
  const unlockedKeys = new Set(unlocked.filter(u => u.isUnlocked).map(u => u.achievementKey));
  return defs.map(d => ({
    ...d,
    isUnlocked: unlockedKeys.has(d.key),
    unlockedAt: unlocked.find(u => u.achievementKey === d.key)?.unlockedAt || null,
  }));
}

async function checkAndUnlock(studentId, context = {}) {
  await ensureDefaultAchievements();
  const stats = await StudentGameStats.findOne({ studentId }).lean();
  const defs = await Achievement.find({ isActive: true }).lean();
  const newlyUnlocked = [];

  for (const def of defs) {
    const already = await StudentAchievement.findOne({ studentId, achievementKey: def.key });
    if (already?.isUnlocked) continue;

    let met = false;
    switch (def.criteriaType) {
      case 'streak_days':
        met = (stats?.currentStreak || 0) >= def.criteriaValue;
        break;
      case 'correct_answers_total':
        met = (stats?.totalCorrectAnswers || 0) >= def.criteriaValue;
        break;
      case 'games_completed':
        met = (stats?.gamesCompleted || 0) >= def.criteriaValue;
        break;
      case 'flawless_game':
        met = context.attempt?.accuracy === 100 && context.attempt?.status === 'completed';
        break;
      case 'fast_completion':
        met = context.attempt?.status === 'completed' && context.attempt?.timeSpentSeconds > 0
          && context.attempt.timeSpentSeconds <= def.criteriaValue;
        break;
      case 'total_xp':
        met = (stats?.totalXp || 0) >= def.criteriaValue;
        break;
      case 'leaderboard_top':
        met = context.leaderboardRank != null && context.leaderboardRank <= def.criteriaValue;
        break;
      default:
        break;
    }

    if (!met) continue;

    await StudentAchievement.findOneAndUpdate(
      { studentId, achievementKey: def.key },
      {
        studentId,
        achievementId: def._id,
        achievementKey: def.key,
        isUnlocked: true,
        unlockedAt: new Date(),
        progress: def.criteriaValue,
      },
      { upsert: true }
    );

    if (def.xpReward > 0) {
      await xpService.award(studentId, null, null, 'bonus', def.xpReward, `Achievement: ${def.title}`);
    }

    newlyUnlocked.push(def);
  }

  return newlyUnlocked;
}

module.exports = { ensureDefaultAchievements, getStudentAchievements, checkAndUnlock };
