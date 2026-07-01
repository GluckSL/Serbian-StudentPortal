const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const multer = require('multer');
const multerS3 = require('multer-s3');
const { GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3');
const GoRecordingResource = require('../models/GoRecordingResource');
const ClassRecording = require('../models/ClassRecording');
const MeetingLink = require('../models/MeetingLink');
const ZoomRecording = require('../models/ZoomRecording');
const User = require('../models/User');
const { verifyToken, verifyMediaToken, checkRole } = require('../middleware/auth');
const { presignStoredS3Url, presignS3DownloadUrl, presignS3InlineUrl } = require('../config/presign');
const { resolveContentType, isBrowserPreviewable } = require('../utils/fileMime');
const {
  canUserAccessManualRecording,
  canUserAccessZoomRecording,
  hasApprovedRecordingGrant,
} = require('../utils/recordingContentAccess');

const DANGEROUS_EXT = /\.(exe|bat|cmd|com|scr|msi|dll|vbs|ps1|pif|cpl|inf|reg|hta|iso)$/i;
const DANGEROUS_MIME =
  /application\/(x-msdownload|x-dosexec|x-msdos-program|vnd\.microsoft\.portable-executable)/i;

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: (_req, file, cb) => {
      cb(null, resolveContentType(file.originalname, file.mimetype));
    },
    key: (_req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      cb(null, `${prefix}/go-recording-resources/${Date.now()}_${file.originalname}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    const name = file.originalname || '';
    if (DANGEROUS_EXT.test(name)) {
      return cb(new Error('This file type is not allowed for security reasons.'));
    }
    if (file.mimetype && DANGEROUS_MIME.test(file.mimetype)) {
      return cb(new Error('This file type is not allowed for security reasons.'));
    }
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 }
});

const uploadResources = upload.array('files', 5);

function isStaff(role) {
  return ['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN'].includes(role);
}

async function loadStudent(req) {
  const id = req.user?.userId || req.user?.id;
  if (!id) return null;
  return User.findById(id).lean();
}

async function resolveManualRecording(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return ClassRecording.findById(id).lean();
}

async function resolveZoomContext(meetingLinkId) {
  if (!mongoose.Types.ObjectId.isValid(meetingLinkId)) return null;
  const meetingLink = await MeetingLink.findById(meetingLinkId).lean();
  if (!meetingLink) return null;
  const zoomRecording = await ZoomRecording.findOne({ meetingLinkId }).lean();
  return { meetingLink, zoomRecording };
}

async function assertRecordingAccess(recordingType, recordingId, student, staff) {
  if (staff) return { ok: true };
  if (!student) return { ok: false, status: 401, message: 'Unauthorized' };

  if (recordingType === 'manual') {
    const recording = await resolveManualRecording(recordingId);
    if (!recording) return { ok: false, status: 404, message: 'Recording not found' };
    if (!canUserAccessManualRecording(recording, student)) {
      return { ok: false, status: 403, message: 'Recording not available for your account' };
    }
    return { ok: true, recording };
  }

  const ctx = await resolveZoomContext(recordingId);
  if (!ctx) return { ok: false, status: 404, message: 'Recording not found' };
  const granted = await hasApprovedRecordingGrant(student._id || student.id, recordingId);
  if (!granted && !canUserAccessZoomRecording(ctx.zoomRecording, ctx.meetingLink, student)) {
    return { ok: false, status: 403, message: 'Recording not available for your account' };
  }
  return { ok: true, ...ctx };
}

function listFilter(recordingType, recordingId) {
  if (recordingType === 'manual') {
    return { recordingType: 'manual', classRecordingId: recordingId };
  }
  return { recordingType: 'zoom', meetingLinkId: recordingId };
}

async function presignResourceRows(resources) {
  await Promise.all(resources.map(async (r) => {
    if (r.fileUrl) r.fileUrl = await presignStoredS3Url(r.fileName, r.fileUrl);
  }));
  return resources;
}

// POST /:recordingType/:recordingId/upload
router.post(
  '/:recordingType/:recordingId/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']),
  (req, res, next) => {
    uploadResources(req, res, (err) => {
      if (err) {
        const message = err.message || 'Upload failed';
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ success: false, message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const recordingType = String(req.params.recordingType || '').toLowerCase();
      const recordingId = req.params.recordingId;
      if (!['manual', 'zoom'].includes(recordingType)) {
        return res.status(400).json({ success: false, message: 'Invalid recording type' });
      }

      if (recordingType === 'manual') {
        const recording = await resolveManualRecording(recordingId);
        if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });
      } else {
        const ctx = await resolveZoomContext(recordingId);
        if (!ctx) return res.status(404).json({ success: false, message: 'Recording not found' });
      }

      const base = {
        recordingType,
        uploadedBy: req.user.id || req.user.userId,
        ...(recordingType === 'manual'
          ? { classRecordingId: recordingId }
          : { meetingLinkId: recordingId })
      };

      const docs = (req.files || []).map((f) => ({
        ...base,
        fileName: f.key || f.filename,
        originalName: f.originalname,
        fileUrl: f.location || f.path,
        fileSize: f.size,
        mimeType: f.mimetype
      }));

      if (!docs.length) {
        return res.status(400).json({ success: false, message: 'No files uploaded' });
      }

      const saved = await GoRecordingResource.insertMany(docs);
      const data = await presignResourceRows(
        saved.map((doc) => (typeof doc.toObject === 'function' ? doc.toObject() : { ...doc }))
      );
      res.json({ success: true, data });
    } catch (err) {
      console.error('goRecordingResources upload error:', err);
      res.status(500).json({ success: false, message: 'Upload failed', error: err.message });
    }
  }
);

// GET /download/:resourceId
router.get('/download/:resourceId', verifyMediaToken, async (req, res) => {
  try {
    const { resourceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid resource id' });
    }

    const resource = await GoRecordingResource.findById(resourceId).lean();
    if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

    const student = await loadStudent(req);
    const staff = isStaff(req.user?.role);
    const parentId = resource.recordingType === 'manual'
      ? String(resource.classRecordingId)
      : String(resource.meetingLinkId);
    const access = await assertRecordingAccess(resource.recordingType, parentId, student, staff);
    if (!access.ok) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    const contentType = resolveContentType(resource.originalName, resource.mimeType);
    const filename = String(resource.originalName || 'download').replace(/["\r\n]/g, '_');

    const objectKey = String(resource.fileName).replace(/^\//, '').trim();
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: objectKey,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
      ResponseContentType: contentType,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 * 5 });
    if (!signedUrl) {
      return res.status(500).json({ success: false, message: 'Could not build download URL' });
    }
    res.redirect(signedUrl);
  } catch (err) {
    console.error('goRecordingResources download error:', err);
    res.status(500).json({ success: false, message: 'Download link failed', error: err.message });
  }
});

// GET /view/:resourceId — inline preview for PDF/images, download for ZIP/Office archives
router.get('/view/:resourceId', verifyToken, async (req, res) => {
  try {
    const { resourceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid resource id' });
    }

    const resource = await GoRecordingResource.findById(resourceId).lean();
    if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

    const student = await loadStudent(req);
    const staff = isStaff(req.user?.role);
    const parentId = resource.recordingType === 'manual'
      ? String(resource.classRecordingId)
      : String(resource.meetingLinkId);
    const access = await assertRecordingAccess(resource.recordingType, parentId, student, staff);
    if (!access.ok) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    const previewable = isBrowserPreviewable(resource.originalName, resource.mimeType);
    const url = previewable
      ? await presignS3InlineUrl(
          resource.fileName,
          resource.fileUrl,
          resource.originalName,
          resource.mimeType
        )
      : await presignS3DownloadUrl(
          resource.fileName,
          resource.fileUrl,
          resource.originalName,
          resource.mimeType
        );

    if (!url) {
      return res.status(500).json({ success: false, message: 'Could not build view URL' });
    }
    res.json({ success: true, url, mode: previewable ? 'inline' : 'download' });
  } catch (err) {
    console.error('goRecordingResources view error:', err);
    res.status(500).json({ success: false, message: 'View link failed', error: err.message });
  }
});

// GET /:recordingType/:recordingId
router.get('/:recordingType/:recordingId', verifyToken, async (req, res) => {
  try {
    const recordingType = String(req.params.recordingType || '').toLowerCase();
    const recordingId = req.params.recordingId;
    if (!['manual', 'zoom'].includes(recordingType)) {
      return res.status(400).json({ success: false, message: 'Invalid recording type' });
    }

    const student = await loadStudent(req);
    const staff = isStaff(req.user?.role);
    const access = await assertRecordingAccess(recordingType, recordingId, student, staff);
    if (!access.ok) {
      return res.status(access.status || 403).json({ success: false, message: access.message });
    }

    const resources = await GoRecordingResource.find(listFilter(recordingType, recordingId))
      .populate('uploadedBy', 'name')
      .sort({ uploadedAt: -1 })
      .lean();

    await presignResourceRows(resources);
    res.json({ success: true, data: resources });
  } catch (err) {
    console.error('goRecordingResources list error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch resources', error: err.message });
  }
});

// DELETE /:resourceId
router.delete(
  '/:resourceId',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN', 'SUB_ADMIN']),
  async (req, res) => {
    try {
      const resource = await GoRecordingResource.findById(req.params.resourceId);
      if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

      if (resource.fileName && process.env.S3_BUCKET) {
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: resource.fileName
          }));
        } catch (_) { /* best effort */ }
      }

      await GoRecordingResource.findByIdAndDelete(resource._id);
      res.json({ success: true, message: 'Deleted' });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Delete failed', error: err.message });
    }
  }
);

module.exports = router;
