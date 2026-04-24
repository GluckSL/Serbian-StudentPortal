/**
 * Per-day journey task completion: modules + digital exercises + live classes (attendance).
 * Used for strict batch rules (% threshold) and admin task checks.
 */

const DigitalExercise = require('../models/DigitalExercise');
const LearningModule = require('../models/LearningModule');
const MeetingLink = require('../models/MeetingLink');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const StudentProgress = require('../models/StudentProgress');

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
  const batchNames = Array.isArray(batchNameOrNames)
    ? batchNameOrNames.map((b) => String(b || '').trim()).filter(Boolean)
    : batchNameOrNames
      ? [String(batchNameOrNames).trim()]
      : [];

  const modules = await LearningModule.find({
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
  const moduleDone = completedModuleSet.size;
  const moduleTotal = moduleIds.length;
  const incompleteModules = modules
    .filter((m) => !completedModuleSet.has(String(m._id)))
    .map((m) => ({
      kind: 'module',
      title: m.title && String(m.title).trim() ? m.title : 'Module',
      courseDay: day
    }));

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
  const completionPercent = totalTasks === 0 ? 100 : Math.floor((100 * doneTasks) / totalTasks);
  const complete = totalTasks === 0 || doneTasks === totalTasks;
  const incompleteTasks = [...incompleteModules, ...incompleteExercises, ...incompleteClasses];

  return {
    complete,
    incompleteTasks,
    totalTasks,
    doneTasks,
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
