/**
 * Per-day journey task completion: modules + digital exercises + live classes (attendance).
 * Used for strict batch rules (% threshold) and admin task checks.
 */

const DigitalExercise = require('../models/DigitalExercise');
const mongoose = require('mongoose');
const LearningModule = require('../models/LearningModule');
const MeetingLink = require('../models/MeetingLink');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const StudentProgress = require('../models/StudentProgress');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const ZoomRecording = require('../models/ZoomRecording');
const ZoomRecordingView = require('../models/ZoomRecordingView');
const DGModule = require('../models/DGModule');
const DGSession = require('../models/DGSession');
const { studentTargetBatchKeys, moduleTargetingQuery } = require('../utils/batchTargeting');
const { batchesAlign } = require('../utils/effectiveStudentBatch');

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string|import('mongoose').Types.ObjectId} studentId
 * @param {string|string[]} batchNameOrNames
 * @param {number} day
 * @param {{ creditMeetings?: (string|import('mongoose').Types.ObjectId)[] }} [options]
 *   creditMeetings — meeting IDs to treat as attended (e.g. recording watch gate just satisfied)
 */
async function computeJourneyDayCompletion(studentId, batchNameOrNames, day, options = {}) {
  const creditMeetingIds = new Set((options.creditMeetings || []).map((id) => String(id)));
  const includeRecordings = options.includeRecordings === true;
  const includeDg = options.includeDg === true;
  /** Silver GO journey uses exercises + DG + recordings only (learning modules hidden in My Course). */
  const includeLearningModules = options.includeLearningModules !== false;
  const studentLevel = String(options.studentLevel || '').toUpperCase().trim();
  const studentPlan = String(options.studentPlan || '').toUpperCase().trim();
  const batchNames = Array.isArray(batchNameOrNames)
    ? batchNameOrNames.map((b) => String(b || '').trim()).filter(Boolean)
    : batchNameOrNames
      ? [String(batchNameOrNames).trim()]
      : [];
  const studentObjectId = mongoose.Types.ObjectId.isValid(String(studentId))
    ? new mongoose.Types.ObjectId(String(studentId))
    : null;

  let modules = [];
  let moduleDone = 0;
  let moduleTotal = 0;
  const incompleteModules = [];
  if (includeLearningModules) {
    modules = await LearningModule.find({
      isDeleted: { $ne: true },
      visibleToStudents: true,
      courseDay: day
    })
      .select('_id title')
      .lean();

    const moduleIds = modules.map((m) => m._id);
    const completedModuleIds = moduleIds.length
      ? await StudentProgress.find({
          studentId,
          moduleId: { $in: moduleIds },
          status: 'completed'
        }).distinct('moduleId')
      : [];

    const completedModuleSet = new Set(completedModuleIds.map((id) => String(id)));
    moduleDone = completedModuleSet.size;
    moduleTotal = moduleIds.length;
    for (const m of modules) {
      if (!completedModuleSet.has(String(m._id))) {
        incompleteModules.push({
          kind: 'module',
          title: m.title && String(m.title).trim() ? m.title : 'Module',
          courseDay: day
        });
      }
    }
  }

  const exercises = await DigitalExercise.find({
    isDeleted: { $ne: true },
    visibleToStudents: true,
    isActive: true,
    courseDay: day
  })
    .select('_id title')
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
  if (batchNames.length) {
    const batchOr = batchNames.map((n) => ({
      batch: new RegExp(`^${escapeRegExp(n)}$`, 'i')
    }));
    classes = await MeetingLink.find({
      $or: batchOr,
      courseDay: day,
      status: { $ne: 'cancelled' }
    })
      .select('_id topic attendance')
      .lean();
  }

  let classDone = 0;
  const classTotal = classes.length;
  const incompleteClasses = [];
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

  const totalTasks = moduleTotal + exerciseTotal + classTotal;
  const doneTasks = moduleDone + exerciseDone + classDone;
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
      .select('_id title batches')
      .lean();
    const visibleManual = manualRecordings.filter((r) => {
      const recBatches = Array.isArray(r.batches) ? r.batches : [];
      if (!recBatches.length || !batchNames.length) return false;
      return recBatches.some((rb) => batchNames.some((sb) => batchesAlign(sb, rb)));
    });
    if (visibleManual.length) {
      const manualIds = visibleManual.map((r) => r._id);
      const watchedManual = studentObjectId ? await RecordingView.aggregate([
        { $match: { student: studentObjectId, recording: { $in: manualIds }, watchDuration: { $gt: 0 } } },
        { $group: { _id: '$recording' } }
      ]) : [];
      const watchedManualSet = new Set(watchedManual.map((w) => String(w._id)));
      recordingTotal += visibleManual.length;
      for (const rec of visibleManual) {
        if (watchedManualSet.has(String(rec._id))) recordingDone++;
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
        .select('meetingLinkId accessBatches accessLevel accessPlan')
        .lean();
      const visibleZoom = zoomRows.filter((zr) => {
        const levelOk = !zr.accessLevel || !studentLevel || String(zr.accessLevel).toUpperCase() === studentLevel;
        const plan = String(zr.accessPlan || 'ALL').toUpperCase();
        const planOk = plan === 'ALL' || !studentPlan || plan === studentPlan;
        if (!levelOk || !planOk) return false;
        const recBatches = Array.isArray(zr.accessBatches) ? zr.accessBatches : [];
        if (!recBatches.length || !batchNames.length) return false;
        return recBatches.some((rb) => batchNames.some((sb) => batchesAlign(sb, rb)));
      });
      if (visibleZoom.length) {
        const zoomMeetingIds = visibleZoom.map((z) => z.meetingLinkId);
        const watchedZoom = studentObjectId ? await ZoomRecordingView.aggregate([
          { $match: { student: studentObjectId, meetingLinkId: { $in: zoomMeetingIds }, watchDuration: { $gt: 0 } } },
          { $group: { _id: '$meetingLinkId' } }
        ]) : [];
        const watchedZoomSet = new Set(watchedZoom.map((w) => String(w._id)));
        const classTopicMap = new Map(classes.map((c) => [String(c._id), c.topic]));
        recordingTotal += visibleZoom.length;
        for (const zr of visibleZoom) {
          const id = String(zr.meetingLinkId);
          if (watchedZoomSet.has(id) || creditMeetingIds.has(id)) recordingDone++;
          else {
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
    const dgStudent = {
      batch: batchNames[0] || '',
      goStatus: options.goStatus || '',
      subscription: options.subscription || ''
    };
    const studentBatchKeys = studentTargetBatchKeys(dgStudent);
    const dgModules = await DGModule.find({
      isActive: true,
      visibleToStudents: true,
      courseDay: day,
      ...moduleTargetingQuery(studentBatchKeys)
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
  const incompleteTasks = [...incompleteModules, ...incompleteExercises, ...incompleteClasses, ...incompleteRecordings, ...incompleteDg];

  return {
    complete,
    incompleteTasks,
    totalTasks: finalTotalTasks,
    doneTasks: finalDoneTasks,
    completionPercent,
    breakdown: {
      modules: {
        done: moduleDone,
        total: moduleTotal,
        items: modules.map((m) => ({ _id: m._id, title: m.title }))
      },
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
}

function meetsStrictThreshold(completion, cfg) {
  if (!cfg || !cfg.strictJourneyRule) return true;
  const raw = Number(cfg.strictJourneyThresholdPercent);
  const threshold = Number.isFinite(raw) ? Math.min(100, Math.max(1, Math.round(raw))) : 100;
  if (completion.totalTasks === 0) return true;
  return completion.completionPercent >= threshold;
}

module.exports = {
  computeJourneyDayCompletion,
  meetsStrictThreshold
};
