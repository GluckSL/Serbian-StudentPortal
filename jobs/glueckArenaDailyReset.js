// jobs/glueckArenaDailyReset.js — expire stale attempts + ensure challenge/achievement seeds

const cron = require('node-cron');
const securityService = require('../services/interactiveGames/security');
const dailyChallengesService = require('../services/interactiveGames/dailyChallenges');
const achievementsService = require('../services/interactiveGames/achievements');
const questsService = require('../services/interactiveGames/quests');
const leaguesService = require('../services/interactiveGames/leagues');
const multiplayerService = require('../services/interactiveGames/multiplayer');
const matchmakingService = require('../services/interactiveGames/matchmaking');
const notificationsService = require('../services/interactiveGames/notifications');
const replayService = require('../services/interactiveGames/replays');

function scheduleGlueckArenaJobs() {
  // Every hour: expire stale in-progress attempts + multiplayer cleanup
  cron.schedule('0 * * * *', async () => {
    try {
      const n = await securityService.expireStaleAttempts();
      if (n > 0) console.log(`[glueck-arena] Expired ${n} stale attempts`);
      const mp = await multiplayerService.cleanupStaleRooms();
      if (mp.expired || mp.disconnected) console.log(`[glueck-arena] MP cleanup:`, mp);
      await matchmakingService.cleanupExpiredQueues();
      const replayDeleted = await replayService.cleanupExpired();
      if (replayDeleted > 0) console.log(`[glueck-arena] Replay cleanup: ${replayDeleted} deleted`);
    } catch (e) {
      console.warn('[glueck-arena] hourly maintenance:', e.message);
    }
  });

  // Every 15 min: process notification queue
  cron.schedule('*/15 * * * *', async () => {
    try {
      const r = await notificationsService.processPending();
      if (r.sent > 0) console.log(`[glueck-arena] Notifications sent: ${r.sent}`);
    } catch (e) { /* ignore */ }
  });

  // Daily 17:00 UTC: streak reminders
  cron.schedule('0 17 * * *', async () => {
    try {
      const q = await notificationsService.scheduleStreakReminders();
      if (q > 0) console.log(`[glueck-arena] Streak reminders queued: ${q}`);
    } catch (e) { /* ignore */ }
  });

  // Daily at 00:05 UTC: ensure challenge + achievement catalogs exist
  cron.schedule('5 0 * * *', async () => {
    try {
      await dailyChallengesService.ensureDefaultChallenges();
      await achievementsService.ensureDefaultAchievements();
      await questsService.ensureDefaultQuests();
      console.log('[glueck-arena] Daily catalog refresh OK');
    } catch (e) {
      console.warn('[glueck-arena] daily catalog refresh:', e.message);
    }
  });

  // Weekly Monday 00:10 UTC — league promotion/relegation
  cron.schedule('10 0 * * 1', async () => {
    try {
      await leaguesService.processWeeklyReset();
      console.log('[glueck-arena] Weekly league reset OK');
    } catch (e) {
      console.warn('[glueck-arena] league reset:', e.message);
    }
  });

  console.log('[glueck-arena] Scheduled daily reset + hourly attempt expiry + weekly leagues');
}

module.exports = { scheduleGlueckArenaJobs };
