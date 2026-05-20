// routes/interactiveGames.js
// GlückArena — Interactive Games API
// Mount: app.use('/api/interactive-games', require('./routes/interactiveGames'))

const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const interactiveGamesController = require('../controllers/interactiveGamesController');
const gaExt = require('../controllers/glueckArenaExtensions');
const { arenaApiLimiter } = require('../middleware/glueckArenaRateLimit');

// ── Health ─────────────────────────────────────────────────────────────────────
router.get('/health', gaExt.publicHealth);
router.get('/health/legacy', (_req, res) => res.json({ ok: true, module: 'GlückArena' }));
router.get('/config/features', verifyToken, gaExt.getFeatureFlags);

router.use(arenaApiLimiter);

// ── Student routes (all require auth) ─────────────────────────────────────────

// Catalog: GET /api/interactive-games?page=1&limit=12&gameType=...&level=...
router.get('/', verifyToken, interactiveGamesController.getCatalog);

// Student stats summary
router.get('/me/stats', verifyToken, checkRole(['STUDENT']), interactiveGamesController.getMyStats);
router.get('/me/arena-access', verifyToken, checkRole(['STUDENT']), interactiveGamesController.getArenaAccess);

// Global leaderboard: GET /api/interactive-games/leaderboard/global?period=daily|weekly|all
router.get('/leaderboard/global', verifyToken, interactiveGamesController.getGlobalLeaderboard);

// Daily challenges & achievements
router.get('/daily-challenges', verifyToken, checkRole(['STUDENT']), interactiveGamesController.getDailyChallenges);
router.post('/daily-challenges/:progressId/claim', verifyToken, checkRole(['STUDENT']), interactiveGamesController.claimDailyChallenge);
router.get('/achievements', verifyToken, interactiveGamesController.getAchievements);

// ── Streak 2.0 ────────────────────────────────────────────────────────────────
router.get('/me/streak', verifyToken, checkRole(['STUDENT']), gaExt.getStreakDashboard);
router.post('/me/streak/freeze', verifyToken, checkRole(['STUDENT']), gaExt.useStreakFreeze);
router.post('/me/streak/repair', verifyToken, checkRole(['STUDENT']), gaExt.repairStreak);
router.post('/me/streak/weekly-claim', verifyToken, checkRole(['STUDENT']), gaExt.claimWeeklyStreakReward);
router.post('/me/streak/milestone/:days/claim', verifyToken, checkRole(['STUDENT']), gaExt.claimStreakMilestone);

// ── Quests ────────────────────────────────────────────────────────────────────
router.get('/quests', verifyToken, checkRole(['STUDENT']), gaExt.getQuests);
router.post('/quests/:progressId/claim', verifyToken, checkRole(['STUDENT']), gaExt.claimQuest);

// ── Leagues ───────────────────────────────────────────────────────────────────
router.get('/leagues/me', verifyToken, gaExt.getMyLeague);

// ── Economy ───────────────────────────────────────────────────────────────────
router.get('/me/wallet', verifyToken, checkRole(['STUDENT']), gaExt.getWallet);
router.post('/me/wallet/daily-wheel', verifyToken, checkRole(['STUDENT']), gaExt.spinDailyWheel);
router.post('/me/wallet/buy-freeze', verifyToken, checkRole(['STUDENT']), gaExt.buyStreakFreeze);

// ── Profile ───────────────────────────────────────────────────────────────────
router.get('/me/profile', verifyToken, gaExt.getArenaProfile);
router.put('/me/profile', verifyToken, gaExt.updateArenaProfile);
router.get('/profiles/:studentId', verifyToken, gaExt.getArenaProfile);

// ── Multiplayer ─────────────────────────────────────────────────────────────
router.post('/multiplayer/rooms', verifyToken, checkRole(['STUDENT']), gaExt.createMultiplayerRoom);
router.post('/multiplayer/join', verifyToken, checkRole(['STUDENT']), gaExt.joinMultiplayerRoom);
router.get('/multiplayer/rooms/:code', verifyToken, gaExt.getMultiplayerRoom);

router.get('/tournaments', verifyToken, gaExt.listTournaments);
router.get('/tournaments/history', verifyToken, gaExt.getTournamentHistory);
router.get('/tournaments/:id', verifyToken, gaExt.getTournament);
router.get('/tournaments/:id/leaderboard', verifyToken, gaExt.getTournamentLeaderboard);
router.post('/tournaments', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.createTournament);
router.patch('/tournaments/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.updateTournament);
router.post('/tournaments/:id/register', verifyToken, checkRole(['STUDENT']), gaExt.registerTournament);
router.post('/tournaments/:id/start', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.startTournament);

router.get('/replays', verifyToken, gaExt.listReplays);
router.get('/replays/:idOrToken', verifyToken, gaExt.getReplay);

router.get('/ranked/me', verifyToken, checkRole(['STUDENT']), gaExt.getMyRankedProfile);
router.get('/ranked/leaderboard', verifyToken, gaExt.getRankedLeaderboard);

router.post('/matchmaking/join', verifyToken, checkRole(['STUDENT']), gaExt.joinMatchmaking);
router.post('/matchmaking/leave', verifyToken, checkRole(['STUDENT']), gaExt.leaveMatchmaking);
router.get('/matchmaking/status', verifyToken, checkRole(['STUDENT']), gaExt.getMatchmakingStatus);

router.get('/me/adaptive-learning', verifyToken, gaExt.getAdaptiveInsights);
router.post('/me/adaptive-learning/refresh', verifyToken, gaExt.refreshAdaptiveInsights);

router.get('/me/notifications/preferences', verifyToken, gaExt.getNotificationPreferences);
router.put('/me/notifications/preferences', verifyToken, gaExt.updateNotificationPreferences);

router.get('/me/premium', verifyToken, gaExt.getPremiumStatus);

// ── Classrooms ────────────────────────────────────────────────────────────────
router.get('/classrooms', verifyToken, gaExt.listMyClassrooms);
router.post('/classrooms', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), gaExt.createClassroom);
router.post('/classrooms/join', verifyToken, checkRole(['STUDENT']), gaExt.joinClassroom);
router.post('/classrooms/:classroomId/assignments', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), gaExt.assignClassroomGame);
router.get('/classrooms/:classroomId/analytics', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), gaExt.getClassroomAnalytics);

// ── Mobile API ────────────────────────────────────────────────────────────────
router.get('/mobile/bootstrap', verifyToken, gaExt.mobileBootstrap);
router.post('/mobile/bootstrap', verifyToken, gaExt.mobileBootstrap);
router.post('/mobile/sync/enqueue', verifyToken, gaExt.mobileSyncEnqueue);
router.post('/mobile/sync/process', verifyToken, gaExt.mobileSyncProcess);
router.post('/mobile/sync/reconcile', verifyToken, gaExt.mobileReconcile);

// ── Admin routes (before /:id) ───────────────────────────────────────────────
const adminRoles = ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'];

router.get('/admin/analytics', verifyToken, checkRole(adminRoles), interactiveGamesController.adminAnalytics);
router.get('/admin/teacher-analytics', verifyToken, checkRole(adminRoles), interactiveGamesController.teacherAnalytics);
router.get('/admin/analytics/advanced', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminAdvancedAnalytics);
router.get('/admin/economy', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminEconomyDashboard);
router.get('/admin/audit-logs', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminAuditLogs);
router.post('/admin/ai/generate-preview', verifyToken, checkRole(adminRoles), gaExt.aiGeneratePreview);
router.get('/admin/analytics/enterprise', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminEnterpriseAnalytics);
router.get('/admin/teacher-analytics/enterprise', verifyToken, checkRole(adminRoles), gaExt.teacherEnterpriseAnalytics);
router.get('/admin/metrics', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminMetrics);
router.get('/admin/env', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminEnvValidation);
router.get('/admin/anti-cheat', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminAntiCheat);
router.get('/admin/multiplayer/live', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminLiveMultiplayer);
router.get('/admin/observability', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminObservability);
router.get('/admin/audit-viewer', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminAuditViewer);
router.get('/admin/tournaments', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminListTournaments);
router.get('/admin/tournaments/analytics', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminTournamentAnalytics);
router.post('/admin/premium/grant', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), gaExt.adminGrantPremium);

// Per-game detail (question count, no answers)
router.get('/:id', verifyToken, interactiveGamesController.getGameDetail);

// Per-game leaderboard
router.get('/:id/leaderboard', verifyToken, interactiveGamesController.getGameLeaderboard);

// Start attempt
router.post('/:id/attempts', verifyToken, checkRole(['STUDENT']), interactiveGamesController.startAttempt);

// Submit a single answer during play
router.post('/attempts/:attemptId/slots', verifyToken, checkRole(['STUDENT']), interactiveGamesController.submitSentenceSlot);
router.post('/attempts/:attemptId/image-match', verifyToken, checkRole(['STUDENT']), interactiveGamesController.submitImageMatchSlot);
router.post('/attempts/:attemptId/answers', verifyToken, checkRole(['STUDENT']), interactiveGamesController.submitAnswer);

// Finalize / complete the session
router.post('/attempts/:attemptId/complete', verifyToken, checkRole(['STUDENT']), interactiveGamesController.completeAttempt);

// Abandon the session
router.post('/attempts/:attemptId/abandon', verifyToken, checkRole(['STUDENT']), interactiveGamesController.abandonAttempt);

// Game set list + create
router.get('/admin/sets', verifyToken, checkRole(adminRoles), interactiveGamesController.adminListSets);
router.post('/admin/sets', verifyToken, checkRole(adminRoles), interactiveGamesController.adminCreateSet);

// Single set: get / update / delete
router.get('/admin/sets/:id', verifyToken, checkRole(adminRoles), interactiveGamesController.adminGetSet);
router.put('/admin/sets/:id', verifyToken, checkRole(adminRoles), interactiveGamesController.adminUpdateSet);
router.delete('/admin/sets/:id', verifyToken, checkRole(adminRoles), interactiveGamesController.adminDeleteSet);

// Thumbnail upload
router.post('/admin/sets/:id/thumbnail', verifyToken, checkRole(adminRoles), interactiveGamesController.adminUploadThumbnail);

// Question management
router.get('/admin/sets/:id/questions', verifyToken, checkRole(adminRoles), interactiveGamesController.adminGetQuestions);
router.post('/admin/sets/:id/questions', verifyToken, checkRole(adminRoles), interactiveGamesController.adminUpsertQuestions);
router.put('/admin/questions/:qid', verifyToken, checkRole(adminRoles), interactiveGamesController.adminUpdateQuestion);
router.delete('/admin/questions/:qid', verifyToken, checkRole(adminRoles), interactiveGamesController.adminDeleteQuestion);

// Scramble Rush level management
router.get('/admin/sets/:id/levels', verifyToken, checkRole(adminRoles), interactiveGamesController.adminGetLevels);
router.put('/admin/sets/:id/levels', verifyToken, checkRole(adminRoles), interactiveGamesController.adminUpsertLevels);

// Bulk import
router.get('/admin/sets/:id/import/template', verifyToken, checkRole(adminRoles), interactiveGamesController.adminImportTemplate);
router.post('/admin/sets/:id/import/preview', verifyToken, checkRole(adminRoles), interactiveGamesController.adminImportPreview);
router.post('/admin/sets/:id/import/commit', verifyToken, checkRole(adminRoles), interactiveGamesController.adminImportCommit);

// Question audio upload
router.post('/admin/questions/:qid/audio', verifyToken, checkRole(adminRoles), interactiveGamesController.adminUploadQuestionAudio);

// Question image upload
router.post('/admin/questions/:qid/image', verifyToken, checkRole(adminRoles), interactiveGamesController.adminUploadQuestionImage);

// Image matching pair image upload (targets a specific pair index within a question)
router.post('/admin/questions/:qid/pair-image/:pairIndex', verifyToken, checkRole(adminRoles), interactiveGamesController.adminUploadPairImage);

module.exports = router;
