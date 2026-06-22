// routes/correction.js
// Admin correction panel: search students, view per-day resources, mark as complete or manually correct

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const User = require('../models/User');
const DigitalExercise = require('../models/DigitalExercise');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const GameSet = require('../models/GameSet');
const GameAttempt = require('../models/GameAttempt');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const MeetingLink = require('../models/MeetingLink');
const ZoomRecording = require('../models/ZoomRecording');
const ZoomRecordingView = require('../models/ZoomRecordingView');
const SilverGoUnlockCache = require('../models/SilverGoUnlockCache');
const BatchConfig = require('../models/BatchConfig');
const { verifyToken, checkRole } = require('../middleware/auth');
const {
  recordingAccessBatchKeys,
  batchesAlign,
  allStudentBatchStringsForContent
} = require('../utils/effectiveStudentBatch');
const { isSilverGoStudent, primaryGoBatchFromKeys } = require('../utils/goSilverTrack');
const {
  recordingWatchCountsAsComplete,
  recordingWatchSecondsForComplete
} = require('../utils/recordingWatchCompletion');
const {
  computeJourneyDayCompletion,
  meetsStrictThreshold
} = require('../services/journeyDayCompletion.service');
const {
  checkAndInstantlyAdvanceSilverGoStudent,
  markPendingAdvanceForStudentDay
} = require('../services/journeyDayAdvance.service');
const { withJourneyLevelInSet } = require('../services/journeyLevelSync.service');
const { listCrossBatchRecordingsForStudent } = require('../services/journeyCrossBatchRecordingAccess.service');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toObjId(id) {
  try { return new mongoose.Types.ObjectId(String(id)); } catch { return null; }
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isSilverStudent(student) {
  return String(student?.subscription || '').toUpperCase() === 'SILVER';
}

function allowedRecordingPlansForStudent(student) {
  const sub = String(student?.subscription || '').toUpperCase();
  if (String(student?.goStatus || '') === 'GO' && sub === 'SILVER') {
    return ['SILVER', 'ALL', 'PLATINUM'];
  }
  return [sub, 'ALL'].filter(Boolean);
}

function recordingWatchRatioForStudent(student) {
  return isSilverGoStudent(student) ? 0.9 : 0.75;
}

async function upsertManualRecordingView(studentId, recordingId, durationSec, student) {
  const ratio = recordingWatchRatioForStudent(student);
  const targetSec = recordingWatchSecondsForComplete(durationSec, ratio);
  const existing = await RecordingView.findOne({ student: studentId, recording: recordingId })
    .sort({ startedAt: -1 });
  if (existing) {
    existing.watchDuration = Math.max(Number(existing.watchDuration) || 0, targetSec);
    existing.lastUpdatedAt = new Date();
    await existing.save();
    return existing.watchDuration;
  }
  const created = await RecordingView.create({
    student: studentId,
    recording: recordingId,
    watchDuration: targetSec
  });
  return created.watchDuration;
}

async function upsertZoomRecordingView(studentId, meetingLinkId, durationSec, student) {
  const ratio = recordingWatchRatioForStudent(student);
  const targetSec = recordingWatchSecondsForComplete(durationSec, ratio);
  const existing = await ZoomRecordingView.findOne({ student: studentId, meetingLinkId })
    .sort({ startedAt: -1 });
  if (existing) {
    existing.watchDuration = Math.max(Number(existing.watchDuration) || 0, targetSec);
    existing.lastUpdatedAt = new Date();
    await existing.save();
    return existing.watchDuration;
  }
  const created = await ZoomRecordingView.create({
    student: studentId,
    meetingLinkId,
    watchDuration: targetSec
  });
  return created.watchDuration;
}

async function tryJourneyAdvanceAfterSilverRecording(student, studentId, courseDay, batchName) {
  if (isSilverGoStudent(student)) {
    await SilverGoUnlockCache.deleteOne({ studentId });
    return checkAndInstantlyAdvanceSilverGoStudent(studentId);
  }

  const dayInt = parseInt(String(courseDay), 10);
  const currentDay = parseInt(String(student.currentCourseDay || 1), 10);
  if (!Number.isFinite(dayInt) || dayInt !== currentDay) return { advanced: false };

  const keys = allStudentBatchStringsForContent(student);
  const primary = primaryGoBatchFromKeys(keys) || keys[0];
  const cfgDoc = primary
    ? await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(primary)}$`, 'i') }).lean()
    : null;

  let allowInstantAdvance = true;
  if (cfgDoc && cfgDoc.strictJourneyRule) {
    const comp = await computeJourneyDayCompletion(studentId, keys, dayInt, {
      includeRecordings: true,
      includeDg: cfgDoc.batchType === 'new',
      includeLearningModules: true,
      studentLevel: student.level,
      studentPlan: student.subscription,
      goStatus: student.goStatus,
      subscription: student.subscription
    });
    allowInstantAdvance = meetsStrictThreshold(comp, cfgDoc);
  }

  if (!allowInstantAdvance) return { advanced: false };

  const nextDay = Math.min(200, dayInt + 1);
  const advancedNow = await User.updateOne(
    { _id: studentId, role: 'STUDENT', currentCourseDay: dayInt },
    {
      $set: withJourneyLevelInSet(
        nextDay,
        {
          currentCourseDay: nextDay,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        },
        { student }
      )
    }
  );
  if (advancedNow?.modifiedCount) {
    return { advanced: true, previousDay: dayInt, newDay: nextDay };
  }
  await markPendingAdvanceForStudentDay(String(studentId), String(batchName || primary || ''), dayInt);
  return { advanced: false };
}

function buildRecordingResultRow({ id, title, courseDay, kind, watchedSec, durationSec, watchRatio }) {
  const completed = recordingWatchCountsAsComplete(watchedSec, durationSec, watchRatio);
  const watchPercent = durationSec > 0
    ? Math.min(100, Math.round((watchedSec / durationSec) * 100))
    : (watchedSec > 0 ? 100 : 0);
  return {
    _id: id,
    title: title && String(title).trim() ? title : 'Class recording',
    courseDay,
    type: 'recording',
    recordingKind: kind,
    attempted: watchedSec > 0,
    completed,
    watchSeconds: watchedSec,
    durationSeconds: durationSec,
    watchPercent,
    completedAt: completed ? new Date().toISOString() : null
  };
}

/** Merge cross-batch / self-pace recordings the student can see in My Course. */
async function appendCrossBatchRecordings(student, studentId, day, results, watchRatio) {
  const studentObjectId = toObjId(studentId);
  if (!studentObjectId) return results;

  const seen = new Set(results.map((r) => `${r.recordingKind}-${String(r._id)}`));
  let crossBatch;
  try {
    crossBatch = await listCrossBatchRecordingsForStudent(student);
  } catch (err) {
    console.error('[correction] cross-batch recordings (non-fatal):', err.message);
    return results;
  }

  const dayItems = [
    ...(crossBatch.manualItems || []).filter((i) => Number(i.courseDay) === day),
    ...(crossBatch.zoomItems || []).filter((i) => Number(i.courseDay) === day)
  ];

  const pending = [];
  for (const item of dayItems) {
    const isZoom = item.type === 'zoom';
    const id = String(isZoom ? (item.meetingLinkId || item.id) : item.id);
    const key = `${isZoom ? 'zoom' : 'manual'}-${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push({ item, isZoom, id });
  }
  if (!pending.length) return results;

  const manualIds = pending.filter((p) => !p.isZoom).map((p) => toObjId(p.id)).filter(Boolean);
  const zoomIds = pending.filter((p) => p.isZoom).map((p) => toObjId(p.id)).filter(Boolean);

  const watchedManualMap = new Map();
  if (manualIds.length) {
    const watchedManual = await RecordingView.aggregate([
      { $match: { student: studentObjectId, recording: { $in: manualIds } } },
      { $group: { _id: '$recording', maxWatchSeconds: { $sum: '$watchDuration' } } }
    ]);
    for (const w of watchedManual) {
      watchedManualMap.set(String(w._id), Math.max(0, Number(w.maxWatchSeconds || 0)));
    }
  }

  const watchedZoomMap = new Map();
  if (zoomIds.length) {
    const watchedZoom = await ZoomRecordingView.aggregate([
      { $match: { student: studentObjectId, meetingLinkId: { $in: zoomIds } } },
      { $group: { _id: '$meetingLinkId', maxWatchSeconds: { $sum: '$watchDuration' } } }
    ]);
    for (const w of watchedZoom) {
      watchedZoomMap.set(String(w._id), Math.max(0, Number(w.maxWatchSeconds || 0)));
    }
  }

  for (const { item, isZoom, id } of pending) {
    const watchedSec = isZoom
      ? (watchedZoomMap.get(id) || 0)
      : (watchedManualMap.get(id) || 0);
    const durationSec = Math.max(0, Number(item.duration || 0));
    results.push(buildRecordingResultRow({
      id: isZoom ? toObjId(id) : id,
      title: item.title,
      courseDay: day,
      kind: isZoom ? 'zoom' : 'manual',
      watchedSec,
      durationSec,
      watchRatio
    }));
  }

  return results;
}

/** Load manual + Zoom class recordings for a Silver student on a journey day. */
async function loadSilverDayRecordings(student, studentId, day) {
  if (!isSilverStudent(student)) return [];

  const recordingBatchKeys = recordingAccessBatchKeys(student);
  const studentLevel = String(student.level || 'A1').toUpperCase();
  const studentPlan = String(student.subscription || 'SILVER').toUpperCase();
  const watchRatio = recordingWatchRatioForStudent(student);
  const studentObjectId = toObjId(studentId);
  const results = [];

  if (recordingBatchKeys.length) {
  const manualFilter = {
    active: true,
    isPublished: { $ne: false },
    courseDay: day,
    level: studentLevel,
    plan: { $in: allowedRecordingPlansForStudent(student) }
  };
  const manualRecordings = await ClassRecording.find(manualFilter)
    .select('_id title batches duration courseDay')
    .lean();
  const visibleManual = manualRecordings.filter((r) => {
    const recBatches = Array.isArray(r.batches) ? r.batches : [];
    if (!recBatches.length) return false;
    return recBatches.some((rb) => recordingBatchKeys.some((sb) => batchesAlign(sb, rb)));
  });

  if (visibleManual.length && studentObjectId) {
    const manualIds = visibleManual.map((r) => r._id);
    const watchedManual = await RecordingView.aggregate([
      { $match: { student: studentObjectId, recording: { $in: manualIds } } },
      { $group: { _id: '$recording', maxWatchSeconds: { $sum: '$watchDuration' } } }
    ]);
    const watchedManualMap = new Map(
      watchedManual.map((w) => [String(w._id), Math.max(0, Number(w.maxWatchSeconds || 0))])
    );
    for (const rec of visibleManual) {
      const watchedSec = watchedManualMap.get(String(rec._id)) || 0;
      const durationSec = Number(rec.duration || 0);
      const completed = recordingWatchCountsAsComplete(watchedSec, durationSec, watchRatio);
      const watchPercent = durationSec > 0
        ? Math.min(100, Math.round((watchedSec / durationSec) * 100))
        : (watchedSec > 0 ? 100 : 0);
      results.push({
        _id: rec._id,
        title: rec.title && String(rec.title).trim() ? rec.title : 'Class recording',
        courseDay: rec.courseDay,
        type: 'recording',
        recordingKind: 'manual',
        attempted: watchedSec > 0,
        completed,
        watchSeconds: watchedSec,
        durationSeconds: durationSec,
        watchPercent,
        completedAt: completed ? new Date().toISOString() : null
      });
    }
  }

  const batchOr = recordingBatchKeys.map((n) => ({
    batch: new RegExp(`^${escapeRegExp(n)}$`, 'i')
  }));
  const classes = await MeetingLink.find({
    $or: batchOr,
    courseDay: day,
    status: { $ne: 'cancelled' }
  })
    .select('_id topic duration batch')
    .lean();

  if (classes.length && studentObjectId) {
    const classIds = classes.map((c) => c._id);
    const zoomRows = await ZoomRecording.find({
      meetingLinkId: { $in: classIds },
      status: 'ready',
      isPublished: { $ne: false }
    })
      .select('meetingLinkId accessBatches accessLevel accessPlan duration')
      .lean();
    const meetingDurationMap = new Map(
      classes.map((c) => [
        String(c._id),
        Number(c.duration) > 0 ? Math.round(Number(c.duration) * 60) : 0
      ])
    );
    const classTopicMap = new Map(classes.map((c) => [String(c._id), c.topic]));
    const visibleZoom = zoomRows.filter((zr) => {
      const levelOk = !zr.accessLevel || !studentLevel || String(zr.accessLevel).toUpperCase() === studentLevel;
      const plan = String(zr.accessPlan || 'ALL').toUpperCase();
      const planOk = plan === 'ALL' || !studentPlan || plan === studentPlan;
      if (!levelOk || !planOk) return false;
      const recBatches = Array.isArray(zr.accessBatches) ? zr.accessBatches : [];
      if (!recBatches.length) return false;
      return recBatches.some((rb) => recordingBatchKeys.some((sb) => batchesAlign(sb, rb)));
    });

    if (visibleZoom.length) {
      const zoomMeetingIds = visibleZoom.map((z) => z.meetingLinkId);
      const watchedZoom = await ZoomRecordingView.aggregate([
        { $match: { student: studentObjectId, meetingLinkId: { $in: zoomMeetingIds } } },
        { $group: { _id: '$meetingLinkId', maxWatchSeconds: { $sum: '$watchDuration' } } }
      ]);
      const watchedZoomMap = new Map(
        watchedZoom.map((w) => [String(w._id), Math.max(0, Number(w.maxWatchSeconds || 0))])
      );
      for (const zr of visibleZoom) {
        const id = String(zr.meetingLinkId);
        const watchedSec = watchedZoomMap.get(id) || 0;
        const durationSec =
          Number(zr.duration) > 0
            ? Number(zr.duration)
            : meetingDurationMap.get(id) || 0;
        const completed = recordingWatchCountsAsComplete(watchedSec, durationSec, watchRatio);
        const watchPercent = durationSec > 0
          ? Math.min(100, Math.round((watchedSec / durationSec) * 100))
          : (watchedSec > 0 ? 100 : 0);
        results.push({
          _id: zr.meetingLinkId,
          title: classTopicMap.get(id) || 'Class recording',
          courseDay: day,
          type: 'recording',
          recordingKind: 'zoom',
          attempted: watchedSec > 0,
          completed,
          watchSeconds: watchedSec,
          durationSeconds: durationSec,
          watchPercent,
          completedAt: completed ? new Date().toISOString() : null
        });
      }
    }
  }
  }

  return appendCrossBatchRecordings(student, studentId, day, results, watchRatio);
}

// ─── Dashboard stats ──────────────────────────────────────────────────────────
// GET /api/correction/stats
router.get('/stats', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const base = { role: 'STUDENT', isTestAccount: { $ne: true } };
    const [totalStudents, onJourney, levelAgg] = await Promise.all([
      User.countDocuments(base),
      User.countDocuments({ ...base, currentCourseDay: { $gte: 1 } }),
      User.aggregate([
        { $match: base },
        { $group: { _id: '$level', count: { $sum: 1 } } }
      ])
    ]);

    const byLevel = {};
    for (const row of levelAgg) {
      const key = String(row._id || 'Unknown').toUpperCase();
      byLevel[key] = row.count;
    }

    const a1 = byLevel.A1 || 0;
    const a2 = byLevel.A2 || 0;
    const b1 = byLevel.B1 || 0;
    const b2 = byLevel.B2 || 0;

    res.json({
      totalStudents,
      onJourney,
      a1,
      a2Plus: a2 + b1 + b2
    });
  } catch (err) {
    console.error('[correction] stats error:', err);
    res.status(500).json({ error: 'Failed to load stats' });
  }
});

// ─── Search Students ──────────────────────────────────────────────────────────
// GET /api/correction/search-students?q=&limit=20
router.get('/search-students', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    if (!q) return res.json({ students: [] });

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const filter = {
      role: 'STUDENT',
      $or: [
        { name: regex },
        { email: regex },
        { regNo: regex }
      ]
    };

    const students = await User.find(filter)
      .select('_id name email regNo batch level currentCourseDay')
      .limit(limit)
      .lean();

    res.json({ students });
  } catch (err) {
    console.error('[correction] search-students error:', err);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

// ─── Get student journey day cards ────────────────────────────────────────────
// GET /api/correction/student/:studentId/journey-days
// Returns day cards 1..currentCourseDay, each with a quick resource count
router.get('/student/:studentId/journey-days', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const studentId = toObjId(req.params.studentId);
    if (!studentId) return res.status(400).json({ error: 'Invalid studentId' });

    const student = await User.findById(studentId)
      .select('name email regNo batch level currentCourseDay subscription goStatus')
      .lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const maxDay = Math.max(1, student.currentCourseDay || 1);
    const isSilver = isSilverStudent(student);
    const recordingBatchKeys = isSilver ? recordingAccessBatchKeys(student) : [];

    // Build a quick summary per day: count exercises, dg modules, game sets, recordings
    const dayQueries = [
      DigitalExercise.find({ courseDay: { $gte: 1, $lte: maxDay }, visibleToStudents: true })
        .select('_id courseDay sequenceLetter title')
        .lean(),
      DGModule.find({ courseDay: { $gte: 1, $lte: maxDay }, visibleToStudents: true })
        .select('_id courseDay title')
        .lean(),
      GameSet.find({ courseDay: { $gte: 1, $lte: maxDay } })
        .select('_id courseDay title sequenceLetter')
        .lean()
    ];
    if (isSilver && recordingBatchKeys.length) {
      const studentLevel = String(student.level || 'A1').toUpperCase();
      dayQueries.push(
        ClassRecording.find({
          active: true,
          isPublished: { $ne: false },
          courseDay: { $gte: 1, $lte: maxDay },
          level: studentLevel,
          plan: { $in: allowedRecordingPlansForStudent(student) }
        })
          .select('courseDay batches')
          .lean()
      );
    }
    const queryResults = await Promise.all(dayQueries);
    const exercises = queryResults[0];
    const dgModules = queryResults[1];
    const gameSets = queryResults[2];
    const manualRecordings = isSilver && recordingBatchKeys.length ? queryResults[3] : [];

    // Group by day
    const dayMap = {};
    for (let d = 1; d <= maxDay; d++) {
      dayMap[d] = { day: d, exerciseCount: 0, dgCount: 0, gameCount: 0, recordingCount: 0 };
    }
    for (const ex of exercises) {
      const d = ex.courseDay;
      if (dayMap[d]) dayMap[d].exerciseCount++;
    }
    for (const m of dgModules) {
      const d = m.courseDay;
      if (dayMap[d]) dayMap[d].dgCount++;
    }
    for (const g of gameSets) {
      const d = g.courseDay;
      if (dayMap[d]) dayMap[d].gameCount++;
    }
    for (const rec of manualRecordings) {
      const recBatches = Array.isArray(rec.batches) ? rec.batches : [];
      if (!recBatches.length) continue;
      if (!recBatches.some((rb) => recordingBatchKeys.some((sb) => batchesAlign(sb, rb)))) continue;
      const d = rec.courseDay;
      if (dayMap[d]) dayMap[d].recordingCount++;
    }

    if (isSilver) {
      try {
        const crossBatch = await listCrossBatchRecordingsForStudent(student);
        for (const item of [...(crossBatch.manualItems || []), ...(crossBatch.zoomItems || [])]) {
          const d = Number(item.courseDay);
          if (dayMap[d]) dayMap[d].recordingCount++;
        }
      } catch (err) {
        console.error('[correction] cross-batch day counts (non-fatal):', err.message);
      }
    }

    const days = Object.values(dayMap).sort((a, b) => a.day - b.day);

    res.json({ student, currentCourseDay: maxDay, days, isSilverStudent: isSilver });
  } catch (err) {
    console.error('[correction] journey-days error:', err);
    res.status(500).json({ error: 'Failed to load journey days' });
  }
});

// ─── Get resources for a specific day with student attempt data ───────────────
// GET /api/correction/student/:studentId/day/:day/resources
router.get('/student/:studentId/day/:day/resources', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const studentId = toObjId(req.params.studentId);
    const day = parseInt(req.params.day);
    if (!studentId || isNaN(day)) return res.status(400).json({ error: 'Invalid parameters' });

    const student = await User.findById(studentId)
      .select('batch level subscription goStatus currentCourseDay')
      .lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const isSilver = isSilverStudent(student);

    // Fetch resources for this day
    const [exercises, dgModules, gameSets] = await Promise.all([
      DigitalExercise.find({ courseDay: day, visibleToStudents: true })
        .select('_id title courseDay sequenceLetter totalCompletions averageScore')
        .lean(),
      DGModule.find({ courseDay: day, visibleToStudents: true })
        .select('_id title courseDay')
        .lean(),
      GameSet.find({ courseDay: day })
        .select('_id title courseDay sequenceLetter gameType')
        .lean()
    ]);

    const exerciseIds = exercises.map(e => e._id);
    const dgIds = dgModules.map(m => m._id);
    const gameIds = gameSets.map(g => g._id);

    // Fetch best attempts/sessions for this student on these resources
    const [exerciseAttempts, dgSessions, gameAttempts] = await Promise.all([
      exerciseIds.length
        ? ExerciseAttempt.find({ studentId, exerciseId: { $in: exerciseIds } })
            .sort({ scorePercentage: -1, completedAt: -1 })
            .select('_id exerciseId status scorePercentage earnedPoints totalPoints completedAt attemptNumber')
            .lean()
        : [],
      dgIds.length
        ? DGSession.find({ studentId, moduleId: { $in: dgIds } })
            .sort({ completedAt: -1 })
            .select('_id moduleId completed completedAt moduleCompletionPercent score')
            .lean()
        : [],
      gameIds.length
        ? GameAttempt.find({ studentId, gameSetId: { $in: gameIds }, status: 'completed' })
            .sort({ accuracy: -1, completedAt: -1 })
            .select('_id gameSetId status accuracy score xpEarned completedAt')
            .lean()
        : []
    ]);

    // Index attempts by resource id (prefer completed, then best score)
    const exAttemptMap = {};
    for (const a of exerciseAttempts) {
      const key = String(a.exerciseId);
      const existing = exAttemptMap[key];
      if (!existing) {
        exAttemptMap[key] = a;
        continue;
      }
      const aDone = a.status === 'completed';
      const eDone = existing.status === 'completed';
      if (aDone && !eDone) {
        exAttemptMap[key] = a;
        continue;
      }
      if (!aDone && eDone) continue;
      if ((a.scorePercentage || 0) > (existing.scorePercentage || 0)) {
        exAttemptMap[key] = a;
      }
    }
    const dgSessionMap = {};
    for (const s of dgSessions) {
      const key = String(s.moduleId);
      if (!dgSessionMap[key] || s.completed) dgSessionMap[key] = s;
    }
    const gameAttemptMap = {};
    for (const g of gameAttempts) {
      const key = String(g.gameSetId);
      if (!gameAttemptMap[key] || g.accuracy > gameAttemptMap[key].accuracy) {
        gameAttemptMap[key] = g;
      }
    }

    // Build enriched resource lists
    const enrichedExercises = exercises.map(ex => {
      const attempt = exAttemptMap[String(ex._id)] || null;
      return {
        _id: ex._id,
        title: ex.title,
        sequenceLetter: ex.sequenceLetter,
        courseDay: ex.courseDay,
        type: 'exercise',
        attempted: !!attempt,
        completed: attempt ? attempt.status === 'completed' : false,
        scorePercentage: attempt ? attempt.scorePercentage : null,
        earnedPoints: attempt ? attempt.earnedPoints : null,
        totalPoints: attempt ? attempt.totalPoints : null,
        attemptId: attempt && attempt.status === 'completed' ? attempt._id : null,
        completedAt: attempt ? attempt.completedAt : null
      };
    });

    const enrichedDg = dgModules.map(mod => {
      const session = dgSessionMap[String(mod._id)] || null;
      return {
        _id: mod._id,
        title: mod.title,
        courseDay: mod.courseDay,
        type: 'dg',
        attempted: !!session,
        completed: session ? session.completed : false,
        completionPercent: session ? (session.moduleCompletionPercent || (session.completed ? 100 : 0)) : null,
        sessionId: session ? session._id : null,
        completedAt: session ? session.completedAt : null
      };
    });

    const enrichedGames = gameSets.map(game => {
      const attempt = gameAttemptMap[String(game._id)] || null;
      return {
        _id: game._id,
        title: game.title,
        gameType: game.gameType,
        sequenceLetter: game.sequenceLetter,
        courseDay: game.courseDay,
        type: 'game',
        attempted: !!attempt,
        completed: !!attempt,
        accuracy: attempt ? attempt.accuracy : null,
        score: attempt ? attempt.score : null,
        attemptId: attempt ? attempt._id : null,
        completedAt: attempt ? attempt.completedAt : null
      };
    });

    const recordings = isSilver
      ? await loadSilverDayRecordings(student, studentId, day)
      : [];

    res.json({
      day,
      isSilverStudent: isSilver,
      exercises: enrichedExercises,
      dgModules: enrichedDg,
      games: enrichedGames,
      recordings
    });
  } catch (err) {
    console.error('[correction] day-resources error:', err);
    res.status(500).json({ error: 'Failed to load day resources' });
  }
});

// ─── Mark Exercise as Complete (100%) ────────────────────────────────────────
// POST /api/correction/student/:studentId/exercise/:exerciseId/mark-complete
router.post('/student/:studentId/exercise/:exerciseId/mark-complete', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const studentId = toObjId(req.params.studentId);
    const exerciseId = toObjId(req.params.exerciseId);
    if (!studentId || !exerciseId) return res.status(400).json({ error: 'Invalid parameters' });

    const exercise = await DigitalExercise.findById(exerciseId).select('_id title questions').lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    const totalPoints = Array.isArray(exercise.questions) ? exercise.questions.length : 1;

    // Find existing attempt or create a new one
    let attempt = await ExerciseAttempt.findOne({
      studentId, exerciseId,
      status: { $in: ['in-progress', 'completed'] }
    }).sort({ attemptNumber: -1 });

    if (attempt) {
      attempt.status = 'completed';
      attempt.scorePercentage = 100;
      attempt.earnedPoints = attempt.totalPoints || totalPoints;
      attempt.totalPoints = attempt.totalPoints || totalPoints;
      attempt.completedAt = attempt.completedAt || new Date();
      await attempt.save();
    } else {
      attempt = await ExerciseAttempt.create({
        studentId,
        exerciseId,
        attemptNumber: 1,
        status: 'completed',
        totalPoints,
        earnedPoints: totalPoints,
        scorePercentage: 100,
        startedAt: new Date(),
        completedAt: new Date(),
        responses: []
      });
    }

    // Update exercise aggregate stats
    await DigitalExercise.findByIdAndUpdate(exerciseId, { $inc: { totalCompletions: 1 } });

    res.json({ success: true, attempt: { _id: attempt._id, scorePercentage: 100, status: 'completed' } });
  } catch (err) {
    console.error('[correction] mark-exercise-complete error:', err);
    res.status(500).json({ error: 'Failed to mark exercise as complete' });
  }
});

// ─── Correct Exercise: set a specific score ───────────────────────────────────
// PATCH /api/correction/student/:studentId/exercise/:exerciseId/correct
// Body: { scorePercentage: 0-100 }
router.patch('/student/:studentId/exercise/:exerciseId/correct', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const studentId = toObjId(req.params.studentId);
    const exerciseId = toObjId(req.params.exerciseId);
    if (!studentId || !exerciseId) return res.status(400).json({ error: 'Invalid parameters' });

    const score = parseFloat(req.body.scorePercentage);
    if (isNaN(score) || score < 0 || score > 100) {
      return res.status(400).json({ error: 'scorePercentage must be 0-100' });
    }

    const exercise = await DigitalExercise.findById(exerciseId).select('_id questions').lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    const totalPoints = Array.isArray(exercise.questions) ? exercise.questions.length : 1;
    const earnedPoints = Math.round((score / 100) * totalPoints);

    let attempt = await ExerciseAttempt.findOne({ studentId, exerciseId })
      .sort({ attemptNumber: -1 });

    if (attempt) {
      attempt.scorePercentage = score;
      attempt.earnedPoints = earnedPoints;
      attempt.totalPoints = totalPoints;
      attempt.status = 'completed';
      attempt.completedAt = attempt.completedAt || new Date();
      await attempt.save();
    } else {
      attempt = await ExerciseAttempt.create({
        studentId,
        exerciseId,
        attemptNumber: 1,
        status: 'completed',
        totalPoints,
        earnedPoints,
        scorePercentage: score,
        startedAt: new Date(),
        completedAt: new Date(),
        responses: []
      });
    }

    res.json({ success: true, attempt: { _id: attempt._id, scorePercentage: score, earnedPoints, totalPoints, status: 'completed' } });
  } catch (err) {
    console.error('[correction] correct-exercise error:', err);
    res.status(500).json({ error: 'Failed to correct exercise' });
  }
});

// ─── Mark DG Module as Complete ───────────────────────────────────────────────
// POST /api/correction/student/:studentId/dg/:moduleId/mark-complete
router.post('/student/:studentId/dg/:moduleId/mark-complete', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const studentId = toObjId(req.params.studentId);
    const moduleId = toObjId(req.params.moduleId);
    if (!studentId || !moduleId) return res.status(400).json({ error: 'Invalid parameters' });

    const mod = await DGModule.findById(moduleId).select('_id title').lean();
    if (!mod) return res.status(404).json({ error: 'DG Module not found' });

    let session = await DGSession.findOne({ studentId, moduleId }).sort({ createdAt: -1 });

    if (session) {
      session.completed = true;
      session.moduleCompletionPercent = 100;
      session.completedAt = session.completedAt || new Date();
      await session.save();
    } else {
      session = await DGSession.create({
        studentId,
        moduleId,
        completed: true,
        moduleCompletionPercent: 100,
        completedAt: new Date(),
        attempts: 0,
        successCount: 0,
        failureCount: 0,
        score: 100
      });
    }

    res.json({ success: true, session: { _id: session._id, completed: true, moduleCompletionPercent: 100 } });
  } catch (err) {
    console.error('[correction] mark-dg-complete error:', err);
    res.status(500).json({ error: 'Failed to mark DG module as complete' });
  }
});

// ─── Mark Game as Complete (100% accuracy) ────────────────────────────────────
// POST /api/correction/student/:studentId/game/:gameSetId/mark-complete
router.post('/student/:studentId/game/:gameSetId/mark-complete', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const studentId = toObjId(req.params.studentId);
    const gameSetId = toObjId(req.params.gameSetId);
    if (!studentId || !gameSetId) return res.status(400).json({ error: 'Invalid parameters' });

    const gameSet = await GameSet.findById(gameSetId).select('_id title gameType').lean();
    if (!gameSet) return res.status(404).json({ error: 'Game set not found' });

    let attempt = await GameAttempt.findOne({ studentId, gameSetId, status: 'completed' });

    if (attempt) {
      attempt.accuracy = 100;
      attempt.score = attempt.score || 100;
      await attempt.save();
    } else {
      attempt = await GameAttempt.create({
        studentId,
        gameSetId,
        gameType: gameSet.gameType || 'scramble_rush',
        status: 'completed',
        accuracy: 100,
        score: 100,
        xpEarned: 10,
        startedAt: new Date(),
        completedAt: new Date()
      });
    }

    res.json({ success: true, attempt: { _id: attempt._id, accuracy: 100, status: 'completed' } });
  } catch (err) {
    console.error('[correction] mark-game-complete error:', err);
    res.status(500).json({ error: 'Failed to mark game as complete' });
  }
});

// ─── Mark Class Recording as Watched (Silver students) ─────────────────────────
// POST /api/correction/student/:studentId/recording/:recordingId/mark-watched
// Body: { kind: 'manual' | 'zoom' }
router.post('/student/:studentId/recording/:recordingId/mark-watched', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const studentId = toObjId(req.params.studentId);
    const recordingId = toObjId(req.params.recordingId);
    const kind = String(req.body?.kind || 'manual').toLowerCase();
    if (!studentId || !recordingId) return res.status(400).json({ error: 'Invalid parameters' });

    const student = await User.findById(studentId)
      .select('batch level subscription goStatus currentCourseDay role')
      .lean();
    if (!student || student.role !== 'STUDENT') return res.status(404).json({ error: 'Student not found' });
    if (!isSilverStudent(student)) return res.status(400).json({ error: 'Recordings correction is only for Silver students' });

    let courseDay = null;
    let batchName = student.batch || '';
    let watchDuration = 0;
    let durationSec = 0;
    let watched = false;

    if (kind === 'zoom') {
      const meeting = await MeetingLink.findById(recordingId)
        .select('topic duration courseDay batch')
        .lean();
      if (!meeting) return res.status(404).json({ error: 'Class meeting not found' });

      const zoomRec = await ZoomRecording.findOne({
        meetingLinkId: recordingId,
        status: 'ready',
        isPublished: { $ne: false }
      })
        .select('duration status')
        .lean();
      if (!zoomRec) return res.status(404).json({ error: 'Zoom recording not found for this class' });

      durationSec =
        Number(zoomRec.duration) > 0
          ? Number(zoomRec.duration)
          : meeting?.duration != null && Number(meeting.duration) > 0
            ? Math.round(Number(meeting.duration) * 60)
            : 0;
      courseDay = meeting.courseDay;
      batchName = meeting.batch || batchName;
      watchDuration = await upsertZoomRecordingView(studentId, recordingId, durationSec, student);
    } else {
      const recording = await ClassRecording.findOne({
        _id: recordingId,
        active: true,
        isPublished: { $ne: false }
      })
        .select('duration title courseDay batches')
        .lean();
      if (!recording) return res.status(404).json({ error: 'Recording not found' });

      durationSec = Number(recording.duration || 0);
      courseDay = recording.courseDay;
      batchName = Array.isArray(recording.batches) && recording.batches[0]
        ? recording.batches[0]
        : batchName;
      watchDuration = await upsertManualRecordingView(studentId, recordingId, durationSec, student);
    }

    const ratio = recordingWatchRatioForStudent(student);
    watched = recordingWatchCountsAsComplete(watchDuration, durationSec, ratio);

    let journeyAdvanced = false;
    let previousCourseDay = null;
    let newCourseDay = null;
    if (watched && courseDay != null) {
      const adv = await tryJourneyAdvanceAfterSilverRecording(student, studentId, courseDay, batchName);
      journeyAdvanced = !!adv?.advanced;
      if (journeyAdvanced) {
        previousCourseDay = adv.previousDay;
        newCourseDay = adv.newDay;
      }
    }

    res.json({
      success: true,
      watched,
      watchDuration,
      journeyAdvanced,
      ...(journeyAdvanced ? { previousCourseDay, newCourseDay } : {})
    });
  } catch (err) {
    console.error('[correction] mark-recording-watched error:', err);
    res.status(500).json({ error: 'Failed to mark recording as watched' });
  }
});

module.exports = router;
