// routes/languageTracking.js
// Admin-only language tracking analytics — unified learning time across
// Exercises, DG Bot and GlückArena.

'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const {
  getOverview,
  getStudentDetail,
  getAnalyticsFilterOptions,
} = require('../services/languageTrackingAnalytics.service');
const {
  sendJourneyReminders,
  MAX_PER_REQUEST,
} = require('../services/languageTrackingReminders.service');

const ALLOWED_ROLES = ['ADMIN', 'TEACHER_ADMIN'];

// ── GET /api/language-tracking/filter-options ────────────────────────────────
router.get('/filter-options', verifyToken, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const options = await getAnalyticsFilterOptions();
    res.json(options);
  } catch (err) {
    console.error('language-tracking GET /filter-options', err);
    res.status(500).json({ message: 'Failed to load filter options' });
  }
});

// ── GET /api/language-tracking/overview ──────────────────────────────────────
// Query params: from, to, cohort, batch, level, search, page, limit, sort
router.get('/overview', verifyToken, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const result = await getOverview({
      from: req.query.from,
      to: req.query.to,
      cohort: req.query.cohort,
      batch: req.query.batch,
      level: req.query.level,
      search: req.query.search,
      // Default true: show test + real students; pass includeTestAccounts=false to hide test
      includeTestAccounts: req.query.includeTestAccounts !== 'false',
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort,
    });
    res.json(result);
  } catch (err) {
    console.error('language-tracking GET /overview', err);
    res.status(500).json({ message: 'Failed to load language tracking overview' });
  }
});

// ── GET /api/language-tracking/student/:studentId ────────────────────────────
// Query params: from, to
router.get('/student/:studentId', verifyToken, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const result = await getStudentDetail(req.params.studentId, {
      from: req.query.from,
      to: req.query.to,
    });
    res.json(result);
  } catch (err) {
    if (err.message === 'STUDENT_NOT_FOUND') return res.status(404).json({ message: 'Student not found' });
    if (err.message === 'INVALID_STUDENT_ID') return res.status(400).json({ message: 'Invalid student ID' });
    console.error('language-tracking GET /student/:id', err);
    res.status(500).json({ message: 'Failed to load student detail' });
  }
});

// ── POST /api/language-tracking/send-reminders ───────────────────────────────
// Body: { studentIds: string[] } — sends one email per student with incomplete day tasks
router.post('/send-reminders', verifyToken, checkRole(ALLOWED_ROLES), async (req, res) => {
  try {
    const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
    if (!studentIds.length) {
      return res.status(400).json({ message: 'studentIds array is required' });
    }
    if (studentIds.length > MAX_PER_REQUEST) {
      return res.status(400).json({ message: `Maximum ${MAX_PER_REQUEST} students per request` });
    }
    const summary = await sendJourneyReminders(studentIds);
    res.json(summary);
  } catch (err) {
    console.error('language-tracking POST /send-reminders', err);
    res.status(500).json({ message: 'Failed to send reminder emails' });
  }
});

module.exports = router;
