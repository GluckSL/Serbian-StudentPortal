const BattlefieldStats = require('../../models/BattlefieldStats');

const K_FACTOR = 32;
const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
const TIER_THRESHOLDS = { bronze: 0, silver: 1100, gold: 1300, platinum: 1500, diamond: 1800 };

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function getTier(elo) {
  let tier = 'bronze';
  for (const t of TIERS) {
    if (elo >= TIER_THRESHOLDS[t]) tier = t;
  }
  return tier;
}

async function getOrCreateStats(studentId) {
  let stats = await BattlefieldStats.findOne({ studentId });
  if (!stats) {
    stats = await BattlefieldStats.create({ studentId });
  }
  return stats;
}

async function recordMatch(winnerId, loserId) {
  const winner = await getOrCreateStats(winnerId);
  const loser = await getOrCreateStats(loserId);

  const eW = expectedScore(winner.elo, loser.elo);
  const eL = expectedScore(loser.elo, winner.elo);

  winner.elo = Math.max(0, Math.round(winner.elo + K_FACTOR * (1 - eW)));
  loser.elo = Math.max(0, Math.round(loser.elo + K_FACTOR * (0 - eL)));

  winner.wins += 1;
  winner.gamesPlayed += 1;
  loser.losses += 1;
  loser.gamesPlayed += 1;

  winner.tier = getTier(winner.elo);
  loser.tier = getTier(loser.elo);

  winner.lastGameAt = new Date();
  loser.lastGameAt = new Date();

  await winner.save();
  await loser.save();

  return {
    winner: { elo: winner.elo, tier: winner.tier, change: Math.round(K_FACTOR * (1 - eW)) },
    loser: { elo: loser.elo, tier: loser.tier, change: Math.round(K_FACTOR * (0 - eL)) },
  };
}

async function recordDraw(studentIdA, studentIdB) {
  const a = await getOrCreateStats(studentIdA);
  const b = await getOrCreateStats(studentIdB);

  const eA = expectedScore(a.elo, b.elo);
  a.elo = Math.max(0, Math.round(a.elo + K_FACTOR * (0.5 - eA)));
  b.elo = Math.max(0, Math.round(b.elo + K_FACTOR * (0.5 - (1 - eA))));

  a.gamesPlayed += 1;
  b.gamesPlayed += 1;
  a.tier = getTier(a.elo);
  b.tier = getTier(b.elo);
  a.lastGameAt = new Date();
  b.lastGameAt = new Date();

  await a.save();
  await b.save();
}

async function getLeaderboard(limit = 50, page = 1) {
  const skip = (page - 1) * limit;
  const [entries, total] = await Promise.all([
    BattlefieldStats.find()
      .sort({ elo: -1 })
      .skip(skip)
      .limit(limit)
      .populate('studentId', 'name username')
      .lean(),
    BattlefieldStats.countDocuments(),
  ]);

  return {
    entries: entries.map((e, i) => ({
      rank: skip + i + 1,
      studentId: e.studentId?._id || e.studentId,
      name: e.studentId?.name || e.studentId?.username || 'Unknown',
      elo: e.elo,
      tier: e.tier,
      wins: e.wins,
      losses: e.losses,
      winRate: e.gamesPlayed > 0 ? Math.round((e.wins / e.gamesPlayed) * 100) : 0,
    })),
    total,
    page,
    limit,
  };
}

async function getStats(studentId) {
  const stats = await getOrCreateStats(studentId);
  return {
    gamesPlayed: stats.gamesPlayed,
    wins: stats.wins,
    losses: stats.losses,
    elo: stats.elo,
    tier: stats.tier,
  };
}

module.exports = {
  recordMatch,
  recordDraw,
  getLeaderboard,
  getStats,
  getOrCreateStats,
};
