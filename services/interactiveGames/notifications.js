// services/interactiveGames/notifications.js — queue + preferences + workers

const NotificationPreference = require('../../models/NotificationPreference');
const NotificationQueue = require('../../models/NotificationQueue');
const StudentGameStats = require('../../models/StudentGameStats');
const config = require('../../config/glueckArena');

async function getPreferences(userId) {
  return NotificationPreference.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true }
  ).lean();
}

async function updatePreferences(userId, patch) {
  const allowed = [
    'enabled', 'streakReminders', 'leagueReminders', 'challengeReminders',
    'classroomReminders', 'inactivityReminders', 'preferredHourUtc',
    'browserPushToken', 'mobilePushToken',
  ];
  const set = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  return NotificationPreference.findOneAndUpdate({ userId }, { $set: set }, { upsert: true, new: true });
}

async function enqueue(userId, { type, title, body, channel = 'browser', scheduledFor, payload }) {
  return NotificationQueue.create({
    userId,
    type,
    title,
    body: body || '',
    channel,
    scheduledFor: scheduledFor || new Date(),
    payload: payload || {},
  });
}

async function processPending(limit = 50) {
  const now = new Date();
  const pending = await NotificationQueue.find({
    status: 'pending',
    scheduledFor: { $lte: now },
  }).limit(limit);

  let sent = 0;
  for (const n of pending) {
    const prefs = await getPreferences(n.userId);
    if (!prefs.enabled) {
      await NotificationQueue.updateOne({ _id: n._id }, { $set: { status: 'cancelled' } });
      continue;
    }
    // Provider abstraction — log for now; wire FCM/APNs later
    if (config.push.provider === 'none') {
      await NotificationQueue.updateOne({ _id: n._id }, {
        $set: { status: 'sent', sentAt: new Date() },
      });
      sent += 1;
    } else {
      // Future: call FCM/APNs provider
      await NotificationQueue.updateOne({ _id: n._id }, {
        $set: { status: 'sent', sentAt: new Date() },
      });
      sent += 1;
    }
  }
  return { processed: pending.length, sent };
}

/** Schedule streak reminders for inactive users (cron) */
async function scheduleStreakReminders() {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const atRisk = await StudentGameStats.find({
    currentStreak: { $gt: 0 },
    lastPlayedDate: { $lt: yesterday },
  }).limit(200).select('studentId').lean();

  let queued = 0;
  for (const s of atRisk) {
    const prefs = await getPreferences(s.studentId);
    if (!prefs.streakReminders) continue;
    const exists = await NotificationQueue.findOne({
      userId: s.studentId,
      type: 'streak_reminder',
      status: 'pending',
      scheduledFor: { $gte: new Date() },
    });
    if (exists) continue;
    await enqueue(s.studentId, {
      type: 'streak_reminder',
      title: 'Keep your streak alive! 🔥',
      body: 'Play a GlückArena game today to maintain your streak.',
      scheduledFor: new Date(),
    });
    queued += 1;
  }
  return queued;
}

module.exports = {
  getPreferences,
  updatePreferences,
  enqueue,
  processPending,
  scheduleStreakReminders,
};
