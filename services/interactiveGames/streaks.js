// services/interactiveGames/streaks.js — Streak 2.0: freeze, repair, calendar, milestones

const StreakCalendarDay = require('../../models/StreakCalendarDay');
const StudentGameStats = require('../../models/StudentGameStats');
const StudentWallet = require('../../models/StudentWallet');
const config = require('../../config/glueckArena');
const xpService = require('./xp');
const auditLog = require('./auditLog');

function dateKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function weekKey(d = new Date()) {
  const onejan = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - onejan) / 86400000) + onejan.getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

async function ensureWallet(studentId) {
  return StudentWallet.findOneAndUpdate(
    { studentId },
    { $setOnInsert: { studentId, coins: 0, gems: 0 } },
    { upsert: true, new: true }
  );
}

/** Called after each completed game — marks calendar + weekly progress */
async function onGameCompleted(studentId, xpEarned = 0) {
  const key = dateKey();
  await StreakCalendarDay.findOneAndUpdate(
    { studentId, dateKey: key },
    { $set: { status: 'played' }, $inc: { xpEarned, gamesCompleted: 1 } },
    { upsert: true }
  );

  const wk = weekKey();
  const stats = await StudentGameStats.findOne({ studentId });
  if (!stats) return;

  if (stats.weeklyStreakWeekKey !== wk) {
    await StudentGameStats.updateOne(
      { studentId },
      { $set: { weeklyStreakWeekKey: wk, weeklyStreakDays: 1, weeklyStreakRewardClaimed: false } }
    );
  } else {
    const existing = await StreakCalendarDay.findOne({ studentId, dateKey: key }).lean();
    if (existing?.gamesCompleted === 1) {
      await StudentGameStats.updateOne({ studentId }, { $inc: { weeklyStreakDays: 1 } });
    }
  }
}

async function getStreakDashboard(studentId) {
  const stats = await StudentGameStats.findOne({ studentId }).lean();
  const wallet = await ensureWallet(studentId);
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 34);

  const calendar = await StreakCalendarDay.find({
    studentId,
    dateKey: { $gte: dateKey(start), $lte: dateKey(end) },
  }).sort({ dateKey: 1 }).lean();

  const milestones = config.streak.milestones.map((days) => ({
    days,
    xpReward: config.streak.milestoneXp[days] || 0,
    claimed: (stats?.claimedStreakMilestones || []).includes(days),
    unlocked: (stats?.currentStreak || 0) >= days,
  }));

  return {
    currentStreak: stats?.currentStreak || 0,
    bestStreak: stats?.bestStreak || 0,
    streakFreezes: stats?.streakFreezes || 0,
    walletFreezes: wallet.inventory?.find(i => i.itemKey === 'streak_freeze')?.quantity || 0,
    weeklyStreakDays: stats?.weeklyStreakDays || 0,
    weeklyStreakRewardClaimed: stats?.weeklyStreakRewardClaimed || false,
    weeklyRewardXp: config.streak.weeklyRewardXp,
    milestones,
    calendar,
    pushReminderEnabled: stats?.pushReminderEnabled !== false,
    reminderArchitecture: {
      provider: config.push.provider,
      preferredHourUtc: config.push.streakReminderHourUtc,
    },
  };
}

async function useStreakFreeze(studentId, targetDateKey) {
  const stats = await StudentGameStats.findOne({ studentId });
  const wallet = await ensureWallet(studentId);
  const invFreeze = wallet.inventory?.find(i => i.itemKey === 'streak_freeze')?.quantity || 0;
  const freezes = (stats?.streakFreezes || 0) + invFreeze;
  if (freezes < 1) return { ok: false, message: 'No streak freezes available' };

  if (stats?.streakFreezes > 0) {
    await StudentGameStats.updateOne({ studentId }, { $inc: { streakFreezes: -1 } });
  } else {
    await StudentWallet.updateOne(
      { studentId, 'inventory.itemKey': 'streak_freeze' },
      { $inc: { 'inventory.$.quantity': -1 } }
    );
  }

  await StreakCalendarDay.findOneAndUpdate(
    { studentId, dateKey: targetDateKey },
    { $set: { status: 'frozen' } },
    { upsert: true }
  );

  await auditLog.log({ actorId: studentId, action: 'streak_freeze_used', metadata: { targetDateKey } });
  return { ok: true };
}

async function repairStreak(studentId) {
  const stats = await StudentGameStats.findOne({ studentId });
  if (!stats || stats.currentStreak > 0) return { ok: false, message: 'Streak does not need repair' };

  const mk = monthKey();
  if (stats.streakRepairsUsedMonth === mk && stats.streakRepairsCount >= 2) {
    return { ok: false, message: 'Monthly repair limit reached' };
  }

  const wallet = await ensureWallet(studentId);
  if (wallet.gems < config.streak.repairGemCost) {
    return { ok: false, message: 'Not enough gems' };
  }

  await StudentWallet.updateOne({ studentId }, { $inc: { gems: -config.streak.repairGemCost } });
  const restored = Math.max(1, stats.bestStreak > 1 ? Math.min(stats.bestStreak, 7) : 1);
  await StudentGameStats.updateOne(
    { studentId },
    {
      $set: {
        currentStreak: restored,
        streakRepairsUsedMonth: mk,
        lastPlayedDate: new Date(),
      },
      $inc: { streakRepairsCount: stats.streakRepairsUsedMonth === mk ? 1 : 0 },
    }
  );

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await StreakCalendarDay.findOneAndUpdate(
    { studentId, dateKey: dateKey(yesterday) },
    { $set: { status: 'repaired' } },
    { upsert: true }
  );

  await auditLog.log({ actorId: studentId, action: 'streak_repaired', metadata: { restored } });
  return { ok: true, restoredStreak: restored };
}

async function claimWeeklyStreakReward(studentId) {
  const stats = await StudentGameStats.findOne({ studentId });
  if (!stats || stats.weeklyStreakRewardClaimed) return { ok: false, message: 'Already claimed' };
  if ((stats.weeklyStreakDays || 0) < 5) return { ok: false, message: 'Play at least 5 days this week' };

  await StudentGameStats.updateOne({ studentId }, { $set: { weeklyStreakRewardClaimed: true } });
  await xpService.award(studentId, null, null, 'streak_weekly', config.streak.weeklyRewardXp, 'Weekly streak reward');
  return { ok: true, xp: config.streak.weeklyRewardXp };
}

async function claimMilestone(studentId, days) {
  const stats = await StudentGameStats.findOne({ studentId });
  if (!stats || (stats.currentStreak || 0) < days) return { ok: false, message: 'Milestone not reached' };
  if ((stats.claimedStreakMilestones || []).includes(days)) return { ok: false, message: 'Already claimed' };

  const xp = config.streak.milestoneXp[days] || 0;
  await StudentGameStats.updateOne(
    { studentId },
    { $addToSet: { claimedStreakMilestones: days } }
  );
  if (xp > 0) await xpService.award(studentId, null, null, 'streak_milestone', xp, `${days}-day streak`);
  return { ok: true, xp };
}

/** Grant weekly freeze inventory (cron) */
async function grantWeeklyFreeze(studentId) {
  await StudentGameStats.updateOne(
    { studentId },
    { $inc: { streakFreezes: 1 } },
    { upsert: true }
  );
}

module.exports = {
  onGameCompleted,
  getStreakDashboard,
  useStreakFreeze,
  repairStreak,
  claimWeeklyStreakReward,
  claimMilestone,
  grantWeeklyFreeze,
  dateKey,
  weekKey,
};
