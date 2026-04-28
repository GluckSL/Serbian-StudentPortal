// routes/batchJourney.js
// Journey management: per-batch config + student day control

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const BatchConfig = require('../models/BatchConfig');
const LearningModule = require('../models/LearningModule');
const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const ClassRecording = require('../models/ClassRecording');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const StudentProgress = require('../models/StudentProgress');
const {
  computeJourneyDayCompletion,
  meetsStrictThreshold
} = require('../services/journeyDayCompletion.service');
const { verifyToken, checkRole } = require('../middleware/auth');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');
const { EXCLUDE_TEST, EXCLUDE_TEST_LOOKUP } = require('../utils/analyticsFilters');

// ─── helpers ────────────────────────────────────────────────────────────────

function clampDay(d, max = 200) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > max) return max;
  return n;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Batches a TEACHER/TEACHER_ADMIN may view: assignedBatches + batches of students assigned to them */
async function buildTeacherAllowedBatchSet(teacherId) {
  const teacher = await User.findById(teacherId).select('assignedBatches role').lean();
  if (!teacher || (teacher.role !== 'TEACHER' && teacher.role !== 'TEACHER_ADMIN')) return null;
  const set = new Set();
  for (const b of teacher.assignedBatches || []) {
    const n = String(b || '').trim();
    if (n) set.add(n);
  }
  const fromStudents = await User.distinct('batch', {
    role: 'STUDENT',
    assignedTeacher: teacherId,
    batch: { $nin: [null, ''] }
  });
  for (const b of fromStudents) {
    const n = String(b || '').trim();
    if (n) set.add(n);
  }
  return set;
}

function normBatchKey(name) {
  return String(name || '').trim().toLowerCase();
}

function teacherAllowedForBatch(allowedSet, batchName) {
  if (!allowedSet || allowedSet.size === 0) return false;
  const target = normBatchKey(batchName);
  for (const a of allowedSet) {
    if (normBatchKey(a) === target) return true;
  }
  return false;
}

async function teacherCanAccessBatch(req, batchName) {
  if (req.user.role !== 'TEACHER' && req.user.role !== 'TEACHER_ADMIN') return true;
  const set = await buildTeacherAllowedBatchSet(req.user.id);
  return teacherAllowedForBatch(set, batchName);
}

async function teacherCanAccessStudent(req, studentId) {
  if (req.user.role !== 'TEACHER' && req.user.role !== 'TEACHER_ADMIN') return true;
  const st = await User.findOne({ _id: studentId, role: 'STUDENT' }).select('batch assignedTeacher').lean();
  if (!st) return false;
  if (String(st.assignedTeacher || '') === String(req.user.id)) return true;
  const set = await buildTeacherAllowedBatchSet(req.user.id);
  return teacherAllowedForBatch(set, st.batch);
}

/** Upsert a BatchConfig row and return it */
async function getOrCreateConfig(batchName) {
  const bn = String(batchName || '').trim();
  if (!bn) return null;
  // Match case-insensitively so admins can't create duplicates like "Batch 1" vs "batch 1".
  let cfg = await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(bn)}$`, 'i') });
  if (!cfg) {
    cfg = await BatchConfig.create({ batchName: bn });
  }
  return cfg;
}

/**
 * Compute the "live" batch day.
 * If batchStartDate is set: day = daysElapsed + 1 (capped to journeyLength).
 * Otherwise fall back to the stored batchCurrentDay.
 */
function computeBatchDay(cfg) {
  if (!cfg.batchStartDate) return cfg.batchCurrentDay;
  const msPerDay = 86_400_000;
  const now = new Date();
  // Compare at UTC midnight so timezone drift doesn't add/subtract a day
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const sd = new Date(cfg.batchStartDate);
  const startUTC = Date.UTC(sd.getFullYear(), sd.getMonth(), sd.getDate());
  const elapsed = Math.floor((todayUTC - startUTC) / msPerDay);
  return Math.min(cfg.journeyLength, Math.max(1, elapsed + 1));
}

async function checkDayCompletion(studentId, batchNameOrNames, day) {
  return computeJourneyDayCompletion(studentId, batchNameOrNames, day);
}

// ─── GET /api/batch-journey ─────────────────────────────────────────────────
// List every distinct batch from the User collection + joined BatchConfig data
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    // Batches can exist either because students are assigned to them (User.batch),
    // or because an admin created a BatchConfig before any students exist.
    const studentBatchNames = await User.distinct('batch', { role: 'STUDENT', batch: { $ne: null, $ne: '' } });
    const configBatchNames = await BatchConfig.distinct('batchName', { batchName: { $ne: null, $ne: '' } });

    let allBatchNames = Array.from(new Set([...(studentBatchNames || []), ...(configBatchNames || [])]));

    if (req.user.role === 'TEACHER' || req.user.role === 'TEACHER_ADMIN') {
      const allowed = await buildTeacherAllowedBatchSet(req.user.id);
      if (!allowed || allowed.size === 0) {
        allBatchNames = [];
      } else {
        allBatchNames = allBatchNames.filter((name) => teacherAllowedForBatch(allowed, name));
      }
    }

    const counts = await User.aggregate([
      { $match: { role: 'STUDENT', batch: { $in: allBatchNames }, ...EXCLUDE_TEST } },
      { $group: { _id: '$batch', count: { $sum: 1 } } }
    ]);
    const countMap = {};
    counts.forEach(c => { countMap[c._id] = c.count; });

    // Most common assigned teacher per batch (from students' assignedTeacher)
    const teacherByBatch = {};
    if (studentBatchNames.length) {
      const teacherAgg = await User.aggregate([
        { $match: { role: 'STUDENT', batch: { $in: studentBatchNames }, assignedTeacher: { $ne: null } } },
        { $group: { _id: { batch: '$batch', tid: '$assignedTeacher' }, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $group: { _id: '$_id.batch', teacherId: { $first: '$_id.tid' } } }
      ]);
      const teacherIds = [...new Set(teacherAgg.map(r => r.teacherId).filter(Boolean))];
      const teacherDocs = teacherIds.length
        ? await User.find({ _id: { $in: teacherIds } }).select('name').lean()
        : [];
      const nameById = {};
      teacherDocs.forEach(t => {
        nameById[String(t._id)] = (t.name && String(t.name).trim()) || '';
      });
      teacherAgg.forEach(row => {
        const nm = nameById[String(row.teacherId)];
        teacherByBatch[row._id] = { teacherId: row.teacherId, teacherName: nm || null };
      });
    }

    const configs = await BatchConfig.find({ batchName: { $in: allBatchNames } }).lean();
    const configMap = {};
    configs.forEach(c => { configMap[c.batchName] = c; });

    function cfgForName(name) {
      let cfg = configMap[name];
      if (cfg) return cfg;
      const target = normBatchKey(name);
      for (const c of configs) {
        if (normBatchKey(c.batchName) === target) return c;
      }
      return null;
    }

    const allRows = allBatchNames.map(name => {
      const cfg = cfgForName(name) || {
        batchName: name,
        journeyLength: 200,
        batchCurrentDay: 1,
        notes: '',
        batchType: 'new',
        batchStartDate: null,
        strictJourneyRule: false,
        strictJourneyThresholdPercent: 100,
        journeyActive: false
      };
      const activeBatchDay = computeBatchDay(cfg);
      return {
        batchName: name,
        journeyLength: cfg.journeyLength,
        batchCurrentDay: activeBatchDay,
        batchStartDate: cfg.batchStartDate || null,
        autoDay: !!cfg.batchStartDate,
        notes: cfg.notes || '',
        batchType: String(cfg.batchType || 'new').toLowerCase() === 'old' ? 'old' : 'new',
        strictJourneyRule: !!cfg.strictJourneyRule,
        strictJourneyThresholdPercent:
          cfg.strictJourneyThresholdPercent != null ? cfg.strictJourneyThresholdPercent : 100,
        journeyActive: !!(cfg && cfg.journeyActive),
        studentCount: countMap[name] || 0,
        teacherId: teacherByBatch[name]?.teacherId ?? null,
        teacherName: teacherByBatch[name]?.teacherName ?? null
      };
    });

    const batches = allRows.filter((b) => b.journeyActive).sort((a, b) => a.batchName.localeCompare(b.batchName));
    const upcomingBatches = allRows.filter((b) => !b.journeyActive).sort((a, b) => a.batchName.localeCompare(b.batchName));
    res.json({ batches, upcomingBatches });
  } catch (err) {
    console.error('batch-journey GET /', err);
    res.status(500).json({ message: 'Failed to load batches', error: err.message });
  }
});

// ─── GET /api/batch-journey/active-platinum-students ─────────────────────────
// All students in batches that have journeyActive (Platinum journey list).
router.get('/active-platinum-students', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    let activeConfigs = await BatchConfig.find({ journeyActive: true }).select('batchName').lean();
    let batchNames = activeConfigs.map((c) => String(c.batchName || '').trim()).filter(Boolean);

    if (req.user.role === 'TEACHER' || req.user.role === 'TEACHER_ADMIN') {
      const allowed = await buildTeacherAllowedBatchSet(req.user.id);
      if (!allowed || allowed.size === 0) {
        return res.json({ students: [] });
      }
      batchNames = batchNames.filter((name) => teacherAllowedForBatch(allowed, name));
    }

    if (!batchNames.length) {
      return res.json({ students: [] });
    }

    const batchOr = batchNames.map((n) => ({
      batch: new RegExp(`^${escapeRegExp(n)}$`, 'i')
    }));

    const students = await User.find({
      role: 'STUDENT',
      $or: batchOr,
      ...EXCLUDE_TEST
    })
      .select('name regNo email level studentStatus currentCourseDay batch enrollmentDate')
      .sort({ batch: 1, name: 1 })
      .lean();

    res.json({
      students: students.map((s) => ({
        _id: s._id,
        name: s.name,
        regNo: s.regNo,
        email: s.email,
        level: s.level,
        studentStatus: s.studentStatus,
        currentCourseDay: s.currentCourseDay || 1,
        batch: s.batch,
        enrollmentDate: s.enrollmentDate || null
      }))
    });
  } catch (err) {
    console.error('batch-journey GET /active-platinum-students', err);
    res.status(500).json({ message: 'Failed to load students', error: err.message });
  }
});

// ─── POST /api/batch-journey/:batchName/journey-activate ────────────────────
// Add batch to the active journey list (shows on Journey Management home).
router.post(
  '/:batchName/journey-activate',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const raw = String(req.params.batchName || '').trim();
      if (!raw) return res.status(400).json({ message: 'batchName is required' });
      if (!(await teacherCanAccessBatch(req, raw))) {
        return res.status(403).json({ message: 'You do not have access to this batch.' });
      }
      let cfg = await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(raw)}$`, 'i') });
      if (!cfg) {
        cfg = await BatchConfig.create({ batchName: raw, journeyActive: true });
      } else {
        cfg.journeyActive = true;
        await cfg.save();
      }
      res.json({
        message: `Journey started for "${cfg.batchName}".`,
        batchName: cfg.batchName,
        journeyActive: true
      });
    } catch (err) {
      console.error('batch-journey POST /:batch/journey-activate', err);
      res.status(500).json({ message: 'Failed to start journey', error: err.message });
    }
  }
);

// ─── POST /api/batch-journey/:batchName/journey-deactivate ─────────────────
// Remove batch from active journey list (batch remains in the system).
router.post(
  '/:batchName/journey-deactivate',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const raw = String(req.params.batchName || '').trim();
      if (!raw) return res.status(400).json({ message: 'batchName is required' });
      if (!(await teacherCanAccessBatch(req, raw))) {
        return res.status(403).json({ message: 'You do not have access to this batch.' });
      }
      const cfg = await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(raw)}$`, 'i') });
      if (!cfg) {
        return res.status(404).json({ message: 'No batch config found. Create the batch first or start journey once.' });
      }
      cfg.journeyActive = false;
      await cfg.save();
      res.json({
        message: `"${cfg.batchName}" removed from active journeys.`,
        batchName: cfg.batchName,
        journeyActive: false
      });
    } catch (err) {
      console.error('batch-journey POST /:batch/journey-deactivate', err);
      res.status(500).json({ message: 'Failed to remove from active journeys', error: err.message });
    }
  }
);

// ─── GET /api/batch-journey/:batchName/students ─────────────────────────────
router.get('/:batchName/students', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { batchName } = req.params;
    if (!(await teacherCanAccessBatch(req, batchName))) {
      return res.status(403).json({ message: 'You do not have access to this batch.' });
    }
    const students = await User.find({ role: 'STUDENT', batch: batchName })
      .select('name regNo email level studentStatus currentCourseDay enrollmentDate createdAt isTestAccount')
      .sort({ name: 1 })
      .lean();

    // most common assigned teacher for this batch
    const teacherAgg = await User.aggregate([
      { $match: { role: 'STUDENT', batch: batchName, assignedTeacher: { $ne: null } } },
      { $group: { _id: '$assignedTeacher', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]);
    let teacherId = teacherAgg?.[0]?._id || null;
    let teacherName = null;
    if (teacherId) {
      const t = await User.findById(teacherId).select('name').lean();
      teacherName = t?.name || null;
    }

    const cfg = await getOrCreateConfig(batchName);
    const activeBatchDay = computeBatchDay(cfg);

    res.json({
      batchName,
      config: {
        journeyLength: cfg.journeyLength,
        batchCurrentDay: activeBatchDay,
        batchStartDate: cfg.batchStartDate || null,
        autoDay: !!cfg.batchStartDate,
        notes: cfg.notes,
        batchType: String(cfg.batchType || 'new').toLowerCase() === 'old' ? 'old' : 'new',
        strictJourneyRule: !!cfg.strictJourneyRule,
        strictJourneyThresholdPercent:
          cfg.strictJourneyThresholdPercent != null ? cfg.strictJourneyThresholdPercent : 100
      },
      teacher: { teacherId, teacherName },
      students: students.map(s => ({
        _id: s._id,
        name: s.name,
        regNo: s.regNo,
        email: s.email,
        level: s.level,
        studentStatus: s.studentStatus,
        currentCourseDay: s.currentCourseDay || 1,
        enrollmentDate: s.enrollmentDate || null,
        accountCreatedAt: s.createdAt || null
      }))
    });
  } catch (err) {
    console.error('batch-journey GET /:batch/students', err);
    res.status(500).json({ message: 'Failed to load students', error: err.message });
  }
});

// ─── GET /api/batch-journey/:batchName/timeline ──────────────────────────────
router.get('/:batchName/timeline', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { batchName } = req.params;
    if (!(await teacherCanAccessBatch(req, batchName))) {
      return res.status(403).json({ message: 'You do not have access to this batch.' });
    }
    const cfg = await getOrCreateConfig(batchName);
    const length = cfg.journeyLength;
    const activeBatchDay = computeBatchDay(cfg);

    // IMPORTANT: classes must be filtered by the requested batch, otherwise teachers can see other batches.
    const batchRegex = new RegExp(`^${escapeRegExp(batchName)}$`, 'i');
    const [modules, exercises, classes, recordings] = await Promise.all([
      LearningModule.find({ isDeleted: { $ne: true }, courseDay: { $gte: 1, $lte: length } })
        .select('title category level courseDay').sort({ courseDay: 1 }).lean(),
      DigitalExercise.find({ isDeleted: { $ne: true }, courseDay: { $gte: 1, $lte: length } })
        .select('title category level courseDay').sort({ courseDay: 1 }).lean(),
      MeetingLink.find({ batch: batchRegex, courseDay: { $gte: 1, $lte: length }, status: { $ne: 'cancelled' } })
        .select('topic batch courseDay startTime duration').sort({ courseDay: 1 }).lean(),
      // Include unpublished recordings: admins schedule content before publishing to students.
      ClassRecording.find({
        active: true,
        courseDay: { $gte: 1, $lte: length },
        batches: batchRegex
      })
        .select('title level plan courseDay batches isPublished').sort({ courseDay: 1 }).lean()
    ]);

    const timeline = {};
    for (let d = 1; d <= length; d++) {
      timeline[d] = { day: d, modules: [], exercises: [], classes: [], recordings: [] };
    }
    modules.forEach(m => {
      if (timeline[m.courseDay]) timeline[m.courseDay].modules.push({ _id: m._id, title: m.title, category: m.category, level: m.level });
    });
    exercises.forEach(e => {
      if (timeline[e.courseDay]) timeline[e.courseDay].exercises.push({ _id: e._id, title: e.title, category: e.category, level: e.level });
    });
    classes.forEach(c => {
      if (timeline[c.courseDay]) timeline[c.courseDay].classes.push({ _id: c._id, topic: c.topic, batch: c.batch, startTime: c.startTime, duration: c.duration });
    });
    recordings.forEach(rec => {
      if (timeline[rec.courseDay]) {
        timeline[rec.courseDay].recordings.push({
          _id: rec._id,
          title: rec.title,
          level: rec.level,
          plan: rec.plan || 'ALL',
          courseDay: rec.courseDay,
          isPublished: rec.isPublished !== false
        });
      }
    });

    const days = Object.values(timeline).filter(
      d => d.day <= length && (d.modules.length || d.exercises.length || d.classes.length || d.recordings.length || d.day === activeBatchDay)
    );

    res.json({
      batchName,
      journeyLength: length,
      batchCurrentDay: activeBatchDay,
      batchStartDate: cfg.batchStartDate || null,
      autoDay: !!cfg.batchStartDate,
      days
    });
  } catch (err) {
    console.error('batch-journey GET /:batch/timeline', err);
    res.status(500).json({ message: 'Failed to load timeline', error: err.message });
  }
});

// ─── PUT /api/batch-journey/:batchName ──────────────────────────────────────
// Update batch config (journeyLength, batchCurrentDay, batchStartDate, notes)
router.put('/:batchName', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const {
      journeyLength,
      batchCurrentDay,
      batchStartDate,
      notes,
      batchType,
      createOnly,
      strictJourneyRule,
      strictJourneyThresholdPercent
    } = req.body || {};

    const bn = String(batchName || '').trim();
    if (!bn) return res.status(400).json({ message: 'batchName is required' });

    if (createOnly) {
      const rx = new RegExp(`^${escapeRegExp(bn)}$`, 'i');
      const existsCfg = await BatchConfig.findOne({ batchName: rx }).select('_id batchName').lean();
      const existsStudents = await User.exists({ role: 'STUDENT', batch: rx });
      if (existsCfg || existsStudents) {
        return res.status(409).json({ message: `Batch "${bn}" already exists` });
      }
    }

    let cfg = await getOrCreateConfig(bn);
    if (!cfg) return res.status(500).json({ message: 'Failed to create batch config' });

    if (journeyLength !== undefined) {
      cfg.journeyLength = Math.min(200, Math.max(1, clampDay(journeyLength)));
    }
    if (batchStartDate !== undefined) {
      // Allow null/empty to clear the start date
      if (!batchStartDate || batchStartDate === '') {
        cfg.batchStartDate = null;
      } else {
        const parsed = new Date(batchStartDate);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ message: 'Invalid batchStartDate' });
        }
        cfg.batchStartDate = parsed;
        // Auto-sync stored batchCurrentDay to the computed value so it stays consistent
        cfg.batchCurrentDay = computeBatchDay(cfg);
      }
    }
    // Manual override only accepted when no start date is set
    if (batchCurrentDay !== undefined && !cfg.batchStartDate) {
      cfg.batchCurrentDay = Math.min(cfg.journeyLength, Math.max(1, clampDay(batchCurrentDay)));
    }
    if (notes !== undefined) {
      cfg.notes = String(notes).substring(0, 500);
    }
    if (batchType !== undefined) {
      const normalizedType = String(batchType || '').trim().toLowerCase();
      if (normalizedType !== 'new' && normalizedType !== 'old') {
        return res.status(400).json({ message: 'batchType must be "new" or "old"' });
      }
      cfg.batchType = normalizedType;
    }
    if (strictJourneyRule !== undefined) {
      cfg.strictJourneyRule = !!strictJourneyRule;
    }
    if (strictJourneyThresholdPercent !== undefined) {
      const p = parseInt(String(strictJourneyThresholdPercent), 10);
      if (!Number.isFinite(p) || p < 1 || p > 100) {
        return res.status(400).json({ message: 'strictJourneyThresholdPercent must be between 1 and 100' });
      }
      cfg.strictJourneyThresholdPercent = p;
    }
    if (cfg.strictJourneyRule && (cfg.strictJourneyThresholdPercent == null || cfg.strictJourneyThresholdPercent < 1)) {
      cfg.strictJourneyThresholdPercent = 100;
    }
    await cfg.save();

    const activeBatchDay = computeBatchDay(cfg);
    res.json({
      message: createOnly ? 'Batch created' : 'Batch config updated',
      config: {
        ...cfg.toObject(),
        batchType: String(cfg.batchType || 'new').toLowerCase() === 'old' ? 'old' : 'new',
        batchCurrentDay: activeBatchDay,
        autoDay: !!cfg.batchStartDate
      }
    });
  } catch (err) {
    console.error('batch-journey PUT /:batch', err);
    res.status(500).json({ message: 'Failed to update config', error: err.message });
  }
});

// ─── POST /api/batch-journey/:batchName/set-day ──────────────────────────────
// Manually force batchCurrentDay (only when no startDate) + push to all students
router.post('/:batchName/set-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const { day } = req.body;
    if (day === undefined || day === null) return res.status(400).json({ message: 'day is required' });

    const targetDay = clampDay(day);
    const cfg = await getOrCreateConfig(batchName);
    if (targetDay > cfg.journeyLength) {
      return res.status(400).json({ message: `day (${targetDay}) exceeds journeyLength (${cfg.journeyLength})` });
    }

    if (!cfg.batchStartDate) {
      cfg.batchCurrentDay = targetDay;
      await cfg.save();
    }

    const result = await User.updateMany(
      { role: 'STUDENT', batch: batchName },
      {
        $set: {
          currentCourseDay: targetDay,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        }
      }
    );

    res.json({
      message: `Batch "${batchName}" advanced to day ${targetDay}`,
      batchCurrentDay: targetDay,
      studentsUpdated: result.modifiedCount
    });
  } catch (err) {
    console.error('batch-journey POST /:batch/set-day', err);
    res.status(500).json({ message: 'Failed to set batch day', error: err.message });
  }
});

// ─── POST /api/batch-journey/:batchName/assign-teacher ───────────────────────
// Assign a teacher to ALL students in a batch (sets User.assignedTeacher)
router.post('/:batchName/assign-teacher', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const { teacherId } = req.body || {};

    const bn = String(batchName || '').trim();
    if (!bn) return res.status(400).json({ message: 'batchName is required' });
    if (!teacherId) return res.status(400).json({ message: 'teacherId is required' });

    const teacher = await User.findOne({ _id: teacherId, role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } })
      .select('name email')
      .lean();
    if (!teacher) return res.status(404).json({ message: 'Teacher not found' });

    const result = await User.updateMany(
      { role: 'STUDENT', batch: bn },
      { $set: { assignedTeacher: teacherId } }
    );

    res.json({
      message: `Assigned ${teacher.name} to batch "${bn}"`,
      batchName: bn,
      teacher: { _id: teacher._id, name: teacher.name, email: teacher.email },
      studentsUpdated: result.modifiedCount
    });
  } catch (err) {
    console.error('batch-journey POST /:batch/assign-teacher', err);
    res.status(500).json({ message: 'Failed to assign teacher', error: err.message });
  }
});

// ─── GET /api/batch-journey/student/:studentId/day-status ────────────────────
// Check if a student has completed all tasks for their current day
router.get('/student/:studentId/day-status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    if (!(await teacherCanAccessStudent(req, req.params.studentId))) {
      return res.status(403).json({ message: 'You do not have access to this student.' });
    }
    const student = await User.findOne({ _id: req.params.studentId, role: 'STUDENT' })
      .select('name regNo batch currentCourseDay goStatus subscription').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const day = student.currentCourseDay || 1;
    const batchKeys = allStudentBatchStringsForContent(student);
    const result = await checkDayCompletion(student._id, batchKeys, day);
    const cfgBatch = batchKeys.includes('GO-SILVER') ? 'GO-SILVER' : batchKeys[0];
    const batchCfg =
      cfgBatch
        ? await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(cfgBatch)}$`, 'i') }).lean()
        : null;
    const strictJourneyRule = !!(batchCfg && batchCfg.strictJourneyRule);
    const strictJourneyThresholdPercent =
      batchCfg && batchCfg.strictJourneyThresholdPercent != null
        ? batchCfg.strictJourneyThresholdPercent
        : 100;
    const thresholdMet = meetsStrictThreshold(result, batchCfg || { strictJourneyRule: false });

    res.json({
      studentId: student._id,
      name: student.name,
      currentDay: day,
      strictJourneyRule,
      strictJourneyThresholdPercent,
      thresholdMet,
      ...result
    });
  } catch (err) {
    console.error('batch-journey GET /student/:id/day-status', err);
    res.status(500).json({ message: 'Failed to check day status', error: err.message });
  }
});

// ─── POST /api/batch-journey/student/:studentId/advance-day ──────────────────
// Lenient batch: advance without checks. Strict batch: advance if day-task % ≥ threshold. Admin can force.
router.post('/student/:studentId/advance-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { force = false } = req.body || {};
    const student = await User.findOne({ _id: req.params.studentId, role: 'STUDENT' })
      .select('name regNo batch currentCourseDay goStatus subscription').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const batchKeys = allStudentBatchStringsForContent(student);
    if (!batchKeys.length) {
      return res.status(400).json({ message: 'Student has no batch assigned; cannot advance journey day.' });
    }
    const cfgBatch = batchKeys.includes('GO-SILVER') ? 'GO-SILVER' : batchKeys[0];
    const cfg = await getOrCreateConfig(cfgBatch);
    const currentDay = student.currentCourseDay || 1;

    if (currentDay >= cfg.journeyLength) {
      return res.json({ advanced: false, message: 'Student has already completed the journey.', currentDay });
    }

    const completion = await checkDayCompletion(student._id, batchKeys, currentDay);

    if (!force) {
      if (cfg.strictJourneyRule && !meetsStrictThreshold(completion, cfg)) {
        const thr =
          cfg.strictJourneyThresholdPercent != null ? cfg.strictJourneyThresholdPercent : 100;
        return res.json({
          advanced: false,
          message: `Strict rule: student has completed ${completion.completionPercent}% of Day ${currentDay} tasks (need ≥ ${thr}%).`,
          currentDay,
          complete: completion.complete,
          completionPercent: completion.completionPercent,
          totalTasks: completion.totalTasks,
          doneTasks: completion.doneTasks,
          incompleteTasks: completion.incompleteTasks,
          breakdown: completion.breakdown
        });
      }
    }

    const nextDay = currentDay + 1;
    await User.findByIdAndUpdate(student._id, {
      $set: {
        currentCourseDay: nextDay,
        pendingJourneyDayAdvance: false,
        pendingJourneyDayAdvanceForDay: null
      }
    });

    console.log(`✅ Student ${student.name} advanced from Day ${currentDay} → Day ${nextDay}${force ? ' (forced by admin)' : ''}`);
    res.json({
      advanced: true,
      message: `${student.name} advanced to Day ${nextDay}${force ? ' (admin override)' : ''}`,
      previousDay: currentDay,
      currentDay: nextDay,
      breakdown: completion.breakdown
    });
  } catch (err) {
    console.error('batch-journey POST /student/:id/advance-day', err);
    res.status(500).json({ message: 'Failed to advance student day', error: err.message });
  }
});

// ─── PATCH /api/batch-journey/student/:studentId/day ────────────────────────
// Manual override: set a single student's currentCourseDay directly
router.patch('/student/:studentId/day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { day } = req.body;
    if (day === undefined || day === null) return res.status(400).json({ message: 'day is required' });

    const targetDay = clampDay(day);
    const student = await User.findOneAndUpdate(
      { _id: studentId, role: 'STUDENT' },
      {
        $set: {
          currentCourseDay: targetDay,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        }
      },
      { new: true, select: 'name regNo batch currentCourseDay' }
    );
    if (!student) return res.status(404).json({ message: 'Student not found' });

    res.json({
      message: `Student "${student.name}" set to day ${targetDay}`,
      student: {
        _id: student._id,
        name: student.name,
        regNo: student.regNo,
        batch: student.batch,
        currentCourseDay: student.currentCourseDay
      }
    });
  } catch (err) {
    console.error('batch-journey PATCH /student/:id/day', err);
    res.status(500).json({ message: 'Failed to update student day', error: err.message });
  }
});

// ─── GET /api/batch-journey/:batchName/progress/day/:day/exercise-analytics ───
// Per-student exercise attempts & scores for all exercises scheduled on a journey day
router.get('/:batchName/progress/day/:day/exercise-analytics', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const bn = String(req.params.batchName || '').trim();
    const dayNum = clampDay(req.params.day);
    if (!bn) return res.status(400).json({ message: 'batchName is required' });
    if (!(await teacherCanAccessBatch(req, bn))) {
      return res.status(403).json({ message: 'You do not have access to this batch.' });
    }

    const batchRegex = new RegExp(`^${escapeRegExp(bn)}$`, 'i');
    const students = await User.find({ batch: batchRegex, role: 'STUDENT', ...EXCLUDE_TEST })
      .select('_id name regNo').sort({ name: 1 }).lean();
    if (!students.length) {
      return res.json({ day: dayNum, exercises: [], students: [] });
    }
    const studentIds = students.map(s => s._id);

    const exDocs = await DigitalExercise.find({
      courseDay: dayNum,
      isDeleted: { $ne: true },
      visibleToStudents: true,
      isActive: true
    })
      .select('_id title')
      .sort({ title: 1 })
      .lean();

    const exIds = exDocs.map(e => e._id);
    const exercises = exDocs.map(e => ({ _id: e._id, title: e.title || 'Untitled' }));

    if (!exIds.length) {
      return res.json({
        day: dayNum,
        exercises,
        students: students.map(s => ({
          _id: s._id,
          name: s.name,
          regNo: s.regNo,
          exercises: []
        }))
      });
    }

    const attempts = await ExerciseAttempt.find({
      studentId: { $in: studentIds },
      exerciseId: { $in: exIds },
      status: 'completed'
    })
      .select('studentId exerciseId scorePercentage completedAt')
      .lean();

    const best = {};
    attempts.forEach((a) => {
      const sid = String(a.studentId);
      const eid = String(a.exerciseId);
      const sc = a.scorePercentage != null ? Number(a.scorePercentage) : 0;
      const key = `${sid}|${eid}`;
      if (!best[key] || sc > best[key].scorePercent) {
        best[key] = { scorePercent: sc, completedAt: a.completedAt };
      }
    });

    const studentsOut = students.map((s) => {
      const sid = String(s._id);
      return {
        _id: s._id,
        name: s.name,
        regNo: s.regNo,
        exercises: exIds.map((eid) => {
          const eidStr = String(eid);
          const b = best[`${sid}|${eidStr}`];
          return {
            exerciseId: eid,
            attempted: !!b,
            scorePercent: b ? b.scorePercent : null,
            completedAt: b ? b.completedAt : null
          };
        })
      };
    });

    res.json({ day: dayNum, exercises, students: studentsOut });
  } catch (err) {
    console.error('batch-journey GET .../progress/day/:day/exercise-analytics', err);
    res.status(500).json({ message: 'Failed to load exercise analytics', error: err.message });
  }
});

// ─── GET /api/batch-journey/:batchName/progress/day/:day ─────────────────────
// Live-class attendance (who joined / who did not) + same summary as daily row
router.get('/:batchName/progress/day/:day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const bn = String(req.params.batchName || '').trim();
    const dayNum = clampDay(req.params.day);
    if (!bn) return res.status(400).json({ message: 'batchName is required' });
    if (!(await teacherCanAccessBatch(req, bn))) {
      return res.status(403).json({ message: 'You do not have access to this batch.' });
    }

    const batchRegex = new RegExp(`^${escapeRegExp(bn)}$`, 'i');
    const students = await User.find({ batch: batchRegex, role: 'STUDENT', ...EXCLUDE_TEST })
      .select('_id name regNo email').sort({ name: 1 }).lean();
    if (!students.length) {
      return res.json({
        day: dayNum,
        liveClasses: [],
        exerciseCount: 0,
        moduleCount: 0,
        exerciseCompletionPercent: 0,
        moduleCompletionPercent: 0
      });
    }
    const studentIds = students.map(s => s._id);

    const meetings = await MeetingLink.find({
      batch: batchRegex,
      courseDay: dayNum,
      status: { $ne: 'cancelled' }
    })
      .select('topic startTime duration attendance')
      .sort({ startTime: 1 })
      .lean();

    const liveClasses = meetings.map((m) => ({
      meetingId: m._id,
      topic: m.topic || 'Live class',
      startTime: m.startTime,
      duration: m.duration,
      students: students.map((s) => {
        const sid = String(s._id);
        const att = (m.attendance || []).find((a) => String(a.studentId) === sid);
        const attended = !!(att && att.attended);
        return {
          _id: s._id,
          name: s.name,
          regNo: s.regNo,
          attended,
          durationMinutes: att?.durationMinutes ?? null,
          attendanceStatus: att?.status || (attended ? 'attended' : 'absent')
        };
      })
    }));

    const exIds = (
      await DigitalExercise.find({
        courseDay: dayNum,
        isDeleted: { $ne: true },
        visibleToStudents: true,
        isActive: true
      })
        .select('_id')
        .lean()
    ).map((e) => e._id);

    const modIds = (
      await LearningModule.find({
        courseDay: dayNum,
        isDeleted: { $ne: true },
        visibleToStudents: true
      })
        .select('_id')
        .lean()
    ).map((m) => m._id);

    let exerciseCompletionPercent = 0;
    let moduleCompletionPercent = 0;
    const nStud = students.length;

    if (exIds.length && nStud) {
      const attempts = await ExerciseAttempt.find({
        studentId: { $in: studentIds },
        exerciseId: { $in: exIds },
        status: 'completed'
      })
        .select('studentId exerciseId')
        .lean();
      const pairSet = new Set(attempts.map((a) => `${String(a.studentId)}|${String(a.exerciseId)}`));
      let filled = 0;
      for (const sid of studentIds) {
        for (const eid of exIds) {
          if (pairSet.has(`${String(sid)}|${String(eid)}`)) filled += 1;
        }
      }
      exerciseCompletionPercent = Math.round((100 * filled) / (nStud * exIds.length));
    }

    if (modIds.length && nStud) {
      const done = await StudentProgress.countDocuments({
        studentId: { $in: studentIds },
        moduleId: { $in: modIds },
        status: 'completed'
      });
      moduleCompletionPercent = Math.round((100 * done) / (nStud * modIds.length));
    }

    res.json({
      day: dayNum,
      liveClasses,
      exerciseCount: exIds.length,
      moduleCount: modIds.length,
      exerciseCompletionPercent,
      moduleCompletionPercent
    });
  } catch (err) {
    console.error('batch-journey GET /:batchName/progress/day/:day', err);
    res.status(500).json({ message: 'Failed to load day progress', error: err.message });
  }
});

// ─── GET /api/batch-journey/:batchName/progress ──────────────────────────────
// Aggregate batch-level progress: overall stats, per-day, per-week, per-student
router.get('/:batchName/progress', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const bn = String(req.params.batchName || '').trim();
    if (!bn) return res.status(400).json({ message: 'batchName is required' });
    if (!(await teacherCanAccessBatch(req, bn))) {
      return res.status(403).json({ message: 'You do not have access to this batch.' });
    }

    const sectionsRaw = req.query.sections;
    const wantAll = sectionsRaw == null || sectionsRaw === '' || sectionsRaw === 'all';
    const sectionParts = wantAll
      ? []
      : String(sectionsRaw).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const includeOverall = wantAll || sectionParts.includes('overall');
    const includeDaily =
      wantAll ||
      sectionParts.includes('daily') ||
      sectionParts.includes('weekly') ||
      sectionParts.includes('detail');
    if (!includeOverall && !includeDaily) {
      return res.status(400).json({ message: 'Invalid sections. Use overall, daily, weekly, all, or comma-separated.' });
    }

    const batchRegex = new RegExp(`^${escapeRegExp(bn)}$`, 'i');

    // All students in batch (test accounts excluded from analytics)
    const students = await User.find({ batch: batchRegex, role: 'STUDENT', ...EXCLUDE_TEST })
      .select('_id name regNo email level currentCourseDay').lean();

    if (!students.length) {
      return res.json({ overall: { totalStudents: 0, avgScorePercent: 0, totalExercisesCompleted: 0, totalClassesAttended: 0, avgDayReached: 0 }, daily: [], weekly: [], students: [] });
    }

    const studentIds = students.map(s => s._id);

    // ── Fast path: overall + per-student rows only (no populate, no per-attempt documents) ──
    if (!includeDaily) {
      const [attemptAgg, meetingsLean] = await Promise.all([
        ExerciseAttempt.aggregate([
          { $match: { studentId: { $in: studentIds }, status: 'completed' } },
          {
            $group: {
              _id: '$studentId',
              count: { $sum: 1 },
              totalScore: {
                $sum: {
                  $cond: [{ $ne: ['$scorePercentage', null] }, '$scorePercentage', 0]
                }
              },
              scoreCount: {
                $sum: {
                  $cond: [{ $ne: ['$scorePercentage', null] }, 1, 0]
                }
              }
            }
          }
        ]),
        MeetingLink.find({ batch: batchRegex, status: { $ne: 'cancelled' } })
          .select('attendance')
          .lean()
      ]);

      const studentExerciseMap = {};
      students.forEach(s => { studentExerciseMap[String(s._id)] = { count: 0, totalScore: 0, scoreCount: 0 }; });
      for (const row of attemptAgg) {
        const sid = String(row._id);
        if (!studentExerciseMap[sid]) continue;
        studentExerciseMap[sid].count = row.count;
        studentExerciseMap[sid].totalScore = row.totalScore;
        studentExerciseMap[sid].scoreCount = row.scoreCount;
      }

      const studentAttendanceMap = {};
      students.forEach(s => { studentAttendanceMap[String(s._id)] = 0; });
      meetingsLean.forEach(m => {
        (m.attendance || []).forEach(a => {
          const sid = String(a.studentId || a.userId || '');
          if (studentAttendanceMap[sid] !== undefined && a.attended) {
            studentAttendanceMap[sid] += 1;
          }
        });
      });

      const studentSummaries = students.map(s => {
        const sid = String(s._id);
        const ex = studentExerciseMap[sid];
        return {
          _id: s._id,
          name: s.name,
          regNo: s.regNo,
          level: s.level,
          currentDay: s.currentCourseDay || 1,
          avgScore: ex.scoreCount ? Math.round(ex.totalScore / ex.scoreCount) : 0,
          exercisesDone: ex.count,
          classesAttended: studentAttendanceMap[sid] || 0
        };
      });

      const totalExercisesCompleted = studentSummaries.reduce((a, s) => a + s.exercisesDone, 0);
      const totalClassesAttended = studentSummaries.reduce((a, s) => a + s.classesAttended, 0);
      const scoredStudents = studentSummaries.filter(s => s.avgScore > 0);
      const avgScorePercent = scoredStudents.length ? Math.round(scoredStudents.reduce((a, s) => a + s.avgScore, 0) / scoredStudents.length) : 0;
      const avgDayReached = studentSummaries.length ? Math.round(studentSummaries.reduce((a, s) => a + s.currentDay, 0) / studentSummaries.length) : 0;

      return res.json({
        overall: {
          totalStudents: students.length,
          avgScorePercent,
          totalExercisesCompleted,
          totalClassesAttended,
          avgDayReached
        },
        students: studentSummaries,
        daily: [],
        weekly: []
      });
    }

    // --- Heavy path: need exercise courseDay (populate) + day-by-day rollups ---
    const [attempts, meetings] = await Promise.all([
      ExerciseAttempt.find({
        studentId: { $in: studentIds },
        status: 'completed'
      })
        .populate('exerciseId', 'title courseDay')
        .lean(),
      MeetingLink.find({ batch: batchRegex, status: { $ne: 'cancelled' } })
        .select('topic startTime duration courseDay attendance status')
        .lean()
    ]);

    const studentExerciseMap = {};
    students.forEach(s => { studentExerciseMap[String(s._id)] = { count: 0, totalScore: 0, scoreCount: 0 }; });

    attempts.forEach(a => {
      const sid = String(a.studentId);
      if (!studentExerciseMap[sid]) return;
      studentExerciseMap[sid].count += 1;
      if (a.scorePercentage !== undefined && a.scorePercentage !== null) {
        studentExerciseMap[sid].totalScore += a.scorePercentage;
        studentExerciseMap[sid].scoreCount += 1;
      }
    });

    const studentAttendanceMap = {};
    students.forEach(s => { studentAttendanceMap[String(s._id)] = 0; });

    meetings.forEach(m => {
      (m.attendance || []).forEach(a => {
        const sid = String(a.studentId || a.userId || '');
        if (studentAttendanceMap[sid] !== undefined && a.attended) {
          studentAttendanceMap[sid] += 1;
        }
      });
    });

    const studentSummaries = students.map(s => {
      const sid = String(s._id);
      const ex = studentExerciseMap[sid];
      return {
        _id: s._id,
        name: s.name,
        regNo: s.regNo,
        level: s.level,
        currentDay: s.currentCourseDay || 1,
        avgScore: ex.scoreCount ? Math.round(ex.totalScore / ex.scoreCount) : 0,
        exercisesDone: ex.count,
        classesAttended: studentAttendanceMap[sid] || 0
      };
    });

    const totalExercisesCompleted = studentSummaries.reduce((a, s) => a + s.exercisesDone, 0);
    const totalClassesAttended = studentSummaries.reduce((a, s) => a + s.classesAttended, 0);
    const scoredStudents = studentSummaries.filter(s => s.avgScore > 0);
    const avgScorePercent = scoredStudents.length ? Math.round(scoredStudents.reduce((a, s) => a + s.avgScore, 0) / scoredStudents.length) : 0;
    const avgDayReached = studentSummaries.length ? Math.round(studentSummaries.reduce((a, s) => a + s.currentDay, 0) / studentSummaries.length) : 0;

    const overallPayload = {
      totalStudents: students.length,
      avgScorePercent,
      totalExercisesCompleted,
      totalClassesAttended,
      avgDayReached
    };

    // --- Daily breakdown ---
    // Determine days covered (max student day)
    const maxDay = Math.max(...students.map(s => s.currentCourseDay || 1), 1);
    const dailyMap = {};
    /** Unique students who attended ≥1 live class on that journey day (for charts: reached vs joined) */
    const liveUniqueByDay = {};
    for (let d = 1; d <= maxDay; d++) {
      dailyMap[d] = { day: d, studentsCompleted: 0, totalScore: 0, scoreCount: 0, classesHeld: 0, classesAttended: 0 };
      liveUniqueByDay[d] = new Set();
    }

    // Students who reached or passed each day
    students.forEach(s => {
      const reached = s.currentCourseDay || 1;
      for (let d = 1; d <= reached && d <= maxDay; d++) {
        if (dailyMap[d]) dailyMap[d].studentsCompleted += 1;
      }
    });

    // Average score per day from attempts
    attempts.forEach(a => {
      const day = a.exerciseId?.courseDay;
      if (day && dailyMap[day] && a.scorePercentage !== undefined) {
        dailyMap[day].totalScore += a.scorePercentage;
        dailyMap[day].scoreCount += 1;
      }
    });

    meetings.forEach(m => {
      const day = m.courseDay;
      if (day && dailyMap[day]) {
        dailyMap[day].classesHeld += 1;
        (m.attendance || []).forEach(a => {
          if (a.attended) {
            dailyMap[day].classesAttended += 1;
            const sid = String(a.studentId || a.userId || '');
            if (sid) liveUniqueByDay[day].add(sid);
          }
        });
      }
    });

    // Scheduled exercises & modules per journey day (visible to students)
    const exForDays = await DigitalExercise.find({
      courseDay: { $gte: 1, $lte: maxDay },
      isDeleted: { $ne: true },
      visibleToStudents: true,
      isActive: true
    }).select('_id courseDay').lean();

    const modForDays = await LearningModule.find({
      courseDay: { $gte: 1, $lte: maxDay },
      isDeleted: { $ne: true },
      visibleToStudents: true
    }).select('_id courseDay').lean();

    const exercisesByDay = {};
    exForDays.forEach((ex) => {
      const day = ex.courseDay;
      if (!day || !dailyMap[day]) return;
      if (!exercisesByDay[day]) exercisesByDay[day] = [];
      exercisesByDay[day].push(ex._id);
    });
    const modulesByDay = {};
    modForDays.forEach((mo) => {
      const day = mo.courseDay;
      if (!day || !dailyMap[day]) return;
      if (!modulesByDay[day]) modulesByDay[day] = [];
      modulesByDay[day].push(mo._id);
    });

    const allExIds = exForDays.map((e) => e._id);
    const exAttemptPairs = allExIds.length
      ? await ExerciseAttempt.find({
        studentId: { $in: studentIds },
        exerciseId: { $in: allExIds },
        status: 'completed'
      }).select('studentId exerciseId').lean()
      : [];
    const exPairSet = new Set(exAttemptPairs.map((a) => `${String(a.studentId)}|${String(a.exerciseId)}`));

    const allModIds = modForDays.map((m) => m._id);
    const modProgressDocs = allModIds.length
      ? await StudentProgress.find({
        studentId: { $in: studentIds },
        moduleId: { $in: allModIds },
        status: 'completed'
      }).select('studentId moduleId').lean()
      : [];
    const modPairSet = new Set(modProgressDocs.map((p) => `${String(p.studentId)}|${String(p.moduleId)}`));

    const nStud = students.length;

    const daily = Object.values(dailyMap).map((d) => {
      const exIds = exercisesByDay[d.day] || [];
      const mIds = modulesByDay[d.day] || [];
      let exerciseCompletionPercent = 0;
      let moduleCompletionPercent = 0;
      let exerciseSlotsFilled = 0;
      const exerciseSlotsTotal = exIds.length * nStud;
      if (exIds.length && nStud) {
        let filled = 0;
        for (const sid of studentIds) {
          for (const eid of exIds) {
            if (exPairSet.has(`${String(sid)}|${String(eid)}`)) filled += 1;
          }
        }
        exerciseSlotsFilled = filled;
        exerciseCompletionPercent = Math.round((100 * filled) / (nStud * exIds.length));
      }
      let moduleSlotsFilled = 0;
      const moduleSlotsTotal = mIds.length * nStud;
      if (mIds.length && nStud) {
        let mf = 0;
        for (const sid of studentIds) {
          for (const mid of mIds) {
            if (modPairSet.has(`${String(sid)}|${String(mid)}`)) mf += 1;
          }
        }
        moduleSlotsFilled = mf;
        moduleCompletionPercent = Math.round((100 * mf) / (nStud * mIds.length));
      }
      const liveUniqueJoined = liveUniqueByDay[d.day] ? liveUniqueByDay[d.day].size : 0;
      return {
        day: d.day,
        studentsCompleted: d.studentsCompleted,
        avgScore: d.scoreCount ? Math.round(d.totalScore / d.scoreCount) : 0,
        classesHeld: d.classesHeld,
        classesAttended: d.classesAttended,
        liveUniqueJoined,
        exerciseCount: exIds.length,
        moduleCount: mIds.length,
        exerciseCompletionPercent,
        moduleCompletionPercent,
        exerciseSlotsFilled,
        exerciseSlotsTotal,
        moduleSlotsFilled,
        moduleSlotsTotal
      };
    });

    // --- Weekly breakdown ---
    const weeklyMap = {};
    daily.forEach(d => {
      const week = Math.ceil(d.day / 7);
      if (!weeklyMap[week]) {
        weeklyMap[week] = { week, days: [], totalScore: 0, scoreCount: 0, exercisesDone: 0, classesAttended: 0 };
      }
      weeklyMap[week].days.push(d.day);
      weeklyMap[week].totalScore += d.avgScore * (d.avgScore > 0 ? 1 : 0);
      if (d.avgScore > 0) weeklyMap[week].scoreCount += 1;
      weeklyMap[week].classesAttended += d.classesAttended;
    });

    // Sum exercisesDone per week from attempts
    attempts.forEach(a => {
      const day = a.exerciseId?.courseDay;
      if (!day) return;
      const week = Math.ceil(day / 7);
      if (weeklyMap[week]) weeklyMap[week].exercisesDone += 1;
    });

    const weekly = Object.values(weeklyMap).map((w) => ({
      week: w.week,
      days: w.days,
      avgScore: w.scoreCount ? Math.round(w.totalScore / w.scoreCount) : 0,
      exercisesDone: w.exercisesDone,
      classesAttended: w.classesAttended
    }));

    if (!includeOverall) {
      return res.json({ daily, weekly });
    }

    res.json({
      overall: overallPayload,
      daily,
      weekly,
      students: studentSummaries
    });
  } catch (err) {
    console.error('batch-journey GET /:batchName/progress', err);
    res.status(500).json({ message: 'Failed to fetch batch progress', error: err.message });
  }
});

// ─── GET /api/batch-journey/student/:studentId/full-progress ─────────────────
// Full detailed progress for one student: exercises + Q&A, modules, live classes, day breakdown
router.get('/student/:studentId/full-progress', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { studentId } = req.params;
    if (!(await teacherCanAccessStudent(req, studentId))) {
      return res.status(403).json({ message: 'You do not have access to this student.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'STUDENT' })
      .select('name regNo email level batch currentCourseDay goStatus subscription').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    // --- Exercise attempts with question responses ---
    const attempts = await ExerciseAttempt.find({ studentId, status: 'completed' })
      .populate('exerciseId', 'title courseDay category level')
      .sort({ completedAt: 1 })
      .lean();

    const exercises = attempts.map(a => ({
      attemptId: a._id,
      exerciseId: a.exerciseId?._id,
      title: a.exerciseId?.title || 'Untitled',
      courseDay: a.exerciseId?.courseDay || null,
      category: a.exerciseId?.category || null,
      level: a.exerciseId?.level || null,
      scorePercent: a.scorePercentage || 0,
      earnedPoints: a.earnedPoints || 0,
      totalPoints: a.totalPoints || 0,
      completedAt: a.completedAt,
      timeSpentSeconds: a.timeSpentSeconds || 0,
      responses: (a.responses || []).map(r => ({
        questionIndex: r.questionIndex,
        questionType: r.questionType,
        selectedOptionIndex: r.selectedOptionIndex,
        matchingResponse: r.matchingResponse,
        fillBlankResponses: r.fillBlankResponses,
        spokenText: r.spokenText,
        pronunciationScore: r.pronunciationScore,
        qaResponse: r.qaResponse,
        listeningText: r.listeningText,
        isCorrect: r.isCorrect,
        pointsEarned: r.pointsEarned
      }))
    }));

    // --- Module progress ---
    const moduleProgress = await StudentProgress.find({ studentId })
      .populate('moduleId', 'title level category courseDay')
      .sort({ lastAccessedAt: -1 })
      .lean();

    const modules = moduleProgress.map(p => ({
      moduleId: p.moduleId?._id,
      title: p.moduleId?.title || 'Untitled',
      level: p.moduleId?.level || null,
      category: p.moduleId?.category || null,
      courseDay: p.moduleId?.courseDay || null,
      status: p.status,
      progressPercent: p.progressPercentage || 0,
      exercisesCompleted: p.exercisesCompleted || 0,
      timeSpent: p.timeSpent || 0,
      lastAccessedAt: p.lastAccessedAt
    }));

    // --- Live classes ---
    const journeyKeys = allStudentBatchStringsForContent(student);
    const meetings = journeyKeys.length
      ? await MeetingLink.find({
          $or: journeyKeys.map((k) => ({
            batch: new RegExp(`^${escapeRegExp(k)}$`, 'i')
          })),
          status: { $ne: 'cancelled' }
        }).select('topic startTime duration courseDay attendance status').lean()
      : [];

    const liveClasses = meetings.map(m => {
      const attendEntry = (m.attendance || []).find(a => String(a.studentId || a.userId) === String(studentId));
      return {
        meetingId: m._id,
        topic: m.topic,
        startTime: m.startTime,
        duration: m.duration,
        courseDay: m.courseDay,
        attended: !!(attendEntry?.attended)
      };
    });

    // --- Day-by-day breakdown ---
    const maxDay = student.currentCourseDay || 1;
    const dayMap = {};
    for (let d = 1; d <= maxDay; d++) {
      dayMap[d] = { day: d, exercisesDone: 0, exercisesTotal: 0, classesAttended: 0, classesTotal: 0, totalScore: 0, scoreCount: 0 };
    }

    // exercises done per day
    exercises.forEach(e => {
      const d = e.courseDay;
      if (d && dayMap[d]) {
        dayMap[d].exercisesDone += 1;
        dayMap[d].totalScore += e.scorePercent;
        dayMap[d].scoreCount += 1;
      }
    });

    // Total exercises available per day from attempts (approximation: count distinct exerciseId per day in exercises)
    // and class info per day
    liveClasses.forEach(c => {
      const d = c.courseDay;
      if (d && dayMap[d]) {
        dayMap[d].classesTotal += 1;
        if (c.attended) dayMap[d].classesAttended += 1;
      }
    });

    const dayBreakdown = Object.values(dayMap).map((d) => ({
      day: d.day,
      exercisesDone: d.exercisesDone,
      classesAttended: d.classesAttended,
      classesTotal: d.classesTotal,
      avgScore: d.scoreCount ? Math.round(d.totalScore / d.scoreCount) : 0
    }));

    res.json({
      student: {
        _id: student._id,
        name: student.name,
        regNo: student.regNo,
        email: student.email,
        level: student.level,
        currentDay: student.currentCourseDay || 1
      },
      exercises,
      modules,
      liveClasses,
      dayBreakdown
    });
  } catch (err) {
    console.error('batch-journey GET /student/:id/full-progress', err);
    res.status(500).json({ message: 'Failed to fetch student full progress', error: err.message });
  }
});

module.exports = router;
