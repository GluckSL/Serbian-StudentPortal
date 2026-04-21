const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const TeacherResource = require('../models/TeacherResource');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');
const { presignStoredS3Url, presignS3InlineUrl } = require('../config/presign');

const router = express.Router();

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      const uniqueName = `${Date.now()}_${Math.round(Math.random() * 1e9)}_${file.originalname}`;
      cb(null, `${prefix}/teacher-resources/${uniqueName}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});

const uploadSingle = upload.single('file');

router.post(
  '/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  (req, res, next) => {
    uploadSingle(req, res, (err) => {
      if (!err) return next();
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: err.message || 'Upload failed' });
    });
  },
  async (req, res) => {
    let uploadedKey = null;
    try {
      const { teacherId, title, day } = req.body;
      if (!teacherId || !title || !day) {
        return res.status(400).json({ success: false, message: 'teacherId, title and day are required' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File is required' });
      }

      const teacher = await User.findOne({ _id: teacherId, role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } }).lean();
      if (!teacher) {
        return res.status(404).json({ success: false, message: 'Teacher not found' });
      }

      uploadedKey = req.file.key || null;
      const doc = await TeacherResource.create({
        teacherId,
        title: String(title).trim(),
        day: String(day).trim(),
        fileName: req.file.key || req.file.filename,
        originalName: req.file.originalname,
        fileUrl: req.file.location || req.file.path,
        mimeType: req.file.mimetype,
        fileSize: req.file.size,
        uploadedBy: req.user.id
      });

      const out = doc.toObject();
      out.fileUrl = await presignStoredS3Url(out.fileName, out.fileUrl);
      res.status(201).json({ success: true, data: out });
    } catch (err) {
      if (uploadedKey && process.env.S3_BUCKET) {
        try {
          await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: uploadedKey }));
        } catch (_) {
          // best effort rollback
        }
      }
      console.error('teacherResources upload error:', err);
      res.status(500).json({ success: false, message: 'Upload failed', error: err.message });
    }
  }
);

router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const role = req.user?.role;
    const query = {};

    if (role === 'TEACHER') {
      query.teacherId = req.user.id;
    } else if (req.query.teacherId) {
      query.teacherId = req.query.teacherId;
    }

    const rows = await TeacherResource.find(query)
      .populate('teacherId', 'name email')
      .populate('uploadedBy', 'name')
      .sort({ uploadedAt: -1 })
      .lean();

    await Promise.all(
      rows.map(async (row) => {
        row.fileUrl = await presignStoredS3Url(row.fileName, row.fileUrl);
        row.previewUrl = await presignS3InlineUrl(row.fileName, row.fileUrl, row.originalName);
      })
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('teacherResources list error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch resources', error: err.message });
  }
});

router.get('/:id/preview', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const row = await TeacherResource.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: 'Resource not found' });

    // Teachers can only preview resources assigned to themselves.
    if (req.user?.role === 'TEACHER' && String(row.teacherId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const key = (row.fileName || '').replace(/^\//, '').trim();
    if (!key || !process.env.S3_BUCKET) {
      return res.status(400).json({ success: false, message: 'Invalid storage object' });
    }

    const fileName = String(row.originalName || 'preview').replace(/["\r\n]/g, '_');
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key
    });
    const out = await s3Client.send(command);

    const originalName = String(row.originalName || '').toLowerCase();
    const forceHtml = originalName.endsWith('.html') || originalName.endsWith('.htm');
    const contentType = forceHtml
      ? 'text/html; charset=utf-8'
      : (row.mimeType || out.ContentType || 'application/octet-stream');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-popups");
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (!out.Body) {
      return res.status(500).json({ success: false, message: 'Preview stream is empty' });
    }
    out.Body.pipe(res);
  } catch (err) {
    console.error('teacherResources preview error:', err);
    res.status(500).json({ success: false, message: 'Failed to preview resource', error: err.message });
  }
});

router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const row = await TeacherResource.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: 'Resource not found' });

    if (row.fileName && process.env.S3_BUCKET) {
      try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: row.fileName }));
      } catch (_) {
        // best effort
      }
    }

    await TeacherResource.findByIdAndDelete(row._id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('teacherResources delete error:', err);
    res.status(500).json({ success: false, message: 'Delete failed', error: err.message });
  }
});

module.exports = router;
