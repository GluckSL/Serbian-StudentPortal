const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { requireAdminOrSubAdminTab } = require('../middleware/subAdminTabAccess');
const ctrl = require('../controllers/portalAnalytics.controller');

const portalRouter = express.Router();

portalRouter.post('/start-session', verifyToken, ctrl.requireStudent, ctrl.startSession);
portalRouter.post('/heartbeat', verifyToken, ctrl.requireStudent, ctrl.heartbeat);
portalRouter.post('/end-session', verifyToken, ctrl.requireStudent, ctrl.endSession);

const analyticsRouter = express.Router();

const requirePortalAnalyticsView = requireAdminOrSubAdminTab('portal-analytics', 'view');

analyticsRouter.get('/filter-options', verifyToken, requirePortalAnalyticsView, ctrl.filterOptions);
analyticsRouter.get('/overview', verifyToken, requirePortalAnalyticsView, ctrl.overview);
analyticsRouter.get('/dashboard', verifyToken, requirePortalAnalyticsView, ctrl.dashboard);
analyticsRouter.get('/daily-logs', verifyToken, requirePortalAnalyticsView, ctrl.dailyLogs);
analyticsRouter.get('/student-wise', verifyToken, requirePortalAnalyticsView, ctrl.studentWise);
analyticsRouter.get('/page-wise', verifyToken, requirePortalAnalyticsView, ctrl.pageWise);
analyticsRouter.get('/timeline', verifyToken, requirePortalAnalyticsView, ctrl.timeline);
analyticsRouter.get('/session-wise', verifyToken, requirePortalAnalyticsView, ctrl.sessionWise);
analyticsRouter.get('/device-wise', verifyToken, requirePortalAnalyticsView, ctrl.deviceWise);
analyticsRouter.get('/learning/:kind', verifyToken, requirePortalAnalyticsView, ctrl.learning);

module.exports = { portalRouter, analyticsRouter };
