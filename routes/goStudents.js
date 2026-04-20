// routes/goStudents.js
// GO Silver student management: add students, list, and fetch per-student detail

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const BatchConfig = require('../models/BatchConfig');
const LearningModule = require('../models/LearningModule');
const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const ZoomRecording = require('../models/ZoomRecording');
const ZoomRecordingView = require('../models/ZoomRecordingView');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const StudentProgress = require('../models/StudentProgress');
const { verifyToken, checkRole } = require('../middleware/auth');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');

const GO_BATCH_NAME = 'GO-SILVER';

function toGoStudentRow(student) {
  return {
    _id: student._id,
    name: student.name,
    regNo: student.regNo,
    email: student.email,
    subscription: student.subscription,
    goStatus: student.goStatus,
    goJoiningDate: student.goJoiningDate,
    currentCourseDay: student.currentCourseDay,
    batch: student.batch || '',
    level: student.level || '',
    studentStatus: student.studentStatus || ''
  };
}

// ─── POST /api/go-students/add ────────────────────────────────────────────────
// Find a SILVER student by email and mark them as GO
router.post('/add', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const studentId = String(req.body?.studentId || '').trim();
    if (!email && !studentId) {
      return res.status(400).json({ message: 'Provide studentId or email.' });
    }

    const query = { role: 'STUDENT' };
    if (studentId) query._id = studentId;
    else query.email = email;

    const student = await User.findOne(query);
    if (!student) {
      return res.status(404).json({ message: 'Student not found.' });
    }
    if (student.subscription !== 'SILVER') {
      return res.status(400).json({ message: `Student is on the ${student.subscription} plan. Only SILVER students can be added to GO batch.` });
    }
    if (student.goStatus === 'GO') {
      return res.status(409).json({ message: 'Student is already in the GO batch.' });
    }

    // Ensure GO-SILVER BatchConfig exists
    await BatchConfig.findOneAndUpdate(
      { batchName: GO_BATCH_NAME },
      { $setOnInsert: { batchName: GO_BATCH_NAME, journeyLength: 200, batchCurrentDay: 1 } },
      { upsert: true, new: true }
    );

    student.goStatus = 'GO';
    student.goJoiningDate = new Date();
    await student.save();

    res.json({
      message: 'Student added to GO batch successfully.',
      student: toGoStudentRow(student)
    });
  } catch (err) {
    console.error('go-students POST /add', err);
    res.status(500).json({ message: 'Failed to add student to GO batch.', error: err.message });
  }
});

// ─── GET /api/go-students ─────────────────────────────────────────────────────
// List all GO Silver students
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const students = await User.find({ goStatus: 'GO', role: 'STUDENT' })
      .select('name regNo email subscription goStatus goJoiningDate currentCourseDay level batch studentStatus')
      .lean();

    res.json({ students });
  } catch (err) {
    console.error('go-students GET /', err);
    res.status(500).json({ message: 'Failed to fetch GO students.', error: err.message });
  }
});

// ─── GET /api/go-students/silver ──────────────────────────────────────────────
// List Silver students that are not yet in GO, with search + batch filters.
router.get('/silver', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const q = String(req.query?.q || '').trim();
    const batch = String(req.query?.batch || '').trim();
    const query = {
      role: 'STUDENT',
      subscription: 'SILVER',
      $or: [{ goStatus: { $exists: false } }, { goStatus: { $ne: 'GO' } }]
    };

    if (batch && batch.toLowerCase() !== 'all') {
      query.batch = batch;
    }

    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$and = [
        {
          $or: [
            { name: new RegExp(safe, 'i') },
            { email: new RegExp(safe, 'i') },
            { regNo: new RegExp(safe, 'i') }
          ]
        }
      ];
    }

    const students = await User.find(query)
      .select('name regNo email subscription currentCourseDay level batch studentStatus')
      .sort({ name: 1 })
      .lean();

    const batches = await User.distinct('batch', {
      role: 'STUDENT',
      subscription: 'SILVER',
      batch: { $exists: true, $nin: ['', null] }
    });

    res.json({
      students,
      batches: (batches || []).filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    });
  } catch (err) {
    console.error('go-students GET /silver', err);
    res.status(500).json({ message: 'Failed to fetch Silver students.', error: err.message });
  }
});

// ─── PATCH /api/go-students/:studentId/journey-day ─────────────────────────────
// Set the student's journey day (what they can access in the portal); clears pending auto-advance flags.
router.patch('/:studentId/journey-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { studentId } = req.params;
    let day = Number(req.body?.currentCourseDay);
    if (!Number.isFinite(day)) {
      return res.status(400).json({ message: 'currentCourseDay must be a number.' });
    }
    day = Math.floor(day);

    const goBatchCfg = await BatchConfig.findOne({ batchName: GO_BATCH_NAME }).select('journeyLength').lean();
    const maxDay =
      goBatchCfg?.journeyLength >= 1 ? Math.min(Math.floor(goBatchCfg.journeyLength), 200) : 200;
    if (day < 1 || day > maxDay) {
      return res.status(400).json({ message: `Journey day must be between 1 and ${maxDay}.` });
    }

    const student = await User.findOne({ _id: studentId, role: 'STUDENT', goStatus: 'GO' });
    if (!student) return res.status(404).json({ message: 'GO student not found.' });

    student.currentCourseDay = day;
    student.pendingJourneyDayAdvance = false;
    student.pendingJourneyDayAdvanceForDay = null;
    await student.save();

    res.json({ message: 'Journey day updated.', currentCourseDay: day });
  } catch (err) {
    console.error('go-students PATCH /:id/journey-day', err);
    res.status(500).json({ message: 'Failed to update journey day.', error: err.message });
  }
});

// ─── DELETE /api/go-students/:studentId/remove ────────────────────────────────
// Remove a student from GO batch (clear goStatus)
router.delete('/:studentId/remove', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { studentId } = req.params;
    const student = await User.findOne({ _id: studentId, role: 'STUDENT' });
    if (!student) return res.status(404).json({ message: 'Student not found.' });

    student.goStatus = undefined;
    student.goJoiningDate = null;
    await student.save();

    res.json({
      message: 'Student moved back to Silver batch.',
      student: {
        _id: student._id,
        name: student.name,
        regNo: student.regNo,
        email: student.email,
        subscription: student.subscription,
        goStatus: student.goStatus,
        goJoiningDate: student.goJoiningDate,
        currentCourseDay: student.currentCourseDay,
        batch: student.batch || '',
        level: student.level || '',
        studentStatus: student.studentStatus || ''
      }
    });
  } catch (err) {
    console.error('go-students DELETE /:id/remove', err);
    res.status(500).json({ message: 'Failed to remove student from GO batch.', error: err.message });
  }
});

// ─── GET /api/go-students/:studentId/detail ──────────────────────────────────
// Full detail for one GO student: recordings, modules, exercises, progress
router.get('/:studentId/detail', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { studentId } = req.params;

    const student = await User.findOne({ _id: studentId, role: 'STUDENT', goStatus: 'GO' })
      .select('name regNo email level batch subscription goStatus goJoiningDate currentCourseDay')
      .lean();
    if (!student) return res.status(404).json({ message: 'GO student not found.' });

    const goBatchCfg = await BatchConfig.findOne({ batchName: GO_BATCH_NAME }).select('journeyLength').lean();
    const journeyLength =
      goBatchCfg?.journeyLength >= 1 ? Math.min(Math.floor(goBatchCfg.journeyLength), 200) : 200;

    const currentDay = student.currentCourseDay || 1;

    // ── Class Recordings (manual uploads) ────────────────────────────────────
    const batchKeys = allStudentBatchStringsForContent(student);
    const batchRecFilter = batchKeys.length
      ? {
          $or: batchKeys.map((k) => ({
            batches: new RegExp(`^${String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
          }))
        }
      : {};

    const classRecordings = await ClassRecording.find({
      active: true,
      isPublished: true,
      ...batchRecFilter,
      $or: [{ plan: 'ALL' }, { plan: 'SILVER' }, { plan: 'PLATINUM' }]
    }).select('title description courseDay plan level batches uploadedBy createdAt').lean();

    // Get view counts for this student
    const recViews = await RecordingView.find({ student: studentId })
      .select('recording watchDuration lastUpdatedAt')
      .lean();
    const recViewMap = {};
    for (const v of recViews) {
      recViewMap[String(v.recording)] = { watchDuration: v.watchDuration, lastUpdatedAt: v.lastUpdatedAt };
    }

    const recordings = classRecordings.map(r => {
      const locked = r.courseDay != null && r.courseDay > currentDay;
      const viewData = recViewMap[String(r._id)];
      return {
        _id: r._id,
        title: r.title,
        courseDay: r.courseDay,
        plan: r.plan,
        level: r.level,
        locked,
        watchDuration: viewData?.watchDuration || 0,
        lastWatchedAt: viewData?.lastUpdatedAt || null,
        watched: !!viewData,
        uploadedAt: r.createdAt
      };
    });

    // ── Zoom Recordings ───────────────────────────────────────────────────────
    const goMeetings = await MeetingLink.find({
      $or: [
        { batch: new RegExp(`^${GO_BATCH_NAME}$`, 'i') },
        { plan: 'SILVER' }
      ],
      status: { $ne: 'cancelled' }
    }).select('topic startTime duration courseDay status').lean();

    const meetingIds = goMeetings.map(m => m._id);
    const zoomRecs = await ZoomRecording.find({ meetingLinkId: { $in: meetingIds }, isPublished: true })
      .select('meetingLinkId duration status publishedAt')
      .lean();

    const zoomViewMap = {};
    if (zoomRecs.length > 0) {
      const zoomViews = await ZoomRecordingView.find({
        student: studentId,
        meetingLinkId: { $in: meetingIds }
      }).select('meetingLinkId watchDuration lastUpdatedAt').lean();
      for (const v of zoomViews) {
        zoomViewMap[String(v.meetingLinkId)] = { watchDuration: v.watchDuration, lastUpdatedAt: v.lastUpdatedAt };
      }
    }

    const zoomRecordings = zoomRecs.map(zr => {
      const meeting = goMeetings.find(m => String(m._id) === String(zr.meetingLinkId));
      const locked = meeting?.courseDay != null && meeting.courseDay > currentDay;
      const viewData = zoomViewMap[String(zr.meetingLinkId)];
      return {
        _id: zr._id,
        meetingLinkId: zr.meetingLinkId,
        topic: meeting?.topic || 'Class Recording',
        courseDay: meeting?.courseDay || null,
        startTime: meeting?.startTime || null,
        duration: zr.duration,
        locked,
        watchDuration: viewData?.watchDuration || 0,
        lastWatchedAt: viewData?.lastUpdatedAt || null,
        watched: !!viewData
      };
    });

    // ── Learning Modules ──────────────────────────────────────────────────────
    const allModules = await LearningModule.find({
      isDeleted: { $ne: true },
      isActive: true,
      courseDay: { $exists: true, $ne: null }
    }).select('title level category courseDay estimatedDuration').lean();

    const moduleProgressRecords = await StudentProgress.find({ studentId })
      .select('moduleId status progressPercentage timeSpent lastAccessedAt')
      .lean();
    const modProgressMap = {};
    for (const p of moduleProgressRecords) {
      modProgressMap[String(p.moduleId)] = p;
    }

    const modules = allModules.map(m => {
      const locked = m.courseDay > currentDay;
      const progress = modProgressMap[String(m._id)];
      return {
        _id: m._id,
        title: m.title,
        level: m.level,
        category: m.category,
        courseDay: m.courseDay,
        estimatedDuration: m.estimatedDuration,
        locked,
        status: progress?.status || 'not_started',
        progressPercent: progress?.progressPercentage || 0,
        timeSpent: progress?.timeSpent || 0,
        lastAccessedAt: progress?.lastAccessedAt || null
      };
    });

    // ── Digital Exercises ─────────────────────────────────────────────────────
    const allExercises = await DigitalExercise.find({
      isDeleted: { $ne: true },
      courseDay: { $exists: true, $ne: null }
    }).select('title level category courseDay sequenceLetter').lean();

    const attempts = await ExerciseAttempt.find({ studentId })
      .select('exerciseId status scorePercentage earnedPoints totalPoints completedAt timeSpentSeconds')
      .lean();
    const attemptMap = {};
    for (const a of attempts) {
      const key = String(a.exerciseId);
      if (!attemptMap[key] || (a.completedAt > (attemptMap[key].completedAt || 0))) {
        attemptMap[key] = a;
      }
    }

    const exercises = allExercises.map(e => {
      const locked = e.courseDay > currentDay;
      const attempt = attemptMap[String(e._id)];
      return {
        _id: e._id,
        title: e.title,
        level: e.level,
        category: e.category,
        courseDay: e.courseDay,
        sequenceLetter: e.sequenceLetter,
        locked,
        attempted: !!attempt,
        status: attempt?.status || 'not_attempted',
        scorePercent: attempt?.scorePercentage || 0,
        earnedPoints: attempt?.earnedPoints || 0,
        totalPoints: attempt?.totalPoints || 0,
        completedAt: attempt?.completedAt || null
      };
    });

    // ── Progress Summary ──────────────────────────────────────────────────────
    const dayBreakdown = [];
    for (let d = 1; d <= currentDay; d++) {
      const dayExercises = exercises.filter(e => e.courseDay === d);
      const dayModules = modules.filter(m => m.courseDay === d);
      const attempted = dayExercises.filter(e => e.attempted).length;
      const completed = dayModules.filter(m => m.status === 'completed').length;
      const avgScore = dayExercises.filter(e => e.attempted).length > 0
        ? Math.round(dayExercises.filter(e => e.attempted).reduce((s, e) => s + e.scorePercent, 0) / dayExercises.filter(e => e.attempted).length)
        : 0;
      dayBreakdown.push({
        day: d,
        exercisesAttempted: attempted,
        exercisesTotal: dayExercises.length,
        modulesCompleted: completed,
        modulesTotal: dayModules.length,
        avgScore
      });
    }

    const totalExercises = exercises.length;
    const attemptedExercises = exercises.filter(e => e.attempted).length;
    const completedModules = modules.filter(m => m.status === 'completed').length;
    const totalModules = modules.length;

    res.json({
      journeyLength,
      student: {
        _id: student._id,
        name: student.name,
        regNo: student.regNo,
        email: student.email,
        level: student.level,
        subscription: student.subscription,
        goStatus: student.goStatus,
        goJoiningDate: student.goJoiningDate,
        currentDay
      },
      recordings,
      zoomRecordings,
      modules,
      exercises,
      progress: {
        currentDay,
        totalExercises,
        attemptedExercises,
        totalModules,
        completedModules,
        overallPercent: totalExercises + totalModules > 0
          ? Math.round((attemptedExercises + completedModules) / (totalExercises + totalModules) * 100)
          : 0,
        dayBreakdown
      }
    });
  } catch (err) {
    console.error('go-students GET /:id/detail', err);
    res.status(500).json({ message: 'Failed to fetch GO student detail.', error: err.message });
  }
});

module.exports = router;
