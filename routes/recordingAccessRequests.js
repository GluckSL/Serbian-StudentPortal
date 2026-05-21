// routes/recordingAccessRequests.js
// Platinum-only recording access request workflow.
// Students request access to recordings of past classes (5 approved per CEFR level).
// Admins approve (grants per-student playback) or decline (emails student).

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const { verifyToken, checkRole } = require('../middleware/auth');
const { requirePlatinum } = require('../middleware/subscriptionCheck');

const RecordingAccessRequest = require('../models/RecordingAccessRequest');
const ZoomRecording = require('../models/ZoomRecording');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');

const {
  REQUEST_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  countApprovedForLevel,
  getQuota,
  getEligibleClassesPage,
  recordingIsReady,
  sendDeclineEmail,
  sendApproveEmail,
  sendNewRequestAdminEmail,
} = require('../services/recordingAccessRequest.service');

const { allStudentBatchStringsForContent, batchesAlign } = require('../utils/effectiveStudentBatch');

const STAFF_ROLES = ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'];

function isStaff(role) {
  return STAFF_ROLES.includes(role);
}

// ─────────────────────────────────────────────────────────────────────────────
// Student routes  (Platinum only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/recording-access-requests/quota
 * Returns approved count + remaining slots for the student's current level.
 */
router.get('/quota', verifyToken, requirePlatinum, async (req, res) => {
  try {
    const student = await User.findById(req.user.id).select('level').lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
    const quota = await getQuota(req.user.id, student.level);
    res.json({ success: true, ...quota });
  } catch (err) {
    console.error('[RecordingAccessRequest] quota error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch quota.' });
  }
});

/**
 * GET /api/recording-access-requests/eligible-classes?page=1&pageSize=10
 * Paginated ended meetings for the student's batch (one page at a time).
 */
router.get('/eligible-classes', verifyToken, requirePlatinum, async (req, res) => {
  try {
    const student = await User
      .findById(req.user.id)
      .select('batch level subscription goStatus email')
      .lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(5, parseInt(String(req.query.pageSize || DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
    );

    const result = await getEligibleClassesPage(student, req.user.id, page, pageSize);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[RecordingAccessRequest] eligible-classes error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch eligible classes.' });
  }
});

/**
 * POST /api/recording-access-requests
 * Student submits a recording access request.
 * Body: { meetingLinkId }
 */
router.post('/', verifyToken, requirePlatinum, async (req, res) => {
  try {
    const { meetingLinkId } = req.body;
    if (!meetingLinkId) {
      return res.status(400).json({ success: false, message: 'meetingLinkId is required.' });
    }

    const student = await User
      .findById(req.user.id)
      .select('name email batch level subscription goStatus')
      .lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });

    // Verify meeting exists and has ended
    const meeting = await MeetingLink.findById(meetingLinkId)
      .select('topic batch startTime duration status plan')
      .lean();
    if (!meeting) return res.status(404).json({ success: false, message: 'Class not found.' });

    const end = new Date(meeting.startTime).getTime() + (meeting.duration || 0) * 60_000;
    const hasEnded = meeting.status === 'ended' || Date.now() > end;
    if (!hasEnded) {
      return res.status(400).json({ success: false, message: 'You can only request recordings for classes that have already ended.' });
    }

    // Batch alignment check
    const batchKeys = allStudentBatchStringsForContent(student);
    const meetingBatchMatches = batchKeys.some((k) => batchesAlign(k, meeting.batch));
    if (!meetingBatchMatches) {
      return res.status(403).json({ success: false, message: 'This class is not in your batch.' });
    }

    // Quota check — only APPROVED count
    const approvedCount = await countApprovedForLevel(req.user.id, student.level);
    if (approvedCount >= REQUEST_LIMIT) {
      return res.status(400).json({
        success: false,
        message: `You have already used all ${REQUEST_LIMIT} approved recording requests for level ${student.level}.`,
        quotaExhausted: true,
      });
    }

    // Check for existing PENDING or APPROVED for same meeting+level
    const duplicate = await RecordingAccessRequest.findOne({
      studentId: req.user.id,
      meetingLinkId,
      studentLevel: student.level,
      status: { $in: ['PENDING', 'APPROVED'] },
    }).lean();
    if (duplicate) {
      return res.status(400).json({
        success: false,
        message: duplicate.status === 'APPROVED'
          ? 'You already have approved access to this recording.'
          : 'You already have a pending request for this class.',
      });
    }

    const hasRecording = await recordingIsReady(meetingLinkId);

    const request = await RecordingAccessRequest.create({
      studentId: req.user.id,
      meetingLinkId,
      studentLevel: student.level,
      studentBatch: student.batch || '',
      studentName: student.name,
      studentEmail: student.email,
      classTopic: meeting.topic || 'Class',
      classDate: meeting.startTime,
      recordingAvailable: hasRecording,
      status: 'PENDING',
    });

    const remaining = Math.max(0, REQUEST_LIMIT - approvedCount);
    sendNewRequestAdminEmail(request, meeting, {
      approvedCount,
      remaining,
      limit: REQUEST_LIMIT,
    }).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'Request submitted successfully.',
      request: {
        _id: request._id,
        status: request.status,
        approvedCount,
        remaining,
        limit: REQUEST_LIMIT,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'You already have an active request for this class.' });
    }
    console.error('[RecordingAccessRequest] submit error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit request.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/recording-access-requests/admin/pending
 * Returns all PENDING requests (oldest first) enriched with quota and recording status.
 */
router.get(
  '/admin/pending',
  verifyToken,
  checkRole(STAFF_ROLES),
  async (req, res) => {
    try {
      const requests = await RecordingAccessRequest.find({ status: 'PENDING' })
        .populate('meetingLinkId', 'topic startTime duration zoomMeetingId batch')
        .populate('reviewedBy', 'name')
        .sort({ requestedAt: 1 })
        .lean();

      // Enrich with recording status and per-student quota
      const enriched = await Promise.all(
        requests.map(async (r) => {
          const hasRecording = await recordingIsReady(r.meetingLinkId?._id || r.meetingLinkId);
          const approvedCount = await countApprovedForLevel(r.studentId, r.studentLevel);
          return {
            ...r,
            hasRecording,
            approvedCount,
            remaining: Math.max(0, REQUEST_LIMIT - approvedCount),
            limit: REQUEST_LIMIT,
          };
        })
      );

      res.json({ success: true, requests: enriched, total: enriched.length });
    } catch (err) {
      console.error('[RecordingAccessRequest] admin/pending error:', err);
      res.status(500).json({ success: false, message: 'Failed to fetch pending requests.' });
    }
  }
);

/**
 * POST /api/recording-access-requests/admin/:id/approve
 * Approves the request. Requires a ready ZoomRecording for the class.
 */
router.post(
  '/admin/:id/approve',
  verifyToken,
  checkRole(STAFF_ROLES),
  async (req, res) => {
    try {
      const request = await RecordingAccessRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });
      if (request.status !== 'PENDING') {
        return res.status(400).json({ success: false, message: `Request is already ${request.status.toLowerCase()}.` });
      }

      const hasRecording = await recordingIsReady(request.meetingLinkId);
      if (!hasRecording) {
        return res.status(400).json({
          success: false,
          message: 'No ready recording found in the portal for this class. Upload and process the recording first, then approve.',
          noRecording: true,
        });
      }

      request.status = 'APPROVED';
      request.reviewedAt = new Date();
      request.reviewedBy = req.user.id;
      request.recordingAvailable = true;
      await request.save();

      // Email student (non-blocking)
      sendApproveEmail(request).catch(() => {});

      res.json({ success: true, message: 'Request approved. Student now has access to this recording.' });
    } catch (err) {
      console.error('[RecordingAccessRequest] approve error:', err);
      res.status(500).json({ success: false, message: 'Failed to approve request.' });
    }
  }
);

/**
 * POST /api/recording-access-requests/admin/:id/decline
 * Declines the request and emails the student.
 * Body: { reason? }
 */
router.post(
  '/admin/:id/decline',
  verifyToken,
  checkRole(STAFF_ROLES),
  async (req, res) => {
    try {
      const { reason = '' } = req.body;
      const request = await RecordingAccessRequest.findById(req.params.id);
      if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });
      if (request.status !== 'PENDING') {
        return res.status(400).json({ success: false, message: `Request is already ${request.status.toLowerCase()}.` });
      }

      request.status = 'DECLINED';
      request.reviewedAt = new Date();
      request.reviewedBy = req.user.id;
      request.declineReason = reason;
      await request.save();

      // Email student (non-blocking)
      sendDeclineEmail(request, reason).catch(() => {});

      res.json({ success: true, message: 'Request declined. Student has been notified by email.' });
    } catch (err) {
      console.error('[RecordingAccessRequest] decline error:', err);
      res.status(500).json({ success: false, message: 'Failed to decline request.' });
    }
  }
);

/**
 * GET /api/recording-access-requests/admin/count
 * Returns count of PENDING requests — used for admin badge.
 */
router.get(
  '/admin/count',
  verifyToken,
  checkRole(STAFF_ROLES),
  async (req, res) => {
    try {
      const count = await RecordingAccessRequest.countDocuments({ status: 'PENDING' });
      res.json({ success: true, count });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Failed to fetch count.' });
    }
  }
);

module.exports = router;
