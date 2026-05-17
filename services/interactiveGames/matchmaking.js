// services/interactiveGames/matchmaking.js — casual + ranked queues

const ArenaMatchmakingEntry = require('../../models/ArenaMatchmakingEntry');
const multiplayerService = require('./multiplayer');
const GameSet = require('../../models/GameSet');
const StudentGameStats = require('../../models/StudentGameStats');

const QUEUE_TTL_MS = 5 * 60 * 1000;
const SKILL_RANGE = 200;

function skillFromStats(stats) {
  if (!stats) return 1000;
  return 1000 + Math.min(500, (stats.totalXp || 0) / 10) + (stats.currentStreak || 0) * 5;
}

async function joinQueue(studentId, studentName, { mode = 'casual', gameType = 'any', region = 'global' } = {}) {
  await leaveQueue(studentId);
  const stats = await StudentGameStats.findOne({ studentId }).lean();
  const skillRating = skillFromStats(stats);

  const entry = await ArenaMatchmakingEntry.create({
    studentId,
    mode,
    gameType,
    region,
    skillRating,
    expiresAt: new Date(Date.now() + QUEUE_TTL_MS),
  });

  const match = await tryMatch(entry, studentName);
  if (match) return { ok: true, matched: true, ...match };

  const waitSec = Math.max(5, 30 - Math.floor((Date.now() - entry.queuedAt.getTime()) / 1000));
  return {
    ok: true,
    matched: false,
    queueId: entry._id,
    estimatedWaitSeconds: waitSec,
    position: await ArenaMatchmakingEntry.countDocuments({ mode, region, queuedAt: { $lt: entry.queuedAt } }),
  };
}

async function tryMatch(entry, studentName) {
  const opponents = await ArenaMatchmakingEntry.find({
    _id: { $ne: entry._id },
    mode: entry.mode,
    region: entry.region,
    gameType: { $in: [entry.gameType, 'any'] },
    skillRating: { $gte: entry.skillRating - SKILL_RANGE, $lte: entry.skillRating + SKILL_RANGE },
    expiresAt: { $gt: new Date() },
  }).sort({ queuedAt: 1 }).limit(1);

  if (!opponents.length) return null;

  const opp = opponents[0];
  const set = await GameSet.findOne({
    isPublished: true,
    visibleToStudents: true,
    isArchived: false,
    ...(entry.gameType !== 'any' ? { gameType: entry.gameType } : {}),
  }).sort({ updatedAt: -1 });

  if (!set) return null;

  const hostName = studentName;
  const created = await multiplayerService.createRoom(entry.studentId, hostName, set._id, {
    matchmakingMode: entry.mode,
    region: entry.region,
  });
  if (!created.ok) return null;

  const User = require('../../models/User');
  const oppUser = await User.findById(opp.studentId).select('name').lean();
  await multiplayerService.joinRoom(opp.studentId, oppUser?.name || 'Player', created.room.inviteCode);

  await ArenaMatchmakingEntry.deleteMany({ studentId: { $in: [entry.studentId, opp.studentId] } });

  return { room: created.room, opponentId: opp.studentId };
}

async function leaveQueue(studentId) {
  await ArenaMatchmakingEntry.deleteMany({ studentId });
  return { ok: true };
}

async function getQueueStatus(studentId, studentName = 'Player') {
  const entry = await ArenaMatchmakingEntry.findOne({ studentId, expiresAt: { $gt: new Date() } }).lean();
  if (!entry) return { inQueue: false };

  const match = await tryMatch(entry, studentName);
  if (match) return { inQueue: false, matched: true, room: match.room };

  const position = await ArenaMatchmakingEntry.countDocuments({
    mode: entry.mode,
    region: entry.region,
    queuedAt: { $lt: entry.queuedAt },
    expiresAt: { $gt: new Date() },
  });
  const waitMs = Date.now() - new Date(entry.queuedAt).getTime();
  return {
    inQueue: true,
    mode: entry.mode,
    gameType: entry.gameType,
    position: position + 1,
    estimatedWaitSeconds: Math.max(5, 45 - Math.floor(waitMs / 1000)),
    queuedAt: entry.queuedAt,
  };
}

async function cleanupExpiredQueues() {
  const r = await ArenaMatchmakingEntry.deleteMany({ expiresAt: { $lt: new Date() } });
  return r.deletedCount || 0;
}

module.exports = { joinQueue, leaveQueue, getQueueStatus, cleanupExpiredQueues, tryMatch };
