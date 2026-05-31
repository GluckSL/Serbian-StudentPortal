// services/interactiveGames/replays.js — battle replay storage & playback

const crypto = require('crypto');
const ArenaBattleReplay = require('../../models/ArenaBattleReplay');
const config = require('../../config/glueckArena');

const activeBuffers = new Map();

function bufferKey(roomId) {
  return String(roomId);
}

function startRecording(roomId, meta = {}) {
  activeBuffers.set(bufferKey(roomId), {
    startedAt: Date.now(),
    meta,
    events: [],
  });
}

function recordEvent(roomId, type, data = {}) {
  const buf = activeBuffers.get(bufferKey(roomId));
  if (!buf) return;
  buf.events.push({
    t: Date.now() - buf.startedAt,
    type,
    data: sanitizeEventData(data),
  });
}

function sanitizeEventData(data) {
  const o = { ...data };
  delete o.questionDocs;
  delete o.correctAnswer;
  return o;
}

async function finalizeRecording(roomId, summary = {}) {
  const key = bufferKey(roomId);
  const buf = activeBuffers.get(key);
  activeBuffers.delete(key);
  if (!buf || !buf.events.length) return null;

  const ttlDays = config.replay?.retentionDays || 30;
  const shareToken = crypto.randomBytes(12).toString('hex');
  const doc = await ArenaBattleReplay.create({
    roomId,
    inviteCode: summary.inviteCode,
    gameType: summary.gameType,
    gameSetId: summary.gameSetId,
    tournamentId: summary.tournamentId || null,
    shareToken,
    durationMs: Date.now() - buf.startedAt,
    playerCount: summary.playerCount || 0,
    winnerId: summary.winnerId || null,
    highlights: extractHighlights(buf.events),
    events: compressEvents(buf.events),
    compressedSize: buf.events.length,
    expiresAt: new Date(Date.now() + ttlDays * 86400000),
  });
  return doc.toObject();
}

function compressEvents(events) {
  const max = config.replay?.maxEvents || 500;
  if (events.length <= max) return events;
  const step = Math.ceil(events.length / max);
  return events.filter((_, i) => i % step === 0);
}

function extractHighlights(events) {
  return events
    .filter(e => ['fastest_answer', 'battle_finish', 'combo_streak'].includes(e.type))
    .slice(0, 10)
    .map(e => e.type);
}

async function getReplay(idOrToken) {
  const q = idOrToken.length === 24
    ? { _id: idOrToken }
    : { shareToken: idOrToken };
  return ArenaBattleReplay.findOne(q).lean();
}

async function listReplays(filter = {}, limit = 20) {
  const q = {};
  if (filter.roomId) q.roomId = filter.roomId;
  if (filter.tournamentId) q.tournamentId = filter.tournamentId;
  return ArenaBattleReplay.find(q).sort({ createdAt: -1 }).limit(limit).select('-events').lean();
}

async function getReplayTimeline(idOrToken) {
  const replay = await getReplay(idOrToken);
  if (!replay) return null;
  return {
    id: replay._id,
    shareToken: replay.shareToken,
    gameType: replay.gameType,
    durationMs: replay.durationMs,
    highlights: replay.highlights,
    events: replay.events,
    createdAt: replay.createdAt,
  };
}

async function cleanupExpired() {
  const r = await ArenaBattleReplay.deleteMany({ expiresAt: { $lt: new Date() } });
  return r.deletedCount || 0;
}

async function getReplayAnalytics() {
  const [total, last24h] = await Promise.all([
    ArenaBattleReplay.countDocuments(),
    ArenaBattleReplay.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } }),
  ]);
  return { total, last24h };
}

module.exports = {
  startRecording,
  recordEvent,
  finalizeRecording,
  getReplay,
  listReplays,
  getReplayTimeline,
  cleanupExpired,
  getReplayAnalytics,
};
