// services/interactiveGames/spectator.js — spectator limits & anti-abuse

const ArenaRoom = require('../../models/ArenaRoom');
const config = require('../../config/glueckArena');
const antiCheat = require('./antiCheat');

const roomSpectators = new Map();

function maxSpectatorsPerRoom() {
  return config.multiplayer?.maxSpectatorsPerRoom || 50;
}

async function canSpectate(roomCode, userId) {
  if (!antiCheat.checkSocketRate(userId)) {
    return { ok: false, message: 'Rate limit' };
  }
  const room = await ArenaRoom.findOne({ inviteCode: roomCode.toUpperCase() });
  if (!room) return { ok: false, message: 'Room not found' };
  if (!['playing', 'countdown', 'finished'].includes(room.status)) {
    return { ok: false, message: 'Battle not watchable' };
  }

  const key = room.inviteCode;
  const set = roomSpectators.get(key) || new Set();
  if (!set.has(userId) && set.size >= maxSpectatorsPerRoom()) {
    return { ok: false, message: 'Spectator limit reached' };
  }
  set.add(userId);
  roomSpectators.set(key, set);

  room.spectatorCount = set.size;
  await room.save();

  return { ok: true, room, spectatorCount: set.size, delayMs: config.multiplayer?.spectatorDelayMs || 3000 };
}

function removeSpectator(roomCode, userId) {
  const key = (roomCode || '').toUpperCase();
  const set = roomSpectators.get(key);
  if (set) {
    set.delete(userId);
    if (!set.size) roomSpectators.delete(key);
  }
}

function getSpectatorCount(roomCode) {
  return (roomSpectators.get((roomCode || '').toUpperCase()) || new Set()).size;
}

function getSpectatorMetrics() {
  let total = 0;
  for (const s of roomSpectators.values()) total += s.size;
  return { activeRooms: roomSpectators.size, totalSpectators: total };
}

module.exports = {
  canSpectate,
  removeSpectator,
  getSpectatorCount,
  getSpectatorMetrics,
  maxSpectatorsPerRoom,
};
