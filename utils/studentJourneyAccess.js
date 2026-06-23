const BatchConfig = require('../models/BatchConfig');
const { allStudentBatchStringsForContent, normalizeBatch } = require('./effectiveStudentBatch');
const { BATCH_TYPE_NEW, normalizeBatchType, isLearningEnabled, isOldBatchType } = require('./batchType');
const { isSilverGoStudent } = require('./goSilverTrack');
const { resolveSilverGoContentUnlock } = require('./silverGoSequentialUnlock');
const { clampJourneyDayForBatch, clampStandardJourneyDay, contentUnlockDayForJourney } = require('./journeyDay');

function normalizeJourneyDay(rawDay, trialDayEnabled = false) {
  if (rawDay != null && Number.isFinite(Number(rawDay))) {
    return clampJourneyDayForBatch(rawDay, 200, trialDayEnabled);
  }
  return trialDayEnabled ? 0 : 1;
}

function resolveTrialDayEnabled(matchedConfigs) {
  return matchedConfigs.some((cfg) => !!cfg.trialDayEnabled);
}

function attachContentUnlock(access) {
  if (!access) return access;
  return {
    ...access,
    contentUnlockDay: contentUnlockDayForJourney(access.courseDay, access.trialDayEnabled),
  };
}

/**
 * Content access rule for STUDENT users:
 * - GO students always have journey content access.
 * - Non-GO students require at least one active BatchConfig (journeyActive=true)
 *   matching their effective batch keys.
 */
async function getJourneyAccessForStudent(student) {
  if (!student || String(student.role || '').toUpperCase() !== 'STUDENT') {
    return attachContentUnlock({
      enabled: true,
      learningEnabled: true,
      dgBotEnabled: true,
      dgUnlockMode: 'daily',
      courseDay: 1,
      trialDayEnabled: false,
      batchKeys: [],
      batchType: BATCH_TYPE_NEW,
    });
  }

  const batchKeys = allStudentBatchStringsForContent(student);
  const isGoStudent = String(student.goStatus || '').toUpperCase() === 'GO';

  if (isGoStudent) {
    let courseDay = normalizeJourneyDay(student.currentCourseDay, false);
    let maxUnlockedContentDay = courseDay;
    if (isSilverGoStudent(student)) {
      const unlock = await resolveSilverGoContentUnlock(student);
      maxUnlockedContentDay = unlock.maxUnlockedContentDay;
      courseDay = maxUnlockedContentDay;
    }
    return attachContentUnlock({
      enabled: true,
      learningEnabled: true,
      dgBotEnabled: true,
      dgUnlockMode: 'daily',
      courseDay,
      maxUnlockedContentDay,
      trialDayEnabled: false,
      batchKeys,
      batchType: BATCH_TYPE_NEW,
      reason: 'GO_STUDENT',
    });
  }

  const activeBatchConfigs = await BatchConfig.find({ journeyActive: true })
    .select('batchName batchType oldBatchDgBotAccess trialDayEnabled')
    .lean();
  const allBatchConfigs = await BatchConfig.find({})
    .select('batchName batchType oldBatchDgBotAccess trialDayEnabled journeyActive')
    .lean();
  const activeMap = new Map();
  for (const cfg of activeBatchConfigs) {
    const key = normalizeBatch(cfg.batchName);
    if (!key) continue;
    activeMap.set(key, cfg);
  }
  const allMap = new Map();
  for (const cfg of allBatchConfigs) {
    const key = normalizeBatch(cfg.batchName);
    if (!key) continue;
    allMap.set(key, cfg);
  }
  const matchedConfigs = batchKeys
    .map((key) => allMap.get(normalizeBatch(key)))
    .filter(Boolean);
  const activeMatched = batchKeys
    .map((key) => activeMap.get(normalizeBatch(key)))
    .filter(Boolean);
  const trialDayEnabled = resolveTrialDayEnabled(matchedConfigs);
  let courseDay = normalizeJourneyDay(student.currentCourseDay, trialDayEnabled);

  if (!batchKeys.length) {
    return attachContentUnlock({
      enabled: false,
      learningEnabled: false,
      dgBotEnabled: false,
      dgUnlockMode: 'none',
      courseDay,
      trialDayEnabled,
      batchKeys,
      batchType: BATCH_TYPE_NEW,
      reason: 'NO_BATCH',
    });
  }

  const enabled = activeMatched.length > 0;
  const hasNewBatchType = matchedConfigs.some((cfg) => isLearningEnabled(cfg.batchType));
  const learningEnabled = enabled && hasNewBatchType;
  const hasOldDgAccess = matchedConfigs.some(
    (cfg) => isOldBatchType(cfg.batchType) && !!cfg.oldBatchDgBotAccess
  );
  const dgBotEnabled = matchedConfigs.length > 0 && (hasNewBatchType || hasOldDgAccess);
  const dgUnlockMode = hasNewBatchType ? 'daily' : hasOldDgAccess ? 'weekly' : 'none';
  const primaryCfg = matchedConfigs[0] || null;
  const batchType = primaryCfg ? normalizeBatchType(primaryCfg.batchType) : BATCH_TYPE_NEW;

  return attachContentUnlock({
    enabled,
    learningEnabled,
    dgBotEnabled,
    dgUnlockMode,
    courseDay,
    trialDayEnabled,
    batchKeys,
    batchType,
    reason: !enabled
      ? 'BATCH_NOT_ACTIVE'
      : learningEnabled
        ? 'ACTIVE_BATCH'
        : dgBotEnabled
          ? 'OLD_BATCH_DG_BOT'
          : 'OLD_BATCH_LEARNING_DISABLED',
  });
}

async function getJourneyAccessForStudentId(UserModel, studentId) {
  const { SILVER_GO_STUDENT_SELECT } = require('./goSilverTrack');
  const student = await UserModel.findById(studentId)
    .select(SILVER_GO_STUDENT_SELECT)
    .lean();
  if (!student) {
    return attachContentUnlock({
      enabled: false,
      learningEnabled: false,
      dgBotEnabled: false,
      dgUnlockMode: 'none',
      courseDay: 1,
      trialDayEnabled: false,
      batchKeys: [],
      batchType: BATCH_TYPE_NEW,
      reason: 'STUDENT_NOT_FOUND',
    });
  }
  return getJourneyAccessForStudent(student);
}

module.exports = {
  normalizeJourneyDay,
  contentUnlockDayForJourney,
  getJourneyAccessForStudent,
  getJourneyAccessForStudentId,
};
