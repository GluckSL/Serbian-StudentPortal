const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');

const dgCharacterController = require('../controllers/dgCharacterController');
const dgModuleController = require('../controllers/dgModuleController');
const dgSessionController = require('../controllers/dgSessionController');
const dgTtsController = require('../controllers/dgTtsController');
const dgConversationController = require('../controllers/dgConversationController');

const staffRoles = ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'];

router.get('/character', verifyToken, checkRole(staffRoles), dgCharacterController.list);
router.get('/character/:id', verifyToken, checkRole(staffRoles), dgCharacterController.getById);
router.post('/character', verifyToken, checkRole(staffRoles), dgCharacterController.create);
router.put('/character/:id', verifyToken, checkRole(staffRoles), dgCharacterController.update);
router.delete('/character/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), dgCharacterController.remove);

router.get('/modules/student', verifyToken, checkRole(['STUDENT']), dgModuleController.listStudent);
router.get('/modules', verifyToken, checkRole(staffRoles), dgModuleController.listAdmin);
router.get('/modules/:id', verifyToken, checkRole(staffRoles), dgModuleController.getAdminById);
router.post('/modules', verifyToken, checkRole(staffRoles), dgModuleController.create);
router.put('/modules/:id', verifyToken, checkRole(staffRoles), dgModuleController.update);
router.patch('/modules/:id/visibility', verifyToken, checkRole(staffRoles), dgModuleController.patchVisibility);
router.delete('/modules/:id', verifyToken, checkRole(staffRoles), dgModuleController.remove);
router.get('/modules/:id/play', verifyToken, dgModuleController.getPlay);

router.post('/session/start', verifyToken, dgSessionController.start);
router.post('/session/update', verifyToken, dgSessionController.update);
router.post('/session/complete', verifyToken, dgSessionController.complete);
router.get('/session/mine', verifyToken, dgSessionController.getMySessions);

router.post('/tts', verifyToken, dgTtsController.synthesize);

router.post('/conversation/respond', verifyToken, dgConversationController.respond);

module.exports = router;
