/**
 * Per-day journey task completion: digital exercises + live classes (attendance).
 * Used for strict batch rules (% threshold) and admin task checks.
 */

const DigitalExercise = require('../models/DigitalExercise');
const mongoose = require('mongoose');
const MeetingLink = require('../models/MeetingLink');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const ZoomRecording = require('../models/ZoomRecording');
const ZoomRecordingView = require('../models/ZoomRecordingView');
const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const { studentTargetBatchKeys, moduleTargetingQuery } = require('../utils/batchTargeting');
const {
  normalizeBatchType,
  exerciseVersionClauseForBatch,
  dgModuleVersionClauseForBatch,
} = require('../utils/batchType');
const BatchConfig = require('../models/BatchConfig');
const { batchesAlign } = require('../utils/effectiveStudentBatch');
const {
  resolveInheritedAttempt,
  isInheritedPassing
} = require('./exerciseSplitInheritance.service');
const { recordingWatchCountsAsComplete } = require('../utils/recordingWatchCompletion');

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Day completion cache (shared by all callers) ──────────────────────────────
const dayCompletionCache = new Map();
const CACHE_TTL_MS = 60_000;

function dayCompletionCacheKey(studentId, day, batchNames, options) {
  return `${String(studentId)}:${day}:${batchNames.join(',')}:${options.includeRecordings ? '1' : '0'}:${options.includeDg ? '1' : '0'}:${options.studentLevel || ''}:${options.studentPlan || ''}:${options.goStatus || ''}:${options.batchType || ''}`;
}

function dayCompletionCacheGet(key) {
  const entry = dayCompletionCache.get(key);
  if (entry && Date.now() - entry.at < CACHE_TTL_MS) return entry.val;
  dayCompletionCache.delete(key);
  return undefined;
}

function dayCompletionCacheSet(key, val) {
  dayCompletionCache.set(key, { at: Date.now(), val });
  if (dayCompletionCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of dayCompletionCache) {
      if (now - v.at > CACHE_TTL_MS) dayCompletionCache.delete(k);
    }
  }
}

/**
 * @param {string|import('mongoose').Types.ObjectId} studentId
 * @param {string|string[]} batchNameOrNames
 * @param {number} day
 * @param {{ creditMeetings?: (string|import('mongoose').Types.ObjectId)[] }} [options]
 *   creditMeetings — meeting IDs to treat as attended (e.g. recording watch gate just satisfied)
 */
async function computeJourneyDayCompletion(studentId, batchNameOrNames, day, options = {}) {
  const batchNames = Array.isArray(batchNameOrNames)
    ? batchNameOrNames.map((b) => String(b || '').trim()).filter(Boolean)
    : batchNameOrNames
      ? [String(batchNameOrNames).trim()]
      : [];
  const cacheKey = dayCompletionCacheKey(studentId, day, batchNames, options);
  const cached = dayCompletionCacheGet(cacheKey);
  if (cached !== undefined) return cached;
  const creditMeetingIds = new Set((options.creditMeetings || []).map((id) => String(id)));
  const includeRecordings = options.includeRecordings === true;
  const includeDg = options.includeDg === true;
  const includeLiveClasses = options.includeLiveClasses !== false;
  const recordingWatchRatio =
    options.recordingWatchRatio != null && Number.isFinite(Number(options.recordingWatchRatio))
      ? Math.min(1, Math.max(0.5, Number(options.recordingWatchRatio)))
      : 0.9;
  const studentLevel = String(options.studentLevel || '').toUpperCase().trim();
  const studentPlan = String(options.studentPlan || '').toUpperCase().trim();
  const accessibleLevels = Array.isArray(options.accessibleLevels) && options.accessibleLevels.length
    ? options.accessibleLevels.filter(Boolean)
    : null;
  const recordingBatchNames =
    Array.isArray(options.recordingBatchNames) && options.recordingBatchNames.length
      ? options.recordingBatchNames.map((b) => String(b || '').trim()).filter(Boolean)
      : batchNames;
  const studentObjectId = mongoose.Types.ObjectId.isValid(String(studentId))
    ? new mongoose.Types.ObjectId(String(studentId))
    : null;

  let batchType = options.batchType ? normalizeBatchType(options.batchType) : null;
  if (!batchType && batchNames.length) {
    const primary = batchNames[0];
    const cfg = primary
      ? await BatchConfig.findOne({
          batchName: new RegExp(`^${escapeRegExp(primary)}$`, 'i'),
        })
          .select('batchType')
          .lean()
      : null;
    batchType = normalizeBatchType(cfg?.batchType);
  } else if (!batchType) {
    batchType = normalizeBatchType('new');
  }
  const studentBatchKeys = studentTargetBatchKeys({
    batch: batchNames[0] || '',
    goStatus: options.goStatus || '',
    subscription: options.subscription || '',
  });

  const exercises = await DigitalExercise.find({
    isDeleted: { $ne: true },
    visibleToStudents: true,
    isActive: true,
    courseDay: day,
    ...(accessibleLevels ? { level: { $in: accessibleLevels } } : {}),
    ...exerciseVersionClauseForBatch(batchType, studentBatchKeys),
  })
    .select('_id title splitLineage questions')
    .lean();

  const exerciseIds = exercises.map((e) => e._id);
  const completedAttempts = exerciseIds.length
    ? await ExerciseAttempt.find({
        studentId,
        exerciseId: { $in: exerciseIds },
        status: 'completed'
      }).distinct('exerciseId')
    : [];

  const completedExerciseIdSet = new Set(completedAttempts.map((id) => String(id)));

  // Batch-load source exercise attempts for split-lineage exercises (fixes N+1)
  const splitExercises = exercises.filter(
    (ex) => !completedExerciseIdSet.has(String(ex._id)) && ex.splitLineage?.sourceExerciseId,
  );
  if (splitExercises.length) {
    const sourceIds = [...new Set(splitExercises.map((ex) => String(ex.splitLineage.sourceExerciseId)))];
    const sourceAttempts = sourceIds.length
      ? await ExerciseAttempt.find({
          studentId,
          exerciseId: { $in: sourceIds },
          status: 'completed',
        })
          .sort({ scorePercentage: -1, completedAt: -1, attemptNumber: -1, _id: -1 })
          .lean()
      : [];
    const bestBySource = new Map();
    for (const att of sourceAttempts) {
      const key = String(att.exerciseId);
      if (!bestBySource.has(key)) bestBySource.set(key, att);
    }
    for (const ex of splitExercises) {
      const srcKey = String(ex.splitLineage.sourceExerciseId);
      const srcAttempt = bestBySource.get(srcKey);
      if (!srcAttempt) continue;
      const inherited = await resolveInheritedAttempt(studentId, ex, srcAttempt);
      if (isInheritedPassing(inherited)) {
        completedExerciseIdSet.add(String(ex._id));
      }
    }
  }
  const exerciseDone = completedExerciseIdSet.size;
  const exerciseTotal = exerciseIds.length;
  const incompleteExercises = exercises
    .filter((e) => !completedExerciseIdSet.has(String(e._id)))
    .map((e) => ({
      kind: 'exercise',
      title: e.title && String(e.title).trim() ? e.title : 'Digital exercise',
      courseDay: day
    }));

  let classes = [];
  const meetingBatchNames = includeRecordings ? recordingBatchNames : batchNames;
  const needsMeetings = (includeLiveClasses || includeRecordings) && meetingBatchNames.length;
  if (needsMeetings) {
    const batchOr = meetingBatchNames.map((n) => ({
      batch: new RegExp(`^${escapeRegExp(n)}$`, 'i')
    }));
    classes = await MeetingLink.find({
      $or: batchOr,
      courseDay: day,
      status: { $ne: 'cancelled' }
    })
      .select('_id topic attendance duration')
      .lean();
  }

  let classDone = 0;
  const classTotal = includeLiveClasses ? classes.length : 0;
  const incompleteClasses = [];
  if (includeLiveClasses) {
    for (const cls of classes) {
      const record = (cls.attendance || []).find(
        (a) => String(a.studentId) === String(studentId) && a.attended === true
      );
      if (record || creditMeetingIds.has(String(cls._id))) {
        classDone++;
      } else {
        incompleteClasses.push({
          kind: 'class',
          title: cls.topic && String(cls.topic).trim() ? cls.topic : 'Live class',
          courseDay: day
        });
      }
    }
  }

  const totalTasks = exerciseTotal + classTotal;
  const doneTasks = exerciseDone + classDone;
  let recordingTotal = 0;
  let recordingDone = 0;
  const incompleteRecordings = [];
  if (includeRecordings) {
    const manualFilter = {
      active: true,
      isPublished: { $ne: false },
      courseDay: day
    };
    if (studentLevel) manualFilter.level = studentLevel;
    if (studentPlan && studentPlan !== 'ALL') {
      manualFilter.plan = { $in: [studentPlan, 'ALL'] };
    }
    const manualRecordings = await ClassRecording.find(manualFilter)
      .select('_id title batches duration')
      .lean();
    const visibleManual = manualRecordings.filter((r) => {
      const recBatches = Array.isArray(r.batches) ? r.batches : [];
      if (!recBatches.length || !recordingBatchNames.length) return false;
      return recBatches.some((rb) => recordingBatchNames.some((sb) => batchesAlign(sb, rb)));
    });
    if (visibleManual.length) {
      const manualIds = visibleManual.map((r) => r._id);
      const watchedManual = studentObjectId ? await RecordingView.aggregate([
        { $match: { student: studentObjectId, recording: { $in: manualIds } } },
        // Accumulated watch time across all sessions (resume-friendly).
        { $group: { _id: '$recording', maxWatchSeconds: { $sum: '$watchDuration' } } }
      ]) : [];
      const watchedManualMap = new Map(
        watchedManual.map((w) => [String(w._id), Math.max(0, Number(w.maxWatchSeconds || 0))])
      );
      recordingTotal += visibleManual.length;
      for (const rec of visibleManual) {
        const watchedSec = watchedManualMap.get(String(rec._id)) || 0;
        const durationSec = Number(rec.duration || 0);
        if (recordingWatchCountsAsComplete(watchedSec, durationSec, recordingWatchRatio)) recordingDone++;
        else {
          incompleteRecordings.push({
            kind: 'recording',
            title: rec.title && String(rec.title).trim() ? rec.title : 'Class recording',
            courseDay: day
          });
        }
      }
    }

    if (classes.length) {
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
      const visibleZoom = zoomRows.filter((zr) => {
        const levelOk = !zr.accessLevel || !studentLevel || String(zr.accessLevel).toUpperCase() === studentLevel;
        const plan = String(zr.accessPlan || 'ALL').toUpperCase();
        const planOk = plan === 'ALL' || !studentPlan || plan === studentPlan;
        if (!levelOk || !planOk) return false;
        const recBatches = Array.isArray(zr.accessBatches) ? zr.accessBatches : [];
        if (!recBatches.length || !recordingBatchNames.length) return false;
        return recBatches.some((rb) => recordingBatchNames.some((sb) => batchesAlign(sb, rb)));
      });
      if (visibleZoom.length) {
        const zoomMeetingIds = visibleZoom.map((z) => z.meetingLinkId);
        const watchedZoom = studentObjectId ? await ZoomRecordingView.aggregate([
          { $match: { student: studentObjectId, meetingLinkId: { $in: zoomMeetingIds } } },
          // Accumulated watch time across all sessions (resume-friendly).
          { $group: { _id: '$meetingLinkId', maxWatchSeconds: { $sum: '$watchDuration' } } }
        ]) : [];
        const watchedZoomMap = new Map(
          watchedZoom.map((w) => [String(w._id), Math.max(0, Number(w.maxWatchSeconds || 0))])
        );
        const classTopicMap = new Map(classes.map((c) => [String(c._id), c.topic]));
        recordingTotal += visibleZoom.length;
        for (const zr of visibleZoom) {
          const id = String(zr.meetingLinkId);
          const watchedSec = watchedZoomMap.get(id) || 0;
          const durationSec =
            Number(zr.duration) > 0
              ? Number(zr.duration)
              : meetingDurationMap.get(id) || 0;
          if (
            creditMeetingIds.has(id) ||
            recordingWatchCountsAsComplete(watchedSec, durationSec, recordingWatchRatio)
          ) {
            recordingDone++;
          } else {
            incompleteRecordings.push({
              kind: 'recording',
              title: classTopicMap.get(id) || 'Class recording',
              courseDay: day
            });
          }
        }
      }
    }
  }

  let dgTotal = 0;
  let dgDone = 0;
  const incompleteDg = [];
  if (includeDg) {
    const dgModules = await DGModule.find({
      isActive: true,
      visibleToStudents: true,
      courseDay: day,
      $and: [
        moduleTargetingQuery(studentBatchKeys),
        dgModuleVersionClauseForBatch(batchType),
      ],
    })
      .select('_id title')
      .lean();
    const dgIds = dgModules.map((m) => m._id);
    const completedDgIds = dgIds.length
      ? await DGSession.find({
          studentId,
          moduleId: { $in: dgIds },
          completed: true
        }).distinct('moduleId')
      : [];
    const completedSet = new Set(completedDgIds.map((id) => String(id)));
    dgTotal = dgIds.length;
    dgDone = completedSet.size;
    for (const mod of dgModules) {
      if (!completedSet.has(String(mod._id))) {
        incompleteDg.push({
          kind: 'dg-bot',
          title: mod.title && String(mod.title).trim() ? mod.title : 'DG bot practice',
          courseDay: day
        });
      }
    }
  }

  const finalTotalTasks = totalTasks + recordingTotal + dgTotal;
  const finalDoneTasks = doneTasks + recordingDone + dgDone;
  const completionPercent = finalTotalTasks === 0 ? 100 : Math.floor((100 * finalDoneTasks) / finalTotalTasks);
  const complete = finalTotalTasks === 0 || finalDoneTasks === finalTotalTasks;
  const incompleteTasks = [...incompleteExercises, ...incompleteClasses, ...incompleteRecordings, ...incompleteDg];

  const result = {
    complete,
    incompleteTasks,
    totalTasks: finalTotalTasks,
    doneTasks: finalDoneTasks,
    completionPercent,
    breakdown: {
      exercises: {
        done: exerciseDone,
        total: exerciseTotal,
        items: exercises.map((e) => ({ _id: e._id, title: e.title }))
      },
      classes: {
        done: classDone,
        total: classTotal,
        items: classes.map((c) => ({ _id: c._id, topic: c.topic }))
      },
      recordings: {
        done: recordingDone,
        total: recordingTotal
      },
      dg: {
        done: dgDone,
        total: dgTotal
      }
    }
  };
  dayCompletionCacheSet(cacheKey, result);
  return result;
}

function meetsStrictThreshold(completion, cfg) {
  if (!cfg || !cfg.strictJourneyRule) return true;
  const raw = Number(cfg.strictJourneyThresholdPercent);
  const threshold = Number.isFinite(raw) ? Math.min(100, Math.max(1, Math.round(raw))) : 100;
  if (completion.totalTasks === 0) return true;
  return completion.completionPercent >= threshold;
}

function clearDayCompletionCacheForStudent(studentId) {
  const prefix = `${String(studentId)}:`;
  for (const key of dayCompletionCache.keys()) {
    if (key.startsWith(prefix)) dayCompletionCache.delete(key);
  }
}

module.exports = {
  computeJourneyDayCompletion,
  meetsStrictThreshold,
  clearDayCompletionCacheForStudent
};
