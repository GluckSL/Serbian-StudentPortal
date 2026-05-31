// services/interactiveGames/mobileApi.js — compact payloads + offline sync + device sessions

const MobileSyncQueue = require('../../models/MobileSyncQueue');
const MobileDeviceSession = require('../../models/MobileDeviceSession');
const GameSet = require('../../models/GameSet');
const StudentGameStats = require('../../models/StudentGameStats');

async function upsertDeviceSession(studentId, { deviceId, platform, appVersion, pushToken }) {
  if (!deviceId) return null;
  return MobileDeviceSession.findOneAndUpdate(
    { studentId, deviceId },
    {
      $set: {
        platform: platform || 'unknown',
        appVersion: appVersion || '',
        pushToken: pushToken || null,
        lastSeenAt: new Date(),
      },
      $inc: { reconnectCount: 1 },
    },
    { upsert: true, new: true }
  ).lean();
}

/** Compact catalog for mobile clients */
async function getMobileBootstrap(studentId, opts = {}) {
  const compact = opts.compact !== false;
  const [sets, stats, device] = await Promise.all([
    GameSet.find({ isPublished: true, visibleToStudents: true, isArchived: false })
      .select(compact
        ? 'title gameType xpReward icon'
        : 'title gameType difficulty level xpReward icon thumbnailUrl estimatedDurationMinutes')
      .limit(compact ? 30 : 50)
      .lean(),
    StudentGameStats.findOne({ studentId }).lean(),
    opts.deviceId
      ? upsertDeviceSession(studentId, opts)
      : Promise.resolve(null),
  ]);

  return {
    version: 2,
    serverTime: new Date().toISOString(),
    catalog: sets.map(s => compact ? {
      id: s._id,
      title: s.title,
      type: s.gameType,
      xp: s.xpReward,
      icon: s.icon,
    } : {
      id: s._id,
      title: s.title,
      type: s.gameType,
      xp: s.xpReward,
      icon: s.icon,
      thumb: s.thumbnailUrl,
      durationMin: s.estimatedDurationMinutes,
    }),
    stats: stats ? {
      xp: stats.totalXp,
      streak: stats.currentStreak,
      level: stats.arenaLevel || 1,
      games: stats.gamesCompleted,
    } : null,
    device: device ? { deviceId: device.deviceId, reconnectCount: device.reconnectCount } : null,
    socket: {
      path: '/socket.io',
      reconnectMs: 1500,
      heartbeatMs: 15000,
    },
  };
}

async function enqueueSyncAction(studentId, clientId, actionType, payload) {
  const existing = await MobileSyncQueue.findOne({
    studentId,
    clientId,
    actionType,
    status: 'pending',
  });
  if (existing) {
    existing.payload = payload;
    existing.updatedAt = new Date();
    await existing.save();
    return existing;
  }
  return MobileSyncQueue.create({ studentId, clientId, actionType, payload });
}

async function processSyncQueue(studentId, limit = 20) {
  const pending = await MobileSyncQueue.find({ studentId, status: 'pending' })
    .sort({ createdAt: 1 })
    .limit(limit);

  const results = [];
  for (const row of pending) {
    try {
      await MobileSyncQueue.updateOne(
        { _id: row._id },
        { $set: { status: 'processed', processedAt: new Date() } }
      );
      results.push({ id: row._id, clientId: row.clientId, ok: true });
    } catch (e) {
      await MobileSyncQueue.updateOne(
        { _id: row._id },
        { $set: { status: 'failed', errorMessage: e.message } }
      );
      results.push({ id: row._id, ok: false, error: e.message });
    }
  }
  return { processed: results.length, results };
}

async function reconcileOffline(studentId, actions = []) {
  const queued = [];
  for (const a of actions) {
    const row = await enqueueSyncAction(studentId, a.clientId, a.actionType, a.payload);
    queued.push(row._id);
  }
  const processed = await processSyncQueue(studentId, actions.length);
  return { queued: queued.length, ...processed };
}

module.exports = {
  getMobileBootstrap,
  enqueueSyncAction,
  processSyncQueue,
  reconcileOffline,
  upsertDeviceSession,
};
