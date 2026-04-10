const express = require('express');
const router = express.Router();
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const ClassResource = require('../models/ClassResource');
const MeetingLink = require('../models/MeetingLink');
const { verifyToken, checkRole } = require('../middleware/auth');
const { presignS3Url } = require('../config/presign');

const allowedTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/zip',
  'image/png',
  'image/jpeg',
  'image/webp'
];

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      cb(null, `${prefix}/class-resources/${Date.now()}_${file.originalname}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, allowedTypes.includes(file.mimetype));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

// POST /:meetingId/upload  — teacher uploads files for a class
router.post('/:meetingId/upload', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), upload.array('files', 5), async (req, res) => {
  try {
    const meeting = await MeetingLink.findById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

    const docs = (req.files || []).map(f => ({
      meetingId: meeting._id,
      uploadedBy: req.user.id,
      fileName: f.key || f.filename,
      originalName: f.originalname,
      fileUrl: f.location || f.path,
      fileSize: f.size,
      mimeType: f.mimetype
    }));

    const saved = await ClassResource.insertMany(docs);
    res.json({ success: true, data: saved });
  } catch (err) {
    console.error('classResources upload error:', err);
    res.status(500).json({ success: false, message: 'Upload failed', error: err.message });
  }
});

// GET /:meetingId  — list resources for a meeting
router.get('/:meetingId', verifyToken, async (req, res) => {
  try {
    const resources = await ClassResource.find({ meetingId: req.params.meetingId })
      .populate('uploadedBy', 'name')
      .sort({ uploadedAt: -1 })
      .lean();

    // Replace private S3 URLs with presigned URLs so students can download
    await Promise.all(resources.map(async (r) => {
      if (r.fileUrl) r.fileUrl = await presignS3Url(r.fileUrl);
    }));

    res.json({ success: true, data: resources });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch resources', error: err.message });
  }
});

// DELETE /:resourceId  — teacher deletes a resource
router.delete('/:resourceId', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), async (req, res) => {
  try {
    const resource = await ClassResource.findById(req.params.resourceId);
    if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

    if (resource.fileName && process.env.S3_BUCKET) {
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: resource.fileName }));
      } catch (_) { /* best effort */ }
    }

    await ClassResource.findByIdAndDelete(resource._id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed', error: err.message });
  }
});

module.exports = router;
