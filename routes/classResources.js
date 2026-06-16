const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const multer = require('multer');
const multerS3 = require('multer-s3');
const { GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3');
const ClassResource = require('../models/ClassResource');
const MeetingLink = require('../models/MeetingLink');
const { verifyToken, verifyMediaToken, checkRole } = require('../middleware/auth');
const { presignStoredS3Url, presignS3DownloadUrl, presignS3InlineUrl } = require('../config/presign');
const { resolveContentType, isBrowserPreviewable } = require('../utils/fileMime');

// Allow most resource types (docs, images, audio, video, archives, etc.).
// Block obvious executable / installer extensions and PE-related MIME types.
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
      cb(null, `${prefix}/class-resources/${Date.now()}_${file.originalname}`);
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
  limits: { fileSize: 20 * 1024 * 1024 }
});

const uploadResources = upload.array('files', 5);

// POST /:meetingId/upload  — teacher uploads files for a class
router.post('/:meetingId/upload', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), (req, res, next) => {
  uploadResources(req, res, (err) => {
    if (err) {
      const message = err.message || 'Upload failed';
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message });
    }
    next();
  });
}, async (req, res) => {
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
    const data = await Promise.all(
      saved.map(async (doc) => {
        const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
        if (o.fileUrl) o.fileUrl = await presignStoredS3Url(o.fileName, o.fileUrl);
        return o;
      })
    );
    res.json({ success: true, data });
  } catch (err) {
    console.error('classResources upload error:', err);
    res.status(500).json({ success: false, message: 'Upload failed', error: err.message });
  }
});

// GET /download/:resourceId — presigned URL with Content-Disposition: attachment (real download, no CORS fetch)
router.get('/download/:resourceId', verifyMediaToken, async (req, res) => {
  try {
    const { resourceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid resource id' });
    }
    const resource = await ClassResource.findById(resourceId).lean();
    if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

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
    console.error('classResources GET /download/:resourceId', err);
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
    const resource = await ClassResource.findById(resourceId).lean();
    if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

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
    console.error('classResources GET /view/:resourceId', err);
    res.status(500).json({ success: false, message: 'View link failed', error: err.message });
  }
});

router.get('/:meetingId', verifyToken, async (req, res) => {
  try {
    const resources = await ClassResource.find({ meetingId: req.params.meetingId })
      .populate('uploadedBy', 'name')
      .sort({ uploadedAt: -1 })
      .lean();

    // Prefer canonical S3 key (fileName) when signing — avoids %20 / %2520 key mismatches vs fileUrl
    await Promise.all(resources.map(async (r) => {
      if (r.fileUrl) r.fileUrl = await presignStoredS3Url(r.fileName, r.fileUrl);
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
