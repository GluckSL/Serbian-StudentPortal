const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const multer = require('multer');
const multerS3 = require('multer-s3');
const { GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3');
const ClassResource = require('../models/ClassResource');
const MeetingLink = require('../models/MeetingLink');
const { verifyToken, verifyMediaToken, checkRole } = require('../middleware/auth');
const { presignStoredS3Url, presignS3DownloadUrl, presignS3InlineUrl, presignMediaUrl } = require('../config/presign');
const { resolveContentType, isBrowserPreviewable } = require('../utils/fileMime');
const {
  isExerciseR2Configured,
  getExerciseR2Config,
  publicUrlForKey,
  getExerciseMediaBuffer,
  extractMediaKeyFromUrl,
  isExerciseR2Url,
} = require('../services/exerciseMediaR2');

const R2_KEY_PREFIX = 'class-resources/';
const MAX_FILES = 5;

function isClassResourceR2Key(key) {
  const normalized = String(key || '').replace(/^\/+/, '');
  return normalized.startsWith(R2_KEY_PREFIX);
}

function isClassResourceS3Key(key) {
  const prefix = process.env.S3_PREFIX || 'uploads';
  const normalized = String(key || '').replace(/^\/+/, '');
  return normalized.startsWith(`${prefix}/class-resources/`);
}

function isClassResourceKey(key) {
  return isClassResourceR2Key(key) || isClassResourceS3Key(key);
}

function isR2ClassResource(row) {
  const key = String(row?.fileName || '').replace(/^\/+/, '');
  if (isClassResourceR2Key(key)) return true;
  return isExerciseR2Url(row?.fileUrl);
}

async function headClassResourceR2(key) {
  const cfg = getExerciseR2Config();
  if (!cfg) return null;
  try {
    return await cfg.client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch {
    return null;
  }
}

async function deleteClassResourceStorage(key) {
  const normalized = String(key || '').replace(/^\/+/, '').trim();
  if (!normalized) return;

  if (isClassResourceR2Key(normalized)) {
    const cfg = getExerciseR2Config();
    if (!cfg) return;
    try {
      await cfg.client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: normalized }));
    } catch (_) {
      // best effort
    }
    return;
  }

  if (process.env.S3_BUCKET) {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: normalized }));
    } catch (_) {
      // best effort
    }
  }
}

async function resolveClassResourceUrl(row) {
  if (isR2ClassResource(row)) {
    const url = row.fileUrl || publicUrlForKey(row.fileName);
    row.fileUrl = await presignMediaUrl(url);
    return row;
  }
  if (row.fileUrl) row.fileUrl = await presignStoredS3Url(row.fileName, row.fileUrl);
  return row;
}

function rejectDangerousOriginalName(originalName) {
  const name = String(originalName || '');
  if (DANGEROUS_EXT.test(name)) {
    const err = new Error('This file type is not allowed for security reasons.');
    err.status = 400;
    throw err;
  }
}

async function verifyUploadedClassResourceFile(fileMeta) {
  const key = String(fileMeta?.key || '').replace(/^\//, '').trim();
  if (!key || !isClassResourceKey(key)) {
    const err = new Error('Invalid storage key');
    err.status = 400;
    throw err;
  }

  const originalName = String(fileMeta.originalName || '').trim() || key.split('/').pop();
  rejectDangerousOriginalName(originalName);

  if (isClassResourceR2Key(key)) {
    if (!isExerciseR2Configured()) {
      const err = new Error('R2 is not configured');
      err.status = 500;
      throw err;
    }
    const head = await headClassResourceR2(key);
    if (!head) {
      const err = new Error('Uploaded file not found in storage. Try uploading again.');
      err.status = 400;
      throw err;
    }
    const size = Number(head.ContentLength || 0);
    if (!size || size > 50 * 1024 * 1024) {
      const err = new Error('Uploaded file is missing or exceeds the 50 MB limit');
      err.status = 400;
      throw err;
    }
    if (head.ContentType && DANGEROUS_MIME.test(head.ContentType)) {
      const err = new Error('This file type is not allowed for security reasons.');
      err.status = 400;
      throw err;
    }
    return {
      key,
      fileUrl: String(fileMeta.fileUrl || publicUrlForKey(key) || '').trim(),
      originalName,
      mimeType: String(fileMeta.mimeType || head.ContentType || 'application/octet-stream').trim(),
      fileSize: size,
    };
  }

  if (!process.env.S3_BUCKET) {
    const err = new Error('File storage is not configured');
    err.status = 500;
    throw err;
  }

  const head = await s3Client.send(
    new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    })
  );
  const size = Number(head.ContentLength || 0);
  if (!size || size > 50 * 1024 * 1024) {
    const err = new Error('Uploaded file is missing or exceeds the 50 MB limit');
    err.status = 400;
    throw err;
  }

  const region = process.env.AWS_REGION || 'us-east-1';
  const host =
    region === 'us-east-1'
      ? `${process.env.S3_BUCKET}.s3.amazonaws.com`
      : `${process.env.S3_BUCKET}.s3.${region}.amazonaws.com`;

  return {
    key,
    fileUrl: String(fileMeta.fileUrl || `https://${host}/${key}`).trim(),
    originalName,
    mimeType: String(fileMeta.mimeType || head.ContentType || 'application/octet-stream').trim(),
    fileSize: size,
  };
}

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
  limits: { fileSize: 50 * 1024 * 1024 }
});

const uploadResources = upload.array('files', 5);

// POST /:meetingId/register-upload — browser PUT to R2 first, then register metadata (avoids nginx timeouts)
router.post(
  '/:meetingId/register-upload',
  verifyToken,
  checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']),
  async (req, res) => {
    const uploadedKeys = [];
    try {
      const meeting = await MeetingLink.findById(req.params.meetingId);
      if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

      const files = req.body?.files;
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one file is required' });
      }
      if (files.length > MAX_FILES) {
        return res.status(400).json({ success: false, message: `Up to ${MAX_FILES} files are allowed per upload` });
      }

      for (const f of files) {
        const key = String(f?.key || '').replace(/^\//, '').trim();
        if (key) uploadedKeys.push(key);
      }

      const verifiedFiles = await Promise.all(files.map((f) => verifyUploadedClassResourceFile(f)));
      const docs = verifiedFiles.map((f) => ({
        meetingId: meeting._id,
        uploadedBy: req.user.id,
        fileName: f.key,
        originalName: f.originalName,
        fileUrl: f.fileUrl,
        fileSize: f.fileSize,
        mimeType: f.mimeType,
      }));

      const saved = await ClassResource.insertMany(docs);
      const data = await Promise.all(
        saved.map(async (doc) => {
          const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
          await resolveClassResourceUrl(o);
          return o;
        })
      );
      res.json({ success: true, data });
    } catch (err) {
      if (uploadedKeys.length > 0) {
        await Promise.allSettled(uploadedKeys.map((key) => deleteClassResourceStorage(key)));
      }
      const status = err.status || 500;
      console.error('classResources register-upload error:', err);
      res.status(status).json({ success: false, message: err.message || 'Upload failed' });
    }
  }
);

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

    const docs = await Promise.all((req.files || []).map(async (f) => {
      let fileSize = f.size;
      if (!fileSize) {
        try {
          const head = await s3Client.send(new HeadObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: f.key,
          }));
          fileSize = head.ContentLength;
        } catch (_) {}
      }
      return {
        meetingId: meeting._id,
        uploadedBy: req.user.id,
        fileName: f.key || f.filename,
        originalName: f.originalname,
        fileUrl: f.location || f.path,
        fileSize,
        mimeType: f.mimetype,
      };
    }));

    const saved = await ClassResource.insertMany(docs);
    const data = await Promise.all(
      saved.map(async (doc) => {
        const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
        await resolveClassResourceUrl(o);
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

    if (isR2ClassResource(resource)) {
      const r2Key = extractMediaKeyFromUrl(resource.fileUrl) || String(resource.fileName).replace(/^\//, '').trim();
      const buffer = await getExerciseMediaBuffer(r2Key);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(buffer);
    }

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
    let url;
    if (isR2ClassResource(resource)) {
      const baseUrl = resource.fileUrl || publicUrlForKey(resource.fileName);
      url = await presignMediaUrl(baseUrl);
    } else {
      url = previewable
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
    }

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

    // Prefer canonical storage key (fileName) when signing — avoids key mismatches vs fileUrl
    await Promise.all(resources.map(async (r) => resolveClassResourceUrl(r)));

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

    if (resource.fileName) {
      await deleteClassResourceStorage(resource.fileName);
    }

    await ClassResource.findByIdAndDelete(resource._id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Delete failed', error: err.message });
  }
});

// GET /:resourceId/file — stream raw file bytes through the API (avoids S3 CORS issues for pptx-viewer fetch)
router.get('/:resourceId/file', verifyToken, async (req, res) => {
  try {
    const { resourceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(resourceId)) {
      return res.status(400).json({ success: false, message: 'Invalid resource id' });
    }
    const resource = await ClassResource.findById(resourceId).lean();
    if (!resource) return res.status(404).json({ success: false, message: 'Resource not found' });

    if (isR2ClassResource(resource)) {
      const r2Key = extractMediaKeyFromUrl(resource.fileUrl) || String(resource.fileName).replace(/^\//, '').trim();
      const buffer = await getExerciseMediaBuffer(r2Key);
      res.setHeader('Content-Type', resolveContentType(resource.originalName, resource.mimeType));
      res.setHeader('Content-Disposition', `inline; filename="${resource.originalName}"`);
      return res.send(buffer);
    }

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: resource.fileName,
    });
    const { Body, ContentType } = await s3Client.send(command);

    res.setHeader('Content-Type', ContentType || resource.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${resource.originalName}"`);
    Body.pipe(res);
  } catch (err) {
    console.error('classResources GET /:resourceId/file', err);
    res.status(500).json({ success: false, message: 'Failed to serve file' });
  }
});

module.exports = router;
