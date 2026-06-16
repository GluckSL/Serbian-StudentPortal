// routes/languageTracking.js
// Admin-only language tracking analytics — unified learning time across
// Exercises, DG Bot and GlückArena.

'use strict';

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAdminOrSubAdminTab } = require('../middleware/subAdminTabAccess');
const {
  getOverview,
  getStudentDetail,
  getStudentWeekSummary,
  getStudentDayDetail,
  getAnalyticsFilterOptions,
} = require('../services/languageTrackingAnalytics.service');
const {
  sendJourneyReminders,
  MAX_PER_REQUEST,
} = require('../services/languageTrackingReminders.service');

const LANGUAGE_TRACKING_TAB = 'language-tracking';
const requireLanguageTrackingView = requireAdminOrSubAdminTab(LANGUAGE_TRACKING_TAB, 'view');
const requireLanguageTrackingEdit = requireAdminOrSubAdminTab(LANGUAGE_TRACKING_TAB, 'edit');

// ── GET /api/language-tracking/filter-options ────────────────────────────────
router.get('/filter-options', verifyToken, requireLanguageTrackingView, async (req, res) => {
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
router.get('/overview', verifyToken, requireLanguageTrackingView, async (req, res) => {
  try {
    const result = await getOverview({
      from: req.query.from,
      to: req.query.to,
      cohort: req.query.cohort,
      batch: req.query.batch,
      level: req.query.level,
      search: req.query.search,
      includeTestAccounts: req.query.includeTestAccounts === 'true',
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
router.get('/student/:studentId', verifyToken, requireLanguageTrackingView, async (req, res) => {
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

// ── GET /api/language-tracking/student/:studentId/week/:week ───────────────────
router.get('/student/:studentId/week/:week', verifyToken, requireLanguageTrackingView, async (req, res) => {
  try {
    const result = await getStudentWeekSummary(req.params.studentId, req.params.week);
    res.json(result);
  } catch (err) {
    if (err.message === 'STUDENT_NOT_FOUND') return res.status(404).json({ message: 'Student not found' });
    if (err.message === 'INVALID_STUDENT_ID') return res.status(400).json({ message: 'Invalid student ID' });
    console.error('language-tracking GET /student/:id/week/:week', err);
    res.status(500).json({ message: 'Failed to load week summary' });
  }
});

// ── GET /api/language-tracking/student/:studentId/day/:day ───────────────────
router.get('/student/:studentId/day/:day', verifyToken, requireLanguageTrackingView, async (req, res) => {
  try {
    const result = await getStudentDayDetail(req.params.studentId, req.params.day);
    res.json(result);
  } catch (err) {
    if (err.message === 'STUDENT_NOT_FOUND') return res.status(404).json({ message: 'Student not found' });
    if (err.message === 'INVALID_STUDENT_ID') return res.status(400).json({ message: 'Invalid student ID' });
    if (err.message === 'DAY_NOT_REACHED') {
      return res.status(400).json({
        message: `Day ${err.day} is not reached yet (student is on day ${err.currentCourseDay})`,
      });
    }
    console.error('language-tracking GET /student/:id/day/:day', err);
    res.status(500).json({ message: 'Failed to load day detail' });
  }
});

// ── POST /api/language-tracking/send-reminders ───────────────────────────────
// Body: { studentIds: string[], day?: number } — optional day for historical reminders
router.post('/send-reminders', verifyToken, requireLanguageTrackingEdit, async (req, res) => {
  try {
    const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
    const day = req.body?.day != null ? Number(req.body.day) : undefined;
    if (!studentIds.length) {
      return res.status(400).json({ message: 'studentIds array is required' });
    }
    if (studentIds.length > MAX_PER_REQUEST) {
      return res.status(400).json({ message: `Maximum ${MAX_PER_REQUEST} students per request` });
    }
    const summary = await sendJourneyReminders(studentIds, day);
    res.json(summary);
  } catch (err) {
    console.error('language-tracking POST /send-reminders', err);
    res.status(500).json({ message: 'Failed to send reminder emails' });
  }
});

module.exports = router;
