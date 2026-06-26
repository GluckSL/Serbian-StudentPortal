const express = require('express');
const router = express.Router();
const multer = require('multer');
const { verifyToken, checkRole } = require('../middleware/auth');
const {
  extractAndWriteSelectedStudents,
  verifySheetConnection,
  getActivity,
  clearActivityLog,
} = require('../services/googleSheetSyncService');
const { extractDocument } = require('../services/ocrService');
const { extractAllFieldsFromImage } = require('../services/visionOcrService');
const User = require('../models/User');
const StudentDocument = require('../models/StudentDocument');

const testUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/verify', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const info = await verifySheetConnection();
    res.json({ ok: true, ...info });
  } catch (err) {
    console.error('[GoogleSheetSync] verify failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/activity', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  res.json(getActivity(since));
});

router.post('/activity/clear', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  clearActivityLog();
  res.json({ ok: true });
});

router.post('/ocr/test', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), testUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const mimeType = req.file.mimetype;

    await extractAllFieldsFromImage(req.file.buffer, mimeType);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/students/search', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    if (!q) return res.json({ data: [] });
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const students = await User.find({
      role: 'STUDENT',
      $or: [{ name: rx }, { regNo: rx }, { email: rx }],
    })
      .select('name regNo email')
      .sort({ regNo: 1 })
      .limit(limit)
      .lean();
    res.json({ data: students });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/students', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100);
    const q = (req.query.q || '').trim();
    const batch = (req.query.batch || '').trim();
    const level = (req.query.level || '').trim();

    const filter = { role: 'STUDENT', isTestAccount: { $ne: true } };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { regNo: rx }, { email: rx }];
    }
    if (batch) filter.batch = batch;
    if (level) filter.level = level;

    const [data, total] = await Promise.all([
      User.find(filter)
        .select('name regNo email batch level')
        .sort({ regNo: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    const studentIds = data.map(s => s._id);
    const docCounts = await StudentDocument.aggregate([
      { $match: { studentId: { $in: studentIds }, isCurrent: true } },
      { $group: { _id: '$studentId', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    for (const dc of docCounts) {
      countMap[dc._id.toString()] = dc.count;
    }
    for (const s of data) {
      s.documentCount = countMap[s._id.toString()] || 0;
    }

    res.json({ data, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/students/filter-options', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const [batches, levels] = await Promise.all([
      User.distinct('batch', { role: 'STUDENT', isTestAccount: { $ne: true }, batch: { $ne: '', $exists: true } }),
      User.distinct('level', { role: 'STUDENT', isTestAccount: { $ne: true }, level: { $ne: '', $exists: true } }),
    ]);
    res.json({ batches: batches.sort(), levels: levels.sort() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/extract-and-sync', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'studentIds must be a non-empty array' });
    }
    const result = await extractAndWriteSelectedStudents(studentIds);
    res.json(result);
  } catch (err) {
    if (err.message.includes('already running')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
