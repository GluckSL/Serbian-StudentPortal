const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const ZoomRecording = require('../models/ZoomRecording');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client, R2_BUCKET } = require('../config/r2');

const SIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

// GET /api/class-recordings — Teacher/Admin: all recordings; Student: filtered
router.get('/', verifyToken, async (req, res) => {
  try {
    const { role } = req.user;

    if (['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role)) {
      const recordings = await ClassRecording.find({ active: true })
        .populate('uploadedBy', 'name')
        .sort({ createdAt: -1 }).lean();
      return res.json({ success: true, recordings });
    }

    // STUDENT — filter by their batch, level, plan
    const student = await User.findById(req.user.id)
      .select('batch level subscription').lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const filter = {
      active: true,
      level: student.level,
      batches: student.batch,
      plan: { $in: [student.subscription, 'ALL'] }
    };

    const recordings = await ClassRecording.find(filter)
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 }).lean();

    res.json({ success: true, recordings });
  } catch (error) {
    console.error('Error fetching class recordings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/batches — Get unique batch values for dropdown
router.get('/batches', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const batches = await User.distinct('batch', { role: 'STUDENT', batch: { $ne: '' } });
    res.json({ success: true, batches: batches.sort() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/analytics/summary — Admin: view counts + total watch time per recording
router.get('/analytics/summary', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const summary = await RecordingView.aggregate([
      { $group: {
        _id: '$recording',
        totalViews: { $sum: 1 },
        uniqueStudents: { $addToSet: '$student' },
        totalWatchTime: { $sum: '$watchDuration' },
        avgWatchTime: { $avg: '$watchDuration' }
      }},
      { $project: {
        _id: 1, totalViews: 1, totalWatchTime: 1, avgWatchTime: 1,
        uniqueStudentCount: { $size: '$uniqueStudents' }
      }}
    ]);
    const map = {};
    summary.forEach(s => { map[s._id.toString()] = s; });
    res.json({ success: true, summary: map });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings — Create recording (Teacher/Admin)
router.post('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { title, description, videoUrl, batches, level, plan } = req.body;
    if (!title || !videoUrl || !level || !batches || batches.length === 0) {
      return res.status(400).json({ success: false, message: 'Title, video URL, level, and at least one batch are required' });
    }

    const recording = await ClassRecording.create({
      title, description, videoUrl, batches, level,
      plan: plan || 'ALL',
      uploadedBy: req.user.id
    });

    console.log(`✅ Class recording created: "${title}" by ${req.user.id}`);
    res.json({ success: true, recording });
  } catch (error) {
    console.error('Error creating class recording:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/:id — Update recording (Teacher/Admin)
router.put('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { title, description, videoUrl, batches, level, plan } = req.body;
    const recording = await ClassRecording.findByIdAndUpdate(
      req.params.id,
      { title, description, videoUrl, batches, level, plan },
      { new: true }
    );
    if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });
    res.json({ success: true, recording });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/class-recordings/:id — Soft delete (Teacher/Admin)
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const recording = await ClassRecording.findByIdAndUpdate(
      req.params.id, { active: false }, { new: true }
    );
    if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });
    res.json({ success: true, message: 'Recording deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings/:id/view — Student starts watching (creates view session)
router.post('/:id/view', verifyToken, async (req, res) => {
  try {
    const view = await RecordingView.create({
      recording: req.params.id,
      student: req.user.id,
      watchDuration: 0
    });
    res.json({ success: true, viewId: view._id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/view/:viewId — Update watch duration (called periodically)
router.put('/view/:viewId', verifyToken, async (req, res) => {
  try {
    const { watchDuration } = req.body;
    await RecordingView.findByIdAndUpdate(req.params.viewId, {
      watchDuration: watchDuration || 0,
      lastUpdatedAt: new Date()
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/:id/views — Admin: get all views for a recording
router.get('/:id/views', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const views = await RecordingView.find({ recording: req.params.id })
      .populate('student', 'name email batch level')
      .sort({ startedAt: -1 }).lean();
    res.json({ success: true, views });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ---------------------------------------------------------------------------
// Zoom Auto-Recorded Sessions (ingested via webhook → R2)
// ---------------------------------------------------------------------------

/**
 * GET /api/class-recordings/zoom/my-batch
 *
 * Returns the list of all READY Zoom recordings for the authenticated student's batch.
 * - Students see only recordings from classes belonging to their own batch.
 * - Admins/Teachers see all recordings (with optional ?batch= filter).
 * Results are sorted by class start date descending (newest first).
 */
router.get('/zoom/my-batch', verifyToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;

    let batchFilter;

    if (['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role)) {
      // Staff can optionally filter by batch via query param, otherwise get all
      batchFilter = req.query.batch ? { batch: req.query.batch } : {};
    } else {
      // Student: derive batch from their profile
      const student = await User.findById(userId).select('batch').lean();
      if (!student || !student.batch) {
        return res.status(400).json({ success: false, message: 'Student batch not set on your profile.' });
      }
      batchFilter = { batch: student.batch };
    }

    // 1. Find all MeetingLinks for this batch
    const meetingLinks = await MeetingLink.find(batchFilter)
      .select('_id topic batch startTime duration')
      .lean();

    if (!meetingLinks.length) {
      return res.json({ success: true, recordings: [] });
    }

    const meetingLinkIds = meetingLinks.map((m) => m._id);

    // 2. Find all ready ZoomRecordings for those meetings
    const zoomRecordings = await ZoomRecording.find({
      meetingLinkId: { $in: meetingLinkIds },
      status: 'ready',
    })
      .select('meetingLinkId r2Key duration status createdAt')
      .lean();

    // Build a lookup map for meeting link metadata
    const meetingMap = {};
    meetingLinks.forEach((m) => { meetingMap[m._id.toString()] = m; });

    // Merge recording with its meeting info and sort by class date descending
    const recordings = zoomRecordings.map((rec) => {
      const meeting = meetingMap[rec.meetingLinkId.toString()] || {};
      return {
        meetingLinkId: rec.meetingLinkId,
        r2Key: rec.r2Key,
        duration: rec.duration,
        createdAt: rec.createdAt,
        topic: meeting.topic || 'Class Recording',
        batch: meeting.batch || '',
        classDate: meeting.startTime || rec.createdAt,
        meetingDuration: meeting.duration || null,
      };
    }).sort((a, b) => new Date(b.classDate) - new Date(a.classDate));

    res.json({ success: true, recordings });
  } catch (error) {
    console.error('Error fetching batch recordings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/:meetingLinkId
 *
 * Returns a short-lived R2 presigned URL for the recording of a given class.
 * Access rules:
 *  - ADMIN / TEACHER_ADMIN / TEACHER: always allowed
 *  - STUDENT: must belong to the same batch as the MeetingLink (attended or not)
 */
router.get('/zoom/:meetingLinkId', verifyToken, async (req, res) => {
  try {
    const { meetingLinkId } = req.params;
    const { role, id: userId } = req.user;

    // 1. Load the ZoomRecording
    const zoomRecording = await ZoomRecording.findOne({ meetingLinkId }).lean();
    if (!zoomRecording) {
      return res.status(404).json({ success: false, message: 'No recording found for this class.' });
    }

    if (zoomRecording.status === 'processing') {
      return res.status(202).json({ success: false, message: 'Recording is still being processed. Please try again shortly.' });
    }

    if (zoomRecording.status === 'failed') {
      return res.status(500).json({ success: false, message: 'Recording processing failed. Please contact support.' });
    }

    // 2. Authorisation check for students — batch-based (attended or not)
    if (!['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role)) {
      const [meetingLink, student] = await Promise.all([
        MeetingLink.findById(meetingLinkId).select('batch').lean(),
        User.findById(userId).select('batch').lean(),
      ]);

      if (!meetingLink) {
        return res.status(404).json({ success: false, message: 'Class not found.' });
      }

      if (!student || meetingLink.batch !== student.batch) {
        return res.status(403).json({ success: false, message: 'This recording is not available for your batch.' });
      }
    }

    // 3. Generate a presigned URL from R2 (15-minute TTL)
    const command = new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: zoomRecording.r2Key,
    });

    const signedUrl = await getSignedUrl(r2Client, command, {
      expiresIn: SIGNED_URL_EXPIRY_SECONDS,
    });

    res.json({
      success: true,
      signedUrl,
      duration: zoomRecording.duration,
      createdAt: zoomRecording.createdAt,
      r2Key: zoomRecording.r2Key,
    });
  } catch (error) {
    console.error('Error generating recording signed URL:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/:meetingLinkId/status
 * Returns processing status without generating a signed URL.
 * Useful for polling from the frontend while a recording is being processed.
 */
router.get('/zoom/:meetingLinkId/status', verifyToken, async (req, res) => {
  try {
    const { meetingLinkId } = req.params;

    const zoomRecording = await ZoomRecording.findOne({ meetingLinkId })
      .select('status duration createdAt errorMessage').lean();

    if (!zoomRecording) {
      return res.status(404).json({ success: false, message: 'No recording found.' });
    }

    res.json({ success: true, status: zoomRecording.status, duration: zoomRecording.duration, createdAt: zoomRecording.createdAt });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
