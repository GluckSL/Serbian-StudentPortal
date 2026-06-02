'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const { blockVisaDocsOnly } = require('../middleware/subscriptionCheck');

const moduleCtrl = require('../controllers/sprechenModuleController');
const sessionCtrl = require('../controllers/sprechenSessionController');
const sprechenCardUpload = require('../middleware/sprechenCardUpload');

const staffRoles = ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'];

// ─── Module routes ────────────────────────────────────────────────────────────

// Student
router.get('/modules/student', verifyToken, blockVisaDocsOnly, checkRole(['STUDENT']), moduleCtrl.listStudent);
router.get('/modules/:id/play', verifyToken, blockVisaDocsOnly, moduleCtrl.getPlay);

// Admin CRUD
router.get('/modules', verifyToken, checkRole(staffRoles), moduleCtrl.listAdmin);
router.get('/modules/:id', verifyToken, checkRole(staffRoles), moduleCtrl.getAdminById);
router.post(
  '/upload-card-image',
  verifyToken,
  checkRole(staffRoles),
  (req, res, next) => {
    sprechenCardUpload(req, res, (err) => {
      if (!err) return next();
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ message: err.message || 'Upload failed' });
    });
  },
  moduleCtrl.uploadCardImage,
);
router.post('/modules', verifyToken, checkRole(staffRoles), moduleCtrl.create);
router.put('/modules/:id', verifyToken, checkRole(staffRoles), moduleCtrl.update);
router.patch('/modules/:id/visibility', verifyToken, checkRole(staffRoles), moduleCtrl.patchVisibility);
router.delete('/modules/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), moduleCtrl.remove);
router.post(
  '/modules/seed-placeholder',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  moduleCtrl.seedFromPlaceholder,
);

// Staff: sessions list + CSV export
router.get('/modules/:id/sessions', verifyToken, checkRole(staffRoles), moduleCtrl.listSessions);
router.get('/modules/:id/export.csv', verifyToken, checkRole(staffRoles), moduleCtrl.exportCsv);

// ─── Session routes ───────────────────────────────────────────────────────────

router.post('/session/start', verifyToken, blockVisaDocsOnly, sessionCtrl.start);
router.get('/session/:id/state', verifyToken, blockVisaDocsOnly, sessionCtrl.getState);
router.post('/session/:id/advance', verifyToken, blockVisaDocsOnly, sessionCtrl.advance);
router.post('/session/:id/turn', verifyToken, blockVisaDocsOnly, sessionCtrl.turn);
router.post('/session/:id/complete', verifyToken, blockVisaDocsOnly, sessionCtrl.complete);
router.post('/session/tts', verifyToken, blockVisaDocsOnly, sessionCtrl.tts);

// Staff: replay + score override
router.get('/session/:id/replay', verifyToken, checkRole(staffRoles), sessionCtrl.getReplay);
router.patch(
  '/session/:id/turns/:turnId/score',
  verifyToken,
  checkRole(staffRoles),
  sessionCtrl.overrideTurnScore,
);

module.exports = router;
