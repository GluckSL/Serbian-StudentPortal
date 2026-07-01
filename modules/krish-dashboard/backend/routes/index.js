/**
 * Enrollment Overview — API Routes
 * All routes are scoped to /api/enrollment-overview (mounted in register.js).
 *
 * Access control:
 *   ADMIN / TEACHER_ADMIN  → pass-through
 *   SUB_ADMIN              → must have 'enrollment-overview' tab permission
 */
const express = require('express');
const User = require('../../../../models/User');
const { ADMIN_STAFF_ROLES } = require('../../../../middleware/subAdminTabAccess');
const { subAdminHasTabAccess } = require('../../../../services/subAdminPermissions');

const analyticsCtrl = require('../controllers/analyticsController');
const studentsCtrl  = require('../controllers/studentsController');
const notesCtrl     = require('../controllers/notesController');
const importCtrl    = require('../controllers/importController');
const exportCtrl    = require('../controllers/exportController');

const router = express.Router();

const TAB = 'enrollment-overview';
const LEGACY_TAB = 'krish-dashboard';
const LEGACY_TAB_OVERDUE = 'enrollment-overdue';

function requireEnrollmentOverviewTab(requiredLevel = 'view') {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required.' });
    }
    const role = req.user.role;
    if (ADMIN_STAFF_ROLES.includes(role)) {
      return next();
    }
    if (role !== 'SUB_ADMIN') {
      return res.status(403).json({ message: 'Access denied. Insufficient permissions.' });
    }
    try {
      const user = await User.findById(req.user.id)
        .select('role sidebarPermissions sidebarAccessLevels')
        .lean();
      if (
        subAdminHasTabAccess(user, TAB, requiredLevel) ||
        subAdminHasTabAccess(user, LEGACY_TAB, requiredLevel) ||
        subAdminHasTabAccess(user, LEGACY_TAB_OVERDUE, requiredLevel)
      ) {
        return next();
      }
    } catch (err) {
      console.error('[EnrollmentOverview] tab access error', err);
    }
    return res.status(403).json({
      message: `Access denied. ${TAB} permission required.`,
    });
  };
}

const canView = requireEnrollmentOverviewTab('view');
const canEdit = requireEnrollmentOverviewTab('edit');
const canFull = requireEnrollmentOverviewTab('full');

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
router.post('/import/fetch-crm', canEdit, importCtrl.fetchCrm);

// ── Export ─────────────────────────────────────────────────────────────────
router.get('/export', canView, exportCtrl.exportStudents);

module.exports = router;
