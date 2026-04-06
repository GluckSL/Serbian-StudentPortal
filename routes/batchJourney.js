// routes/batchJourney.js
// Journey management: per-batch config + student day control

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const BatchConfig = require('../models/BatchConfig');
const LearningModule = require('../models/LearningModule');
const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const { verifyToken, checkRole } = require('../middleware/auth');

// ─── helpers ────────────────────────────────────────────────────────────────

function clampDay(d, max = 200) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > max) return max;
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

/**
 * Check whether a student has completed all tasks scheduled for a given day.
 * Returns { complete, breakdown: { exercises, classes } }
 */
async function checkDayCompletion(studentId, batchName, day) {
  // --- Exercises for this day ---
  const exercises = await DigitalExercise.find({
    isDeleted: { $ne: true },
    visibleToStudents: true,
    courseDay: day
  }).select('_id title').lean();

  const exerciseIds = exercises.map(e => e._id);
  const completedAttempts = exerciseIds.length
    ? await ExerciseAttempt.find({
        studentId,
        exerciseId: { $in: exerciseIds },
        status: 'completed'
      }).distinct('exerciseId')
    : [];

  const completedExerciseIdSet = new Set(completedAttempts.map(id => String(id)));
  const exerciseDone = completedExerciseIdSet.size;
  const exerciseTotal = exerciseIds.length;

  const incompleteExercises = exercises
    .filter(e => !completedExerciseIdSet.has(String(e._id)))
    .map(e => ({
      kind: 'exercise',
      title: e.title && String(e.title).trim() ? e.title : 'Digital exercise',
      courseDay: day
    }));

  // --- Live classes for this day & batch ---
  const classes = await MeetingLink.find({
    batch: batchName,
    courseDay: day,
    status: { $ne: 'cancelled' }
  }).select('_id topic attendance').lean();

  let classDone = 0;
  const classTotal = classes.length;
  const incompleteClasses = [];
  for (const cls of classes) {
    const record = (cls.attendance || []).find(a =>
      String(a.studentId) === String(studentId) && a.attended === true
    );
    if (record) {
      classDone++;
    } else {
      incompleteClasses.push({
        kind: 'class',
        title: cls.topic && String(cls.topic).trim() ? cls.topic : 'Live class',
        courseDay: day
      });
    }
  }

  const allExercisesDone = exerciseTotal === 0 || exerciseDone >= exerciseTotal;
  const allClassesDone   = classTotal  === 0 || classDone  >= classTotal;
  const complete = allExercisesDone && allClassesDone;

  const incompleteTasks = [...incompleteExercises, ...incompleteClasses];

  return {
    complete,
    incompleteTasks,
    breakdown: {
      exercises: { done: exerciseDone, total: exerciseTotal, items: exercises.map(e => ({ _id: e._id, title: e.title })) },
      classes:   { done: classDone,    total: classTotal,    items: classes.map(c => ({ _id: c._id, topic: c.topic })) }
    }
  };
}

// ─── GET /api/batch-journey ─────────────────────────────────────────────────
// List every distinct batch from the User collection + joined BatchConfig data
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const batchNames = await User.distinct('batch', { role: 'STUDENT', batch: { $ne: null, $ne: '' } });

    const counts = await User.aggregate([
      { $match: { role: 'STUDENT', batch: { $in: batchNames } } },
      { $group: { _id: '$batch', count: { $sum: 1 } } }
    ]);
    const countMap = {};
    counts.forEach(c => { countMap[c._id] = c.count; });

    const dayAggs = await User.aggregate([
      { $match: { role: 'STUDENT', batch: { $in: batchNames } } },
      { $group: { _id: '$batch', avgDay: { $avg: '$currentCourseDay' }, minDay: { $min: '$currentCourseDay' }, maxDay: { $max: '$currentCourseDay' } } }
    ]);
    const dayMap = {};
    dayAggs.forEach(d => { dayMap[d._id] = { avg: Math.round(d.avgDay || 1), min: d.minDay || 1, max: d.maxDay || 1 }; });

    const configs = await BatchConfig.find({ batchName: { $in: batchNames } }).lean();
    const configMap = {};
    configs.forEach(c => { configMap[c.batchName] = c; });

    const batches = batchNames.map(name => {
      const cfg = configMap[name] || { batchName: name, journeyLength: 200, batchCurrentDay: 1, notes: '', batchStartDate: null };
      const days = dayMap[name] || { avg: 1, min: 1, max: 1 };
      const activeBatchDay = computeBatchDay(cfg);
      return {
        batchName: name,
        journeyLength: cfg.journeyLength,
        batchCurrentDay: activeBatchDay,
        batchStartDate: cfg.batchStartDate || null,
        autoDay: !!cfg.batchStartDate,
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
      .select('name regNo email level studentStatus currentCourseDay enrollmentDate createdAt')
      .sort({ name: 1 })
      .lean();

    const cfg = await getOrCreateConfig(batchName);
    const activeBatchDay = computeBatchDay(cfg);

    res.json({
      batchName,
      config: {
        journeyLength: cfg.journeyLength,
        batchCurrentDay: activeBatchDay,
        batchStartDate: cfg.batchStartDate || null,
        autoDay: !!cfg.batchStartDate,
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
router.get('/:batchName/timeline', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const cfg = await getOrCreateConfig(batchName);
    const length = cfg.journeyLength;
    const activeBatchDay = computeBatchDay(cfg);

    const [modules, exercises, classes] = await Promise.all([
      LearningModule.find({ isDeleted: { $ne: true }, courseDay: { $gte: 1, $lte: length } })
        .select('title category level courseDay').sort({ courseDay: 1 }).lean(),
      DigitalExercise.find({ isDeleted: { $ne: true }, courseDay: { $gte: 1, $lte: length } })
        .select('title category level courseDay').sort({ courseDay: 1 }).lean(),
      MeetingLink.find({ courseDay: { $gte: 1, $lte: length } })
        .select('topic batch courseDay startTime duration').sort({ courseDay: 1 }).lean()
    ]);

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

    const days = Object.values(timeline).filter(
      d => d.day <= length && (d.modules.length || d.exercises.length || d.classes.length || d.day === activeBatchDay)
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
    const { journeyLength, batchCurrentDay, batchStartDate, notes } = req.body;

    let cfg = await getOrCreateConfig(batchName);

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
    await cfg.save();

    const activeBatchDay = computeBatchDay(cfg);
    res.json({
      message: 'Batch config updated',
      config: {
        ...cfg.toObject(),
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
      { $set: { currentCourseDay: targetDay } }
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

// ─── GET /api/batch-journey/student/:studentId/day-status ────────────────────
// Check if a student has completed all tasks for their current day
router.get('/student/:studentId/day-status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const student = await User.findOne({ _id: req.params.studentId, role: 'STUDENT' })
      .select('name regNo batch currentCourseDay').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const day = student.currentCourseDay || 1;
    const result = await checkDayCompletion(student._id, student.batch, day);

    res.json({
      studentId: student._id,
      name: student.name,
      currentDay: day,
      ...result
    });
  } catch (err) {
    console.error('batch-journey GET /student/:id/day-status', err);
    res.status(500).json({ message: 'Failed to check day status', error: err.message });
  }
});

// ─── POST /api/batch-journey/student/:studentId/advance-day ──────────────────
// Check task completion; if all done, advance student to next day. Admin can force.
router.post('/student/:studentId/advance-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { force = false } = req.body || {};
    const student = await User.findOne({ _id: req.params.studentId, role: 'STUDENT' })
      .select('name regNo batch currentCourseDay').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const cfg = await getOrCreateConfig(student.batch);
    const currentDay = student.currentCourseDay || 1;

    if (currentDay >= cfg.journeyLength) {
      return res.json({ advanced: false, message: 'Student has already completed the journey.', currentDay });
    }

    const { complete, breakdown, incompleteTasks } = await checkDayCompletion(student._id, student.batch, currentDay);

    if (!complete && !force) {
      return res.json({
        advanced: false,
        message: `Student has not completed all tasks for Day ${currentDay}.`,
        currentDay,
        complete: false,
        incompleteTasks,
        breakdown
      });
    }

    const nextDay = currentDay + 1;
    await User.findByIdAndUpdate(student._id, { $set: { currentCourseDay: nextDay } });

    console.log(`✅ Student ${student.name} advanced from Day ${currentDay} → Day ${nextDay}${force ? ' (forced by admin)' : ''}`);
    res.json({
      advanced: true,
      message: `${student.name} advanced to Day ${nextDay}${force ? ' (admin override)' : ''}`,
      previousDay: currentDay,
      currentDay: nextDay,
      breakdown
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
      { $set: { currentCourseDay: targetDay } },
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

module.exports = router;
