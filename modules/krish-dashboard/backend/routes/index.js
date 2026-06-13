/**
 * Krish Dashboard — API Routes
 * All routes are scoped to /api/krish-dashboard (mounted in register.js).
 *
 * Access control:
 *   ADMIN / TEACHER_ADMIN  → pass-through
 *   SUB_ADMIN              → must have 'krish-dashboard' tab permission
 */
const express = require('express');
const { requireAdminOrSubAdminTab } = require('../../../../middleware/subAdminTabAccess');

const analyticsCtrl = require('../controllers/analyticsController');
const studentsCtrl  = require('../controllers/studentsController');
const notesCtrl     = require('../controllers/notesController');
const importCtrl    = require('../controllers/importController');
const exportCtrl    = require('../controllers/exportController');

const router = express.Router();

const canView = requireAdminOrSubAdminTab('krish-dashboard', 'view');
const canEdit = requireAdminOrSubAdminTab('krish-dashboard', 'edit');
const canFull = requireAdminOrSubAdminTab('krish-dashboard', 'full');

// ── Analytics ──────────────────────────────────────────────────────────────
router.get('/analytics', canView, analyticsCtrl.analytics);
router.get('/analytics/profession-breakdown', canView, analyticsCtrl.professionBreakdown);

// ── Students ───────────────────────────────────────────────────────────────
router.get('/students',       canView, studentsCtrl.list);
router.post('/students/reset-all', canFull, studentsCtrl.resetAll);
router.get('/students/:id',   canView, studentsCtrl.detail);
router.post('/students',      canEdit, studentsCtrl.create);
router.patch('/students/:id', canEdit, studentsCtrl.update);
router.delete('/students/:id', canFull, studentsCtrl.remove);

// ── Notes / Follow-ups ─────────────────────────────────────────────────────
router.post('/students/:id/notes',           canEdit, notesCtrl.addNote);
router.patch('/students/:id/notes/:noteId',  canEdit, notesCtrl.updateNote);

// ── Import ─────────────────────────────────────────────────────────────────
router.post('/import/preview', canEdit, importCtrl.preview);
router.post('/import/commit',  canEdit, importCtrl.commit);

// ── Export ─────────────────────────────────────────────────────────────────
router.get('/export', canView, exportCtrl.exportStudents);

module.exports = router;
