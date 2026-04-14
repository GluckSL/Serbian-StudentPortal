const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const ZoomRecording = require('../models/ZoomRecording');
const MeetingLink = require('../models/MeetingLink');
const ZoomWebhookAudit = require('../models/ZoomWebhookAudit');
const User = require('../models/User');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client, R2_BUCKET } = require('../config/r2');
const { backfillZoomRecordings } = require('../services/zoomRecordingBackfillService');

const SIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

function normalizeBatch(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSameBatch(studentBatch, meetingBatch) {
  const a = normalizeBatch(studentBatch);
  const b = normalizeBatch(meetingBatch);
  if (!a || !b) return false;
  if (a === b) return true;
  // Allow meeting batch names that extend student batch labels,
  // e.g. "Batch 35" vs "Batch 35 - A1 German Class"
  return b.startsWith(`${a} -`) || b.startsWith(`${a}:`) || b.startsWith(`${a} |`);
}

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

// GET /api/class-recordings/admin/all — Admin/Teacher: combined manual + zoom recordings
router.get('/admin/all', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    // 1) Manual recordings (existing ClassRecording records)
    const manualRecordings = await ClassRecording.find({ active: true })
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // 2) Zoom auto-recordings (ingested from webhook, stored in R2)
    // Admin sees all states so they can decide what to publish.
    const zoomRecordings = await ZoomRecording.find({})
      .select('meetingLinkId r2Key duration status createdAt zoomMeetingId isPublished publishedAt')
      .sort({ createdAt: -1 })
      .lean();

    const meetingLinkIds = zoomRecordings.map((z) => z.meetingLinkId);
    const meetingLinks = await MeetingLink.find({ _id: { $in: meetingLinkIds } })
      .select('_id topic batch startTime duration')
      .lean();

    const meetingMap = {};
    meetingLinks.forEach((m) => { meetingMap[m._id.toString()] = m; });

    const zoomItems = zoomRecordings.map((z) => {
      const meeting = meetingMap[z.meetingLinkId.toString()] || {};
      return {
        _id: `zoom-${z.meetingLinkId.toString()}`,
        recordingType: 'ZOOM',
        source: 'ZOOM_AUTO',
        title: meeting.topic || 'Zoom Class Recording',
        description: '',
        videoUrl: '',
        level: 'ZOOM',
        plan: 'ALL',
        batches: meeting.batch ? [meeting.batch] : [],
        uploadedBy: { _id: null, name: 'Zoom Webhook' },
        active: true,
        createdAt: z.createdAt,
        // zoom-specific extras for admin UI
        meetingLinkId: z.meetingLinkId,
        zoomMeetingId: z.zoomMeetingId || null,
        status: z.status,
        isPublished: Boolean(z.isPublished),
        publishedAt: z.publishedAt || null,
        r2Key: z.r2Key,
        duration: z.duration,
        classDate: meeting.startTime || z.createdAt,
        classDuration: meeting.duration || null,
      };
    });

    const manualItems = manualRecordings.map((m) => ({
      ...m,
      recordingType: 'MANUAL',
      source: 'MANUAL_UPLOAD',
      status: 'ready',
      isPublished: true,
      publishedAt: m.createdAt,
      duration: null,
      classDate: m.createdAt,
      classDuration: null,
      meetingLinkId: null,
      zoomMeetingId: null,
      r2Key: null,
    }));

    const recordings = [...manualItems, ...zoomItems].sort(
      (a, b) => new Date(b.classDate || b.createdAt) - new Date(a.classDate || a.createdAt)
    );

    res.json({ success: true, recordings });
  } catch (error) {
    console.error('Error fetching combined admin recordings:', error);
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
      batchFilter = req.query.batch
        ? { batch: { $regex: `^${escapeRegex(String(req.query.batch))}`, $options: 'i' } }
        : {};
    } else {
      // Student: derive batch from their profile
      const student = await User.findById(userId).select('batch').lean();
      if (!student || !student.batch) {
        return res.status(400).json({ success: false, message: 'Student batch not set on your profile.' });
      }
      batchFilter = {
        batch: {
          $regex: `^${escapeRegex(String(student.batch))}(\\b|\\s*[-:|])`,
          $options: 'i',
        },
      };
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
      isPublished: true,
    })
      .select('meetingLinkId r2Key duration status createdAt isPublished')
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
        isPublished: Boolean(rec.isPublished),
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
 * POST /api/class-recordings/zoom/backfill
 *
 * Admin tool to backfill past class recordings from Zoom for existing MeetingLink records.
 * This is for historical data recovery. Future classes should still flow automatically
 * through the recording.completed webhook.
 *
 * Body (all optional):
 *  - batch: "35"
 *  - limit: 200
 *  - includeFailed: true
 *  - force: false
 */
router.post('/zoom/backfill', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const {
      batch = null,
      limit = 100,
      includeFailed = true,
      force = false,
    } = req.body || {};

    const result = await backfillZoomRecordings({
      batch,
      limit,
      includeFailed,
      force,
    });

    return res.json({
      success: true,
      message: 'Backfill scan completed. Queued recordings will continue processing in background.',
      ...result,
    });
  } catch (error) {
    console.error('Error running zoom recording backfill:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/class-recordings/zoom/publish
 *
 * Publish/unpublish selected Zoom recordings for student visibility.
 * Body:
 *  - meetingLinkIds: string[]
 *  - isPublished: boolean (default true)
 */
router.post('/zoom/publish', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { meetingLinkIds, isPublished = true } = req.body || {};
    if (!Array.isArray(meetingLinkIds) || meetingLinkIds.length === 0) {
      return res.status(400).json({ success: false, message: 'meetingLinkIds array is required.' });
    }

    const update = {
      isPublished: Boolean(isPublished),
      publishedAt: isPublished ? new Date() : null,
      publishedBy: isPublished ? req.user.id : null,
    };

    const result = await ZoomRecording.updateMany(
      { meetingLinkId: { $in: meetingLinkIds } },
      { $set: update }
    );

    return res.json({
      success: true,
      message: isPublished ? 'Recordings published successfully.' : 'Recordings unpublished successfully.',
      matched: result.matchedCount || 0,
      modified: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('Error publishing zoom recordings:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/debug/status
 *
 * Temporary admin/teacher debug endpoint to inspect ingestion status by batch.
 * Query params:
 *  - batch (optional): filter to one batch
 *  - limit (optional, default 200): max rows
 */
router.get('/zoom/debug/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 500));
    const batch = req.query.batch ? String(req.query.batch) : null;
    const meetingFilter = batch ? { batch } : {};

    const meetingLinks = await MeetingLink.find(meetingFilter)
      .select('_id batch topic startTime duration createdAt')
      .sort({ startTime: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (!meetingLinks.length) {
      return res.json({ success: true, total: 0, summary: {}, rows: [] });
    }

    const meetingIds = meetingLinks.map((m) => m._id);
    const zoomRows = await ZoomRecording.find({ meetingLinkId: { $in: meetingIds } })
      .select('meetingLinkId zoomMeetingId status isPublished r2Key duration errorMessage createdAt updatedAt')
      .lean();

    const zoomByMeetingId = {};
    zoomRows.forEach((z) => {
      zoomByMeetingId[z.meetingLinkId.toString()] = z;
    });

    const rows = meetingLinks.map((meeting) => {
      const zoom = zoomByMeetingId[meeting._id.toString()];
      return {
        meetingLinkId: meeting._id,
        batch: meeting.batch || '',
        topic: meeting.topic || 'Class',
        classDate: meeting.startTime || meeting.createdAt,
        meetingDuration: meeting.duration || null,
        zoomMeetingId: zoom?.zoomMeetingId || null,
        status: zoom?.status || 'missing',
        isPublished: Boolean(zoom?.isPublished),
        r2Key: zoom?.r2Key || null,
        recordingDuration: zoom?.duration || null,
        errorMessage: zoom?.errorMessage || null,
        recordingCreatedAt: zoom?.createdAt || null,
        recordingUpdatedAt: zoom?.updatedAt || null,
      };
    });

    const summary = rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      total: rows.length,
      summary,
      rows,
    });
  } catch (error) {
    console.error('Error fetching zoom debug status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/webhook-audit
 *
 * Admin/teacher endpoint to inspect recent webhook ingress + processing outcomes.
 * Query params:
 *  - limit (default 100, max 500)
 *  - status (optional)
 *  - eventType (optional)
 */
router.get('/zoom/webhook-audit', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.eventType) filter.eventType = String(req.query.eventType);

    const rows = await ZoomWebhookAudit.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const summary = rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    res.json({ success: true, total: rows.length, summary, rows });
  } catch (error) {
    console.error('Error fetching webhook audit logs:', error);
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

    // 2. Authorisation check for students — batch-based + published only
    if (!['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role)) {
      if (!zoomRecording.isPublished) {
        return res.status(403).json({ success: false, message: 'This recording has not been published yet.' });
      }

      const [meetingLink, student] = await Promise.all([
        MeetingLink.findById(meetingLinkId).select('batch').lean(),
        User.findById(userId).select('batch').lean(),
      ]);

      if (!meetingLink) {
        return res.status(404).json({ success: false, message: 'Class not found.' });
      }

      if (!student || !isSameBatch(student.batch, meetingLink.batch)) {
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
      isPublished: Boolean(zoomRecording.isPublished),
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
