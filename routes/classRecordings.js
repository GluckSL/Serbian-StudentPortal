const express = require('express');
const router = express.Router();
const { verifyToken, checkRole } = require('../middleware/auth');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const ZoomRecording = require('../models/ZoomRecording');
const ZoomRecordingView = require('../models/ZoomRecordingView');
const MeetingLink = require('../models/MeetingLink');
const ZoomWebhookAudit = require('../models/ZoomWebhookAudit');
const User = require('../models/User');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
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
    const zoomRecordings = await ZoomRecording.find({ status: 'ready' })
      .select('meetingLinkId r2Key duration status createdAt zoomMeetingId isPublished publishedAt')
      .sort({ createdAt: -1 })
      .lean();

    const meetingLinkIds = zoomRecordings.map((z) => z.meetingLinkId);
    const meetingLinks = await MeetingLink.find({ _id: { $in: meetingLinkIds } })
      .select('_id topic batch startTime duration assignedTeacher')
      .populate('assignedTeacher', 'name')
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
        assignedTeacherId: meeting.assignedTeacher?._id || null,
        status: z.status,
        isPublished: z.isPublished !== false,
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

// POST /api/class-recordings/zoom/:meetingLinkId/view — Student starts watching a Zoom recording
router.post('/zoom/:meetingLinkId/view', verifyToken, async (req, res) => {
  try {
    const { meetingLinkId } = req.params;
    const view = await ZoomRecordingView.create({
      meetingLinkId,
      student: req.user.id,
      watchDuration: 0,
    });
    res.json({ success: true, viewId: view._id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/zoom/view/:viewId — Update Zoom watch duration
router.put('/zoom/view/:viewId', verifyToken, async (req, res) => {
  try {
    const { watchDuration } = req.body || {};
    await ZoomRecordingView.findByIdAndUpdate(req.params.viewId, {
      watchDuration: watchDuration || 0,
      lastUpdatedAt: new Date(),
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/zoom/:meetingLinkId/views — Admin analytics for one Zoom recording
router.get('/zoom/:meetingLinkId/views', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { meetingLinkId } = req.params;

    const [meeting, zoomRec, zoomViews] = await Promise.all([
      MeetingLink.findById(meetingLinkId).select('batch').lean(),
      ZoomRecording.findOne({ meetingLinkId }).select('r2Key').lean(),
      ZoomRecordingView.find({ meetingLinkId })
        .populate('student', 'name email batch level')
        .sort({ startedAt: -1 })
        .lean(),
    ]);

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found.' });
    }

    const watchMap = {};
    for (const v of zoomViews) {
      const sid = v?.student?._id ? String(v.student._id) : null;
      if (!sid) continue;
      if (!watchMap[sid]) watchMap[sid] = [];
      watchMap[sid].push(v);
    }

    const allStudents = await User.find({ role: 'STUDENT' })
      .select('name email batch level')
      .lean();

    const batchStudents = allStudents.filter((s) =>
      isSameBatch(s.batch, meeting.batch) || isSameBatch(meeting.batch, s.batch)
    );

    const rows = [];
    for (const student of batchStudents) {
      const sid = String(student._id);
      const sessions = watchMap[sid] || [];
      if (!sessions.length) {
        rows.push({
          student: {
            name: student.name || 'Unknown',
            email: student.email || '',
            batch: student.batch || '',
            level: student.level || '',
          },
          watchDuration: 0,
          startedAt: null,
          lastUpdatedAt: null,
          viewed: false,
        });
        continue;
      }

      const latest = sessions[0];
      rows.push({
        student: {
          name: student.name || 'Unknown',
          email: student.email || '',
          batch: student.batch || '',
          level: student.level || '',
        },
        watchDuration: Number(latest.watchDuration || 0),
        startedAt: latest.startedAt || null,
        lastUpdatedAt: latest.lastUpdatedAt || null,
        viewed: true,
      });
    }

    let videoSizeBytes = 0;
    if (zoomRec?.r2Key) {
      try {
        const head = await r2Client.send(new HeadObjectCommand({
          Bucket: R2_BUCKET,
          Key: zoomRec.r2Key,
        }));
        videoSizeBytes = Number(head.ContentLength || 0);
      } catch (e) {
        videoSizeBytes = 0;
      }
    }

    const watchedCount = rows.filter((r) => r.viewed).length;
    const totalWatchSeconds = rows.reduce((sum, r) => sum + Number(r.watchDuration || 0), 0);

    return res.json({
      success: true,
      views: rows,
      summary: {
        totalStudents: rows.length,
        watchedCount,
        notWatchedCount: rows.length - watchedCount,
        totalWatchSeconds,
        videoSizeBytes,
      },
    });
  } catch (error) {
    console.error('Error fetching zoom recording views:', error);
    return res.status(500).json({ success: false, message: error.message });
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
    let studentBatchValue = null;

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
      studentBatchValue = String(student.batch);
      const batchToken = escapeRegex(studentBatchValue);
      batchFilter = {
        batch: {
          // Broad pre-filter: batch token can appear in labels like
          // "35", "Batch 35", "Batch 35 - A1 German Class", etc.
          $regex: `(^|\\s|-)${batchToken}(\\b|\\s*[-:|])`,
          $options: 'i',
        },
      };
    }

    // 1. Find all MeetingLinks for this batch
    let meetingLinks = await MeetingLink.find(batchFilter)
      .select('_id topic batch startTime duration status attendance assignedTeacher')
      .populate('assignedTeacher', 'name')
      .lean();

    // Final guard for students: normalize and compare batch labels safely.
    if (studentBatchValue) {
      meetingLinks = meetingLinks.filter((m) => isSameBatch(studentBatchValue, m.batch));
    }

    if (!meetingLinks.length) {
      return res.json({ success: true, recordings: [] });
    }

    const meetingLinkIds = meetingLinks.map((m) => m._id);

    // 2. Find all ready ZoomRecordings for those meetings
    const zoomRecordings = await ZoomRecording.find({
      meetingLinkId: { $in: meetingLinkIds },
      status: 'ready',
      isPublished: { $ne: false },
    })
      .select('meetingLinkId r2Key duration status createdAt isPublished')
      .lean();

    // Build a lookup map for meeting link metadata
    const meetingMap = {};
    meetingLinks.forEach((m) => { meetingMap[m._id.toString()] = m; });

    // Merge recording with its meeting info and sort by class date descending
    const recordings = zoomRecordings.map((rec) => {
      const meeting = meetingMap[rec.meetingLinkId.toString()] || {};
      const startTime = meeting.startTime ? new Date(meeting.startTime) : null;
      const durationMinutes = Number(meeting.duration || 0);
      const computedEnd = startTime && durationMinutes > 0
        ? new Date(startTime.getTime() + durationMinutes * 60 * 1000)
        : null;
      const attempted = meeting.status === 'ended' || (computedEnd ? Date.now() >= computedEnd.getTime() : false);
      const myAttendance = Array.isArray(meeting.attendance)
        ? meeting.attendance.find((a) => String(a?.studentId || '') === String(userId))
        : null;
      const attendanceStatus = myAttendance
        ? (
            myAttendance.attended === true ||
            myAttendance.status === 'attended' ||
            Number(myAttendance.attendancePercent || 0) >= 75
              ? 'Attended'
              : (attempted ? 'Not Attended' : 'Pending')
          )
        : (attempted ? 'Not Attempted' : 'Pending');

      return {
        meetingLinkId: rec.meetingLinkId,
        r2Key: rec.r2Key,
        duration: rec.duration,
        createdAt: rec.createdAt,
        isPublished: rec.isPublished !== false,
        topic: meeting.topic || 'Class Recording',
        batch: meeting.batch || '',
        teacherName: meeting.assignedTeacher?.name || 'Teacher',
        attempted,
        attendanceStatus,
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
 * Toggle Zoom recording visibility for students.
 * Body:
 *  - meetingLinkIds: string[]
 *  - isPublished: boolean
 */
router.post('/zoom/publish', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { meetingLinkIds, isPublished } = req.body || {};
    if (!Array.isArray(meetingLinkIds) || meetingLinkIds.length === 0) {
      return res.status(400).json({ success: false, message: 'meetingLinkIds array is required.' });
    }

    const publishState = Boolean(isPublished);
    const result = await ZoomRecording.updateMany(
      { meetingLinkId: { $in: meetingLinkIds } },
      {
        $set: {
          isPublished: publishState,
          publishedAt: publishState ? new Date() : null,
        },
      }
    );

    return res.json({
      success: true,
      message: publishState ? 'Recording(s) visible to students.' : 'Recording(s) hidden from students.',
      matched: result.matchedCount || 0,
      modified: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('Error updating Zoom publish state:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/class-recordings/zoom/:meetingLinkId/meta
 *
 * Edit metadata of a Zoom class recording (title/topic, teacher, batch).
 */
router.put('/zoom/:meetingLinkId/meta', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { meetingLinkId } = req.params;
    const { title, batch, teacherId } = req.body || {};

    const meeting = await MeetingLink.findById(meetingLinkId);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found.' });
    }

    if (typeof title === 'string' && title.trim()) {
      meeting.topic = title.trim();
    }
    if (typeof batch === 'string' && batch.trim()) {
      meeting.batch = batch.trim();
    }
    if (teacherId) {
      const teacher = await User.findById(teacherId).select('_id role').lean();
      if (!teacher || !['TEACHER', 'TEACHER_ADMIN', 'ADMIN'].includes(teacher.role)) {
        return res.status(400).json({ success: false, message: 'Invalid teacher selected.' });
      }
      meeting.assignedTeacher = teacher._id;
    }

    await meeting.save();
    return res.json({ success: true, message: 'Zoom recording details updated.' });
  } catch (error) {
    console.error('Error updating zoom recording metadata:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/class-recordings/zoom/:meetingLinkId
 *
 * Remove a Zoom auto-recording entry for a class.
 */
router.delete('/zoom/:meetingLinkId', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { meetingLinkId } = req.params;
    const removed = await ZoomRecording.findOneAndDelete({ meetingLinkId });
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Zoom recording not found.' });
    }
    await ZoomRecordingView.deleteMany({ meetingLinkId });
    return res.json({ success: true, message: 'Zoom recording deleted successfully.' });
  } catch (error) {
    console.error('Error deleting zoom recording:', error);
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
        isPublished: zoom?.isPublished !== false,
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

    // 2. Authorisation check for students — batch-based (attended or not)
    if (!['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role)) {
      if (zoomRecording.isPublished === false) {
        return res.status(403).json({ success: false, message: 'This recording is hidden by your teacher.' });
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
      isPublished: zoomRecording.isPublished !== false,
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
