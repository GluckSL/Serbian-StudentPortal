const BatchConfig = require('../models/BatchConfig');
const { allStudentBatchStringsForContent, normalizeBatch } = require('./effectiveStudentBatch');
const { BATCH_TYPE_NEW, normalizeBatchType, isLearningEnabled, isOldBatchType } = require('./batchType');
const { isSilverGoStudent } = require('./goSilverTrack');
const { resolveSilverGoContentUnlock } = require('./silverGoSequentialUnlock');

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
 */
async function getJourneyAccessForStudent(student) {
  if (!student || String(student.role || '').toUpperCase() !== 'STUDENT') {
    return {
      enabled: true,
      learningEnabled: true,
      dgBotEnabled: true,
      dgUnlockMode: 'daily',
      courseDay: 1,
      batchKeys: [],
      batchType: BATCH_TYPE_NEW,
    };
  }

  let courseDay = normalizeJourneyDay(student.currentCourseDay);
  const isGoStudent = String(student.goStatus || '').toUpperCase() === 'GO';
  const batchKeys = allStudentBatchStringsForContent(student);

  if (isGoStudent) {
    let maxUnlockedContentDay = courseDay;
    if (isSilverGoStudent(student)) {
      const unlock = await resolveSilverGoContentUnlock(student);
      maxUnlockedContentDay = unlock.maxUnlockedContentDay;
      courseDay = maxUnlockedContentDay;
    }
    return {
      enabled: true,
      learningEnabled: true,
      dgBotEnabled: true,
      dgUnlockMode: 'daily',
      courseDay,
      maxUnlockedContentDay,
      batchKeys,
      batchType: BATCH_TYPE_NEW,
      reason: 'GO_STUDENT',
    };
  }
  if (!batchKeys.length) {
    return {
      enabled: false,
      learningEnabled: false,
      dgBotEnabled: false,
      dgUnlockMode: 'none',
      courseDay,
      batchKeys,
      batchType: BATCH_TYPE_NEW,
      reason: 'NO_BATCH',
    };
  }

  const activeBatchConfigs = await BatchConfig.find({ journeyActive: true })
    .select('batchName batchType oldBatchDgBotAccess')
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
  const hasNewBatchType = matchedConfigs.some((cfg) => isLearningEnabled(cfg.batchType));
  const learningEnabled = enabled && hasNewBatchType;
  const hasOldDgAccess = matchedConfigs.some(
    (cfg) => isOldBatchType(cfg.batchType) && !!cfg.oldBatchDgBotAccess
  );
  const dgBotEnabled = enabled && (hasNewBatchType || hasOldDgAccess);
  const dgUnlockMode = hasNewBatchType ? 'daily' : hasOldDgAccess ? 'weekly' : 'none';
  const primaryCfg = matchedConfigs[0] || null;
  const batchType = primaryCfg ? normalizeBatchType(primaryCfg.batchType) : BATCH_TYPE_NEW;

  return {
    enabled,
    learningEnabled,
    dgBotEnabled,
    dgUnlockMode,
    courseDay,
    batchKeys,
    batchType,
    reason: !enabled
      ? 'BATCH_NOT_ACTIVE'
      : learningEnabled
        ? 'ACTIVE_BATCH'
        : dgBotEnabled
          ? 'OLD_BATCH_DG_BOT'
          : 'OLD_BATCH_LEARNING_DISABLED',
  };
}

async function getJourneyAccessForStudentId(UserModel, studentId) {
  const student = await UserModel.findById(studentId)
    .select('role batch goStatus subscription currentCourseDay')
    .lean();
  if (!student) {
    return {
      enabled: false,
      learningEnabled: false,
      dgBotEnabled: false,
      dgUnlockMode: 'none',
      courseDay: 1,
      batchKeys: [],
      batchType: BATCH_TYPE_NEW,
      reason: 'STUDENT_NOT_FOUND',
    };
  }
  return getJourneyAccessForStudent(student);
}

module.exports = {
  normalizeJourneyDay,
  getJourneyAccessForStudent,
  getJourneyAccessForStudentId,
};
