const BattlefieldTeamBattle = require('../../models/BattlefieldTeamBattle');
const ArenaRoom = require('../../models/ArenaRoom');
const ArenaClassroom = require('../../models/ArenaClassroom');
const ArenaClassroomMember = require('../../models/ArenaClassroomMember');
const crypto = require('crypto');

function inviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function createTeamBattle(adminId, payload) {
  const { title, gameSetId, gameType, teamA, teamB, startsAt } = payload;
  if (!title || !gameSetId || !gameType || !teamA || !teamB) {
    return { ok: false, message: 'Missing required fields' };
  }
  if (!teamA.name || !teamB.name) {
    return { ok: false, message: 'Team names required' };
  }
  if (!teamA.members?.length || !teamB.members?.length) {
    return { ok: false, message: 'Each team needs at least one member' };
  }

  const battle = await BattlefieldTeamBattle.create({
    createdBy: adminId,
    title,
    gameSetId,
    gameType,
    status: 'pending',
    teamA: {
      name: teamA.name,
      type: teamA.type || 'manual',
      classroomId: teamA.classroomId || null,
      members: teamA.members.map(m => ({ studentId: m.id || m, name: m.name || '' })),
      score: 0,
    },
    teamB: {
      name: teamB.name,
      type: teamB.type || 'manual',
      classroomId: teamB.classroomId || null,
      members: teamB.members.map(m => ({ studentId: m.id || m, name: m.name || '' })),
      score: 0,
    },
    startsAt: startsAt || new Date(),
  });

  return { ok: true, battle };
}

async function startTeamBattle(battleId, adminId) {
  const battle = await BattlefieldTeamBattle.findById(battleId);
  if (!battle) return { ok: false, message: 'Team battle not found' };
  if (battle.status !== 'pending') return { ok: false, message: 'Already started or finished' };
  if (String(battle.createdBy) !== String(adminId)) {
    return { ok: false, message: 'Only creator can start' };
  }

  const allPlayers = [
    ...battle.teamA.members.map(m => ({
      studentId: m.studentId,
      name: m.name,
      isConnected: false,
    })),
    ...battle.teamB.members.map(m => ({
      studentId: m.studentId,
      name: m.name,
      isConnected: false,
    })),
  ];

  const room = await ArenaRoom.create({
    inviteCode: inviteCode(),
    hostId: adminId,
    gameSetId: battle.gameSetId,
    gameType: battle.gameType,
    roomName: battle.title,
    isPublic: false,
    teamMode: true,
    teamBattleId: battle._id,
    maxPlayers: allPlayers.length,
    players: allPlayers,
    status: 'lobby',
    endsAt: new Date(Date.now() + 3600000),
  });

  battle.status = 'active';
  battle.roomCode = room.inviteCode;
  battle.startsAt = new Date();
  await battle.save();

  return { ok: true, battle: battle.toObject(), room: room.toObject() };
}

async function submitTeamAnswer(battleId, studentId, payload) {
  const battle = await BattlefieldTeamBattle.findById(battleId);
  if (!battle || battle.status !== 'active') return { ok: false, message: 'Battle not active' };

  const isTeamA = battle.teamA.members.some(m => String(m.studentId) === String(studentId));
  const isTeamB = battle.teamB.members.some(m => String(m.studentId) === String(studentId));
  if (!isTeamA && !isTeamB) return { ok: false, message: 'Not in this battle' };

  const teamKey = isTeamA ? 'teamA' : 'teamB';
  const member = battle[teamKey].members.find(m => String(m.studentId) === String(studentId));
  if (!member) return { ok: false, message: 'Member not found' };

  member.score += payload.points || 10;
  battle[teamKey].score = battle[teamKey].members.reduce((sum, m) => sum + m.score, 0);
  battle.currentRound = payload.roundIndex != null ? payload.roundIndex + 1 : battle.currentRound;
  await battle.save();

  return { ok: true, battle: battle.toObject() };
}

async function endRound(battleId) {
  const battle = await BattlefieldTeamBattle.findById(battleId);
  if (!battle) return { ok: false, message: 'Not found' };
  if (battle.currentRound >= battle.rounds) {
    return { ok: false, message: 'All rounds complete' };
  }
  return { ok: true, round: battle.currentRound };
}

async function finishTeamBattle(battleId) {
  const battle = await BattlefieldTeamBattle.findById(battleId);
  if (!battle) return { ok: false, message: 'Not found' };
  battle.status = 'finished';

  if (battle.teamA.score > battle.teamB.score) {
    battle.winner = 'teamA';
  } else if (battle.teamB.score > battle.teamA.score) {
    battle.winner = 'teamB';
  } else {
    battle.winner = null;
  }
  await battle.save();
  return { ok: true, battle: battle.toObject() };
}

async function listTeamBattles(filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  const battles = await BattlefieldTeamBattle.find(query)
    .sort({ createdAt: -1 })
    .populate('createdBy', 'name username')
    .populate('gameSetId', 'title')
    .lean();
  return battles;
}

async function getScorecard(battleId) {
  const battle = await BattlefieldTeamBattle.findById(battleId)
    .populate('createdBy', 'name username')
    .populate('gameSetId', 'title')
    .lean();
  if (!battle) return null;

  const sortMembers = team => {
    team.members = (team.members || []).sort((a, b) => (b.score || 0) - (a.score || 0));
    return team;
  };

  battle.teamA = sortMembers(battle.teamA);
  battle.teamB = sortMembers(battle.teamB);

  return battle;
}

async function deleteTeamBattle(battleId) {
  const battle = await BattlefieldTeamBattle.findById(battleId);
  if (!battle) return { ok: false, message: 'Team battle not found' };

  if (battle.roomCode) {
    await ArenaRoom.findOneAndUpdate(
      { inviteCode: battle.roomCode },
      { $set: { status: 'cancelled' } }
    );
  }

  await BattlefieldTeamBattle.findByIdAndDelete(battleId);
  return { ok: true, message: 'Deleted' };
}

async function getStandings() {
  const battles = await BattlefieldTeamBattle.find({ status: 'finished' }).lean();
  const batchMap = {};

  function ensure(batchName) {
    if (!batchMap[batchName]) {
      batchMap[batchName] = { played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0 };
    }
    return batchMap[batchName];
  }

  for (const b of battles) {
    const aBatch = b.teamA?.classroomId;
    const bBatch = b.teamB?.classroomId;
    if (!aBatch || !bBatch) continue;

    const a = ensure(aBatch);
    const bStats = ensure(bBatch);

    a.played++;
    bStats.played++;

    a.pointsFor += b.teamA?.score || 0;
    a.pointsAgainst += b.teamB?.score || 0;
    bStats.pointsFor += b.teamB?.score || 0;
    bStats.pointsAgainst += b.teamA?.score || 0;

    if (b.winner === 'teamA') { a.won++; bStats.lost++; }
    else if (b.winner === 'teamB') { bStats.won++; a.lost++; }
  }

  return Object.entries(batchMap)
    .map(([batch, s]) => ({
      batch,
      played: s.played,
      won: s.won,
      lost: s.lost,
      pointsFor: s.pointsFor,
      pointsAgainst: s.pointsAgainst,
      winRate: s.played > 0 ? +(s.won / s.played).toFixed(3) : 0,
    }))
    .sort((a, b) => b.won - a.won || b.winRate - a.winRate || b.pointsFor - a.pointsFor);
}

module.exports = {
  createTeamBattle,
  startTeamBattle,
  submitTeamAnswer,
  endRound,
  finishTeamBattle,
  listTeamBattles,
  getScorecard,
  getStandings,
  deleteTeamBattle,
};
