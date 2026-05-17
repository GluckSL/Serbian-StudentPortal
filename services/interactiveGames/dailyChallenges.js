// services/interactiveGames/dailyChallenges.js

const DailyChallenge = require('../../models/DailyChallenge');
const StudentDailyChallenge = require('../../models/StudentDailyChallenge');
const StudentGameStats = require('../../models/StudentGameStats');
const GameAttempt = require('../../models/GameAttempt');
const xpService = require('./xp');

function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

const DEFAULT_CHALLENGES = [
  { key: 'play_3_games', title: 'Play 3 Games', description: 'Complete 3 GlückArena games today', challengeType: 'games_completed', targetValue: 3, xpReward: 30, sortOrder: 1 },
  { key: 'earn_50_xp', title: 'Earn 50 XP', description: 'Earn at least 50 XP today', challengeType: 'xp_earned', targetValue: 50, xpReward: 25, sortOrder: 2 },
  { key: 'perfect_accuracy', title: 'Perfect Round', description: 'Finish one game with 100% accuracy', challengeType: 'perfect_accuracy', targetValue: 1, xpReward: 40, sortOrder: 3 },
];

async function ensureDefaultChallenges() {
  for (const c of DEFAULT_CHALLENGES) {
    await DailyChallenge.findOneAndUpdate({ key: c.key }, { $setOnInsert: c }, { upsert: true });
  }
}

async function getOrCreateStudentChallenges(studentId) {
  await ensureDefaultChallenges();
  const dateKey = todayKey();
  const defs = await DailyChallenge.find({ isActive: true }).sort({ sortOrder: 1 }).lean();

  const existing = await StudentDailyChallenge.find({ studentId, dateKey }).lean();
  const byKey = new Map(existing.map(e => [e.challengeKey, e]));

  const docs = [];
  for (const def of defs) {
    if (byKey.has(def.key)) {
      docs.push(byKey.get(def.key));
      continue;
    }
    const created = await StudentDailyChallenge.create({
      studentId,
      challengeId: def._id,
      challengeKey: def.key,
      dateKey,
      targetValue: def.targetValue,
      progress: 0,
    });
    docs.push(created.toObject());
  }

  return { dateKey, challenges: await enrichChallenges(docs, defs) };
}

async function enrichChallenges(rows, defs) {
  const defMap = new Map(defs.map(d => [d.key, d]));
  return rows.map(r => ({
    ...r,
    title: defMap.get(r.challengeKey)?.title,
    description: defMap.get(r.challengeKey)?.description,
    xpReward: defMap.get(r.challengeKey)?.xpReward ?? 0,
    challengeType: defMap.get(r.challengeKey)?.challengeType,
  }));
}

async function updateProgressFromAttempt(studentId, attempt, xpEarned = 0) {
  const dateKey = todayKey();
  const startOfDay = new Date(dateKey + 'T00:00:00.000Z');
  const endOfDay = new Date(dateKey + 'T23:59:59.999Z');

  const rows = await StudentDailyChallenge.find({ studentId, dateKey, isClaimed: false }).lean();
  if (!rows.length) return;

  const [dayXp, dayCompleted] = await Promise.all([
    require('../../models/XpTransaction').aggregate([
      { $match: { studentId, createdAt: { $gte: startOfDay, $lte: endOfDay } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    GameAttempt.countDocuments({ studentId, status: 'completed', completedAt: { $gte: startOfDay, $lte: endOfDay } }),
  ]);

  const totalXpToday = dayXp[0]?.total || 0;
  const defs = await DailyChallenge.find({ isActive: true }).lean();
  const defByKey = new Map(defs.map(d => [d.key, d]));

  for (const row of rows) {
    const def = defByKey.get(row.challengeKey);
    if (!def) continue;

    let progress = row.progress;
    switch (def.challengeType) {
      case 'games_completed':
        progress = dayCompleted;
        break;
      case 'xp_earned':
        progress = totalXpToday;
        break;
      case 'perfect_accuracy':
        if (attempt?.accuracy === 100) progress = Math.max(progress, 1);
        break;
      case 'time_limit_complete':
        if (attempt?.status === 'completed' && attempt.timeSpentSeconds > 0 && attempt.timeSpentSeconds <= 300) {
          progress = Math.max(progress, 1);
        }
        break;
      case 'correct_answers':
        progress += attempt?.correctAnswers || 0;
        break;
      default:
        break;
    }

    const isCompleted = progress >= row.targetValue;
    await StudentDailyChallenge.findByIdAndUpdate(row._id, {
      progress,
      isCompleted,
      completedAt: isCompleted && !row.isCompleted ? new Date() : row.completedAt,
    });
  }
}

async function claimChallenge(studentId, progressId) {
  const row = await StudentDailyChallenge.findOne({ _id: progressId, studentId });
  if (!row) return { ok: false, message: 'Challenge not found' };
  if (!row.isCompleted) return { ok: false, message: 'Challenge not completed yet' };
  if (row.isClaimed) return { ok: false, message: 'Already claimed' };

  const def = await DailyChallenge.findById(row.challengeId).lean();
  const xp = def?.xpReward || 0;

  row.isClaimed = true;
  row.claimedAt = new Date();
  await row.save();

  if (xp > 0) {
    await xpService.award(studentId, null, null, 'bonus', xp, 'Daily challenge reward');
    await StudentGameStats.findOneAndUpdate(
      { studentId },
      { $inc: { totalXp: xp } },
      { upsert: true }
    );
  }

  return { ok: true, xpReward: xp };
}

module.exports = {
  ensureDefaultChallenges,
  getOrCreateStudentChallenges,
  updateProgressFromAttempt,
  claimChallenge,
  todayKey,
};
