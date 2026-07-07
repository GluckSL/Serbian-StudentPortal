const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const TeacherResource = require('../models/TeacherResource');
const User = require('../models/User');
const { verifyToken, verifyMediaToken, checkRole } = require('../middleware/auth');
const { presignMediaUrl, presignStoredS3Url, presignS3InlineUrl } = require('../config/presign');
const {
  isExerciseR2Configured,
  getExerciseR2Config,
  publicUrlForKey,
  getExerciseMediaBuffer,
  extractMediaKeyFromUrl,
  isExerciseR2Url,
} = require('../services/exerciseMediaR2');

const router = express.Router();

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 20;
const R2_KEY_PREFIX = 'teacher-resources/';

function isTeacherResourceR2Key(key) {
  const normalized = String(key || '').replace(/^\/+/, '');
  return normalized.startsWith(R2_KEY_PREFIX);
}

function isTeacherResourceS3Key(key) {
  const prefix = process.env.S3_PREFIX || 'uploads';
  const normalized = String(key || '').replace(/^\/+/, '');
  return normalized.startsWith(`${prefix}/teacher-resources/`);
}

function isTeacherResourceKey(key) {
  return isTeacherResourceR2Key(key) || isTeacherResourceS3Key(key);
}

function isR2TeacherResource(row) {
  const key = String(row?.fileName || '').replace(/^\/+/, '');
  if (isTeacherResourceR2Key(key)) return true;
  return isExerciseR2Url(row?.fileUrl);
}

async function headTeacherResourceR2(key) {
  const cfg = getExerciseR2Config();
  if (!cfg) return null;
  try {
    return await cfg.client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch {
    return null;
  }
}

async function deleteTeacherResourceStorage(key) {
  const normalized = String(key || '').replace(/^\/+/, '').trim();
  if (!normalized) return;

  if (isTeacherResourceR2Key(normalized)) {
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

async function resolveTeacherResourceUrls(row) {
  if (isR2TeacherResource(row)) {
    const url = row.fileUrl || publicUrlForKey(row.fileName);
    row.fileUrl = await presignMediaUrl(url);
    row.previewUrl = row.fileUrl;
    return;
  }
  row.fileUrl = await presignStoredS3Url(row.fileName, row.fileUrl);
  row.previewUrl = await presignS3InlineUrl(row.fileName, row.fileUrl, row.originalName, row.mimeType);
}

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
  limits: { fileSize: MAX_FILE_SIZE }
});

const uploadSingle = upload.single('file');
const uploadMultiple = upload.array('files', 20);

function toSortedUniqueStringList(values) {
  return Array.from(
    new Set(
      (values || [])
        .map((v) => String(v || '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Parse teacher id list from multipart / JSON body (teacherIds JSON array or comma-separated). */
function parseTeacherIdsFromBody(body) {
  const raw = body && body.teacherIds;
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))];
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map((x) => String(x || '').trim()).filter(Boolean))];
      }
    } catch {
      return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
    }
  }
  if (body && body.teacherId) {
    const one = String(body.teacherId).trim();
    return one ? [one] : [];
  }
  return [];
}

function resourceVisibleToUser(row, userId) {
  const uid = String(userId || '');
  const ids = Array.isArray(row.teacherIds) ? row.teacherIds.map((x) => String(typeof x === 'object' && x ? x._id || x : x)) : [];
  if (ids.length > 0) return ids.includes(uid);
  return String(row.teacherId || '') === uid;
}

async function validateTeacherIds(teacherIds) {
  const teachers = await User.find({
    _id: { $in: teacherIds },
    role: { $in: ['TEACHER', 'TEACHER_ADMIN'] }
  })
    .select('_id')
    .lean();
  if (teachers.length !== teacherIds.length) {
    const err = new Error('One or more teacher ids are invalid');
    err.status = 400;
    throw err;
  }
}

async function verifyUploadedTeacherResourceFile(fileMeta) {
  const key = String(fileMeta?.key || '').replace(/^\//, '').trim();
  if (!key || !isTeacherResourceKey(key)) {
    const err = new Error('Invalid storage key');
    err.status = 400;
    throw err;
  }

  if (isTeacherResourceR2Key(key)) {
    if (!isExerciseR2Configured()) {
      const err = new Error('R2 is not configured');
      err.status = 500;
      throw err;
    }
    const head = await headTeacherResourceR2(key);
    if (!head) {
      const err = new Error('Uploaded file not found in storage. Try uploading again.');
      err.status = 400;
      throw err;
    }
    const size = Number(head.ContentLength || 0);
    if (!size || size > MAX_FILE_SIZE) {
      const err = new Error('Uploaded file is missing or exceeds the 50 MB limit');
      err.status = 400;
      throw err;
    }
    return {
      key,
      fileUrl: String(fileMeta.fileUrl || publicUrlForKey(key) || '').trim(),
      originalName: String(fileMeta.originalName || '').trim() || key.split('/').pop(),
      mimeType: String(fileMeta.mimeType || head.ContentType || 'application/octet-stream').trim(),
      fileSize: size
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
      Key: key
    })
  );
  const size = Number(head.ContentLength || 0);
  if (!size || size > MAX_FILE_SIZE) {
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
    originalName: String(fileMeta.originalName || '').trim() || key.split('/').pop(),
    mimeType: String(fileMeta.mimeType || head.ContentType || 'application/octet-stream').trim(),
    fileSize: size
  };
}

async function createTeacherResourceDocs({
  teacherIds,
  title,
  day,
  batch = '',
  level = '',
  plan = '',
  resourceType = '',
  topic = '',
  description = '',
  files,
  uploadedBy
}) {
  await validateTeacherIds(teacherIds);
  const verifiedFiles = await Promise.all(files.map((f) => verifyUploadedTeacherResourceFile(f)));
  const primaryTeacherId = teacherIds[0];

  const docs = await Promise.all(
    verifiedFiles.map((f) =>
      TeacherResource.create({
        teacherId: primaryTeacherId,
        teacherIds,
        title: String(title).trim(),
        day: String(day).trim(),
        batch: String(batch || '').trim(),
        level: String(level || '').trim(),
        plan: String(plan || '').trim(),
        resourceType: String(resourceType || '').trim(),
        topic: String(topic || '').trim(),
        description: String(description || '').trim(),
        fileName: f.key,
        originalName: f.originalName,
        fileUrl: f.fileUrl,
        mimeType: f.mimeType,
        fileSize: f.fileSize,
        uploadedBy
      })
    )
  );

  return Promise.all(
    docs.map(async (doc) => {
      const o = doc.toObject();
      await resolveTeacherResourceUrls(o);
      return o;
    })
  );
}

router.post('/register-upload', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  const uploadedKeys = [];
  try {
    const {
      title,
      day,
      batch = '',
      level = '',
      plan = '',
      resourceType = '',
      topic = '',
      description = '',
      files = []
    } = req.body || {};
    const teacherIds = parseTeacherIdsFromBody(req.body);
    if (!title || !day || teacherIds.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one teacher, title and day are required' });
    }
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one file is required' });
    }
    if (files.length > MAX_FILES) {
      return res.status(400).json({ success: false, message: `Up to ${MAX_FILES} files are allowed per upload` });
    }
    if (!isExerciseR2Configured()) {
      return res.status(503).json({ success: false, message: 'R2 storage is not configured for teacher resource uploads' });
    }

    for (const f of files) {
      const key = String(f?.key || '').replace(/^\//, '').trim();
      if (key) uploadedKeys.push(key);
    }

    const out = await createTeacherResourceDocs({
      teacherIds,
      title,
      day,
      batch,
      level,
      plan,
      resourceType,
      topic,
      description,
      files,
      uploadedBy: req.user.id
    });

    res.status(201).json({ success: true, data: out });
  } catch (err) {
    if (uploadedKeys.length) {
      await Promise.allSettled(uploadedKeys.map((key) => deleteTeacherResourceStorage(key)));
    }
    console.error('teacherResources register-upload error:', err);
    res.status(err.status || 500).json({ success: false, message: err.message || 'Upload failed' });
  }
});

router.post(
  '/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  (req, res, next) => {
    uploadMultiple(req, res, (err) => {
      if (!err) return next();
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: err.message || 'Upload failed' });
    });
  },
  async (req, res) => {
    const uploadedKeys = [];
    try {
      const {
        title,
        day,
        batch = '',
        level = '',
        plan = '',
        resourceType = '',
        topic = '',
        description = ''
      } = req.body;
      const teacherIds = parseTeacherIdsFromBody(req.body);
      if (!title || !day || teacherIds.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one teacher, title and day are required' });
      }

      const files = req.files && req.files.length > 0 ? req.files : req.file ? [req.file] : [];
      if (files.length === 0) {
        return res.status(400).json({ success: false, message: 'At least one file is required' });
      }

      const teachers = await User.find({
        _id: { $in: teacherIds },
        role: { $in: ['TEACHER', 'TEACHER_ADMIN'] }
      })
        .select('_id')
        .lean();
      if (teachers.length !== teacherIds.length) {
        return res.status(400).json({ success: false, message: 'One or more teacher ids are invalid' });
      }

      for (const f of files) {
        if (f.key) uploadedKeys.push(f.key);
      }

      const out = await createTeacherResourceDocs({
        teacherIds,
        title,
        day,
        batch,
        level,
        plan,
        resourceType,
        topic,
        description,
        files: files.map((f) => ({
          key: f.key || f.filename,
          fileUrl: f.location || f.path,
          originalName: f.originalname,
          mimeType: f.mimetype,
          fileSize: f.size
        })),
        uploadedBy: req.user.id
      });

      res.status(201).json({ success: true, data: out });
    } catch (err) {
      if (uploadedKeys.length) {
        await Promise.allSettled(uploadedKeys.map((key) => deleteTeacherResourceStorage(key)));
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
    let scopedTeacherId = null;

    if (role === 'TEACHER') {
      const uid = req.user.id;
      query.$or = [{ teacherIds: uid }, { teacherId: uid }];
      scopedTeacherId = uid;
    } else if (req.query.teacherId) {
      const tid = String(req.query.teacherId).trim();
      query.$or = [{ teacherIds: tid }, { teacherId: tid }];
      scopedTeacherId = tid;
    }
    if (req.query.batch) query.batch = String(req.query.batch).trim();
    if (req.query.level) query.level = String(req.query.level).trim();
    if (req.query.plan) query.plan = String(req.query.plan).trim();

    const rows = await TeacherResource.find(query)
      .populate('teacherId', 'name email')
      .populate('teacherIds', 'name email')
      .populate('uploadedBy', 'name')
      .sort({ uploadedAt: -1 })
      .lean();

    await Promise.all(rows.map((row) => resolveTeacherResourceUrls(row)));

    // Build dropdown options from both uploaded resource metadata and teacher's class/student metadata.
    // This ensures filters are populated even when older resources were uploaded without batch/level/plan.
    const resourceScopeQuery = { ...query };
    delete resourceScopeQuery.batch;
    delete resourceScopeQuery.level;
    delete resourceScopeQuery.plan;

    const [resourceBatches, resourceLevels, resourcePlans] = await Promise.all([
      TeacherResource.distinct('batch', { ...resourceScopeQuery, batch: { $exists: true, $nin: [null, ''] } }),
      TeacherResource.distinct('level', { ...resourceScopeQuery, level: { $exists: true, $nin: [null, ''] } }),
      TeacherResource.distinct('plan', { ...resourceScopeQuery, plan: { $exists: true, $nin: [null, ''] } })
    ]);

    let studentBatches = [];
    let studentLevels = [];
    let studentPlans = [];
    if (scopedTeacherId) {
      const students = await User.find({
        role: 'STUDENT',
        assignedTeacher: scopedTeacherId
      })
        .select('batch level subscription')
        .lean();
      studentBatches = students.map((s) => s.batch);
      studentLevels = students.map((s) => s.level);
      studentPlans = students.map((s) => s.subscription);
    }

    res.json({
      success: true,
      data: rows,
      filters: {
        batches: toSortedUniqueStringList([...resourceBatches, ...studentBatches]),
        levels: toSortedUniqueStringList([...resourceLevels, ...studentLevels]),
        plans: toSortedUniqueStringList([...resourcePlans, ...studentPlans])
      }
    });
  } catch (err) {
    console.error('teacherResources list error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch resources', error: err.message });
  }
});

router.get('/:id/preview', verifyMediaToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const row = await TeacherResource.findById(req.params.id).lean();
    if (!row) return res.status(404).json({ success: false, message: 'Resource not found' });

    if (req.user?.role === 'TEACHER' && !resourceVisibleToUser(row, req.user.id)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const key = (row.fileName || '').replace(/^\//, '').trim();
    if (!key) {
      return res.status(400).json({ success: false, message: 'Invalid storage object' });
    }

    const fileName = String(row.originalName || 'preview').replace(/["\r\n]/g, '_');
    const originalName = String(row.originalName || '').toLowerCase();
    const forceHtml = originalName.endsWith('.html') || originalName.endsWith('.htm');
    const contentType = forceHtml
      ? 'text/html; charset=utf-8'
      : (row.mimeType || 'application/octet-stream');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-popups");
    res.setHeader('Cache-Control', 'private, max-age=300');

    if (isR2TeacherResource(row)) {
      const r2Key = extractMediaKeyFromUrl(row.fileUrl) || key;
      const buffer = await getExerciseMediaBuffer(r2Key);
      return res.send(buffer);
    }

    if (!process.env.S3_BUCKET) {
      return res.status(400).json({ success: false, message: 'Invalid storage object' });
    }

    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key
    });
    const out = await s3Client.send(command);

    if (!out.Body) {
      return res.status(500).json({ success: false, message: 'Preview stream is empty' });
    }
    out.Body.pipe(res);
  } catch (err) {
    console.error('teacherResources preview error:', err);
    res.status(500).json({ success: false, message: 'Failed to preview resource', error: err.message });
  }
});

router.patch(
  '/:id',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  async (req, res, next) => {
    if (req.is('application/json') && req.body?.uploadedFile?.key) {
      let uploadedKey = null;
      try {
        const row = await TeacherResource.findById(req.params.id);
        if (!row) return res.status(404).json({ success: false, message: 'Resource not found' });

        const has = (k) => Object.prototype.hasOwnProperty.call(req.body || {}, k);

        if (has('teacherIds') || has('teacherId')) {
          const nextIds = has('teacherIds')
            ? parseTeacherIdsFromBody(req.body)
            : [String(req.body.teacherId || '').trim()].filter(Boolean);
          if (nextIds.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one teacher is required' });
          }
          await validateTeacherIds(nextIds);
          row.teacherIds = nextIds;
          row.teacherId = nextIds[0];
        }

        if (has('title')) {
          const title = String(req.body.title || '').trim();
          if (!title) return res.status(400).json({ success: false, message: 'title cannot be empty' });
          row.title = title;
        }
        if (has('day')) {
          const day = String(req.body.day || '').trim();
          if (!day) return res.status(400).json({ success: false, message: 'day cannot be empty' });
          row.day = day;
        }
        if (has('batch')) row.batch = String(req.body.batch || '').trim();
        if (has('level')) row.level = String(req.body.level || '').trim();
        if (has('plan')) row.plan = String(req.body.plan || '').trim();
        if (has('resourceType')) row.resourceType = String(req.body.resourceType || '').trim();
        if (has('topic')) row.topic = String(req.body.topic || '').trim();
        if (has('description')) row.description = String(req.body.description || '').trim();

        const previousFileName = row.fileName;
        const verified = await verifyUploadedTeacherResourceFile(req.body.uploadedFile);
        uploadedKey = verified.key;
        row.fileName = verified.key;
        row.originalName = verified.originalName;
        row.fileUrl = verified.fileUrl;
        row.mimeType = verified.mimeType;
        row.fileSize = verified.fileSize;

        await row.save();

        if (previousFileName && previousFileName !== row.fileName) {
          await deleteTeacherResourceStorage(previousFileName);
        }

        const out = row.toObject();
        await resolveTeacherResourceUrls(out);
        return res.json({ success: true, data: out });
      } catch (err) {
        if (uploadedKey) {
          await deleteTeacherResourceStorage(uploadedKey);
        }
        console.error('teacherResources update (presigned) error:', err);
        return res.status(err.status || 500).json({ success: false, message: err.message || 'Update failed' });
      }
    }
    next();
  },
  (req, res, next) => {
    uploadSingle(req, res, (err) => {
      if (!err) return next();
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: err.message || 'Update failed' });
    });
  },
  async (req, res) => {
    let uploadedKey = null;
    try {
      const row = await TeacherResource.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Resource not found' });

      const has = (k) => Object.prototype.hasOwnProperty.call(req.body || {}, k);

      if (has('teacherIds') || has('teacherId')) {
        const nextIds = has('teacherIds') ? parseTeacherIdsFromBody(req.body) : [String(req.body.teacherId || '').trim()].filter(Boolean);
        if (nextIds.length === 0) return res.status(400).json({ success: false, message: 'At least one teacher is required' });
        const teachers = await User.find({
          _id: { $in: nextIds },
          role: { $in: ['TEACHER', 'TEACHER_ADMIN'] }
        })
          .select('_id')
          .lean();
        if (teachers.length !== nextIds.length) {
          return res.status(400).json({ success: false, message: 'One or more teacher ids are invalid' });
        }
        row.teacherIds = nextIds;
        row.teacherId = nextIds[0];
      }

      if (has('title')) {
        const title = String(req.body.title || '').trim();
        if (!title) return res.status(400).json({ success: false, message: 'title cannot be empty' });
        row.title = title;
      }
      if (has('day')) {
        const day = String(req.body.day || '').trim();
        if (!day) return res.status(400).json({ success: false, message: 'day cannot be empty' });
        row.day = day;
      }
      if (has('batch')) row.batch = String(req.body.batch || '').trim();
      if (has('level')) row.level = String(req.body.level || '').trim();
      if (has('plan')) row.plan = String(req.body.plan || '').trim();
      if (has('resourceType')) row.resourceType = String(req.body.resourceType || '').trim();
      if (has('topic')) row.topic = String(req.body.topic || '').trim();
      if (has('description')) row.description = String(req.body.description || '').trim();

      const previousFileName = row.fileName;
      if (req.file) {
        uploadedKey = req.file.key || null;
        row.fileName = req.file.key || req.file.filename;
        row.originalName = req.file.originalname;
        row.fileUrl = req.file.location || req.file.path;
        row.mimeType = req.file.mimetype;
        row.fileSize = req.file.size;
      }

      await row.save();

      if (req.file && previousFileName && previousFileName !== row.fileName) {
        await deleteTeacherResourceStorage(previousFileName);
      }

      const out = row.toObject();
      await resolveTeacherResourceUrls(out);
      res.json({ success: true, data: out });
    } catch (err) {
      if (uploadedKey) {
        await deleteTeacherResourceStorage(uploadedKey);
      }
      console.error('teacherResources update error:', err);
      res.status(500).json({ success: false, message: 'Update failed', error: err.message });
    }
  }
);

router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const row = await TeacherResource.findById(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: 'Resource not found' });

    if (row.fileName) {
      await deleteTeacherResourceStorage(row.fileName);
    }

    await TeacherResource.findByIdAndDelete(row._id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('teacherResources delete error:', err);
    res.status(500).json({ success: false, message: 'Delete failed', error: err.message });
  }
});

module.exports = router;
