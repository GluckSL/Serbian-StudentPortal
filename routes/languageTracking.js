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
  sendJourneyWeekReminders,
  MAX_PER_REQUEST,
} = require('../services/languageTrackingReminders.service');
const { getCrucialStudents, sortCrucialStudents } = require('../services/crucialStudentsService');
const { sendCrucialStudentsReport } = require('../services/crucialStudentsEmailService');
const { parseBatchList } = require('../utils/analyticsFilters');
const {
  getEngagementOverview,
  getSingleBatchEngagement,
} = require('../services/engagementOverviewService');

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
      includeProgress: req.query.includeProgress === 'true',
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
// Body: { studentIds: string[], day?: number, scope?: 'day' | 'week' }
// scope=week sends reminders for all pending tasks in the student's current journey week
router.post('/send-reminders', verifyToken, requireLanguageTrackingEdit, async (req, res) => {
  try {
    const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
    const scope = req.body?.scope === 'week' ? 'week' : 'day';
    const day = req.body?.day != null ? Number(req.body.day) : undefined;
    if (!studentIds.length) {
      return res.status(400).json({ message: 'studentIds array is required' });
    }
    if (studentIds.length > MAX_PER_REQUEST) {
      return res.status(400).json({ message: `Maximum ${MAX_PER_REQUEST} students per request` });
    }
    const summary =
      scope === 'week'
        ? await sendJourneyWeekReminders(studentIds)
        : await sendJourneyReminders(studentIds, day);
    res.json(summary);
  } catch (err) {
    console.error('language-tracking POST /send-reminders', err);
    res.status(500).json({ message: 'Failed to send reminder emails' });
  }
});

// ── GET /api/language-tracking/crucial-students ───────────────────────────────
// Query: page, limit, search, batch, sort
router.get('/crucial-students', verifyToken, requireLanguageTrackingView, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const search = (req.query.search || '').trim().toLowerCase();
    const selectedBatches = parseBatchList(req.query.batch);
    const sort   = ['lowest', 'highest', 'nearest_hour'].includes(req.query.sort)
      ? req.query.sort : 'lowest';

    // Live-class filter: 0 = missed both, 1 = attended 1, 2 = attended both
    let liveClassesFilter = null;
    if (req.query.liveClasses !== undefined && req.query.liveClasses !== '') {
      const n = parseInt(req.query.liveClasses, 10);
      if (!Number.isNaN(n) && n >= 0) liveClassesFilter = n;
    }

    const data = await getCrucialStudents();
    let filtered = data.students;

    const availableLiveClassCounts = [
      ...new Set(data.students.map(s => s.liveClassesAttended ?? 0)),
    ].sort((a, b) => a - b);

    if (selectedBatches.length) {
      const batchSet = new Set(selectedBatches.map((b) => String(b).trim()));
      filtered = filtered.filter((s) => batchSet.has(String(s.batch)));
    }
    if (search) {
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(search) ||
        s.email.toLowerCase().includes(search) ||
        String(s.batch).toLowerCase().includes(search),
      );
    }
    if (liveClassesFilter !== null) {
      filtered = filtered.filter(s => (s.liveClassesAttended ?? 0) === liveClassesFilter);
    }

    filtered = sortCrucialStudents(filtered, sort);

    const total = filtered.length;
    const start = (page - 1) * limit;
    const paged = filtered.slice(start, start + limit);

    res.json({
      students: paged,
      total,
      page,
      limit,
      availableBatches: data.availableBatches,
      availableLiveClassCounts,
      summary: {
        ...data.summary,
        total,
        avgMinutes: filtered.length
          ? Math.round(filtered.reduce((s, r) => s + r.totalMinutes, 0) / filtered.length)
          : 0,
      },
      filters: { batches: selectedBatches, sort, liveClasses: liveClassesFilter },
    });
  } catch (err) {
    console.error('language-tracking GET /crucial-students', err);
    res.status(500).json({ message: 'Failed to load crucial students' });
  }
});

// ── POST /api/language-tracking/crucial-students/send-email ──────────────────
// Manually trigger the crucial students PDF email
router.post('/crucial-students/send-email', verifyToken, requireLanguageTrackingEdit, async (req, res) => {
  try {
    const result = await sendCrucialStudentsReport();
    res.json({
      ok: true,
      message: `Email sent with ${result.summary.total} crucial student(s)`,
      summary: result.summary,
    });
  } catch (err) {
    console.error('language-tracking POST /crucial-students/send-email', err);
    res.status(500).json({ message: 'Failed to send crucial students email' });
  }
});

// ── GET /api/language-tracking/engagement-overview ───────────────────────────
// All active/ongoing batches at their current journey week (red/yellow/green
// engagement heatmap). Reuses the language-tracking view permission.
router.get('/engagement-overview', verifyToken, requireLanguageTrackingView, async (req, res) => {
  try {
    const week = req.query.week != null ? Number(req.query.week) : undefined;
    const data = await getEngagementOverview(week);
    res.json(data);
  } catch (err) {
    console.error('language-tracking GET /engagement-overview', err);
    res.status(500).json({ message: 'Failed to load engagement overview' });
  }
});

// ── GET /api/language-tracking/engagement-overview/batch ─────────────────────
// One batch at a specific journey week (for the per-batch week dropdown).
// Query: batch (required), week (optional — defaults to the batch's current week)
router.get('/engagement-overview/batch', verifyToken, requireLanguageTrackingView, async (req, res) => {
  try {
    const batch = String(req.query.batch || '').trim();
    if (!batch) return res.status(400).json({ message: 'batch is required' });
    const week = req.query.week != null ? Number(req.query.week) : undefined;
    const data = await getSingleBatchEngagement(batch, week);
    if (!data) return res.status(404).json({ message: 'Batch not found' });
    res.json(data);
  } catch (err) {
    console.error('language-tracking GET /engagement-overview/batch', err);
    res.status(500).json({ message: 'Failed to load batch engagement' });
  }
});

module.exports = router;
