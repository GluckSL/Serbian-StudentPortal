// services/interactiveGames/tournaments.js — tournament CRUD + brackets + analytics

const ArenaTournament = require('../../models/ArenaTournament');
const User = require('../../models/User');

async function listTournaments(filter = {}) {
  const q = {};
  if (filter.status) q.status = filter.status;
  else if (!filter.includeAll) q.status = { $in: ['scheduled', 'registration', 'active'] };
  if (filter.gameType) q.gameType = filter.gameType;
  return ArenaTournament.find(q).sort({ startsAt: 1 }).limit(50).lean();
}

async function listHistory(limit = 30) {
  return ArenaTournament.find({ status: 'finished' })
    .sort({ endsAt: -1, updatedAt: -1 })
    .limit(limit)
    .lean();
}

async function getTournament(id) {
  const t = await ArenaTournament.findById(id).lean();
  if (!t) return null;
  const names = await populateNames(t);
  return names;
}

async function populateNames(tournament) {
  const ids = [...(tournament.participants || [])];
  (tournament.bracket || []).forEach(m => {
    if (m.playerAId) ids.push(m.playerAId);
    if (m.playerBId) ids.push(m.playerBId);
    if (m.winnerId) ids.push(m.winnerId);
  });
  const unique = [...new Set(ids.map(String))].filter(Boolean);
  const users = unique.length
    ? await User.find({ _id: { $in: unique } }).select('name username').lean()
    : [];
  const map = Object.fromEntries(users.map(u => [String(u._id), u.name || u.username || 'Player']));
  return {
    ...tournament,
    participantNames: (tournament.participants || []).map(id => ({
      id: String(id),
      name: map[String(id)] || 'Player',
    })),
    bracket: (tournament.bracket || []).map(m => ({
      ...m,
      playerAName: m.playerAId ? map[String(m.playerAId)] : null,
      playerBName: m.playerBId ? map[String(m.playerBId)] : null,
      winnerName: m.winnerId ? map[String(m.winnerId)] : null,
    })),
  };
}

async function createTournament(adminId, data) {
  const doc = await ArenaTournament.create({
    title: data.title,
    gameSetId: data.gameSetId,
    gameType: data.gameType,
    startsAt: new Date(data.startsAt),
    endsAt: data.endsAt ? new Date(data.endsAt) : null,
    maxParticipants: data.maxParticipants || 32,
    entryRules: data.entryRules || {},
    rewards: data.rewards || {},
    createdBy: adminId,
    status: data.status || 'draft',
  });
  return doc.toObject();
}

async function updateTournament(id, updates) {
  const allowed = ['title', 'startsAt', 'endsAt', 'maxParticipants', 'entryRules', 'rewards', 'status', 'bracket'];
  const patch = {};
  for (const k of allowed) {
    if (updates[k] !== undefined) patch[k] = updates[k];
  }
  const t = await ArenaTournament.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  return t ? populateNames(t) : null;
}

async function registerParticipant(tournamentId, studentId) {
  const t = await ArenaTournament.findById(tournamentId);
  if (!t) return { ok: false, message: 'Tournament not found' };
  if (!['registration', 'scheduled'].includes(t.status)) {
    return { ok: false, message: 'Registration closed' };
  }
  if (t.participants.length >= t.maxParticipants) return { ok: false, message: 'Full' };
  if (t.participants.some(p => String(p) === String(studentId))) {
    return { ok: true, tournament: await populateNames(t.toObject()) };
  }
  t.participants.push(studentId);
  if (t.status === 'scheduled') t.status = 'registration';
  await t.save();
  return { ok: true, tournament: await populateNames(t.toObject()) };
}

function buildKnockoutBracket(participantIds) {
  const ids = [...participantIds];
  while (ids.length & (ids.length - 1)) ids.push(null);
  const matches = [];
  for (let i = 0; i < ids.length; i += 2) {
    matches.push({
      round: 1,
      playerAId: ids[i],
      playerBId: ids[i + 1],
      status: 'pending',
    });
  }
  return matches;
}

async function startTournament(id) {
  const t = await ArenaTournament.findById(id);
  if (!t) return { ok: false, message: 'Not found' };
  if (t.participants.length < 2) return { ok: false, message: 'Need at least 2 players' };
  t.bracket = buildKnockoutBracket(t.participants);
  t.status = 'active';
  await t.save();
  return { ok: true, tournament: await populateNames(t.toObject()) };
}

async function reportMatchResult(tournamentId, matchIndex, winnerId) {
  const t = await ArenaTournament.findById(tournamentId);
  if (!t || !t.bracket[matchIndex]) return { ok: false, message: 'Invalid match' };
  t.bracket[matchIndex].winnerId = winnerId;
  t.bracket[matchIndex].status = 'finished';
  const allDone = t.bracket.every(m => m.status === 'finished' || !m.playerBId);
  if (allDone) {
    t.status = 'finished';
    t.endsAt = new Date();
  }
  await t.save();
  return { ok: true, tournament: await populateNames(t.toObject()) };
}

async function getTournamentLeaderboard(tournamentId) {
  const t = await getTournament(tournamentId);
  if (!t) return [];
  const scores = {};
  (t.bracket || []).forEach(m => {
    if (m.winnerId) {
      const w = String(m.winnerId);
      scores[w] = (scores[w] || 0) + 1;
    }
  });
  return Object.entries(scores)
    .map(([id, wins]) => ({
      studentId: id,
      name: t.participantNames?.find(p => p.id === id)?.name || 'Player',
      wins,
    }))
    .sort((a, b) => b.wins - a.wins);
}

async function getTournamentAnalytics() {
  const [active, finished, totalParticipants] = await Promise.all([
    ArenaTournament.countDocuments({ status: 'active' }),
    ArenaTournament.countDocuments({ status: 'finished' }),
    ArenaTournament.aggregate([
      { $project: { count: { $size: '$participants' } } },
      { $group: { _id: null, total: { $sum: '$count' } } },
    ]),
  ]);
  return {
    active,
    finished,
    totalParticipants: totalParticipants[0]?.total || 0,
  };
}

module.exports = {
  listTournaments,
  listHistory,
  getTournament,
  createTournament,
  updateTournament,
  registerParticipant,
  startTournament,
  reportMatchResult,
  getTournamentLeaderboard,
  getTournamentAnalytics,
};
