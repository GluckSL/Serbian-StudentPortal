// services/interactiveGames/quests.js — daily / weekly / seasonal quests

const Quest = require('../../models/Quest');
const StudentQuestProgress = require('../../models/StudentQuestProgress');
const GameAttempt = require('../../models/GameAttempt');
const XpTransaction = require('../../models/XpTransaction');
const { dateKey, weekKey } = require('./streaks');
const xpService = require('./xp');
const economyService = require('./economy');

const QUEST_POOLS = {
  daily: [
    { key: 'daily_2_games', title: 'Finish 2 Games', questType: 'games_completed', targetValue: 2, xpReward: 30 },
    { key: 'daily_perfect', title: 'Perfect Accuracy', questType: 'perfect_accuracy', targetValue: 1, xpReward: 40 },
    { key: 'daily_no_mistakes', title: 'No Mistakes', questType: 'no_mistakes', targetValue: 1, xpReward: 35 },
    { key: 'daily_speed', title: 'Speed Run', questType: 'speed_completion', targetValue: 1, xpReward: 25 },
  ],
  weekly: [
    { key: 'weekly_500_xp', title: 'Earn 500 XP', questType: 'xp_earned', targetValue: 500, xpReward: 100 },
    { key: 'weekly_20_games', title: 'Complete 20 Games', questType: 'games_completed', targetValue: 20, xpReward: 120 },
    { key: 'weekly_streak', title: 'Maintain Streak', questType: 'maintain_streak', targetValue: 7, xpReward: 150 },
  ],
  seasonal: [
    { key: 'season_oktoberfest', title: 'Oktoberfest Challenge', questType: 'seasonal_event', targetValue: 10, xpReward: 200, seasonKey: 'oktoberfest' },
    { key: 'season_vocab_marathon', title: 'Vocabulary Marathon', questType: 'games_completed', targetValue: 50, xpReward: 300, seasonKey: 'vocab_marathon' },
  ],
};

async function ensureDefaultQuests() {
  for (const [period, pool] of Object.entries(QUEST_POOLS)) {
    for (const q of pool) {
      await Quest.findOneAndUpdate(
        { key: q.key },
        { $setOnInsert: { ...q, period, isActive: true, poolTag: 'default' } },
        { upsert: true }
      );
    }
  }
}

function periodKeyFor(period) {
  if (period === 'daily') return dateKey();
  if (period === 'weekly') return weekKey();
  return `season-${new Date().getUTCFullYear()}`;
}

async function getStudentQuests(studentId, period = null) {
  await ensureDefaultQuests();
  const periods = period ? [period] : ['daily', 'weekly', 'seasonal'];
  const result = {};

  for (const p of periods) {
    const pk = periodKeyFor(p);
    const defs = await Quest.find({ period: p, isActive: true }).sort({ sortOrder: 1 }).lean();
    const existing = await StudentQuestProgress.find({ studentId, period: p, periodKey: pk }).lean();
    const map = new Map(existing.map(e => [e.questKey, e]));

    const quests = [];
    for (const def of defs) {
      let row = map.get(def.key);
      if (!row) {
        const created = await StudentQuestProgress.create({
          studentId,
          questId: def._id,
          questKey: def.key,
          period: p,
          periodKey: pk,
          targetValue: def.targetValue,
        });
        row = created.toObject();
      }
      quests.push({
        ...row,
        title: def.title,
        description: def.description,
        xpReward: def.xpReward,
        coinReward: def.coinReward,
        questType: def.questType,
      });
    }
    result[p] = { periodKey: pk, quests };
  }

  return result;
}

async function updateFromAttempt(studentId, attempt, xpEarned = 0) {
  const periods = ['daily', 'weekly'];
  for (const p of periods) {
    const pk = periodKeyFor(p);
    const rows = await StudentQuestProgress.find({ studentId, period: p, periodKey: pk, isClaimed: false }).lean();
    if (!rows.length) continue;

    const startOfDay = new Date(dateKey() + 'T00:00:00.000Z');
    const endOfDay = new Date(dateKey() + 'T23:59:59.999Z');
    const [dayXp, dayCompleted] = await Promise.all([
      XpTransaction.aggregate([
        { $match: { studentId, createdAt: { $gte: startOfDay, $lte: endOfDay } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      GameAttempt.countDocuments({ studentId, status: 'completed', completedAt: { $gte: startOfDay, $lte: endOfDay } }),
    ]);

    for (const row of rows) {
      const def = await Quest.findOne({ key: row.questKey }).lean();
      if (!def) continue;
      let progress = row.progress;
      switch (def.questType) {
        case 'games_completed':
          progress = p === 'daily' ? dayCompleted : await GameAttempt.countDocuments({
            studentId, status: 'completed',
            completedAt: { $gte: new Date(pk.includes('W') ? Date.now() - 7 * 86400000 : startOfDay) },
          });
          break;
        case 'xp_earned':
          progress = dayXp[0]?.total || 0;
          break;
        case 'perfect_accuracy':
          if (attempt.accuracy >= 100) progress = 1;
          break;
        case 'no_mistakes':
          if (attempt.correctAnswers === attempt.totalQuestions && attempt.totalQuestions > 0) progress = 1;
          break;
        case 'speed_completion':
          if (attempt.timeSpentSeconds > 0 && attempt.timeSpentSeconds <= 120 && attempt.status === 'completed') progress = 1;
          break;
        case 'maintain_streak': {
          const stats = await require('../../models/StudentGameStats').findOne({ studentId }).lean();
          progress = stats?.currentStreak || 0;
          break;
        }
        default:
          break;
      }
      const isCompleted = progress >= row.targetValue;
      await StudentQuestProgress.updateOne(
        { _id: row._id },
        { $set: { progress, isCompleted, completedAt: isCompleted ? new Date() : null } }
      );
    }
  }
}

async function claimQuest(studentId, progressId) {
  const row = await StudentQuestProgress.findOne({ _id: progressId, studentId });
  if (!row || !row.isCompleted || row.isClaimed) return { ok: false, message: 'Cannot claim' };

  const def = await Quest.findOne({ key: row.questKey }).lean();
  await StudentQuestProgress.updateOne({ _id: row._id }, { $set: { isClaimed: true } });
  if (def?.xpReward) await xpService.award(studentId, null, null, 'quest', def.xpReward, def.title);
  if (def?.coinReward) await economyService.addCoins(studentId, def.coinReward, 'quest_reward');

  return { ok: true, xp: def?.xpReward || 0, coins: def?.coinReward || 0 };
}

module.exports = { ensureDefaultQuests, getStudentQuests, updateFromAttempt, claimQuest };
