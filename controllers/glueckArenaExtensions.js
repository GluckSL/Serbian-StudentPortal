// controllers/glueckArenaExtensions.js — Phases 9–20 API handlers

const streaksService = require('../services/interactiveGames/streaks');
const questsService = require('../services/interactiveGames/quests');
const leaguesService = require('../services/interactiveGames/leagues');
const economyService = require('../services/interactiveGames/economy');
const arenaProfileService = require('../services/interactiveGames/arenaProfile');
const multiplayerService = require('../services/interactiveGames/multiplayer');
const classroomsService = require('../services/interactiveGames/classrooms');
const aiContentService = require('../services/interactiveGames/aiContent');
const mobileApiService = require('../services/interactiveGames/mobileApi');
const advancedAnalyticsService = require('../services/interactiveGames/advancedAnalytics');
const auditLogService = require('../services/interactiveGames/auditLog');
const gaConfig = require('../config/glueckArena');
const matchmakingService = require('../services/interactiveGames/matchmaking');
const adaptiveLearningService = require('../services/interactiveGames/adaptiveLearning');
const notificationsService = require('../services/interactiveGames/notifications');
const premiumService = require('../services/interactiveGames/premium');
const enterpriseAnalyticsService = require('../services/interactiveGames/enterpriseAnalytics');
const productionHealthService = require('../services/interactiveGames/productionHealth');
const antiCheatService = require('../services/interactiveGames/antiCheat');
const battleEngine = require('../services/interactiveGames/battleEngine');
const tournamentsService = require('../services/interactiveGames/tournaments');
const rankedService = require('../services/interactiveGames/ranked');
const replayService = require('../services/interactiveGames/replays');
const observabilityService = require('../services/interactiveGames/observability');
const { getOnlineSocketCount } = require('../sockets/glueckArenaMultiplayer');

function serverError(res, err) {
  console.error('[glueck-arena]', err);
  return res.status(500).json({ success: false, message: err.message || 'Server error' });
}

// ── Streak 2.0 ────────────────────────────────────────────────────────────────
exports.getStreakDashboard = async (req, res) => {
  try {
    const data = await streaksService.getStreakDashboard(req.user.id);
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

exports.useStreakFreeze = async (req, res) => {
  try {
    const result = await streaksService.useStreakFreeze(req.user.id, req.body.dateKey);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

exports.repairStreak = async (req, res) => {
  try {
    const result = await streaksService.repairStreak(req.user.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

exports.claimWeeklyStreakReward = async (req, res) => {
  try {
    const result = await streaksService.claimWeeklyStreakReward(req.user.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

exports.claimStreakMilestone = async (req, res) => {
  try {
    const days = parseInt(req.params.days, 10);
    const result = await streaksService.claimMilestone(req.user.id, days);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

// ── Quests ────────────────────────────────────────────────────────────────────
exports.getQuests = async (req, res) => {
  try {
    const data = await questsService.getStudentQuests(req.user.id, req.query.period || null);
    res.json({ success: true, quests: data });
  } catch (err) { serverError(res, err); }
};

exports.claimQuest = async (req, res) => {
  try {
    const result = await questsService.claimQuest(req.user.id, req.params.progressId);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

// ── Leagues ───────────────────────────────────────────────────────────────────
exports.getMyLeague = async (req, res) => {
  try {
    const data = await leaguesService.getLeagueBoard(req.user.id);
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

// ── Economy ───────────────────────────────────────────────────────────────────
exports.getWallet = async (req, res) => {
  try {
    const wallet = await economyService.getWallet(req.user.id);
    res.json({ success: true, wallet });
  } catch (err) { serverError(res, err); }
};

exports.spinDailyWheel = async (req, res) => {
  try {
    const result = await economyService.spinDailyWheel(req.user.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

exports.buyStreakFreeze = async (req, res) => {
  try {
    const result = await economyService.buyStreakFreeze(req.user.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

// ── Profile ───────────────────────────────────────────────────────────────────
exports.getArenaProfile = async (req, res) => {
  try {
    const studentId = req.params.studentId || req.user.id;
    const data = await arenaProfileService.getProfile(studentId, req.user.id);
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

exports.updateArenaProfile = async (req, res) => {
  try {
    const profile = await arenaProfileService.updateProfile(req.user.id, req.body);
    res.json({ success: true, profile });
  } catch (err) { serverError(res, err); }
};

// ── Multiplayer ───────────────────────────────────────────────────────────────
exports.createMultiplayerRoom = async (req, res) => {
  try {
    const result = await multiplayerService.createRoom(req.user.id, req.user.name || 'Player', req.body.gameSetId);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, room: result.room });
  } catch (err) { serverError(res, err); }
};

exports.joinMultiplayerRoom = async (req, res) => {
  try {
    const result = await multiplayerService.joinRoom(req.user.id, req.user.name || 'Player', req.body.code);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, room: result.room });
  } catch (err) { serverError(res, err); }
};

exports.getMultiplayerRoom = async (req, res) => {
  try {
    const room = await multiplayerService.getRoomByCode(req.params.code);
    if (!room) return res.status(404).json({ success: false, message: 'Room not found' });
    res.json({ success: true, room });
  } catch (err) { serverError(res, err); }
};

// ── Classrooms ────────────────────────────────────────────────────────────────
exports.createClassroom = async (req, res) => {
  try {
    const room = await classroomsService.createClassroom(req.user.id, req.body);
    res.json({ success: true, classroom: room });
  } catch (err) { serverError(res, err); }
};

exports.joinClassroom = async (req, res) => {
  try {
    const result = await classroomsService.joinByCode(req.user.id, req.body.classCode);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, classroom: result.classroom });
  } catch (err) { serverError(res, err); }
};

exports.listMyClassrooms = async (req, res) => {
  try {
    const isTeacher = ['TEACHER', 'TEACHER_ADMIN', 'ADMIN'].includes(req.user.role);
    const list = isTeacher
      ? await classroomsService.listTeacherClassrooms(req.user.id)
      : await classroomsService.listStudentClassrooms(req.user.id);
    res.json({ success: true, classrooms: list });
  } catch (err) { serverError(res, err); }
};

exports.assignClassroomGame = async (req, res) => {
  try {
    const result = await classroomsService.assignGame(req.user.id, req.params.classroomId, req.body);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, assignment: result.assignment });
  } catch (err) { serverError(res, err); }
};

exports.getClassroomAnalytics = async (req, res) => {
  try {
    const data = await classroomsService.getClassroomAnalytics(req.user.id, req.params.classroomId);
    if (!data) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

// ── AI content ────────────────────────────────────────────────────────────────
exports.aiGeneratePreview = async (req, res) => {
  try {
    const result = await aiContentService.generatePreview(req.user.id, req.body);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

// ── Mobile ────────────────────────────────────────────────────────────────────
exports.mobileBootstrap = async (req, res) => {
  try {
    const compact = req.query.compact !== 'false';
    const data = await mobileApiService.getMobileBootstrap(req.user.id, {
      compact,
      deviceId: req.body?.deviceId || req.query.deviceId,
      platform: req.body?.platform || req.query.platform,
      appVersion: req.body?.appVersion,
      pushToken: req.body?.pushToken,
    });
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

exports.mobileReconcile = async (req, res) => {
  try {
    const result = await mobileApiService.reconcileOffline(req.user.id, req.body.actions || []);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

exports.mobileSyncEnqueue = async (req, res) => {
  try {
    const row = await mobileApiService.enqueueSyncAction(
      req.user.id, req.body.clientId, req.body.actionType, req.body.payload
    );
    res.json({ success: true, queueId: row._id });
  } catch (err) { serverError(res, err); }
};

exports.mobileSyncProcess = async (req, res) => {
  try {
    const results = await mobileApiService.processSyncQueue(req.user.id);
    res.json({ success: true, results });
  } catch (err) { serverError(res, err); }
};

// ── Advanced analytics (admin) ────────────────────────────────────────────────
exports.adminAdvancedAnalytics = async (req, res) => {
  try {
    const data = await advancedAnalyticsService.getRetentionAnalytics({
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

exports.adminEconomyDashboard = async (req, res) => {
  try {
    const StudentWallet = require('../models/StudentWallet');
    const agg = await StudentWallet.aggregate([
      { $group: { _id: null, totalCoins: { $sum: '$coins' }, totalGems: { $sum: '$gems' }, users: { $sum: 1 } } },
    ]);
    res.json({ success: true, economy: agg[0] || { totalCoins: 0, totalGems: 0, users: 0 }, config: gaConfig.economy });
  } catch (err) { serverError(res, err); }
};

exports.adminAuditLogs = async (req, res) => {
  try {
    const logs = await auditLogService.getRecentLogs({
      limit: parseInt(req.query.limit, 10) || 50,
      action: req.query.action,
      severity: req.query.severity,
    });
    res.json({ success: true, logs });
  } catch (err) { serverError(res, err); }
};

exports.getFeatureFlags = async (_req, res) => {
  res.json({ success: true, features: gaConfig.features });
};

// ── Matchmaking (Phase B) ─────────────────────────────────────────────────────
exports.joinMatchmaking = async (req, res) => {
  try {
    const result = await matchmakingService.joinQueue(req.user.id, req.user.name || 'Player', req.body);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

exports.leaveMatchmaking = async (req, res) => {
  try {
    const result = await matchmakingService.leaveQueue(req.user.id);
    res.json({ success: true, ...result });
  } catch (err) { serverError(res, err); }
};

exports.getMatchmakingStatus = async (req, res) => {
  try {
    const status = await matchmakingService.getQueueStatus(req.user.id, req.user.name || 'Player');
    res.json({ success: true, ...status });
  } catch (err) { serverError(res, err); }
};

// ── Adaptive learning (Phase C) ─────────────────────────────────────────────
exports.getAdaptiveInsights = async (req, res) => {
  try {
    const data = await adaptiveLearningService.getStudentInsights(req.user.id);
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

exports.refreshAdaptiveInsights = async (req, res) => {
  try {
    const data = await adaptiveLearningService.analyzeStudent(req.user.id);
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

// ── Notifications (Phase D) ─────────────────────────────────────────────────
exports.getNotificationPreferences = async (req, res) => {
  try {
    const prefs = await notificationsService.getPreferences(req.user.id);
    res.json({ success: true, preferences: prefs });
  } catch (err) { serverError(res, err); }
};

exports.updateNotificationPreferences = async (req, res) => {
  try {
    const prefs = await notificationsService.updatePreferences(req.user.id, req.body);
    res.json({ success: true, preferences: prefs });
  } catch (err) { serverError(res, err); }
};

// ── Premium (Phase E) ───────────────────────────────────────────────────────
exports.getPremiumStatus = async (req, res) => {
  try {
    const sub = await premiumService.getSubscription(req.user.id);
    res.json({ success: true, subscription: sub });
  } catch (err) { serverError(res, err); }
};

exports.adminGrantPremium = async (req, res) => {
  try {
    const { studentId, tier, days } = req.body;
    if (!studentId) return res.status(400).json({ success: false, message: 'studentId required' });
    const sub = await premiumService.grantPremium(studentId, { tier, days });
    res.json({ success: true, subscription: sub });
  } catch (err) { serverError(res, err); }
};

// ── Enterprise analytics (Phase F) ──────────────────────────────────────────
exports.adminEnterpriseAnalytics = async (req, res) => {
  try {
    const data = await enterpriseAnalyticsService.getAdminEnterpriseDashboard({
      from: req.query.from,
      to: req.query.to,
    });
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

exports.teacherEnterpriseAnalytics = async (req, res) => {
  try {
    const data = await enterpriseAnalyticsService.getTeacherEnterpriseDashboard(
      req.user.id,
      req.query.classroomId
    );
    res.json({ success: true, ...data });
  } catch (err) { serverError(res, err); }
};

// ── Production health (Phase K) ───────────────────────────────────────────────
exports.publicHealth = async (_req, res) => {
  try {
    const health = await productionHealthService.getHealth();
    res.status(health.status === 'healthy' ? 200 : 503).json(health);
  } catch (err) { serverError(res, err); }
};

exports.adminMetrics = async (_req, res) => {
  try {
    const metrics = await productionHealthService.getMetrics();
    const live = await multiplayerService.getLiveStats();
    res.json({
      success: true,
      ...metrics,
      sockets: getOnlineSocketCount(),
      multiplayer: live,
      battle: battleEngine.getMetrics(),
    });
  } catch (err) { serverError(res, err); }
};

exports.adminEnvValidation = async (_req, res) => {
  res.json({ success: true, ...productionHealthService.validateEnvironment() });
};

exports.adminAntiCheat = async (req, res) => {
  try {
    const logs = await antiCheatService.getAntiCheatSummary(parseInt(req.query.limit, 10) || 30);
    res.json({ success: true, logs });
  } catch (err) { serverError(res, err); }
};

exports.adminLiveMultiplayer = async (_req, res) => {
  try {
    const live = await multiplayerService.getLiveStats();
    const rooms = await require('../models/ArenaRoom').find({
      status: { $in: ['lobby', 'playing', 'countdown'] },
    }).limit(20).select('inviteCode status players gameType battle').lean();
    res.json({ success: true, live, sockets: getOnlineSocketCount(), battle: battleEngine.getMetrics(), rooms });
  } catch (err) { serverError(res, err); }
};

// ── Tournaments (Phase 3) ───────────────────────────────────────────────────
exports.listTournaments = async (req, res) => {
  try {
    const list = await tournamentsService.listTournaments({ gameType: req.query.gameType });
    res.json({ success: true, tournaments: list });
  } catch (err) { serverError(res, err); }
};

exports.createTournament = async (req, res) => {
  try {
    const t = await tournamentsService.createTournament(req.user.id, req.body);
    res.json({ success: true, tournament: t });
  } catch (err) { serverError(res, err); }
};

exports.updateTournament = async (req, res) => {
  try {
    const t = await tournamentsService.updateTournament(req.params.id, req.body);
    res.json({ success: true, tournament: t });
  } catch (err) { serverError(res, err); }
};

exports.registerTournament = async (req, res) => {
  try {
    const result = await tournamentsService.registerParticipant(req.params.id, req.user.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, tournament: result.tournament });
  } catch (err) { serverError(res, err); }
};

// ── Ranked / MMR (Phase 5) ──────────────────────────────────────────────────
exports.getMyRankedProfile = async (req, res) => {
  try {
    const profile = await rankedService.getOrCreateProfile(req.user.id);
    res.json({ success: true, profile });
  } catch (err) { serverError(res, err); }
};

exports.getRankedLeaderboard = async (req, res) => {
  try {
    const board = await rankedService.getLeaderboard(parseInt(req.query.limit, 10) || 50);
    res.json({ success: true, leaderboard: board });
  } catch (err) { serverError(res, err); }
};

exports.getTournament = async (req, res) => {
  try {
    const t = await tournamentsService.getTournament(req.params.id);
    if (!t) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, tournament: t });
  } catch (err) { serverError(res, err); }
};

exports.getTournamentHistory = async (req, res) => {
  try {
    const list = await tournamentsService.listHistory(parseInt(req.query.limit, 10) || 30);
    res.json({ success: true, tournaments: list });
  } catch (err) { serverError(res, err); }
};

exports.getTournamentLeaderboard = async (req, res) => {
  try {
    const board = await tournamentsService.getTournamentLeaderboard(req.params.id);
    res.json({ success: true, leaderboard: board });
  } catch (err) { serverError(res, err); }
};

exports.startTournament = async (req, res) => {
  try {
    const result = await tournamentsService.startTournament(req.params.id);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, tournament: result.tournament });
  } catch (err) { serverError(res, err); }
};

exports.adminTournamentAnalytics = async (_req, res) => {
  try {
    const analytics = await tournamentsService.getTournamentAnalytics();
    res.json({ success: true, analytics });
  } catch (err) { serverError(res, err); }
};

exports.adminListTournaments = async (req, res) => {
  try {
    const list = await tournamentsService.listTournaments({ includeAll: true, status: req.query.status });
    res.json({ success: true, tournaments: list });
  } catch (err) { serverError(res, err); }
};

exports.getReplay = async (req, res) => {
  try {
    const timeline = await replayService.getReplayTimeline(req.params.idOrToken);
    if (!timeline) return res.status(404).json({ success: false, message: 'Replay not found' });
    res.json({ success: true, replay: timeline });
  } catch (err) { serverError(res, err); }
};

exports.listReplays = async (req, res) => {
  try {
    const replays = await replayService.listReplays({
      roomId: req.query.roomId,
      tournamentId: req.query.tournamentId,
    }, parseInt(req.query.limit, 10) || 20);
    res.json({ success: true, replays });
  } catch (err) { serverError(res, err); }
};

exports.adminObservability = async (_req, res) => {
  try {
    const dashboard = await observabilityService.getDashboard();
    res.json({ success: true, dashboard });
  } catch (err) { serverError(res, err); }
};

exports.adminAuditViewer = async (req, res) => {
  try {
    const logs = await auditLogService.getRecentLogs({
      limit: parseInt(req.query.limit, 10) || 50,
      severity: req.query.severity,
      action: req.query.action,
    });
    res.json({ success: true, logs });
  } catch (err) { serverError(res, err); }
};
