// services/interactiveGames/ranked.js — ELO/MMR, placement, decay

const ArenaRankedProfile = require('../../models/ArenaRankedProfile');

const PLACEMENT_GAMES = 5;
const K_FACTOR = 32;
const TIERS = [
  { key: 'bronze', min: 0 },
  { key: 'silver', min: 1100 },
  { key: 'gold', min: 1300 },
  { key: 'diamond', min: 1500 },
];

function tierForMmr(mmr) {
  let tier = 'bronze';
  for (const t of TIERS) {
    if (mmr >= t.min) tier = t.key;
  }
  return tier;
}

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

async function getOrCreateProfile(studentId) {
  let p = await ArenaRankedProfile.findOne({ studentId });
  if (!p) {
    p = await ArenaRankedProfile.create({ studentId });
  }
  return p;
}

async function recordMatchResult(winnerId, loserId) {
  const [winner, loser] = await Promise.all([
    getOrCreateProfile(winnerId),
    getOrCreateProfile(loserId),
  ]);

  const expW = expectedScore(winner.mmr, loser.mmr);
  const expL = expectedScore(loser.mmr, winner.mmr);

  winner.mmr = Math.round(winner.mmr + K_FACTOR * (1 - expW));
  loser.mmr = Math.round(loser.mmr + K_FACTOR * (0 - expL));

  winner.wins += 1;
  loser.losses += 1;
  winner.lastPlayedAt = new Date();
  loser.lastPlayedAt = new Date();

  if (!winner.placementComplete) {
    winner.placementMatchesPlayed += 1;
    if (winner.placementMatchesPlayed >= PLACEMENT_GAMES) winner.placementComplete = true;
  }
  if (!loser.placementComplete) {
    loser.placementMatchesPlayed += 1;
    if (loser.placementMatchesPlayed >= PLACEMENT_GAMES) loser.placementComplete = true;
  }

  winner.tier = tierForMmr(winner.mmr);
  loser.tier = tierForMmr(loser.mmr);

  await Promise.all([winner.save(), loser.save()]);
  return { winner: winner.toObject(), loser: loser.toObject() };
}

async function applySeasonReset(seasonId) {
  await ArenaRankedProfile.updateMany(
    {},
    {
      $set: {
        seasonId,
        mmr: 1000,
        tier: 'bronze',
        placementMatchesPlayed: 0,
        placementComplete: false,
      },
    }
  );
}

async function getLeaderboard(limit = 50) {
  return ArenaRankedProfile.find({ placementComplete: true })
    .sort({ mmr: -1 })
    .limit(limit)
    .populate('studentId', 'name username')
    .lean();
}

module.exports = {
  getOrCreateProfile,
  recordMatchResult,
  applySeasonReset,
  getLeaderboard,
  tierForMmr,
  PLACEMENT_GAMES,
};
