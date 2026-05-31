// services/interactiveGames/leagues.js — weekly leagues with promotion/relegation

const LeagueMembership = require('../../models/LeagueMembership');
const XpTransaction = require('../../models/XpTransaction');
const User = require('../../models/User');
const config = require('../../config/glueckArena');
const { weekKey } = require('./streaks');
const cacheService = require('./cache');

function cohortForTier(tier, studentId) {
  const hash = String(studentId).slice(-4);
  return `${tier}-${hash}`;
}

async function getOrCreateMembership(studentId) {
  const wk = weekKey();
  let m = await LeagueMembership.findOne({ studentId, weekKey: wk });
  if (m) return m;

  const prev = await LeagueMembership.findOne({ studentId }).sort({ weekKey: -1 });
  const tier = prev?.tier || 'bronze';
  m = await LeagueMembership.create({
    studentId,
    weekKey: wk,
    tier,
    cohortId: cohortForTier(tier, studentId),
    weeklyXp: 0,
  });
  return m;
}

async function addWeeklyXp(studentId, amount) {
  if (!amount) return;
  const m = await getOrCreateMembership(studentId);
  await LeagueMembership.updateOne({ _id: m._id }, { $inc: { weeklyXp: amount } });
  await cacheService.del(`league:${m.cohortId}:${m.weekKey}`);
}

async function getLeagueBoard(studentId) {
  const m = await getOrCreateMembership(studentId);
  const cacheKey = `league:${m.cohortId}:${m.weekKey}`;
  const cached = await cacheService.get(cacheKey);
  if (cached) return { ...cached, myMembership: m };

  const members = await LeagueMembership.find({ cohortId: m.cohortId, weekKey: m.weekKey })
    .sort({ weeklyXp: -1 })
    .limit(30)
    .lean();

  const userIds = members.map(x => x.studentId);
  const users = await User.find({ _id: { $in: userIds } }).select('name avatar').lean();
  const userMap = new Map(users.map(u => [String(u._id), u]));

  const leaderboard = members.map((row, i) => ({
    rank: i + 1,
    studentId: row.studentId,
    name: userMap.get(String(row.studentId))?.name || 'Player',
    avatarUrl: userMap.get(String(row.studentId))?.avatar || null,
    weeklyXp: row.weeklyXp,
    tier: row.tier,
    isMe: String(row.studentId) === String(studentId),
  }));

  const myRank = leaderboard.findIndex(e => e.isMe) + 1;
  const payload = {
    weekKey: m.weekKey,
    tier: m.tier,
    tiers: config.leagues.tiers,
    leaderboard,
    myRank: myRank || null,
    promoteTop: config.leagues.promoteTop,
    relegateBottom: config.leagues.relegateBottom,
  };
  await cacheService.set(cacheKey, payload, 120);
  return { ...payload, myMembership: m };
}

/** Weekly cron: promote/relegate */
async function processWeeklyReset() {
  const wk = weekKey();
  const prevDate = new Date();
  prevDate.setUTCDate(prevDate.getUTCDate() - 7);
  const prevWk = weekKey(prevDate);

  const cohorts = await LeagueMembership.distinct('cohortId', { weekKey: prevWk });
  for (const cohortId of cohorts) {
    const ranked = await LeagueMembership.find({ cohortId, weekKey: prevWk })
      .sort({ weeklyXp: -1 })
      .lean();
    const tiers = config.leagues.tiers;
    ranked.forEach((row, idx) => {
      let tierIdx = tiers.indexOf(row.tier);
      if (idx < config.leagues.promoteTop && tierIdx < tiers.length - 1) tierIdx += 1;
      if (idx >= ranked.length - config.leagues.relegateBottom && tierIdx > 0) tierIdx -= 1;
      LeagueMembership.updateOne(
        { _id: row._id },
        { $set: { promoted: idx < config.leagues.promoteTop, relegated: idx >= ranked.length - config.leagues.relegateBottom } }
      ).catch(() => {});
    });
  }
}

module.exports = { getOrCreateMembership, addWeeklyXp, getLeagueBoard, processWeeklyReset };
