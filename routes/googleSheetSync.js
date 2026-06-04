const express = require('express');
const router = express.Router();
const multer = require('multer');
const { verifyToken, checkRole } = require('../middleware/auth');
const {
  syncAllStudents,
  syncSingleStudent,
  getSyncStatus,
  verifySheetConnection,
  getActivity,
  clearActivityLog,
} = require('../services/googleSheetSyncService');
const { runOcrForStudent, runOcrForAllStudents, runOcrForSelectedStudents, processSingleDocument } = require('../services/ocrService');
const StudentExtractedData = require('../models/StudentExtractedData');
const User = require('../models/User');

const testUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.get('/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const status = await getSyncStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Confirm API can reach the spreadsheet and log title vs GOOGLE_SPREADSHEET_TITLE_EXPECTED */
router.get('/activity', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  res.json(getActivity(since));
});

router.post('/activity/clear', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  clearActivityLog();
  res.json({ ok: true });
});

router.get('/verify', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const info = await verifySheetConnection();
    res.json({ ok: true, ...info });
  } catch (err) {
    console.error('[GoogleSheetSync] verify failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/sync', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const result = await syncAllStudents();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync/:studentId', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const result = await syncSingleStudent(req.params.studentId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ocr/test', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), testUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const doc = {
      mimeType: req.file.mimetype,
      documentType: req.body.documentType || '',
      fileName: req.file.originalname,
    };

    const { result } = await processSingleDocument(doc, { buffer: req.file.buffer, dryRun: true });

    res.json({
      text: result?.rawText || '',
      parsed: result?.structured || {},
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ocr/all', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const results = await runOcrForAllStudents();
    const summary = {
      total: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      errors: results.filter(r => r.status === 'error').length,
      details: results,
    };
    res.json(summary);
  } catch (err) {
    if (err.message.includes('already in progress')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/ocr/selected', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { studentIds } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'studentIds must be a non-empty array' });
    }
    const results = await runOcrForSelectedStudents(studentIds);
    const summary = {
      total: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      errors: results.filter(r => r.status === 'error').length,
      details: results,
    };
    res.json(summary);
  } catch (err) {
    if (err.message.includes('already in progress')) {
      return res.status(409).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/students/search', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    if (!q) return res.json({ data: [] });
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const students = await User.find({
      role: 'STUDENT',
      $or: [{ name: rx }, { regNo: rx }, { email: rx }],
      isTestAccount: { $ne: true },
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

router.post('/ocr/:studentId', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const result = await runOcrForStudent(req.params.studentId);
    res.json({
      studentId: result.studentId,
      regNo: result.regNo,
      ocrStatus: result.ocrStatus,
      documentsUsed: result.documentsUsed?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/extractions', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    let filter = {};
    if (search) {
      const users = await User.find({
        role: 'STUDENT',
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { regNo: { $regex: search, $options: 'i' } },
        ],
      }).select('_id').lean();
      filter.studentId = { $in: users.map(u => u._id) };
    }

    const [data, total] = await Promise.all([
      StudentExtractedData.find(filter)
        .populate('studentId', 'name email regNo')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      StudentExtractedData.countDocuments(filter),
    ]);

    res.json({ data, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
