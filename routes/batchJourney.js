// routes/batchJourney.js
// Journey management: per-batch config + student day control

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const BatchConfig = require('../models/BatchConfig');
const LearningModule = require('../models/LearningModule');
const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const { verifyToken, checkRole } = require('../middleware/auth');

// ─── helpers ────────────────────────────────────────────────────────────────

function clampDay(d) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 200) return 200;
  return n;
}

/** Upsert a BatchConfig row and return it */
async function getOrCreateConfig(batchName) {
  let cfg = await BatchConfig.findOne({ batchName });
  if (!cfg) {
    cfg = await BatchConfig.create({ batchName });
  }
  return cfg;
}

// ─── GET /api/batch-journey ─────────────────────────────────────────────────
// List every distinct batch from the User collection + joined BatchConfig data
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    // Distinct batch names from students
    const batchNames = await User.distinct('batch', { role: 'STUDENT', batch: { $ne: null, $ne: '' } });

    // Student counts per batch
    const counts = await User.aggregate([
      { $match: { role: 'STUDENT', batch: { $in: batchNames } } },
      { $group: { _id: '$batch', count: { $sum: 1 } } }
    ]);
    const countMap = {};
    counts.forEach(c => { countMap[c._id] = c.count; });

    // Average course day per batch
    const dayAggs = await User.aggregate([
      { $match: { role: 'STUDENT', batch: { $in: batchNames } } },
      { $group: { _id: '$batch', avgDay: { $avg: '$currentCourseDay' }, minDay: { $min: '$currentCourseDay' }, maxDay: { $max: '$currentCourseDay' } } }
    ]);
    const dayMap = {};
    dayAggs.forEach(d => { dayMap[d._id] = { avg: Math.round(d.avgDay || 1), min: d.minDay || 1, max: d.maxDay || 1 }; });

    // All BatchConfigs
    const configs = await BatchConfig.find({ batchName: { $in: batchNames } }).lean();
    const configMap = {};
    configs.forEach(c => { configMap[c.batchName] = c; });

    const batches = batchNames.map(name => {
      const cfg = configMap[name] || { batchName: name, journeyLength: 200, batchCurrentDay: 1, notes: '' };
      const days = dayMap[name] || { avg: 1, min: 1, max: 1 };
      return {
        batchName: name,
        journeyLength: cfg.journeyLength,
        batchCurrentDay: cfg.batchCurrentDay,
        notes: cfg.notes || '',
        studentCount: countMap[name] || 0,
        studentDays: days
      };
    });

    batches.sort((a, b) => a.batchName.localeCompare(b.batchName));

    res.json({ batches });
  } catch (err) {
    console.error('batch-journey GET /', err);
    res.status(500).json({ message: 'Failed to load batches', error: err.message });
  }
});

// ─── GET /api/batch-journey/:batchName/students ─────────────────────────────
router.get('/:batchName/students', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const students = await User.find({ role: 'STUDENT', batch: batchName })
      .select('name regNo email level studentStatus currentCourseDay enrollmentDate')
      .sort({ name: 1 })
      .lean();

    const cfg = await getOrCreateConfig(batchName);

    res.json({
      batchName,
      config: {
        journeyLength: cfg.journeyLength,
        batchCurrentDay: cfg.batchCurrentDay,
        notes: cfg.notes
      },
      students: students.map(s => ({
        _id: s._id,
        name: s.name,
        regNo: s.regNo,
        email: s.email,
        level: s.level,
        studentStatus: s.studentStatus,
        currentCourseDay: s.currentCourseDay || 1,
        enrollmentDate: s.enrollmentDate
      }))
    });
  } catch (err) {
    console.error('batch-journey GET /:batch/students', err);
    res.status(500).json({ message: 'Failed to load students', error: err.message });
  }
});

// ─── GET /api/batch-journey/:batchName/timeline ──────────────────────────────
// Returns content (modules, exercises, live classes) grouped by day
router.get('/:batchName/timeline', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const cfg = await getOrCreateConfig(batchName);
    const length = cfg.journeyLength;

    // Fetch all content with courseDay in 1..length
    const [modules, exercises, classes] = await Promise.all([
      LearningModule.find({
        isDeleted: { $ne: true },
        courseDay: { $gte: 1, $lte: length }
      }).select('title category level courseDay').sort({ courseDay: 1 }).lean(),

      DigitalExercise.find({
        isDeleted: { $ne: true },
        courseDay: { $gte: 1, $lte: length }
      }).select('title category level courseDay').sort({ courseDay: 1 }).lean(),

      MeetingLink.find({
        courseDay: { $gte: 1, $lte: length }
      }).select('topic batch courseDay startTime duration').sort({ courseDay: 1 }).lean()
    ]);

    // Group by day
    const timeline = {};
    for (let d = 1; d <= length; d++) {
      timeline[d] = { day: d, modules: [], exercises: [], classes: [] };
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

    // Return only days that have content, plus the current batch day
    const days = Object.values(timeline).filter(
      d => d.day <= length && (d.modules.length || d.exercises.length || d.classes.length || d.day === cfg.batchCurrentDay)
    );

    res.json({
      batchName,
      journeyLength: length,
      batchCurrentDay: cfg.batchCurrentDay,
      days
    });
  } catch (err) {
    console.error('batch-journey GET /:batch/timeline', err);
    res.status(500).json({ message: 'Failed to load timeline', error: err.message });
  }
});

// ─── PUT /api/batch-journey/:batchName ──────────────────────────────────────
// Update journeyLength and/or batchCurrentDay on the config (does NOT push to students)
router.put('/:batchName', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const { journeyLength, batchCurrentDay, notes } = req.body;

    let cfg = await getOrCreateConfig(batchName);

    if (journeyLength !== undefined) {
      const jl = clampDay(journeyLength);
      cfg.journeyLength = Math.min(200, Math.max(1, jl));
    }
    if (batchCurrentDay !== undefined) {
      cfg.batchCurrentDay = Math.min(cfg.journeyLength, Math.max(1, clampDay(batchCurrentDay)));
    }
    if (notes !== undefined) {
      cfg.notes = String(notes).substring(0, 500);
    }
    await cfg.save();

    res.json({ message: 'Batch config updated', config: cfg });
  } catch (err) {
    console.error('batch-journey PUT /:batch', err);
    res.status(500).json({ message: 'Failed to update config', error: err.message });
  }
});

// ─── POST /api/batch-journey/:batchName/set-day ──────────────────────────────
// Set batchCurrentDay on config AND push to all students in the batch
router.post('/:batchName/set-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const { day } = req.body;

    if (day === undefined || day === null) {
      return res.status(400).json({ message: 'day is required' });
    }
    const targetDay = clampDay(day);

    const cfg = await getOrCreateConfig(batchName);
    if (targetDay > cfg.journeyLength) {
      return res.status(400).json({ message: `day (${targetDay}) exceeds journeyLength (${cfg.journeyLength})` });
    }

    // Update config
    cfg.batchCurrentDay = targetDay;
    await cfg.save();

    // Update all students in batch
    const result = await User.updateMany(
      { role: 'STUDENT', batch: batchName },
      { $set: { currentCourseDay: targetDay } }
    );

    console.log(`✅ Batch ${batchName} set to day ${targetDay}. Updated ${result.modifiedCount} students.`);

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

// ─── PATCH /api/batch-journey/student/:studentId/day ────────────────────────
// Override a single student's currentCourseDay
router.patch('/student/:studentId/day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { studentId } = req.params;
    const { day } = req.body;

    if (day === undefined || day === null) {
      return res.status(400).json({ message: 'day is required' });
    }
    const targetDay = clampDay(day);

    const student = await User.findOneAndUpdate(
      { _id: studentId, role: 'STUDENT' },
      { $set: { currentCourseDay: targetDay } },
      { new: true, select: 'name regNo batch currentCourseDay' }
    );

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    console.log(`✅ Student ${student.name} (${student.regNo}) set to day ${targetDay}`);

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

module.exports = router;
