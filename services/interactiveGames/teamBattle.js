const BattlefieldTeamBattle = require('../../models/BattlefieldTeamBattle');
const ArenaRoom = require('../../models/ArenaRoom');
const ArenaClassroom = require('../../models/ArenaClassroom');
const ArenaClassroomMember = require('../../models/ArenaClassroomMember');
const crypto = require('crypto');

function inviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function createTeamBattle(adminId, payload) {
  const { title, gameSetId, gameType, teamA, teamB, rounds, startsAt } = payload;
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
    rounds: rounds || 5,
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

  const room = await ArenaRoom.create({
    inviteCode: inviteCode(),
    hostId: adminId,
    gameSetId: battle.gameSetId,
    gameType: battle.gameType,
    roomName: battle.title,
    isPublic: false,
    teamMode: true,
    teamBattleId: battle._id,
    players: [
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
    ],
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
    .lean();
  return battles;
}

module.exports = {
  createTeamBattle,
  startTeamBattle,
  submitTeamAnswer,
  endRound,
  finishTeamBattle,
  listTeamBattles,
};
