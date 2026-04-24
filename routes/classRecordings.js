const express = require('express');
const mongoose = require('mongoose');
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
const { r2Client, R2_BUCKET, R2_CONFIG_OK, r2ConfigIssues } = require('../config/r2');
const { backfillZoomRecordings, getBackfillStatus } = require('../services/zoomRecordingBackfillService');
const { processManualRecordingUpload } = require('../services/recordingProcessor');
const manualRecordingUpload = require('../config/manualRecordingUpload');
const { allStudentBatchStringsForContent, batchesAlign } = require('../utils/effectiveStudentBatch');
const { markPendingAdvanceForStudentDay } = require('../services/journeyDayAdvance.service');
const BatchConfig = require('../models/BatchConfig');
const {
  computeJourneyDayCompletion,
  meetsStrictThreshold
} = require('../services/journeyDayCompletion.service');

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SIGNED_URL_EXPIRY_SECONDS = 15 * 60; // 15 minutes

// ── In-memory HLS playlist cache ──────────────────────────────────────────────
// Stores rewritten m3u8 (with presigned segment URLs) per recording key.
// TTL is 13 min — safely within the 15-min presigned URL lifetime.
const _hlsCache = new Map(); // cacheKey → { content: string, expiresAt: number }
const HLS_CACHE_TTL_MS = 13 * 60 * 1000;

function getHlsCached(cacheKey) {
  const entry = _hlsCache.get(cacheKey);
  if (!entry || Date.now() >= entry.expiresAt) {
    _hlsCache.delete(cacheKey);
    return null;
  }
  return entry.content;
}

function setHlsCached(cacheKey, content) {
  _hlsCache.set(cacheKey, { content, expiresAt: Date.now() + HLS_CACHE_TTL_MS });
}

/** Drain an AWS SDK v3 stream body into a UTF-8 string. */
async function streamToString(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Fetch the raw HLS playlist from R2, then replace every `.ts` line with
 * a presigned R2 URL valid for SIGNED_URL_EXPIRY_SECONDS.
 * The browser (or hls.js) can then fetch segments directly from R2,
 * bypassing the Express server entirely — zero extra backend load during playback.
 */
async function buildSignedHlsPlaylist(hlsKey) {
  if (!R2_CONFIG_OK) {
    throw new Error(`R2 is not configured: ${r2ConfigIssues.join(', ')}`);
  }
  const { GetObjectCommand: GetObj } = require('@aws-sdk/client-s3');

  // Fetch raw m3u8 text from R2
  const obj = await r2Client.send(new GetObj({ Bucket: R2_BUCKET, Key: hlsKey }));
  const raw = await streamToString(obj.Body);

  // The HLS directory prefix (everything before /playlist.m3u8)
  const hlsDir = hlsKey.substring(0, hlsKey.lastIndexOf('/'));

  // Replace each segment filename line with a presigned URL
  const lines = raw.split('\n');
  const signed = await Promise.all(
    lines.map(async (line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.endsWith('.ts')) {
        const segKey = `${hlsDir}/${trimmed}`;
        const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: segKey });
        return getSignedUrl(r2Client, cmd, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
      }
      return line;
    })
  );

  return signed.join('\n');
}

/** Plans a student may see for manual ClassRecording rows (GO-Silver journey uploads are sometimes tagged PLATINUM). */
function allowedRecordingPlansForStudent(student) {
  const sub = String(student?.subscription || '').toUpperCase();
  if (String(student?.goStatus || '') === 'GO' && sub === 'SILVER') {
    return ['SILVER', 'ALL', 'PLATINUM'];
  }
  return [sub, 'ALL'].filter(Boolean);
}

function normalizedStudentCourseDay(student) {
  const v = student && student.currentCourseDay;
  if (v != null && v !== undefined && Number.isFinite(Number(v))) {
    return Math.min(200, Math.max(1, Math.floor(Number(v))));
  }
  return 1;
}

/** ClassRecording or MeetingLink: available when courseDay is unset or <= student's journey day. */
function journeyCourseDayUnlockedForStudent(doc, student) {
  const studentDay = normalizedStudentCourseDay(student);
  const raw = doc && doc.courseDay;
  if (raw == null || raw === undefined) return true;
  const cd = Number(raw);
  if (!Number.isFinite(cd)) return true;
  return cd <= studentDay;
}

function canUserAccessManualRecording(recording, student) {
  if (!recording?.active) return false;
  if (recording.isPublished === false) return false;
  if (!student) return false;
  const batchKeys = allStudentBatchStringsForContent(student);
  const inBatch = batchKeys.length > 0 && Array.isArray(recording.batches) &&
    recording.batches.some((b) => batchKeys.some((k) => batchesAlign(k, b)));
  if (!inBatch) return false;
  if (!journeyCourseDayUnlockedForStudent(recording, student)) return false;
  if (recording.level && student.level && recording.level !== student.level) return false;
  const recPlan = String(recording.plan || 'ALL').toUpperCase();
  if (!recPlan || recPlan === 'ALL') return true;
  const allowed = allowedRecordingPlansForStudent(student).map((p) => String(p).toUpperCase());
  return allowed.includes(recPlan);
}

function normalizeZoomAccessSettings(zoomRecording, meetingLink) {
  const accessBatches = Array.isArray(zoomRecording?.accessBatches)
    ? zoomRecording.accessBatches.map((b) => String(b).trim()).filter(Boolean)
    : [];
  const batches = accessBatches.length
    ? accessBatches
    : (meetingLink?.batch ? [String(meetingLink.batch)] : []);
  const level = zoomRecording?.accessLevel ? String(zoomRecording.accessLevel).toUpperCase() : null;
  const plan = String(zoomRecording?.accessPlan || 'ALL').toUpperCase();
  return { batches, level, plan };
}

function canUserAccessZoomRecording(zoomRecording, meetingLink, student) {
  if (!zoomRecording || zoomRecording.isPublished === false) return false;
  if (!student || !meetingLink) return false;
  if (!journeyCourseDayUnlockedForStudent(meetingLink, student)) return false;

  const { batches, level, plan } = normalizeZoomAccessSettings(zoomRecording, meetingLink);
  const studentBatchKeys = allStudentBatchStringsForContent(student);
  const inBatch = studentBatchKeys.length > 0 &&
    batches.length > 0 &&
    batches.some((b) => studentBatchKeys.some((k) => batchesAlign(k, b)));
  if (!inBatch) return false;

  if (level && student.level && String(student.level).toUpperCase() !== level) return false;
  if (!plan || plan === 'ALL') return true;

  const allowed = allowedRecordingPlansForStudent(student).map((p) => String(p).toUpperCase());
  return allowed.includes(plan);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

    // STUDENT — filter by their batch, level, plan, journey day
    const student = await User.findById(req.user.id)
      .select('batch level subscription goStatus currentCourseDay').lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const studentLevel = String(student.level || 'A1').toUpperCase();
    const baseFilter = {
      active: true,
      isPublished: { $ne: false },
      level: studentLevel,
      plan: { $in: allowedRecordingPlansForStudent(student) }
    };

    const recordings = await ClassRecording.find(baseFilter)
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 }).lean();

    const batchKeys = allStudentBatchStringsForContent(student);
    // Match legacy User.batch and GO-SILVER tags (Silver GO often has both).
    const filteredRecordings = batchKeys.length
      ? recordings.filter(
          (r) =>
            Array.isArray(r.batches) &&
            r.batches.some((b) => batchKeys.some((k) => batchesAlign(k, b))) &&
            journeyCourseDayUnlockedForStudent(r, student)
        )
      : [];

    res.json({ success: true, recordings: filteredRecordings });
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
    // Admin/teacher list includes all states so rows do not disappear while processing;
    // publish flags control student visibility.
    const zoomRecordings = await ZoomRecording.find({})
      .select('meetingLinkId r2Key duration status createdAt zoomMeetingId isPublished publishedAt accessBatches accessLevel accessPlan')
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
      const access = normalizeZoomAccessSettings(z, meeting);
      return {
        _id: `zoom-${z.meetingLinkId.toString()}`,
        recordingType: 'ZOOM',
        source: 'ZOOM_AUTO',
        title: meeting.topic || 'Zoom Class Recording',
        description: '',
        videoUrl: '',
        level: access.level || '',
        plan: access.plan || 'ALL',
        batches: access.batches,
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
      status: m.status || 'ready',
      isPublished: m.isPublished !== false,
      publishedAt: m.publishedAt || (m.isPublished !== false ? m.createdAt : null),
      duration: null,
      classDate: m.createdAt,
      classDuration: null,
      meetingLinkId: null,
      zoomMeetingId: null,
      r2Key: null,
      sourceType: m.sourceType || 'URL',
      hlsKey: m.hlsKey || null,
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
      sourceType: 'URL',
      status: 'ready',
      uploadedBy: req.user.id
    });

    console.log(`✅ Class recording created: "${title}" by ${req.user.id}`);
    res.json({ success: true, recording });
  } catch (error) {
    console.error('Error creating class recording:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings/upload — Upload MP4, convert to HLS, store in R2
router.post('/upload', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), (req, res) => {
  manualRecordingUpload.single('video')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message || 'Upload failed.' });
    }

    try {
      if (!R2_CONFIG_OK) {
        return res.status(503).json({
          success: false,
          message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
        });
      }

      const { title, description = '', level, plan = 'ALL' } = req.body || {};
      const rawBatches = req.body?.batches;
      const batches = Array.isArray(rawBatches)
        ? rawBatches
        : String(rawBatches || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);

      if (!title || !level || !batches.length) {
        return res.status(400).json({
          success: false,
          message: 'Title, level, and at least one batch are required.',
        });
      }
      if (!req.file?.path) {
        return res.status(400).json({ success: false, message: 'Video file is required.' });
      }

      const recording = await ClassRecording.create({
        title: String(title).trim(),
        description: String(description || '').trim(),
        videoUrl: '',
        batches,
        level: String(level),
        plan: String(plan || 'ALL'),
        sourceType: 'HLS_UPLOAD',
        status: 'processing',
        hlsKey: null,
        errorMessage: null,
        uploadedBy: req.user.id,
        isPublished: false,
        publishedAt: null,
      });

      // Immediate response; conversion runs in background.
      res.status(202).json({
        success: true,
        message: 'Upload received. HLS conversion started in background.',
        recordingId: recording._id,
      });

      processManualRecordingUpload(String(recording._id), req.file.path)
        .then(async (result) => {
          if (result?.success && result.hlsKey) {
            await ClassRecording.findByIdAndUpdate(recording._id, {
              status: 'ready',
              hlsKey: result.hlsKey,
              errorMessage: null,
            });
            return;
          }
          await ClassRecording.findByIdAndUpdate(recording._id, {
            status: 'failed',
            errorMessage: result?.error || 'Conversion failed',
          });
        })
        .catch(async (err) => {
          await ClassRecording.findByIdAndUpdate(recording._id, {
            status: 'failed',
            errorMessage: err.message || 'Conversion failed',
          });
        });
    } catch (error) {
      console.error('Error creating uploaded recording:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
});

/**
 * POST /api/class-recordings/manual/publish
 *
 * Toggle student visibility for manually uploaded / URL class recordings.
 * Body: { recordingIds: string[], isPublished: boolean }
 */
router.post('/manual/publish', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { recordingIds, isPublished } = req.body || {};
    if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'recordingIds array is required.' });
    }

    const publishState = Boolean(isPublished);
    const result = await ClassRecording.updateMany(
      { _id: { $in: recordingIds }, status: 'ready', active: true },
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
    console.error('Error updating manual publish state:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/:id — Update recording (Teacher/Admin)
router.put('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { title, description, videoUrl, batches, level, plan, courseDay, addBatch, isPublished } = req.body || {};
    const existing = await ClassRecording.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Recording not found' });

    const updatePayload = {};
    if (title !== undefined) updatePayload.title = title;
    if (description !== undefined) updatePayload.description = description;
    if (level !== undefined) updatePayload.level = level;
    if (plan !== undefined) updatePayload.plan = plan;
    if (existing.sourceType !== 'HLS_UPLOAD' && videoUrl !== undefined) {
      updatePayload.videoUrl = videoUrl;
    }
    if (Array.isArray(batches)) {
      updatePayload.batches = batches.map((b) => String(b).trim()).filter(Boolean);
    } else if (addBatch !== undefined && addBatch !== null && String(addBatch).trim() !== '') {
      const tag = String(addBatch).trim();
      updatePayload.batches = Array.from(new Set([...(existing.batches || []).map(String), tag]));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseDay')) {
      if (courseDay === null || courseDay === '') {
        updatePayload.courseDay = null;
      } else {
        const n = parseInt(String(courseDay), 10);
        updatePayload.courseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isPublished')) {
      const pub = Boolean(isPublished);
      updatePayload.isPublished = pub;
      updatePayload.publishedAt = pub ? (existing.publishedAt || new Date()) : null;
    }

    const recording = await ClassRecording.findByIdAndUpdate(
      req.params.id,
      { $set: updatePayload },
      { new: true, runValidators: true }
    );
    res.json({ success: true, recording });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/:id/upload-status — Poll status for manual uploaded recordings
router.get('/:id/upload-status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const recording = await ClassRecording.findById(req.params.id)
      .select('_id sourceType status errorMessage hlsKey createdAt')
      .lean();

    if (!recording) {
      return res.status(404).json({ success: false, message: 'Recording not found.' });
    }

    res.json({
      success: true,
      recordingId: recording._id,
      sourceType: recording.sourceType || 'URL',
      status: recording.status || 'ready',
      errorMessage: recording.errorMessage || null,
      hlsReady: Boolean(recording.hlsKey),
      createdAt: recording.createdAt,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/:id/hls/playlist — signed playlist for manual uploaded recordings
router.get('/:id/hls/playlist', verifyToken, async (req, res) => {
  try {
    if (!R2_CONFIG_OK) {
      return res.status(503).json({
        success: false,
        message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
      });
    }

    const recording = await ClassRecording.findById(req.params.id)
      .select('active sourceType status hlsKey level plan batches isPublished courseDay')
      .lean();
    if (!recording || !recording.active) {
      return res.status(404).json({ success: false, message: 'Recording not found.' });
    }
    if (recording.sourceType !== 'HLS_UPLOAD' || !recording.hlsKey) {
      return res.status(404).json({ success: false, message: 'HLS recording not found for this item.' });
    }
    if (recording.status === 'processing') {
      return res.status(202).json({ success: false, message: 'Recording is still being processed.' });
    }
    if (recording.status !== 'ready') {
      return res.status(500).json({ success: false, message: recording.errorMessage || 'Recording is not available.' });
    }

    if (!['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(req.user.role)) {
      const student = await User.findById(req.user.id).select('batch level subscription goStatus currentCourseDay').lean();
      if (!canUserAccessManualRecording(recording, student)) {
        return res.status(403).json({ success: false, message: 'This recording is not available for your profile.' });
      }
    }

    const cacheKey = `manual:${String(req.params.id)}`;
    const cached = getHlsCached(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(cached);
    }

    const playlist = await buildSignedHlsPlaylist(recording.hlsKey);
    setHlsCached(cacheKey, playlist);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(playlist);
  } catch (error) {
    console.error('Error serving manual HLS playlist:', error);
    return res.status(500).json({ success: false, message: error.message });
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
    const recording = await ClassRecording.findById(req.params.id).lean();
    if (!recording || !recording.active) {
      return res.status(404).json({ success: false, message: 'Recording not found.' });
    }
    if (!['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(req.user.role)) {
      const student = await User.findById(req.user.id).select('batch level subscription goStatus currentCourseDay').lean();
      if (!canUserAccessManualRecording(recording, student)) {
        return res.status(403).json({ success: false, message: 'This recording is not available for your profile.' });
      }
    }
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
    const { role, id: userId } = req.user;
    if (!['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role)) {
      const [meetingLink, zoomRecording, student] = await Promise.all([
        MeetingLink.findById(meetingLinkId).select('batch courseDay').lean(),
        ZoomRecording.findOne({ meetingLinkId }).select('accessBatches accessLevel accessPlan isPublished').lean(),
        User.findById(userId).select('batch goStatus subscription currentCourseDay').lean(),
      ]);
      if (!canUserAccessZoomRecording(zoomRecording, meetingLink, student)) {
        return res.status(403).json({
          success: false,
          message: 'This recording is not available for your profile.',
        });
      }
    }
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
    const watchDurationSec = Math.max(0, Number(req.body?.watchDuration || 0));
    const view = await ZoomRecordingView.findByIdAndUpdate(req.params.viewId, {
      watchDuration: watchDurationSec,
      lastUpdatedAt: new Date(),
    }, {
      new: true,
      select: 'meetingLinkId student watchDuration'
    });

    if (view?.meetingLinkId && view?.student) {
      const [meeting, zoomRec] = await Promise.all([
        MeetingLink.findById(view.meetingLinkId).select('batch courseDay duration status').lean(),
        ZoomRecording.findOne({ meetingLinkId: view.meetingLinkId }).select('duration').lean()
      ]);

      const recordingDurationSec = Number(
        zoomRec?.duration != null
          ? zoomRec.duration
          : (meeting?.duration != null ? Number(meeting.duration) * 60 : 0)
      );
      const day = Number(meeting?.courseDay);
      const isEligibleGate =
        !!meeting &&
        meeting.status !== 'cancelled' &&
        Number.isFinite(day) &&
        day >= 1 &&
        Number.isFinite(recordingDurationSec) &&
        recordingDurationSec > 0 &&
        watchDurationSec >= Math.ceil(recordingDurationSec * 0.75);

      if (isEligibleGate) {
        const dayInt = Math.floor(day);
        const nextDay = Math.min(200, dayInt + 1);
        const studentLean = await User.findById(view.student)
          .select('batch goStatus subscription currentCourseDay')
          .lean();
        const batchKeys = studentLean ? allStudentBatchStringsForContent(studentLean) : [];
        const primary = batchKeys.includes('GO-SILVER') ? 'GO-SILVER' : batchKeys[0];
        const cfgDoc = primary
          ? await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(primary)}$`, 'i') }).lean()
          : null;

        let allowInstantAdvance = true;
        if (cfgDoc && cfgDoc.strictJourneyRule) {
          const comp = await computeJourneyDayCompletion(view.student, batchKeys, dayInt, {
            creditMeetings: meeting?._id ? [meeting._id] : []
          });
          allowInstantAdvance = meetsStrictThreshold(comp, cfgDoc);
        }

        if (allowInstantAdvance) {
          const advancedNow = await User.updateOne(
            { _id: view.student, role: 'STUDENT', currentCourseDay: dayInt },
            {
              $set: {
                currentCourseDay: nextDay,
                pendingJourneyDayAdvance: false,
                pendingJourneyDayAdvanceForDay: null
              }
            }
          );
          if (!advancedNow?.modifiedCount) {
            await markPendingAdvanceForStudentDay(String(view.student), String(meeting.batch || ''), dayInt);
          }
        }
      }
    }

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
      ZoomRecording.findOne({ meetingLinkId }).select('r2Key accessBatches accessLevel accessPlan').lean(),
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
      .select('name email batch level goStatus subscription')
      .lean();

    const access = normalizeZoomAccessSettings(zoomRec, meeting);
    const batchStudents = allStudents.filter((s) => {
      const keys = allStudentBatchStringsForContent(s);
      if (!keys.length || !access.batches.length) return false;
      const inBatch = access.batches.some((b) => keys.some((k) => batchesAlign(k, b)));
      if (!inBatch) return false;
      if (access.level && s.level && String(s.level).toUpperCase() !== access.level) return false;
      if (!access.plan || access.plan === 'ALL') return true;
      const allowed = allowedRecordingPlansForStudent(s).map((p) => String(p).toUpperCase());
      return allowed.includes(access.plan);
    });

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
    const isStaff = ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role);
    const student = isStaff
      ? null
      : await User.findById(userId).select('batch level subscription goStatus currentCourseDay').lean();
    if (!isStaff && !student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const query = isStaff
      ? { status: 'ready' }
      : { status: 'ready', isPublished: { $ne: false } };
    const zoomRecordings = await ZoomRecording.find(query)
      .select('meetingLinkId r2Key duration status createdAt isPublished accessBatches accessLevel accessPlan')
      .lean();
    if (!zoomRecordings.length) return res.json({ success: true, recordings: [] });

    const meetingLinkIds = zoomRecordings.map((z) => z.meetingLinkId);
    const meetingLinks = await MeetingLink.find({ _id: { $in: meetingLinkIds } })
      .select('_id topic batch startTime duration status attendance assignedTeacher courseDay')
      .populate('assignedTeacher', 'name')
      .lean();
    const meetingMap = {};
    meetingLinks.forEach((m) => { meetingMap[String(m._id)] = m; });

    const batchQuery = req.query.batch ? String(req.query.batch).trim() : '';
    const recordings = zoomRecordings
      .filter((rec) => {
        const meeting = meetingMap[String(rec.meetingLinkId)];
        if (!meeting) return false;
        if (!isStaff) {
          return canUserAccessZoomRecording(rec, meeting, student);
        }
        if (!batchQuery) return true;
        const access = normalizeZoomAccessSettings(rec, meeting);
        return access.batches.some((b) => batchesAlign(batchQuery, b));
      })
      .map((rec) => {
        const meeting = meetingMap[String(rec.meetingLinkId)] || {};
        const access = normalizeZoomAccessSettings(rec, meeting);
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
          status: rec.status,
          createdAt: rec.createdAt,
          isPublished: rec.isPublished !== false,
          topic: meeting.topic || 'Class Recording',
          batch: access.batches.join(', '),
          batches: access.batches,
          level: access.level,
          plan: access.plan,
          teacherName: meeting.assignedTeacher?.name || 'Teacher',
          attempted,
          attendanceStatus,
          classDate: meeting.startTime || rec.createdAt,
          meetingDuration: meeting.duration || null,
          courseDay: meeting.courseDay != null ? meeting.courseDay : null,
        };
      })
      .sort((a, b) => new Date(b.classDate) - new Date(a.classDate));

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
 *  - meetingIds: ["81190533282", "81221622942"] or "81190533282,81221622942"
 */
/**
 * POST /api/class-recordings/zoom/backfill
 *
 * Starts a backfill in the background and responds 202 immediately so
 * Cloudflare's proxy timeout is never hit. Poll GET /zoom/backfill/status
 * to track progress.
 */
router.post('/zoom/backfill', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  const {
    batch = null,
    limit = 100,
    includeFailed = true,
    force = false,
    meetingIds = [],
  } = req.body || {};

  const status = getBackfillStatus();
  if (status.running) {
    return res.status(409).json({
      success: false,
      message: 'A backfill is already running. Poll GET /api/class-recordings/zoom/backfill/status for updates.',
      startedAt: status.startedAt,
      params: status.params,
    });
  }

  // Respond immediately — scanning + downloading can take minutes.
  res.status(202).json({
    success: true,
    message: 'Backfill started in background. Poll GET /api/class-recordings/zoom/backfill/status for results.',
    params: { batch, limit, includeFailed, force, meetingIds },
  });

  // Fire-and-forget: runs entirely outside the HTTP request lifecycle.
  backfillZoomRecordings({ batch, limit, includeFailed, force, meetingIds }).catch((err) => {
    console.error('❌ Backfill top-level error:', err.message);
  });
});

/**
 * GET /api/class-recordings/zoom/backfill/status
 *
 * Returns the state of the most recently triggered backfill job.
 * Use this to poll after calling POST /zoom/backfill.
 */
router.get('/zoom/backfill/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  const status = getBackfillStatus();
  res.json({ success: true, ...status });
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
    // Only ready recordings are eligible for student visibility toggling.
    const result = await ZoomRecording.updateMany(
      { meetingLinkId: { $in: meetingLinkIds }, status: 'ready' },
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
 * POST /api/class-recordings/manual/publish
 *
 * Toggle manual (uploaded / URL) class recording visibility for students.
 * Body:
 *  - recordingIds: string[]
 *  - isPublished: boolean
 */
router.post('/manual/publish', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { recordingIds, isPublished } = req.body || {};
    if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'recordingIds array is required.' });
    }

    const publishState = Boolean(isPublished);
    const ids = [...new Set(recordingIds.map((id) => String(id).trim()).filter(Boolean))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );
    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'No valid recording IDs.' });
    }

    const result = await ClassRecording.updateMany(
      { _id: { $in: ids }, active: true, status: 'ready' },
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
    console.error('Error updating manual publish state:', error);
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
    const { title, batch, batches, level, plan, teacherId } = req.body || {};

    const meeting = await MeetingLink.findById(meetingLinkId);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found.' });
    }

    if (typeof title === 'string' && title.trim()) {
      meeting.topic = title.trim();
    }
    const nextBatches = Array.isArray(batches)
      ? batches.map((b) => String(b).trim()).filter(Boolean)
      : (typeof batch === 'string' && batch.trim() ? [batch.trim()] : []);

    if (nextBatches.length === 1) {
      meeting.batch = nextBatches[0];
    } else if (typeof batch === 'string' && batch.trim()) {
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
    const zoomSet = {
      ...(nextBatches.length ? { accessBatches: Array.from(new Set(nextBatches)) } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'level')
        ? { accessLevel: level ? String(level).toUpperCase() : null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'plan')
        ? { accessPlan: String(plan || 'ALL').toUpperCase() }
        : {}),
    };
    if (Object.keys(zoomSet).length > 0) {
      await ZoomRecording.updateOne({ meetingLinkId }, { $set: zoomSet });
    }
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
 * GET /api/class-recordings/zoom/:meetingLinkId/hls/playlist
 *
 * Serves the HLS master playlist (.m3u8) with every segment line replaced by
 * a short-lived presigned R2 URL.  Once the client has this playlist, it fetches
 * segments directly from R2 — the Express server is NOT involved during playback.
 *
 * The playlist is cached in-memory for 13 minutes so repeated seeks / refreshes
 * don't re-sign hundreds of URLs on every request.
 *
 * Access control is identical to the MP4 signed-URL endpoint.
 */
router.get('/zoom/:meetingLinkId/hls/playlist', verifyToken, async (req, res) => {
  try {
    if (!R2_CONFIG_OK) {
      return res.status(503).json({
        success: false,
        message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
      });
    }

    const { meetingLinkId } = req.params;
    const { role, id: userId } = req.user;

    const zoomRecording = await ZoomRecording.findOne({ meetingLinkId })
      .select('hlsKey status isPublished accessBatches accessLevel accessPlan').lean();

    if (!zoomRecording || !zoomRecording.hlsKey) {
      return res.status(404).json({ success: false, message: 'HLS recording not found for this class.' });
    }
    if (zoomRecording.status === 'processing') {
      return res.status(202).json({ success: false, message: 'Recording is still being processed.' });
    }
    if (zoomRecording.status !== 'ready') {
      return res.status(500).json({ success: false, message: 'Recording is not available.' });
    }

    // Student access control
    if (!['ADMIN', 'TEACHER_ADMIN', 'TEACHER'].includes(role)) {
      const [meetingLink, student] = await Promise.all([
        MeetingLink.findById(meetingLinkId).select('batch courseDay').lean(),
        User.findById(userId).select('batch level goStatus subscription currentCourseDay').lean(),
      ]);
      if (!canUserAccessZoomRecording(zoomRecording, meetingLink, student)) {
        return res.status(403).json({
          success: false,
          message: 'This recording is not available for your profile.',
        });
      }
    }

    // Serve from cache when possible
    const cacheKey = `zoom:${String(meetingLinkId)}`;
    const cached = getHlsCached(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(cached);
    }

    // Build and cache the signed playlist
    const playlist = await buildSignedHlsPlaylist(zoomRecording.hlsKey);
    setHlsCached(cacheKey, playlist);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(playlist);

  } catch (error) {
    console.error('Error serving HLS playlist:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/:meetingLinkId
 *
 * Returns a short-lived R2 presigned URL for the recording of a given class.
 * For HLS recordings (hlsKey set) it also returns hlsMode:true so the client
 * knows to use the /hls/playlist endpoint instead of the MP4 URL.
 * Access rules:
 *  - ADMIN / TEACHER_ADMIN / TEACHER: always allowed
 *  - STUDENT: must belong to the same batch as the MeetingLink (attended or not)
 */
router.get('/zoom/:meetingLinkId', verifyToken, async (req, res) => {
  try {
    if (!R2_CONFIG_OK) {
      return res.status(503).json({
        success: false,
        message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
      });
    }

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
      const [meetingLink, student] = await Promise.all([
        MeetingLink.findById(meetingLinkId).select('batch courseDay').lean(),
        User.findById(userId).select('batch level goStatus subscription currentCourseDay').lean(),
      ]);
      if (!meetingLink) {
        return res.status(404).json({ success: false, message: 'Class not found.' });
      }
      if (!canUserAccessZoomRecording(zoomRecording, meetingLink, student)) {
        return res.status(403).json({
          success: false,
          message: 'This recording is not available for your profile.',
        });
      }
    }

    // 3. For HLS recordings — no MP4 presigned URL needed; client uses /hls/playlist endpoint.
    //    For legacy MP4 recordings (hlsKey absent, r2Key present) — generate presigned URL.
    const hlsMode = !!zoomRecording.hlsKey;
    let signedUrl = null;

    if (!hlsMode && zoomRecording.r2Key) {
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: zoomRecording.r2Key,
      });
      signedUrl = await getSignedUrl(r2Client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
    }

    if (!hlsMode && !signedUrl) {
      return res.status(500).json({
        success: false,
        message: 'Recording is missing both hlsKey and r2Key.',
      });
    }

    res.json({
      success: true,
      hlsMode,                                  // true → use /hls/playlist endpoint
      signedUrl,                                // null for HLS recordings; MP4 URL for legacy
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
