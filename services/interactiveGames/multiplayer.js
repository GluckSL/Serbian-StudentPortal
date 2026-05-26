// services/interactiveGames/multiplayer.js — room lifecycle, reconnect, anti-cheat hooks

const crypto = require('crypto');
const ArenaRoom = require('../../models/ArenaRoom');
const GameSet = require('../../models/GameSet');
const config = require('../../config/glueckArena');
const auditLog = require('./auditLog');
const antiCheat = require('./antiCheat');
const battleEngine = require('./battleEngine');

const HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_POINTS_PER_ANSWER = 50;

function inviteCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function sanitizeRoom(room) {
  if (!room) return null;
  const o = room.toObject ? room.toObject() : room;
  return {
    _id: o._id,
    inviteCode: o.inviteCode,
    status: o.status,
    gameType: o.gameType,
    gameSetId: o.gameSetId,
    hostId: o.hostId,
    players: (o.players || []).map(p => ({
      studentId: p.studentId,
      name: p.name,
      score: p.score,
      isReady: p.isReady,
      isConnected: p.isConnected,
      correctAnswers: p.correctAnswers || 0,
      totalAnswers: p.totalAnswers || 0,
    })),
    maxPlayers: o.maxPlayers,
    currentQuestionIndex: o.currentQuestionIndex,
    startedAt: o.startedAt,
    endsAt: o.endsAt,
    rematchVotes: (o.rematchRequestedBy || []).length,
    battle: battleEngine.sanitizeBattlePublic(o.battle),
    roomName: o.roomName || '',
    isPublic: !!o.isPublic,
    teamMode: !!o.teamMode,
  };
}

async function createRoom(hostId, hostName, gameSetId, opts = {}) {
  const set = await GameSet.findById(gameSetId).lean();
  if (!set) return { ok: false, message: 'Game not found' };

  const room = await ArenaRoom.create({
    inviteCode: inviteCode(),
    hostId,
    gameSetId,
    gameType: set.gameType,
    roomName: opts.roomName || `${hostName}'s ${set.gameType.replace(/_/g, ' ')}`,
    isPublic: !!opts.isPublic,
    password: opts.password || null,
    teamMode: !!opts.teamMode,
    players: [{
      studentId: hostId,
      name: hostName,
      isReady: false,
      isConnected: true,
      lastHeartbeatAt: new Date(),
    }],
    maxPlayers: opts.maxPlayers || config.multiplayer.maxPlayers,
    endsAt: new Date(Date.now() + config.multiplayer.roomTtlMinutes * 60000),
    matchmakingMode: opts.matchmakingMode || (opts.isPublic ? 'casual' : 'private'),
    region: opts.region || 'global',
  });

  await auditLog.log({ actorId: hostId, action: 'multiplayer_room_created', resourceId: room._id });
  return { ok: true, room: sanitizeRoom(room) };
}

async function joinRoom(studentId, studentName, code, socketId = null) {
  const room = await ArenaRoom.findOne({
    inviteCode: code.toUpperCase(),
    status: { $in: ['lobby', 'countdown'] },
    endsAt: { $gt: new Date() },
  });
  if (!room) return { ok: false, message: 'Room not found or expired' };

  const existing = room.players.find(p => String(p.studentId) === String(studentId));
  if (existing) {
    existing.isConnected = true;
    existing.lastHeartbeatAt = new Date();
    if (socketId) existing.socketId = socketId;
    await room.save();
    return { ok: true, room: sanitizeRoom(room), isReconnect: true };
  }

  if (room.players.length >= room.maxPlayers) return { ok: false, message: 'Room full' };
  room.players.push({
    studentId,
    name: studentName,
    isConnected: true,
    lastHeartbeatAt: new Date(),
    socketId: socketId || null,
  });
  await room.save();
  return { ok: true, room: sanitizeRoom(room) };
}

async function getRoomByCode(code) {
  const room = await ArenaRoom.findOne({ inviteCode: code.toUpperCase() }).lean();
  return room ? sanitizeRoom(room) : null;
}

async function setPlayerReady(roomId, studentId, ready) {
  const room = await ArenaRoom.findOneAndUpdate(
    { _id: roomId, 'players.studentId': studentId },
    { $set: { 'players.$.isReady': !!ready, 'players.$.lastHeartbeatAt': new Date() } },
    { new: true }
  );
  return room ? sanitizeRoom(room) : null;
}

async function startRoom(roomId, hostId) {
  const room = await ArenaRoom.findOne({ _id: roomId, hostId, status: 'lobby' });
  if (!room) return { ok: false, message: 'Cannot start' };
  if (!room.players.every(p => p.isReady)) return { ok: false, message: 'Not all players ready' };
  if (room.players.length < 1) return { ok: false, message: 'Need at least one player' };

  room.status = 'countdown';
  room.startedAt = new Date();
  await room.save();
  return { ok: true, room: sanitizeRoom(room) };
}

async function beginPlaying(roomId, roomCodeForEmitter = null) {
  const room = await ArenaRoom.findByIdAndUpdate(
    roomId,
    { $set: { status: 'playing', currentQuestionIndex: 0 } },
    { new: true }
  );
  if (!room) return null;

  const init = await battleEngine.initBattle(roomId, sanitizeRoom, buildLeaderboard);
  if (!init.ok) {
    await ArenaRoom.findByIdAndUpdate(roomId, { $set: { status: 'lobby' } });
    return { error: init.message, room: sanitizeRoom(room) };
  }

  if (roomCodeForEmitter) {
    battleEngine.registerRoomEmitter(roomId, (event, payload) => {
      const { getIo } = require('../../sockets/glueckArenaMultiplayer');
      const io = getIo();
      if (io) io.to(`room:${roomCodeForEmitter}`).emit(event, payload);
    });
    await battleEngine.startBattleLoop(roomId, sanitizeRoom, buildLeaderboard);
  }

  const updated = await ArenaRoom.findById(roomId);
  return updated ? sanitizeRoom(updated) : sanitizeRoom(room);
}

async function submitBattleAnswer(roomId, studentId, payload) {
  return battleEngine.submitBattleAnswer(
    roomId,
    studentId,
    payload,
    buildLeaderboard,
    sanitizeRoom
  );
}

async function getBattleSnapshotByCode(code) {
  const room = await ArenaRoom.findOne({ inviteCode: code.toUpperCase() });
  if (!room) return null;
  return {
    room: sanitizeRoom(room),
    snapshot: battleEngine.getBattleSnapshot(room),
  };
}

async function recordAnswer(roomId, studentId, payload) {
  const cheat = antiCheat.validateMultiplayerAnswer(studentId, payload);
  if (!cheat.ok) {
    await auditLog.log({
      actorId: studentId,
      action: 'multiplayer_cheat_blocked',
      resourceId: roomId,
      metadata: { reason: cheat.message },
      severity: 'warn',
    });
    return { ok: false, message: cheat.message };
  }

  const room = await ArenaRoom.findOne({ _id: roomId, status: { $in: ['playing', 'countdown'] } });
  if (!room) return { ok: false, message: 'Room not active' };

  const player = room.players.find(p => String(p.studentId) === String(studentId));
  if (!player) return { ok: false, message: 'Not in room' };

  const points = Math.min(MAX_POINTS_PER_ANSWER, Math.max(0, parseInt(payload.points, 10) || 0));
  player.totalAnswers = (player.totalAnswers || 0) + 1;
  if (payload.isCorrect) {
    player.correctAnswers = (player.correctAnswers || 0) + 1;
    player.score += points || 10;
  }
  player.lastAnswerAt = new Date();
  player.lastHeartbeatAt = new Date();
  await room.save();

  return { ok: true, room: sanitizeRoom(room), leaderboard: buildLeaderboard(room) };
}

function buildLeaderboard(room) {
  return [...(room.players || [])]
    .map((p, i) => ({
      rank: 0,
      studentId: p.studentId,
      name: p.name,
      score: p.score,
      isConnected: p.isConnected,
    }))
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

async function finishRoom(roomId, hostId) {
  const room = await ArenaRoom.findOne({ _id: roomId });
  if (!room) return { ok: false, message: 'Room not found' };
  if (hostId && String(room.hostId) !== String(hostId)) {
    return { ok: false, message: 'Only host can finish' };
  }
  room.status = 'finished';
  await room.save();
  return { ok: true, room: sanitizeRoom(room), results: buildLeaderboard(room) };
}

async function requestRematch(roomId, studentId) {
  const room = await ArenaRoom.findOneAndUpdate(
    { _id: roomId, status: 'finished' },
    { $addToSet: { rematchRequestedBy: studentId } },
    { new: true }
  );
  if (!room) return { ok: false, message: 'Cannot rematch' };
  const votes = room.rematchRequestedBy.length;
  const needed = Math.ceil(room.players.length / 2);
  if (votes >= needed) {
    room.status = 'lobby';
    room.rematchRequestedBy = [];
    room.players.forEach(p => {
      p.score = 0;
      p.correctAnswers = 0;
      p.totalAnswers = 0;
      p.isReady = false;
    });
    room.currentQuestionIndex = 0;
    battleEngine.resetBattleState(room);
    battleEngine.unregisterRoomEmitter(room._id);
    await room.save();
    return { ok: true, rematchAccepted: true, room: sanitizeRoom(room) };
  }
  return { ok: true, rematchAccepted: false, votes, needed };
}

async function heartbeat(roomCode, studentId, socketId) {
  const room = await ArenaRoom.findOne({ inviteCode: roomCode.toUpperCase() });
  if (!room) return null;
  const p = room.players.find(x => String(x.studentId) === String(studentId));
  if (!p) return null;
  p.isConnected = true;
  p.lastHeartbeatAt = new Date();
  if (socketId) p.socketId = socketId;
  await room.save();
  return sanitizeRoom(room);
}

async function handleDisconnect(studentId, socketId) {
  const rooms = await ArenaRoom.find({
    'players.studentId': studentId,
    status: { $in: ['lobby', 'countdown', 'playing'] },
  });
  for (const room of rooms) {
    const p = room.players.find(x => String(x.studentId) === String(studentId));
    if (p && (!socketId || p.socketId === socketId)) {
      p.isConnected = false;
    }
    const anyConnected = room.players.some(x => x.isConnected);
    if (!anyConnected && room.status !== 'playing') {
      room.status = 'cancelled';
    }
    await room.save();
  }
}

async function cleanupStaleRooms() {
  const now = new Date();
  const hbCutoff = new Date(now.getTime() - HEARTBEAT_TIMEOUT_MS);

  const expired = await ArenaRoom.updateMany(
    { endsAt: { $lt: now }, status: { $nin: ['finished', 'cancelled'] } },
    { $set: { status: 'cancelled' } }
  );

  const rooms = await ArenaRoom.find({
    status: { $in: ['lobby', 'countdown', 'playing'] },
  });
  let disconnected = 0;
  for (const room of rooms) {
    let changed = false;
    for (const p of room.players) {
      if (p.isConnected && p.lastHeartbeatAt && p.lastHeartbeatAt < hbCutoff) {
        p.isConnected = false;
        changed = true;
        disconnected += 1;
      }
    }
    if (changed) await room.save();
  }

  return { expired: expired.modifiedCount || 0, disconnected };
}

/** Live room count for metrics */
async function getLiveStats() {
  const [activeRooms, playingRooms, onlinePlayers] = await Promise.all([
    ArenaRoom.countDocuments({ status: { $in: ['lobby', 'countdown', 'playing'] }, endsAt: { $gt: new Date() } }),
    ArenaRoom.countDocuments({ status: 'playing' }),
    ArenaRoom.aggregate([
      { $match: { status: { $in: ['lobby', 'countdown', 'playing'] } } },
      { $unwind: '$players' },
      { $match: { 'players.isConnected': true } },
      { $count: 'count' },
    ]),
  ]);
  return {
    activeRooms,
    playingRooms,
    onlinePlayers: onlinePlayers[0]?.count || 0,
  };
}

async function listPublicRooms(filters = {}) {
  const query = {
    isPublic: true,
    status: { $in: ['lobby', 'playing'] },
    endsAt: { $gt: new Date() },
  };
  if (filters.gameType) query.gameType = filters.gameType;
  if (filters.search) {
    query.roomName = { $regex: filters.search, $options: 'i' };
  }
  const rooms = await ArenaRoom.find(query)
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('hostId', 'name username')
    .lean();
  return rooms.map(r => ({
    inviteCode: r.inviteCode,
    roomName: r.roomName || '',
    gameType: r.gameType,
    hostName: r.hostId?.name || r.hostId?.username || 'Unknown',
    hostId: String(r.hostId?._id || r.hostId),
    playerCount: (r.players || []).filter(p => p.isConnected).length,
    maxPlayers: r.maxPlayers,
    status: r.status,
    isPublic: true,
    hasPassword: !!r.password,
  }));
}

module.exports = {
  createRoom,
  joinRoom,
  getRoomByCode,
  setPlayerReady,
  startRoom,
  beginPlaying,
  submitBattleAnswer,
  getBattleSnapshotByCode,
  recordAnswer,
  finishRoom,
  requestRematch,
  heartbeat,
  handleDisconnect,
  cleanupStaleRooms,
  getLiveStats,
  sanitizeRoom,
  buildLeaderboard,
  listPublicRooms,
};
