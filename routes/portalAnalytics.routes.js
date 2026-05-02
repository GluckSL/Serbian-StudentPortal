const express = require('express');
const { verifyToken, isAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/portalAnalytics.controller');

const portalRouter = express.Router();

portalRouter.post('/start-session', verifyToken, ctrl.requireStudent, ctrl.startSession);
portalRouter.post('/heartbeat', verifyToken, ctrl.requireStudent, ctrl.heartbeat);
portalRouter.post('/end-session', verifyToken, ctrl.requireStudent, ctrl.endSession);

const analyticsRouter = express.Router();

analyticsRouter.get('/overview', verifyToken, isAdmin, ctrl.overview);
analyticsRouter.get('/dashboard', verifyToken, isAdmin, ctrl.dashboard);
analyticsRouter.get('/daily-logs', verifyToken, isAdmin, ctrl.dailyLogs);
analyticsRouter.get('/student-wise', verifyToken, isAdmin, ctrl.studentWise);
analyticsRouter.get('/page-wise', verifyToken, isAdmin, ctrl.pageWise);
analyticsRouter.get('/timeline', verifyToken, isAdmin, ctrl.timeline);
analyticsRouter.get('/session-wise', verifyToken, isAdmin, ctrl.sessionWise);
analyticsRouter.get('/learning/:kind', verifyToken, isAdmin, ctrl.learning);

module.exports = { portalRouter, analyticsRouter };
