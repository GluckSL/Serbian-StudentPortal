// routes/batchJourney.js
// Journey management: per-batch config + student day control

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const BatchConfig = require('../models/BatchConfig');
const DigitalExercise = require('../models/DigitalExercise');
const MeetingLink = require('../models/MeetingLink');
const ClassRecording = require('../models/ClassRecording');
const ZoomRecording = require('../models/ZoomRecording');
const TimeTable = require('../models/TimeTable');
const Announcement = require('../models/Announcement');
const TeacherResource = require('../models/TeacherResource');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const GameSet = require('../models/GameSet');
const GameAttempt = require('../models/GameAttempt');
const SprechenExamModule = require('../models/SprechenExamModule');
const {
  computeJourneyDayCompletion,
  meetsStrictThreshold
} = require('../services/journeyDayCompletion.service');
const { verifyToken, checkRole } = require('../middleware/auth');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');
const { mergePortalBatchNames } = require('../utils/portalBatchPresets');
const { EXCLUDE_TEST, EXCLUDE_TEST_LOOKUP } = require('../utils/analyticsFilters');
const {
  withJourneyLevelInSet,
  syncJourneyLevelsForBatch,
  levelForJourneyDay
} = require('../services/journeyLevelSync.service');
const {
  BATCH_TYPE_NEW,
  BATCH_TYPE_OLD,
  normalizeBatchType,
  isValidBatchTypeInput,
  isOldBatchType,
  isLearningEnabled
} = require('../utils/batchType');
const {
  computeBatchDay,
  computeBatchDayFromCalendar,
  isNewBatchPaused,
  applyJourneyPauseToggle,
  clearJourneyPauseFields,
  journeyPauseFieldsForApi
} = require('../utils/journeyPause');

const {
  clampStandardJourneyDay,
  clampJourneyDayForBatch,
  journeyDayRangeStart,
  isValidJourneyDay,
  utcMidnightMs,
  MS_PER_DAY
} = require('../utils/journeyDay');

function clampDay(d, max = 200, trialDayEnabled = false) {
  return clampJourneyDayForBatch(d, max, trialDayEnabled);
}

function resolveCourseDay(raw, trialDayEnabled = false) {
  if (raw == null || !Number.isFinite(Number(raw))) return trialDayEnabled ? 0 : 1;
  const n = Number(raw);
  if (n === 0 && trialDayEnabled) return 0;
  return clampJourneyDayForBatch(n, 200, trialDayEnabled);
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function levelRegex(level) {
  return new RegExp(`^${escapeRegExp(String(level || 'A1').trim())}$`, 'i');
}

/** Average per-class attendance rate — matches Zoom Meeting Reports (avg of each class rate). */
function avgZoomClassAttendancePct(meetings) {
  if (!Array.isArray(meetings) || !meetings.length) return 0;
  const now = Date.now();
  let sumRates = 0;
  let meetingCount = 0;
  for (const m of meetings) {
    const startMs = m.startTime ? new Date(m.startTime).getTime() : NaN;
    const durationMin = Number(m.duration) || 0;
    if (!Number.isFinite(startMs)) continue;
    const endMs = startMs + durationMin * 60000;
    if (endMs >= now) continue;

    const totalStudents = (m.attendees || []).length;
    const attendedCount = (m.attendance || []).filter((a) => a && a.attended === true).length;
    const rate = totalStudents > 0 ? (attendedCount / totalStudents) * 100 : 0;
    sumRates += rate;
    meetingCount += 1;
  }
  if (!meetingCount) return 0;
  return Math.min(100, Math.round(sumRates / meetingCount));
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

function batchNameRegex(name) {
  return new RegExp(`^${escapeRegExp(String(name || '').trim())}$`, 'i');
}

/** Rename a batch across configs, users, and content that references batch strings. */
async function renameBatchAcrossSystem(oldName, newName) {
  const oldBn = String(oldName || '').trim();
  const newBn = String(newName || '').trim();
  if (!oldBn || !newBn) throw new Error('Both old and new batch names are required');
  if (normBatchKey(oldBn) === normBatchKey(newBn)) return { batchName: newBn, renamed: false };

  const oldRx = batchNameRegex(oldBn);
  const newRx = batchNameRegex(newBn);

  const conflictCfg = await BatchConfig.findOne({ batchName: newRx }).select('_id').lean();
  const conflictStudents = await User.exists({ role: 'STUDENT', batch: newRx });
  if (conflictCfg || conflictStudents) {
    const err = new Error(`Batch "${newBn}" already exists`);
    err.statusCode = 409;
    throw err;
  }

  const cfg = await BatchConfig.findOne({ batchName: oldRx });
  if (cfg) {
    cfg.batchName = newBn;
    await cfg.save();
  } else {
    await BatchConfig.create({ batchName: newBn });
  }

  const studentsResult = await User.updateMany(
    { role: 'STUDENT', batch: oldRx },
    { $set: { batch: newBn } }
  );

  const teachers = await User.find({
    role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
    assignedBatches: { $exists: true, $ne: [] }
  }).select('assignedBatches').lean();
  let teachersUpdated = 0;
  for (const t of teachers) {
    let changed = false;
    const updated = (t.assignedBatches || []).map((b) => {
      if (normBatchKey(b) === normBatchKey(oldBn)) {
        changed = true;
        return newBn;
      }
      return b;
    });
    if (changed) {
      await User.updateOne({ _id: t._id }, { $set: { assignedBatches: [...new Set(updated)] } });
      teachersUpdated += 1;
    }
  }

  const [meetings, timetables, resources] = await Promise.all([
    MeetingLink.updateMany({ batch: oldRx }, { $set: { batch: newBn } }),
    TimeTable.updateMany({ batch: oldRx }, { $set: { batch: newBn } }),
    TeacherResource.updateMany({ batch: oldRx }, { $set: { batch: newBn } })
  ]);

  const recordings = await ClassRecording.find({ batches: oldRx }).select('batches').lean();
  let recordingsUpdated = 0;
  for (const rec of recordings) {
    const batches = (rec.batches || []).map((b) =>
      normBatchKey(b) === normBatchKey(oldBn) ? newBn : b
    );
    await ClassRecording.updateOne({ _id: rec._id }, { $set: { batches: [...new Set(batches)] } });
    recordingsUpdated += 1;
  }

  const announcements = await Announcement.find({ targetBatches: oldRx }).select('targetBatches').lean();
  let announcementsUpdated = 0;
  for (const ann of announcements) {
    const targetBatches = (ann.targetBatches || []).map((b) =>
      normBatchKey(b) === normBatchKey(oldBn) ? newBn : b
    );
    await Announcement.updateOne({ _id: ann._id }, { $set: { targetBatches: [...new Set(targetBatches)] } });
    announcementsUpdated += 1;
  }

  const arrayBatchModels = [
    { Model: DGModule, field: 'targetBatchKeys' },
    { Model: GameSet, field: 'targetBatchKeys' },
    { Model: SprechenExamModule, field: 'targetBatchKeys' }
  ];
  let contentDocsUpdated = 0;
  for (const { Model, field } of arrayBatchModels) {
    const docs = await Model.find({ [field]: oldRx }).select(field).lean();
    for (const doc of docs) {
      const keys = (doc[field] || []).map((b) =>
        normBatchKey(b) === normBatchKey(oldBn) ? newBn : b
      );
      await Model.updateOne({ _id: doc._id }, { $set: { [field]: [...new Set(keys)] } });
      contentDocsUpdated += 1;
    }
  }

  return {
    batchName: newBn,
    renamed: true,
    studentsUpdated: studentsResult.modifiedCount,
    teachersUpdated,
    meetingsUpdated: meetings.modifiedCount,
    timetablesUpdated: timetables.modifiedCount,
    resourcesUpdated: resources.modifiedCount,
    recordingsUpdated,
    announcementsUpdated,
    contentDocsUpdated
  };
}

async function checkDayCompletion(studentId, batchNameOrNames, day, options = {}) {
  return computeJourneyDayCompletion(studentId, batchNameOrNames, day, options);
}

// ─── GET /api/batch-journey ─────────────────────────────────────────────────
// List every distinct batch from the User collection + joined BatchConfig data
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    // Batches can exist either because students are assigned to them (User.batch),
    // or because an admin created a BatchConfig before any students exist.
    const studentBatchNames = await User.distinct('batch', { role: 'STUDENT', batch: { $ne: null, $ne: '' } });
    const configBatchNames = await BatchConfig.distinct('batchName', { batchName: { $ne: null, $ne: '' } });

    let allBatchNames = mergePortalBatchNames([
      ...new Set([...(studentBatchNames || []), ...(configBatchNames || [])])
    ]);

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

    function defaultCfgForName(name) {
      return {
        batchName: name,
        journeyLength: 200,
        batchCurrentDay: 1,
        batchStartDate: null,
        strictJourneyRule: false,
        strictJourneyThresholdPercent: 100,
        trialDayEnabled: false
      };
    }

    const studentsBehindMap = {};
    allBatchNames.forEach((name) => {
      studentsBehindMap[name] = 0;
    });
    if (allBatchNames.length) {
      const batchDayCache = new Map();
      function activeDayForBatch(batchName) {
        if (batchDayCache.has(batchName)) return batchDayCache.get(batchName);
        const cfg = cfgForName(batchName) || defaultCfgForName(batchName);
        const day = computeBatchDay(cfg);
        batchDayCache.set(batchName, day);
        return day;
      }

      const studentRows = await User.find({
        role: 'STUDENT',
        batch: { $in: allBatchNames },
        ...EXCLUDE_TEST
      })
        .select('batch currentCourseDay')
        .lean();

      for (const s of studentRows) {
        const batch = s.batch;
        if (!batch) continue;
        const cfg = cfgForName(batch) || defaultCfgForName(batch);
        const trial = !!cfg.trialDayEnabled;
        const cur = resolveCourseDay(s.currentCourseDay, trial);
        const activeDay = activeDayForBatch(batch);
        if (cur < activeDay) {
          studentsBehindMap[batch] = (studentsBehindMap[batch] || 0) + 1;
        }
      }
    }

    const allRows = allBatchNames.map(name => {
      const savedCfg = cfgForName(name);
      const cfg = savedCfg || {
        batchName: name,
        journeyLength: 200,
        batchCurrentDay: 1,
        notes: '',
        batchType: BATCH_TYPE_OLD,
        oldBatchDgBotAccess: false,
        batchStartDate: null,
        strictJourneyRule: false,
        strictJourneyThresholdPercent: 100,
        autoRecordingEnabled: true,
        journeyActive: false,
        trialDayEnabled: false
      };
      const activeBatchDay = computeBatchDay(cfg);
      return {
        batchName: name,
        hasSavedConfig: !!savedCfg,
        batchLevel: levelForJourneyDay(activeBatchDay),
        journeyLength: cfg.journeyLength,
        batchCurrentDay: activeBatchDay,
        batchStartDate: cfg.batchStartDate || null,
        autoDay: !!cfg.batchStartDate,
        notes: cfg.notes || '',
        batchType: normalizeBatchType(cfg.batchType),
        oldBatchDgBotAccess: !!(cfg && cfg.oldBatchDgBotAccess),
        strictJourneyRule: !!cfg.strictJourneyRule,
        strictJourneyThresholdPercent:
          cfg.strictJourneyThresholdPercent != null ? cfg.strictJourneyThresholdPercent : 100,
        autoRecordingEnabled: !!(cfg && cfg.autoRecordingEnabled),
        journeyActive: !!(cfg && cfg.journeyActive),
        trialDayEnabled: !!(cfg && cfg.trialDayEnabled),
        trialAccessStartDate: cfg.trialAccessStartDate || null,
        ...journeyPauseFieldsForApi(cfg),
        studentCount: countMap[name] || 0,
        studentsBehindCount: studentsBehindMap[name] || 0,
        hasStudentsBehind: (studentsBehindMap[name] || 0) > 0,
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
    let activeConfigs = await BatchConfig.find({ journeyActive: true }).select('batchName trialDayEnabled').lean();
    let batchNames = activeConfigs.map((c) => String(c.batchName || '').trim()).filter(Boolean);
    const trial = activeConfigs.some((c) => !!c.trialDayEnabled);

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
        currentCourseDay: resolveCourseDay(s.currentCourseDay, trial),
        batch: s.batch,
        enrollmentDate: s.enrollmentDate || null
      }))
    });
  } catch (err) {
    console.error('batch-journey GET /active-platinum-students', err);
    res.status(500).json({ message: 'Failed to load students', error: err.message });
  }
});

// ─── GET /api/batch-journey/student/timetable ───────────────────────────────
// Automatic timetable from journey schedule (live classes, exercises, DG bot, arena).
router.get('/student/timetable', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const student = await User.findById(req.user.id)
      .select('role batch subscription medium goStatus currentCourseDay studentStatus level')
      .lean();
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    const { buildStudentJourneyTimetable } = require('../services/studentJourneyTimetable.service');
    const horizonDays = parseInt(String(req.query.horizonDays || '14'), 10);
    const payload = await buildStudentJourneyTimetable(student, { horizonDays });
    res.json({ success: true, ...payload });
  } catch (err) {
    console.error('batch-journey GET /student/timetable', err);
    res.status(500).json({ message: 'Failed to load journey timetable', error: err.message });
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
    const batchRx = batchNameRegex(batchName);
    await syncJourneyLevelsForBatch(batchRx);
    const students = await User.find({ role: 'STUDENT', batch: batchRx })
      .select('name regNo email level studentStatus currentCourseDay enrollmentDate createdAt isTestAccount batch')
      .sort({ name: 1 })
      .lean();

    // most common assigned teacher for this batch
    const teacherAgg = await User.aggregate([
      { $match: { role: 'STUDENT', batch: batchRx, assignedTeacher: { $ne: null } } },
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
    const trial = !!cfg.trialDayEnabled;

    res.json({
      batchName,
      config: {
        journeyLength: cfg.journeyLength,
        batchCurrentDay: activeBatchDay,
        batchStartDate: cfg.batchStartDate || null,
        autoDay: !!cfg.batchStartDate,
        notes: cfg.notes,
        batchType: normalizeBatchType(cfg.batchType),
        oldBatchDgBotAccess: !!cfg.oldBatchDgBotAccess,
        trialDayEnabled: trial,
        trialAccessStartDate: cfg.trialAccessStartDate || null,
        strictJourneyRule: !!cfg.strictJourneyRule,
        strictJourneyThresholdPercent:
          cfg.strictJourneyThresholdPercent != null ? cfg.strictJourneyThresholdPercent : 100,
        autoRecordingEnabled: !!cfg.autoRecordingEnabled,
        ...journeyPauseFieldsForApi(cfg)
      },
      teacher: { teacherId, teacherName },
      students: students.map(s => ({
        _id: s._id,
        name: s.name,
        regNo: s.regNo,
        email: s.email,
        level: s.level,
        studentStatus: s.studentStatus,
        currentCourseDay: resolveCourseDay(s.currentCourseDay, trial),
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
    const dayStart = journeyDayRangeStart(!!cfg.trialDayEnabled);
    const [exercises, classes, recordings, zoomRecordings] = await Promise.all([
      DigitalExercise.find({ isDeleted: { $ne: true }, courseDay: { $gte: dayStart, $lte: length } })
        .select('title category level courseDay').sort({ courseDay: 1 }).lean(),
      MeetingLink.find({ batch: batchRegex, courseDay: { $gte: dayStart, $lte: length }, status: { $ne: 'cancelled' } })
        .select('topic batch courseDay startTime duration').sort({ courseDay: 1 }).lean(),
      ClassRecording.find({
        active: true,
        courseDay: { $gte: dayStart, $lte: length },
        batches: batchRegex
      })
        .select('title level plan courseDay batches isPublished').sort({ courseDay: 1 }).lean(),
      ZoomRecording.find({
        status: 'ready',
        accessBatches: batchRegex,
        $or: [
          { r2Key: { $exists: true, $nin: [null, ''] } },
          { hlsKey: { $exists: true, $nin: [null, ''] } }
        ]
      })
        .select('meetingLinkId accessLevel accessPlan isPublished')
        .lean()
    ]);

    const timeline = {};
    for (let d = dayStart; d <= length; d++) {
      timeline[d] = { day: d, exercises: [], classes: [], recordings: [] };
    }
    exercises.forEach(e => {
      if (e.courseDay != null && timeline[e.courseDay]) timeline[e.courseDay].exercises.push({ _id: e._id, title: e.title, category: e.category, level: e.level });
    });
    classes.forEach(c => {
      if (c.courseDay != null && timeline[c.courseDay]) timeline[c.courseDay].classes.push({ _id: c._id, topic: c.topic, batch: c.batch, startTime: c.startTime, duration: c.duration });
    });
    recordings.forEach(rec => {
      if (rec.courseDay != null && timeline[rec.courseDay]) {
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

    if (zoomRecordings.length) {
      const zoomMeetingIds = zoomRecordings.map((z) => z.meetingLinkId).filter(Boolean);
      const zoomMeetings = await MeetingLink.find({
        _id: { $in: zoomMeetingIds },
        courseDay: { $gte: dayStart, $lte: length }
      })
        .select('topic courseDay')
        .lean();
      const zoomByMeetingId = new Map(
        zoomRecordings.map((z) => [String(z.meetingLinkId), z])
      );
      zoomMeetings.forEach((meeting) => {
        const zoom = zoomByMeetingId.get(String(meeting._id));
        if (!zoom || meeting.courseDay == null || !timeline[meeting.courseDay]) return;
        timeline[meeting.courseDay].recordings.push({
          _id: `zoom-${meeting._id}`,
          title: meeting.topic || 'Zoom Class Recording',
          level: zoom.accessLevel || '',
          plan: zoom.accessPlan || 'ALL',
          courseDay: meeting.courseDay,
          isPublished: zoom.isPublished !== false
        });
      });
    }

    const days = Object.values(timeline).filter(
      d => d.day <= length && (d.exercises.length || d.classes.length || d.recordings.length || d.day === activeBatchDay)
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
      oldBatchDgBotAccess,
      createOnly,
      strictJourneyRule,
      strictJourneyThresholdPercent,
      autoRecordingEnabled,
      journeyActive,
      journeyPaused,
      trialDayEnabled,
      trialAccessStartDate,
      newBatchName
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

    let effectiveBatchName = cfg.batchName;
    if (newBatchName !== undefined && String(newBatchName).trim()) {
      const renameResult = await renameBatchAcrossSystem(cfg.batchName, String(newBatchName).trim());
      effectiveBatchName = renameResult.batchName;
      cfg = await BatchConfig.findOne({ batchName: batchNameRegex(effectiveBatchName) });
      if (!cfg) return res.status(500).json({ message: 'Failed to load batch after rename' });
    }

    if (journeyLength !== undefined) {
      cfg.journeyLength = Math.min(200, Math.max(1, clampDay(journeyLength)));
    }
    if (trialDayEnabled !== undefined) {
      cfg.trialDayEnabled = !!trialDayEnabled;
      if (!cfg.trialDayEnabled) {
        cfg.trialAccessStartDate = null;
      }
      if (cfg.batchStartDate) {
        cfg.batchCurrentDay = computeBatchDay(cfg);
      }
    }
    if (trialAccessStartDate !== undefined) {
      if (!trialAccessStartDate || trialAccessStartDate === '') {
        cfg.trialAccessStartDate = null;
      } else {
        const parsedTrial = new Date(trialAccessStartDate);
        if (isNaN(parsedTrial.getTime())) {
          return res.status(400).json({ message: 'Invalid trialAccessStartDate' });
        }
        cfg.trialAccessStartDate = parsedTrial;
      }
      if (cfg.batchStartDate) {
        cfg.batchCurrentDay = computeBatchDay(cfg);
      }
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
      const minDay = cfg.trialDayEnabled ? 0 : 1;
      cfg.batchCurrentDay = Math.min(cfg.journeyLength, Math.max(minDay, clampDay(batchCurrentDay, cfg.journeyLength, !!cfg.trialDayEnabled)));
    }
    if (notes !== undefined) {
      cfg.notes = String(notes).substring(0, 500);
    }
    if (batchType !== undefined) {
      if (!isValidBatchTypeInput(batchType)) {
        return res.status(400).json({ message: 'batchType must be "new" or "old"' });
      }
      cfg.batchType = normalizeBatchType(batchType);
      if (!isOldBatchType(cfg.batchType)) {
        cfg.oldBatchDgBotAccess = false;
      } else {
        clearJourneyPauseFields(cfg);
      }
    }
    if (oldBatchDgBotAccess !== undefined) {
      if (isOldBatchType(cfg.batchType)) {
        cfg.oldBatchDgBotAccess = !!oldBatchDgBotAccess;
      } else {
        cfg.oldBatchDgBotAccess = false;
      }
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
    if (strictJourneyRule !== undefined || strictJourneyThresholdPercent !== undefined) {
      if (cfg.strictJourneyRule && (cfg.strictJourneyThresholdPercent == null || cfg.strictJourneyThresholdPercent < 1)) {
        cfg.strictJourneyThresholdPercent = 100;
      }
    }
    if (autoRecordingEnabled !== undefined) {
      cfg.autoRecordingEnabled = !!autoRecordingEnabled;
    }
    if (journeyActive !== undefined) {
      cfg.journeyActive = !!journeyActive;
    }
    if (journeyPaused !== undefined) {
      if (!isLearningEnabled(cfg.batchType)) {
        clearJourneyPauseFields(cfg);
      } else {
        applyJourneyPauseToggle(cfg, !!journeyPaused);
      }
    }
    await cfg.save();

    const activeBatchDay = computeBatchDay(cfg);
    res.json({
      message: createOnly ? 'Batch created' : 'Batch config updated',
      batchName: effectiveBatchName,
      config: {
        ...cfg.toObject(),
        batchName: effectiveBatchName,
        batchType: normalizeBatchType(cfg.batchType),
        oldBatchDgBotAccess: !!cfg.oldBatchDgBotAccess,
        batchCurrentDay: activeBatchDay,
        autoDay: !!cfg.batchStartDate,
        journeyActive: !!cfg.journeyActive,
        ...journeyPauseFieldsForApi(cfg)
      }
    });
  } catch (err) {
    console.error('batch-journey PUT /:batch', err);
    res.status(500).json({ message: 'Failed to update config', error: err.message });
  }
});

// ─── POST /api/batch-journey/:batchName/set-day ──────────────────────────────
// Push all students to a journey day and align batch config (manual or auto schedule).
router.post('/:batchName/set-day', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { batchName } = req.params;
    const { day } = req.body;
    if (day === undefined || day === null) return res.status(400).json({ message: 'day is required' });

    const cfg = await getOrCreateConfig(batchName);
    const targetDay = clampDay(day, cfg.journeyLength, !!cfg.trialDayEnabled);
    if (targetDay > cfg.journeyLength) {
      return res.status(400).json({ message: `day (${targetDay}) exceeds journeyLength (${cfg.journeyLength})` });
    }

    if (cfg.batchStartDate) {
      const calendarDay = computeBatchDayFromCalendar(cfg);
      const dayShift = calendarDay - targetDay;
      if (dayShift !== 0) {
        const startUTC = utcMidnightMs(new Date(cfg.batchStartDate));
        cfg.batchStartDate = new Date(startUTC + dayShift * MS_PER_DAY);
      }
      cfg.batchCurrentDay = targetDay;
    } else {
      cfg.batchCurrentDay = targetDay;
    }

    if (isNewBatchPaused(cfg)) {
      cfg.journeyPausedFrozenDay = targetDay;
    }

    await cfg.save();

    const result = await User.updateMany(
      { role: 'STUDENT', batch: batchName },
      {
        $set: withJourneyLevelInSet(
          targetDay,
          {
            currentCourseDay: targetDay,
            pendingJourneyDayAdvance: false,
            pendingJourneyDayAdvanceForDay: null
          },
          { force: true }
        )
      }
    );

    const activeBatchDay = computeBatchDay(cfg);
    res.json({
      message: `Batch "${batchName}" set to day ${targetDay}`,
      batchCurrentDay: activeBatchDay,
      studentsUpdated: result.modifiedCount,
      config: {
        batchStartDate: cfg.batchStartDate,
        batchCurrentDay: activeBatchDay,
        journeyPausedFrozenDay: cfg.journeyPausedFrozenDay,
        ...journeyPauseFieldsForApi(cfg)
      }
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

    const stBatchCfg = student.batch
      ? await BatchConfig.findOne({ batchName: batchNameRegex(student.batch) }).select('trialDayEnabled').lean()
      : null;
    const studentTrial = !!stBatchCfg?.trialDayEnabled;
    const dayStart = journeyDayRangeStart(studentTrial);

    const day = resolveCourseDay(student.currentCourseDay, studentTrial);
    const batchKeys = allStudentBatchStringsForContent(student);
    const { primaryGoBatchFromKeys } = require('../utils/goSilverTrack');
    const cfgBatch = primaryGoBatchFromKeys(batchKeys) || batchKeys[0];
    const batchCfg =
      cfgBatch
        ? await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(cfgBatch)}$`, 'i') }).lean()
        : null;
    const result = await checkDayCompletion(student._id, batchKeys, day, {
      includeDg: batchCfg?.batchType === 'new',
      goStatus: student.goStatus,
      subscription: student.subscription
    });
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
      .select('name regNo batch currentCourseDay goStatus subscription level').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const batchKeys = allStudentBatchStringsForContent(student);
    if (!batchKeys.length) {
      return res.status(400).json({ message: 'Student has no batch assigned; cannot advance journey day.' });
    }
    const { primaryGoBatchFromKeys } = require('../utils/goSilverTrack');
    const cfgBatch = primaryGoBatchFromKeys(batchKeys) || batchKeys[0];
    const cfg = await getOrCreateConfig(cfgBatch);
    const stBatchCfg = student.batch
      ? await BatchConfig.findOne({ batchName: batchNameRegex(student.batch) }).select('trialDayEnabled').lean()
      : null;
    const currentDay = resolveCourseDay(student.currentCourseDay, !!stBatchCfg?.trialDayEnabled);

    if (currentDay >= cfg.journeyLength) {
      return res.json({ advanced: false, message: 'Student has already completed the journey.', currentDay });
    }

    const completion = await checkDayCompletion(student._id, batchKeys, currentDay, {
      includeDg: cfg.batchType === 'new',
      goStatus: student.goStatus,
      subscription: student.subscription,
      studentLevel: student.level
    });

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
      $set: withJourneyLevelInSet(
        nextDay,
        {
          currentCourseDay: nextDay,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        },
        { student }
      )
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

    const existing = await User.findOne({ _id: studentId, role: 'STUDENT' })
      .select('goStatus batch subscription level')
      .lean();
    if (!existing) return res.status(404).json({ message: 'Student not found' });

    const batchName = String(existing.batch || '').trim();
    let trialDayEnabled = false;
    let maxDay = 200;
    if (batchName) {
      const cfg = await BatchConfig.findOne({ batchName })
        .select('trialDayEnabled journeyLength')
        .lean();
      if (cfg) {
        trialDayEnabled = !!cfg.trialDayEnabled;
        maxDay =
          cfg.journeyLength >= 1 ? Math.min(Math.floor(cfg.journeyLength), 200) : 200;
      }
    }

    const minDay = journeyDayRangeStart(trialDayEnabled);
    const n = Math.floor(Number(day));
    if (!Number.isFinite(n) || n < minDay || n > maxDay) {
      return res.status(400).json({
        message: trialDayEnabled
          ? `day must be between 0 (Trial) and ${maxDay}`
          : `day must be between 1 and ${maxDay}`
      });
    }

    const targetDay = clampDay(n, maxDay, trialDayEnabled);

    const student = await User.findOneAndUpdate(
      { _id: studentId, role: 'STUDENT' },
      {
        $set: withJourneyLevelInSet(
          targetDay,
          {
            currentCourseDay: targetDay,
            pendingJourneyDayAdvance: false,
            pendingJourneyDayAdvanceForDay: null
          },
          { student: existing }
        )
      },
      { new: true, select: 'name regNo batch currentCourseDay level' }
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

    let exerciseCompletionPercent = 0;
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

    res.json({
      day: dayNum,
      liveClasses,
      exerciseCount: exIds.length,
      exerciseCompletionPercent
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
    const batchCfg = await BatchConfig.findOne({ batchName: batchRegex })
      .select('trialDayEnabled batchCurrentDay batchStartDate journeyLength')
      .lean();
    const trial = !!batchCfg?.trialDayEnabled;
    const activeBatchDay = computeBatchDay(batchCfg || {});
    const batchLevel = levelForJourneyDay(activeBatchDay);
    const lvRx = levelRegex(batchLevel);
    const metricsScope = String(req.query.metricsScope || 'current').trim().toLowerCase();
    const scopeAll = metricsScope === 'all';

    // All students in batch (test accounts excluded from analytics)
    const students = await User.find({ batch: batchRegex, role: 'STUDENT', ...EXCLUDE_TEST })
      .select('_id name regNo email level currentCourseDay').lean();

    if (!students.length) {
      return res.json({ overall: { totalStudents: 0, avgScorePercent: 0, totalExercisesCompleted: 0, totalClassesAttended: 0, avgDayReached: 0 }, daily: [], weekly: [], students: [] });
    }

    const studentIds = students.map(s => s._id);

    // ── Fast path: overall + per-student rows only (no populate, no per-attempt documents) ──
    if (!includeDaily) {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      const DigitalExercise = require('../models/DigitalExercise');
      const { totalSessionMinutes } = require('../utils/dgSessionMetrics');
      const MAX_ATTEMPT_SECONDS = 900; // cap per attempt (15 min) – mirrors language tracking

      // Compute avg student day FIRST so we can query exercise counts correctly
      const avgStudentDay = Math.round(
        students.reduce((sum, s) => sum + resolveCourseDay(s.currentCourseDay, trial), 0) / students.length
      ) || 1;

      const exMetaFilter = scopeAll ? { isDeleted: { $ne: true } } : { level: lvRx, isDeleted: { $ne: true } };
      const modMetaFilter = scopeAll ? {} : { level: lvRx };
      const gsMetaFilter = scopeAll ? {} : { level: lvRx };
      const exAvailableFilter = {
        isDeleted: { $ne: true },
        visibleToStudents: true,
        isActive: true,
        courseDay: { $gte: 1, $lte: avgStudentDay },
        ...(scopeAll ? {} : { level: lvRx }),
      };

      const [levelExerciseIds, levelModuleIds, levelGameSetIds] = await Promise.all([
        DigitalExercise.find(exMetaFilter).distinct('_id'),
        DGModule.find(modMetaFilter).distinct('_id'),
        GameSet.find(gsMetaFilter).distinct('_id'),
      ]);

      const exAttemptMatch = scopeAll
        ? { studentId: { $in: studentIds }, status: 'completed' }
        : { studentId: { $in: studentIds }, status: 'completed', exerciseId: { $in: levelExerciseIds } };
      const dgSessionMatch = scopeAll
        ? { studentId: { $in: studentIds }, completed: true }
        : { studentId: { $in: studentIds }, completed: true, moduleId: { $in: levelModuleIds } };
      const dgWeekMatch = scopeAll
        ? { studentId: { $in: studentIds }, createdAt: { $gte: weekAgo } }
        : { studentId: { $in: studentIds }, createdAt: { $gte: weekAgo }, moduleId: { $in: levelModuleIds } };
      const arenaMatch = scopeAll
        ? { studentId: { $in: studentIds }, status: 'completed' }
        : { studentId: { $in: studentIds }, status: 'completed', gameSetId: { $in: levelGameSetIds } };
      const exTimeMatch = scopeAll
        ? { studentId: { $in: studentIds }, status: 'completed', startedAt: { $gte: weekAgo } }
        : { studentId: { $in: studentIds }, status: 'completed', startedAt: { $gte: weekAgo }, exerciseId: { $in: levelExerciseIds } };
      const arenaTimeMatch = scopeAll
        ? { studentId: { $in: studentIds }, startedAt: { $gte: weekAgo } }
        : { studentId: { $in: studentIds }, startedAt: { $gte: weekAgo }, gameSetId: { $in: levelGameSetIds } };

      const [
        distinctExAgg,
        scoreAgg,
        totalExAvailable,
        meetingsLean,
        distinctDgAgg,
        dgWeekSessions,
        arenaAgg,
        exTimeAgg,
        arenaTimeAgg,
      ] = await Promise.all([
        ExerciseAttempt.aggregate([
          { $match: exAttemptMatch },
          { $group: { _id: { studentId: '$studentId', exerciseId: '$exerciseId' } } },
          { $group: { _id: '$_id.studentId', count: { $sum: 1 } } }
        ]),
        ExerciseAttempt.aggregate([
          { $match: exAttemptMatch },
          {
            $group: {
              _id: '$studentId',
              totalScore: { $sum: { $cond: [{ $ne: ['$scorePercentage', null] }, '$scorePercentage', 0] } },
              scoreCount: { $sum: { $cond: [{ $ne: ['$scorePercentage', null] }, 1, 0] } }
            }
          }
        ]),
        DigitalExercise.countDocuments(exAvailableFilter),
        MeetingLink.find({ batch: batchRegex, status: { $ne: 'cancelled' } })
          .select('attendance attendees startTime duration')
          .lean(),
        DGSession.aggregate([
          { $match: dgSessionMatch },
          { $group: { _id: { studentId: '$studentId', moduleId: '$moduleId' } } },
          { $group: { _id: '$_id.studentId', count: { $sum: 1 } } }
        ]),
        DGSession.find(dgWeekMatch).select('studentId timePerSceneMs logs completed').lean(),
        GameAttempt.aggregate([
          { $match: arenaMatch },
          { $group: { _id: '$studentId', count: { $sum: 1 } } }
        ]),
        ExerciseAttempt.aggregate([
          { $match: exTimeMatch },
          {
            $group: {
              _id: '$studentId',
              seconds: { $sum: { $min: ['$timeSpentSeconds', MAX_ATTEMPT_SECONDS] } }
            }
          }
        ]),
        GameAttempt.aggregate([
          { $match: arenaTimeMatch },
          { $group: { _id: '$studentId', seconds: { $sum: '$timeSpentSeconds' } } }
        ]),
      ]);

      // Build per-student lookup maps
      const studentExMap = {};
      students.forEach(s => { studentExMap[String(s._id)] = { count: 0, totalScore: 0, scoreCount: 0 }; });
      for (const row of (distinctExAgg || [])) {
        const sid = String(row._id);
        if (studentExMap[sid]) studentExMap[sid].count = row.count || 0;
      }
      for (const row of (scoreAgg || [])) {
        const sid = String(row._id);
        if (studentExMap[sid]) {
          studentExMap[sid].totalScore = row.totalScore || 0;
          studentExMap[sid].scoreCount = row.scoreCount || 0;
        }
      }

      const studentAttendanceMap = {};
      students.forEach(s => { studentAttendanceMap[String(s._id)] = 0; });
      meetingsLean.forEach(m => {
        (m.attendance || []).forEach(a => {
          const sid = String(a.studentId || a.userId || '');
          if (studentAttendanceMap[sid] !== undefined && a.attended) studentAttendanceMap[sid] += 1;
        });
      });

      const studentDgMap = {};
      students.forEach(s => { studentDgMap[String(s._id)] = 0; });
      for (const row of (distinctDgAgg || [])) {
        const sid = String(row._id);
        if (studentDgMap[sid] !== undefined) studentDgMap[sid] = row.count || 0;
      }

      const studentArenaMap = {};
      students.forEach(s => { studentArenaMap[String(s._id)] = 0; });
      for (const row of (arenaAgg || [])) {
        const sid = String(row._id);
        if (studentArenaMap[sid] !== undefined) studentArenaMap[sid] = row.count || 0;
      }

      // ── Weekly engagement time (Exercises + DG Bot + Arena) ───────────────────
      const exTimeMap = {};
      for (const row of (exTimeAgg || [])) exTimeMap[String(row._id)] = row.seconds || 0;
      const arTimeMap = {};
      for (const row of (arenaTimeAgg || [])) arTimeMap[String(row._id)] = row.seconds || 0;
      const dgTimeMap = {};
      for (const s of (dgWeekSessions || [])) {
        const sid = String(s.studentId);
        const secs = totalSessionMinutes(s) * 60;
        dgTimeMap[sid] = (dgTimeMap[sid] || 0) + secs;
      }
      const TARGET_WEEKLY_SECONDS = 360 * 60; // 6 hours
      let totalEngagementSeconds = 0;
      let studentsOnTarget = 0;
      for (const s of students) {
        const sid = String(s._id);
        const secs = (exTimeMap[sid] || 0) + (dgTimeMap[sid] || 0) + (arTimeMap[sid] || 0);
        totalEngagementSeconds += secs;
        if (secs >= TARGET_WEEKLY_SECONDS) studentsOnTarget++;
      }
      const avgWeeklyMinutesPerStudent = students.length
        ? Math.round(totalEngagementSeconds / students.length / 60) : 0;
      const engagementPct = Math.min(100, Math.round((totalEngagementSeconds / students.length / TARGET_WEEKLY_SECONDS) * 100)) || 0;

      const studentSummaries = students.map(s => {
        const sid = String(s._id);
        const ex = studentExMap[sid];
        return {
          _id: s._id,
          name: s.name,
          regNo: s.regNo,
          level: s.level,
          currentDay: resolveCourseDay(s.currentCourseDay, trial),
          avgScore: ex.scoreCount ? Math.round(ex.totalScore / ex.scoreCount) : 0,
          exercisesDone: ex.count,
          classesAttended: studentAttendanceMap[sid] || 0,
          dgBotDone: studentDgMap[sid] || 0,
          arenaDone: studentArenaMap[sid] || 0
        };
      });

      const totalExercisesCompleted = studentSummaries.reduce((a, s) => a + s.exercisesDone, 0);
      const totalClassesAttended  = studentSummaries.reduce((a, s) => a + s.classesAttended, 0);
      const totalDgBotCompleted   = studentSummaries.reduce((a, s) => a + s.dgBotDone, 0);
      const totalArenaCompleted   = studentSummaries.reduce((a, s) => a + s.arenaDone, 0);

      // ── Accurate completion rates ──────────────────────────────────────────────
      // Exercises: distinct completed / (totalExAvailable × students)
      const exExpected = (totalExAvailable || 0) * students.length;
      const exerciseCompletionPct = exExpected > 0
        ? Math.min(100, Math.round((totalExercisesCompleted / exExpected) * 100))
        : 0;

      // DG: distinct modules per student / expected (1 module per 2 journey days each)
      const dgRatePct = (() => {
        let done = 0, expected = 0;
        for (const s of studentSummaries) {
          const day = Math.max(1, s.currentDay);
          done += s.dgBotDone;
          expected += Math.max(1, Math.ceil(day / 2));
        }
        return expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : 0;
      })();

      // Arena: plays / expected (1 per 5 days each)
      const arenaRatePct = (() => {
        let done = 0, expected = 0;
        for (const s of studentSummaries) {
          const day = Math.max(1, s.currentDay);
          done += s.arenaDone;
          expected += Math.max(1, Math.ceil(day / 5));
        }
        return expected > 0 ? Math.min(100, Math.round((done / expected) * 100)) : 0;
      })();

      // Classes %: avg per-class attendance rate (same as Zoom Meeting Reports)
      const classAttendancePct = avgZoomClassAttendancePct(meetingsLean);

      const scoredStudents = studentSummaries.filter(s => s.avgScore > 0);
      const avgScorePercent = scoredStudents.length ? Math.round(scoredStudents.reduce((a, s) => a + s.avgScore, 0) / scoredStudents.length) : 0;
      const avgDayReached = studentSummaries.length ? Math.round(studentSummaries.reduce((a, s) => a + s.currentDay, 0) / studentSummaries.length) : 0;

      return res.json({
        overall: {
          totalStudents: students.length,
          batchLevel,
          batchCurrentDay: activeBatchDay,
          metricsScope: scopeAll ? 'all' : 'current',
          avgScorePercent,
          totalExercisesCompleted,
          totalClassesAttended,
          avgDayReached,
          totalDgBotCompleted,
          totalArenaCompleted,
          classAttendancePct,
          exerciseCompletionPct,
          dgBotCompletionPct: dgRatePct,
          arenaEngagementPct: arenaRatePct,
          avgWeeklyMinutesPerStudent,
          engagementPct,
          studentsOnTarget
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
        currentDay: resolveCourseDay(s.currentCourseDay, trial),
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

    const dayStart = journeyDayRangeStart(trial);

    // --- Daily breakdown ---
    const maxDay = Math.max(
      ...students.map((s) => (s.currentCourseDay != null ? s.currentCourseDay : dayStart)),
      dayStart
    );
    const dailyMap = {};
    /** Unique students who attended ≥1 live class on that journey day (for charts: reached vs joined) */
    const liveUniqueByDay = {};
    for (let d = dayStart; d <= maxDay; d++) {
      dailyMap[d] = { day: d, studentsCompleted: 0, totalScore: 0, scoreCount: 0, classesHeld: 0, classesAttended: 0 };
      liveUniqueByDay[d] = new Set();
    }

    // Students who reached or passed each day
    students.forEach(s => {
      const reached = s.currentCourseDay != null ? s.currentCourseDay : dayStart;
      for (let d = dayStart; d <= reached && d <= maxDay; d++) {
        if (dailyMap[d]) dailyMap[d].studentsCompleted += 1;
      }
    });

    // Average score per day from attempts
    attempts.forEach(a => {
      const day = a.exerciseId?.courseDay;
      if (day != null && dailyMap[day] && a.scorePercentage !== undefined) {
        dailyMap[day].totalScore += a.scorePercentage;
        dailyMap[day].scoreCount += 1;
      }
    });

    meetings.forEach(m => {
      const day = m.courseDay;
      if (day != null && dailyMap[day]) {
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
      courseDay: { $gte: dayStart, $lte: maxDay },
      isDeleted: { $ne: true },
      visibleToStudents: true,
      isActive: true
    }).select('_id courseDay').lean();

    const exercisesByDay = {};
    exForDays.forEach((ex) => {
      const day = ex.courseDay;
      if (!day || !dailyMap[day]) return;
      if (!exercisesByDay[day]) exercisesByDay[day] = [];
      exercisesByDay[day].push(ex._id);
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

    const nStud = students.length;

    const daily = Object.values(dailyMap).map((d) => {
      const exIds = exercisesByDay[d.day] || [];
      let exerciseCompletionPercent = 0;
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
      const liveUniqueJoined = liveUniqueByDay[d.day] ? liveUniqueByDay[d.day].size : 0;
      return {
        day: d.day,
        studentsCompleted: d.studentsCompleted,
        avgScore: d.scoreCount ? Math.round(d.totalScore / d.scoreCount) : 0,
        classesHeld: d.classesHeld,
        classesAttended: d.classesAttended,
        liveUniqueJoined,
        exerciseCount: exIds.length,
        exerciseCompletionPercent,
        exerciseSlotsFilled,
        exerciseSlotsTotal
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

// ─── GET /api/batch-journey/:batchName/progress/week/:week/students ───────────
// Per-student weekly detail rows for "View more" page.
router.get('/:batchName/progress/week/:week/students', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const bn = String(req.params.batchName || '').trim();
    const week = parseInt(String(req.params.week || ''), 10);
    if (!bn) return res.status(400).json({ message: 'batchName is required' });
    if (!Number.isFinite(week) || week < 1) return res.status(400).json({ message: 'week must be >= 1' });
    if (!(await teacherCanAccessBatch(req, bn))) {
      return res.status(403).json({ message: 'You do not have access to this batch.' });
    }

    const dayStart = (week - 1) * 7 + 1;
    const dayEnd = week * 7;
    const batchRegex = new RegExp(`^${escapeRegExp(bn)}$`, 'i');

    const students = await User.find({ batch: batchRegex, role: 'STUDENT', ...EXCLUDE_TEST })
      .select('_id name regNo email level currentCourseDay')
      .lean();

    if (!students.length) {
      return res.json({ week, dayStart, dayEnd, rows: [] });
    }

    const studentIds = students.map((s) => s._id);
    const [weekExercises, weekMeetings, weekDgModules] = await Promise.all([
      DigitalExercise.find({
        courseDay: { $gte: dayStart, $lte: dayEnd },
        isDeleted: { $ne: true },
        visibleToStudents: true,
        isActive: true
      }).select('_id title courseDay').lean(),
      MeetingLink.find({
        batch: batchRegex,
        status: { $ne: 'cancelled' },
        courseDay: { $gte: dayStart, $lte: dayEnd }
      }).select('_id topic courseDay attendance').lean(),
      DGModule.find({
        courseDay: { $gte: dayStart, $lte: dayEnd },
        visibleToStudents: true,
        isActive: true
      }).select('_id title courseDay').lean()
    ]);

    const exerciseIds = weekExercises.map((e) => e._id);
    const dgModuleIds = weekDgModules.map((m) => m._id);
    const classTotalForWeek = weekMeetings.length;
    const exerciseTotalForWeek = weekExercises.length;
    const dgBotTotalForWeek = weekDgModules.length;
    const exerciseTitleById = {};
    weekExercises.forEach((e) => { exerciseTitleById[String(e._id)] = e.title || 'Untitled'; });
    const classTopicById = {};
    weekMeetings.forEach((m) => { classTopicById[String(m._id)] = m.topic || 'Live class'; });
    const dgTitleById = {};
    weekDgModules.forEach((m) => { dgTitleById[String(m._id)] = m.title || 'DG Module'; });

    const [exerciseAttempts, dgSessions] = await Promise.all([
      exerciseIds.length
        ? ExerciseAttempt.find({
          studentId: { $in: studentIds },
          exerciseId: { $in: exerciseIds },
          status: 'completed'
        }).select('studentId exerciseId scorePercentage').lean()
        : [],
      dgModuleIds.length
        ? DGSession.find({
          studentId: { $in: studentIds },
          moduleId: { $in: dgModuleIds },
          completed: true
        }).select('studentId moduleId score').lean()
        : []
    ]);

    const byStudent = {};
    students.forEach((s) => {
      byStudent[String(s._id)] = {
        _id: s._id,
        name: s.name,
        regNo: s.regNo,
        email: s.email,
        level: s.level,
        currentDay: resolveCourseDay(s.currentCourseDay, trial),
        classesAttended: 0,
        classTopics: new Set(),
        exercisesDone: 0,
        exerciseScoreTotal: 0,
        exerciseScoreCount: 0,
        exerciseTitles: new Set(),
        dgBotCompleted: 0,
        dgBotScoreTotal: 0,
        dgBotScoreCount: 0,
        dgBotTitles: new Set()
      };
    });

    weekMeetings.forEach((m) => {
      (m.attendance || []).forEach((a) => {
        const sid = String(a.studentId || a.userId || '');
        if (!sid || !byStudent[sid] || !a.attended) return;
        byStudent[sid].classesAttended += 1;
        byStudent[sid].classTopics.add(classTopicById[String(m._id)] || 'Live class');
      });
    });

    exerciseAttempts.forEach((a) => {
      const sid = String(a.studentId || '');
      if (!sid || !byStudent[sid]) return;
      byStudent[sid].exercisesDone += 1;
      byStudent[sid].exerciseTitles.add(exerciseTitleById[String(a.exerciseId)] || 'Exercise');
      if (a.scorePercentage !== null && a.scorePercentage !== undefined) {
        byStudent[sid].exerciseScoreTotal += a.scorePercentage;
        byStudent[sid].exerciseScoreCount += 1;
      }
    });

    dgSessions.forEach((s) => {
      const sid = String(s.studentId || '');
      if (!sid || !byStudent[sid]) return;
      byStudent[sid].dgBotCompleted += 1;
      byStudent[sid].dgBotTitles.add(dgTitleById[String(s.moduleId)] || 'DG Module');
      if (s.score !== null && s.score !== undefined) {
        byStudent[sid].dgBotScoreTotal += s.score;
        byStudent[sid].dgBotScoreCount += 1;
      }
    });

    const rows = students.map((s) => {
      const row = byStudent[String(s._id)];
      const attemptedSet = new Set(row.exerciseTitles || []);
      const attemptedExerciseTitles = Array.from(attemptedSet);
      const notAttemptedExerciseTitles = weekExercises
        .map((ex) => ex.title || 'Untitled')
        .filter((title) => !attemptedSet.has(title));
      return {
        _id: row._id,
        name: row.name,
        regNo: row.regNo,
        email: row.email,
        level: row.level || '—',
        currentDay: row.currentDay,
        classesAttended: row.classesAttended,
        classesTotal: classTotalForWeek,
        classTopics: Array.from(row.classTopics),
        exercisesDone: attemptedExerciseTitles.length,
        exercisesTotal: exerciseTotalForWeek,
        exerciseAvgScore: row.exerciseScoreCount ? Math.round(row.exerciseScoreTotal / row.exerciseScoreCount) : 0,
        attemptedExerciseTitles,
        notAttemptedExerciseTitles,
        dgBotCompleted: row.dgBotCompleted,
        dgBotTotal: dgBotTotalForWeek,
        dgBotAvgScore: row.dgBotScoreCount ? Math.round(row.dgBotScoreTotal / row.dgBotScoreCount) : 0,
        dgBotTitles: Array.from(row.dgBotTitles)
      };
    });

    res.json({ week, dayStart, dayEnd, rows });
  } catch (err) {
    console.error('batch-journey GET /:batchName/progress/week/:week/students', err);
    res.status(500).json({ message: 'Failed to fetch weekly student details', error: err.message });
  }
});

// ─── GET /api/batch-journey/student/:studentId/full-progress ─────────────────
// Full detailed progress for one student: exercises + Q&A, live classes, day breakdown
router.get('/student/:studentId/full-progress', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { studentId } = req.params;
    if (!(await teacherCanAccessStudent(req, studentId))) {
      return res.status(403).json({ message: 'You do not have access to this student.' });
    }

    const student = await User.findOne({ _id: studentId, role: 'STUDENT' })
      .select('name regNo email level batch currentCourseDay goStatus subscription').lean();
    if (!student) return res.status(404).json({ message: 'Student not found' });

    const stBatchCfg = student.batch
      ? await BatchConfig.findOne({ batchName: batchNameRegex(student.batch) }).select('trialDayEnabled').lean()
      : null;
    const studentTrial = !!stBatchCfg?.trialDayEnabled;
    const dayStart = journeyDayRangeStart(studentTrial);

    // --- Exercises with full catalog (all exercises, mapped with attempt data) ---
    const exJourneyLength = Math.max(student.currentCourseDay || 0, 200);

    const [allExercises, exAttempts] = await Promise.all([
      DigitalExercise.find({
        isDeleted: { $ne: true },
        isActive: true,
        visibleToStudents: true,
        courseDay: { $gte: 1, $lte: exJourneyLength }
      })
        .select('title level category courseDay sequenceLetter')
        .lean(),

      ExerciseAttempt.find({ studentId })
        .select('exerciseId status scorePercentage earnedPoints totalPoints completedAt timeSpentSeconds responses')
        .lean()
    ]);

    const attemptMap = {};
    for (const a of exAttempts) {
      const key = String(a.exerciseId);
      if (!attemptMap[key] || (a.completedAt > (attemptMap[key].completedAt || 0))) {
        attemptMap[key] = a;
      }
    }

    const exercises = allExercises.map(e => {
      const attempt = attemptMap[String(e._id)];
      return {
        _id: e._id,
        title: e.title,
        level: e.level,
        category: e.category,
        courseDay: e.courseDay,
        sequenceLetter: e.sequenceLetter,
        attempted: !!attempt,
        status: attempt?.status || 'not_attempted',
        scorePercent: attempt?.scorePercentage || 0,
        earnedPoints: attempt?.earnedPoints || 0,
        totalPoints: attempt?.totalPoints || 0,
        completedAt: attempt?.completedAt || null,
        timeSpentSeconds: attempt?.timeSpentSeconds || 0,
        responses: (attempt?.responses || []).map(r => ({
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
      };
    });

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
        attended: !!(attendEntry?.attended),
        attendedDurationMin: attendEntry?.durationMinutes || (attendEntry?.duration ? Math.round(attendEntry.duration / 60) : 0),
        attendancePercent: attendEntry?.attendancePercent || 0,
        status: attendEntry?.status || (attendEntry?.attended ? 'attended' : 'absent')
      };
    });

    // --- Glück Buddy (DG Bot) modules ---
    let modules = [];
    try {
      const { getStudentDgJourneyAccess, dgModuleUnlockedForAccess } = require('../utils/dgStudentJourneyGate');
      const [dgAccess, allDg, dgCompletedIds, dgAnyIds] = await Promise.all([
        getStudentDgJourneyAccess(studentId),
        DGModule.find({ isActive: true, visibleToStudents: true })
          .select('title level courseDay')
          .sort({ courseDay: 1, title: 1 })
          .lean(),
        DGSession.distinct('moduleId', { studentId, completed: true }),
        DGSession.distinct('moduleId', { studentId })
      ]);

      const dgCompletedSet = new Set((dgCompletedIds || []).map((id) => String(id)));
      const dgAnySet = new Set((dgAnyIds || []).map((id) => String(id)));

      modules = (allDg || []).map((m) => {
        const dayLocked =
          !dgAccess.enabled ||
          dgAccess.dgBotEnabled === false ||
          !dgModuleUnlockedForAccess(dgAccess, m.courseDay);
        const completed = dgCompletedSet.has(String(m._id));
        const started = dgAnySet.has(String(m._id));
        let status = 'not_started';
        if (completed) status = 'completed';
        else if (started) status = 'in_progress';
        return {
          _id: m._id,
          title: m.title,
          level: m.level,
          courseDay: m.courseDay ?? null,
          locked: dayLocked,
          status,
        };
      });
    } catch (dgErr) {
      console.warn('batch-journey detail: DG module summary skipped', dgErr?.message || dgErr);
    }

    // --- Day-by-day breakdown ---
    const maxDay = student.currentCourseDay != null ? student.currentCourseDay : dayStart;
    const dayMap = {};
    for (let d = dayStart; d <= maxDay; d++) {
      dayMap[d] = { day: d, exercisesDone: 0, exercisesTotal: 0, classesAttended: 0, classesTotal: 0, totalScore: 0, scoreCount: 0 };
    }

    // exercises done per day (attempted only) + total count
    exercises.forEach(e => {
      const d = e.courseDay;
      if (d != null && dayMap[d]) {
        if (e.attempted) {
          dayMap[d].exercisesDone += 1;
          dayMap[d].totalScore += e.scorePercent;
          dayMap[d].scoreCount += 1;
        }
        dayMap[d].exercisesTotal += 1;
      }
    });

    // and class info per day
    liveClasses.forEach(c => {
      const d = c.courseDay;
      if (d != null && dayMap[d]) {
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
        currentDay: resolveCourseDay(student.currentCourseDay, studentTrial)
      },
      exercises,
      liveClasses,
      modules,
      dayBreakdown
    });
  } catch (err) {
    console.error('batch-journey GET /student/:id/full-progress', err);
    res.status(500).json({ message: 'Failed to fetch student full progress', error: err.message });
  }
});

// ─── PATCH /api/batch-journey/:batchName/rename ─────────────────────────────
router.patch('/:batchName/rename', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const oldName = String(req.params.batchName || '').trim();
    const newName = String(req.body?.newBatchName || '').trim();
    if (!oldName) return res.status(400).json({ message: 'batchName is required' });
    if (!newName) return res.status(400).json({ message: 'newBatchName is required' });
    if (newName.length > 120) return res.status(400).json({ message: 'newBatchName is too long' });

    const result = await renameBatchAcrossSystem(oldName, newName);
    res.json({
      message: result.renamed ? `Batch renamed to "${result.batchName}"` : 'Batch name unchanged',
      ...result
    });
  } catch (err) {
    if (err.statusCode === 409) return res.status(409).json({ message: err.message });
    console.error('batch-journey PATCH /:batch/rename', err);
    res.status(500).json({ message: 'Failed to rename batch', error: err.message });
  }
});

// ─── PUT /api/batch-journey/:batchName/students ─────────────────────────────
// Add or remove students from a batch (uses canonical batch name from BatchConfig).
router.put('/:batchName/students', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const raw = String(req.params.batchName || '').trim();
    if (!raw) return res.status(400).json({ message: 'batchName is required' });

    const cfg = await getOrCreateConfig(raw);
    const canonicalName = cfg.batchName;
    const batchRx = batchNameRegex(canonicalName);

    const addIds = Array.isArray(req.body?.addStudentIds) ? req.body.addStudentIds : [];
    const removeIds = Array.isArray(req.body?.removeStudentIds) ? req.body.removeStudentIds : [];

    if (!addIds.length && !removeIds.length) {
      return res.status(400).json({ message: 'addStudentIds or removeStudentIds is required' });
    }

    let added = 0;
    let removed = 0;

    if (addIds.length) {
      const addResult = await User.updateMany(
        { _id: { $in: addIds }, role: 'STUDENT' },
        { $set: { batch: canonicalName } }
      );
      added = addResult.modifiedCount;
    }

    if (removeIds.length) {
      const removeResult = await User.updateMany(
        { _id: { $in: removeIds }, role: 'STUDENT', batch: batchRx },
        { $set: { batch: 'Unassigned' } }
      );
      removed = removeResult.modifiedCount;
    }

    const studentCount = await User.countDocuments({ role: 'STUDENT', batch: batchRx, ...EXCLUDE_TEST });

    res.json({
      message: 'Batch students updated',
      batchName: canonicalName,
      studentsAdded: added,
      studentsRemoved: removed,
      studentCount
    });
  } catch (err) {
    console.error('batch-journey PUT /:batch/students', err);
    res.status(500).json({ message: 'Failed to update batch students', error: err.message });
  }
});

module.exports = router;
