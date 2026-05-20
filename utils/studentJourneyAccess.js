const BatchConfig = require('../models/BatchConfig');
const { allStudentBatchStringsForContent, normalizeBatch } = require('./effectiveStudentBatch');
const { BATCH_TYPE_OLD, normalizeBatchType, isLearningEnabled } = require('./batchType');

function normalizeJourneyDay(rawDay) {
  if (rawDay != null && Number.isFinite(Number(rawDay))) {
    return Math.min(200, Math.max(1, Math.floor(Number(rawDay))));
  }
  return 1;
}

/**
 * Content access rule for STUDENT users:
 * - GO students always have journey content access.
 * - Non-GO students require at least one active BatchConfig (journeyActive=true)
 *   matching their effective batch keys.
 * Only 'new' batch type enables modules and exercises.
 * 'general' and 'old' allow live/recordings only (no module content).
 */
async function getJourneyAccessForStudent(student) {
  if (!student || String(student.role || '').toUpperCase() !== 'STUDENT') {
    return { enabled: true, learningEnabled: true, courseDay: 1, batchKeys: [], batchType: BATCH_TYPE_OLD };
  }

  const courseDay = normalizeJourneyDay(student.currentCourseDay);
  const isGoStudent = String(student.goStatus || '').toUpperCase() === 'GO';
  const batchKeys = allStudentBatchStringsForContent(student);

  if (isGoStudent) {
    return { enabled: true, learningEnabled: true, courseDay, batchKeys, batchType: BATCH_TYPE_OLD, reason: 'GO_STUDENT' };
  }
  if (!batchKeys.length) {
    return { enabled: false, learningEnabled: false, courseDay, batchKeys, batchType: BATCH_TYPE_OLD, reason: 'NO_BATCH' };
  }

  const activeBatchConfigs = await BatchConfig.find({ journeyActive: true })
    .select('batchName batchType')
    .lean();
  const activeMap = new Map();
  for (const cfg of activeBatchConfigs) {
    const key = normalizeBatch(cfg.batchName);
    if (!key) continue;
    activeMap.set(key, cfg);
  }
  const matchedConfigs = batchKeys
    .map((key) => activeMap.get(normalizeBatch(key)))
    .filter(Boolean);
  const enabled = matchedConfigs.length > 0;
  const hasLearningType = matchedConfigs.some((cfg) => isLearningEnabled(cfg.batchType));
  const learningEnabled = enabled && hasLearningType;
  const primaryCfg = matchedConfigs[0] || null;
  const batchType = primaryCfg ? normalizeBatchType(primaryCfg.batchType) : BATCH_TYPE_OLD;

  return {
    enabled,
    learningEnabled,
    courseDay,
    batchKeys,
    batchType,
    reason: !enabled
      ? 'BATCH_NOT_ACTIVE'
      : learningEnabled
        ? 'ACTIVE_BATCH'
        : 'OLD_BATCH_LEARNING_DISABLED'
  };
}

async function getJourneyAccessForStudentId(UserModel, studentId) {
  const student = await UserModel.findById(studentId)
    .select('role batch goStatus subscription currentCourseDay')
    .lean();
  if (!student) return { enabled: false, learningEnabled: false, courseDay: 1, batchKeys: [], batchType: BATCH_TYPE_OLD, reason: 'STUDENT_NOT_FOUND' };
  return getJourneyAccessForStudent(student);
}

module.exports = {
  normalizeJourneyDay,
  getJourneyAccessForStudent,
  getJourneyAccessForStudentId
};
