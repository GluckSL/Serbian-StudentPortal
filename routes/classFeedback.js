// routes/classFeedback.js
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ClassFeedback = require('../models/ClassFeedback');
const FeedbackBatchSettings = require('../models/FeedbackBatchSettings');
const BatchConfig = require('../models/BatchConfig');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');

// ─── Admin: get all batch settings ────────────────────────────────────────────
router.get('/batch-settings', auth.verifyToken, auth.isAdmin, async (req, res) => {
  try {
    // Get all known batches from BatchConfig
    const batchConfigs = await BatchConfig.find({}).select('batchName').sort({ batchName: 1 }).lean();
    const allBatchNames = batchConfigs.map((b) => b.batchName);

    // Get existing settings docs
    const existingSettings = await FeedbackBatchSettings.find({}).lean();
    const settingsMap = {};
    for (const s of existingSettings) {
      settingsMap[s.batch] = s;
    }

    // Merge: return all batches with their enabled status
    const result = allBatchNames.map((batchName) => ({
      batch: batchName,
      enabled: settingsMap[batchName]?.enabled ?? false,
      updatedAt: settingsMap[batchName]?.updatedAt ?? null,
    }));

    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[ClassFeedback] batch-settings error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Admin: update batch settings ─────────────────────────────────────────────
// Body: { updates: [{ batch: string, enabled: boolean }] }
router.put('/batch-settings', auth.verifyToken, auth.isAdmin, async (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, message: 'updates array required' });
    }

    const adminId = req.user?.id;
    const ops = updates.map((u) => ({
      updateOne: {
        filter: { batch: u.batch },
        update: { $set: { enabled: !!u.enabled, updatedAt: new Date(), updatedBy: adminId } },
        upsert: true,
      },
    }));

    await FeedbackBatchSettings.bulkWrite(ops);
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    console.error('[ClassFeedback] update batch-settings error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Student: check if feedback enabled for a batch ───────────────────────────
router.get('/batch-enabled/:batch', auth.verifyToken, async (req, res) => {
  try {
    const setting = await FeedbackBatchSettings.findOne({ batch: req.params.batch }).lean();
    res.json({ success: true, enabled: setting?.enabled ?? false });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Student: check if student already submitted feedback for a meeting ────────
router.get('/check/:meetingId', auth.verifyToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const existing = await ClassFeedback.findOne({
      meetingId: req.params.meetingId,
      studentId,
    }).lean();
    res.json({ success: true, submitted: !!existing, feedback: existing || null });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Student: get meeting details for feedback popup ──────────────────────────
router.get('/meeting/:meetingId', auth.verifyToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const meeting = await MeetingLink.findById(req.params.meetingId)
      .select('topic batch startTime duration status attendees')
      .lean();

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    // Verify the student is an attendee of this class
    const isAttendee = meeting.attendees?.some(
      (a) => String(a.studentId) === String(studentId)
    );
    if (!isAttendee) {
      return res.status(403).json({ success: false, message: 'Not enrolled in this class' });
    }

    // Check if feedback is enabled for this batch
    const setting = await FeedbackBatchSettings.findOne({ batch: meeting.batch }).lean();
    if (!setting?.enabled) {
      return res.status(403).json({ success: false, message: 'Feedback not enabled for this batch' });
    }

    // Check if already submitted
    const existing = await ClassFeedback.findOne({ meetingId: meeting._id, studentId }).lean();

    res.json({
      success: true,
      meeting: {
        _id: meeting._id,
        topic: meeting.topic,
        batch: meeting.batch,
        startTime: meeting.startTime,
        duration: meeting.duration,
        status: meeting.status,
      },
      alreadySubmitted: !!existing,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Student: submit feedback ──────────────────────────────────────────────────
router.post('/submit', auth.verifyToken, async (req, res) => {
  try {
    const studentId = req.user.id;
    const { meetingId, understanding, pace, confidence, motivation } = req.body;

    if (!meetingId || !understanding || !pace || !confidence || !motivation) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Load student profile
    const student = await User.findById(studentId).select('name email batch').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // Load meeting
    const meeting = await MeetingLink.findById(meetingId)
      .select('topic batch startTime attendees status')
      .lean();
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Class not found' });
    }

    // Verify attendee
    const isAttendee = meeting.attendees?.some(
      (a) => String(a.studentId) === String(studentId)
    );
    if (!isAttendee) {
      return res.status(403).json({ success: false, message: 'Not enrolled in this class' });
    }

    // Verify feedback enabled
    const setting = await FeedbackBatchSettings.findOne({ batch: meeting.batch }).lean();
    if (!setting?.enabled) {
      return res.status(403).json({ success: false, message: 'Feedback not enabled for this batch' });
    }

    // Validate enums
    const validUnderstanding = ['not_really', 'mostly', 'completely'];
    const validPace = ['too_slow', 'just_right', 'too_fast'];
    const validMotivation = ['not_motivated', 'somewhat_motivated', 'very_motivated'];
    const confidenceNum = Number(confidence);

    if (
      !validUnderstanding.includes(understanding) ||
      !validPace.includes(pace) ||
      !validMotivation.includes(motivation) ||
      isNaN(confidenceNum) ||
      confidenceNum < 1 ||
      confidenceNum > 3
    ) {
      return res.status(400).json({ success: false, message: 'Invalid field values' });
    }

    // Upsert (prevent duplicates)
    const feedback = await ClassFeedback.findOneAndUpdate(
      { meetingId, studentId },
      {
        studentId,
        studentName: student.name,
        studentEmail: student.email || '',
        batch: meeting.batch,
        meetingId,
        classTitle: meeting.topic || 'Untitled Class',
        classDate: meeting.startTime,
        understanding,
        pace,
        confidence: confidenceNum,
        motivation,
        submittedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, message: 'Feedback submitted. Thank you! 🦊', feedback });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Feedback already submitted for this class' });
    }
    console.error('[ClassFeedback] submit error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Admin: list feedback with filters ─────────────────────────────────────────
// Query: batch, dateFrom, dateTo, understanding, page, limit
router.get('/list', auth.verifyToken, auth.isAdmin, async (req, res) => {
  try {
    const {
      batch,
      dateFrom,
      dateTo,
      understanding,
      motivation,
      page = 1,
      limit = 20,
    } = req.query;

    const filter = {};
    if (batch) filter.batch = batch;
    if (understanding) filter.understanding = understanding;
    if (motivation) filter.motivation = motivation;
    if (dateFrom || dateTo) {
      filter.classDate = {};
      if (dateFrom) filter.classDate.$gte = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        filter.classDate.$lte = to;
      }
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [feedbacks, total] = await Promise.all([
      ClassFeedback.find(filter)
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      ClassFeedback.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: feedbacks,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    console.error('[ClassFeedback] list error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Admin: export feedback as CSV ────────────────────────────────────────────
router.get('/export', auth.verifyToken, auth.isAdmin, async (req, res) => {
  try {
    const { batch, dateFrom, dateTo, understanding, motivation } = req.query;

    const filter = {};
    if (batch) filter.batch = batch;
    if (understanding) filter.understanding = understanding;
    if (motivation) filter.motivation = motivation;
    if (dateFrom || dateTo) {
      filter.classDate = {};
      if (dateFrom) filter.classDate.$gte = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        filter.classDate.$lte = to;
      }
    }

    const feedbacks = await ClassFeedback.find(filter).sort({ submittedAt: -1 }).lean();

    const UNDERSTANDING_LABELS = {
      not_really: 'Not really',
      mostly: 'Mostly',
      completely: 'Completely',
    };
    const PACE_LABELS = {
      too_slow: 'Too slow',
      just_right: 'Just right',
      too_fast: 'Too fast',
    };
    const MOTIVATION_LABELS = {
      not_motivated: 'Not motivated',
      somewhat_motivated: 'Somewhat motivated',
      very_motivated: 'Very motivated',
    };

    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    const headers = [
      'Student Name',
      'Student Email',
      'Batch',
      'Class Title',
      'Class Date',
      'Understanding',
      'Pace',
      'Confidence (Stars)',
      'Motivation',
      'Submitted At',
    ];

    const rows = feedbacks.map((f) => [
      escape(f.studentName),
      escape(f.studentEmail),
      escape(f.batch),
      escape(f.classTitle),
      escape(f.classDate ? new Date(f.classDate).toLocaleDateString('en-GB') : ''),
      escape(UNDERSTANDING_LABELS[f.understanding] || f.understanding),
      escape(PACE_LABELS[f.pace] || f.pace),
      escape('★'.repeat(f.confidence || 0)),
      escape(MOTIVATION_LABELS[f.motivation] || f.motivation),
      escape(f.submittedAt ? new Date(f.submittedAt).toLocaleString('en-GB') : ''),
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="class-feedback-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('[ClassFeedback] export error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Admin: summary stats ──────────────────────────────────────────────────────
router.get('/stats', auth.verifyToken, auth.isAdmin, async (req, res) => {
  try {
    const { batch, dateFrom, dateTo } = req.query;
    const filter = {};
    if (batch) filter.batch = batch;
    if (dateFrom || dateTo) {
      filter.classDate = {};
      if (dateFrom) filter.classDate.$gte = new Date(dateFrom);
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        filter.classDate.$lte = to;
      }
    }

    const [total, understandingAgg, paceAgg, confidenceAgg, motivationAgg] = await Promise.all([
      ClassFeedback.countDocuments(filter),
      ClassFeedback.aggregate([
        { $match: filter },
        { $group: { _id: '$understanding', count: { $sum: 1 } } },
      ]),
      ClassFeedback.aggregate([
        { $match: filter },
        { $group: { _id: '$pace', count: { $sum: 1 } } },
      ]),
      ClassFeedback.aggregate([
        { $match: filter },
        { $group: { _id: '$confidence', count: { $sum: 1 } } },
      ]),
      ClassFeedback.aggregate([
        { $match: filter },
        { $group: { _id: '$motivation', count: { $sum: 1 } } },
      ]),
    ]);

    const toMap = (agg) => {
      const m = {};
      for (const a of agg) m[a._id] = a.count;
      return m;
    };

    res.json({
      success: true,
      total,
      understanding: toMap(understandingAgg),
      pace: toMap(paceAgg),
      confidence: toMap(confidenceAgg),
      motivation: toMap(motivationAgg),
    });
  } catch (err) {
    console.error('[ClassFeedback] stats error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
