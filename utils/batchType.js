const BATCH_TYPE_NEW = 'new';
const BATCH_TYPE_OLD = 'old';
const BATCH_TYPE_NEW2 = 'new2';

const VALID_BATCH_TYPES = [BATCH_TYPE_NEW, BATCH_TYPE_OLD, BATCH_TYPE_NEW2];

function normalizeBatchType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t === BATCH_TYPE_OLD) return BATCH_TYPE_OLD;
  if (t === BATCH_TYPE_NEW2) return BATCH_TYPE_NEW2;
  if (t === 'general') return BATCH_TYPE_NEW;
  return BATCH_TYPE_NEW;
}

function isValidBatchTypeInput(type) {
  const t = String(type || '').trim().toLowerCase();
  return (
    t === BATCH_TYPE_NEW ||
    t === BATCH_TYPE_OLD ||
    t === BATCH_TYPE_NEW2 ||
    t === 'general'
  );
}

function isLearningEnabled(type) {
  const t = normalizeBatchType(type);
  return t === BATCH_TYPE_NEW || t === BATCH_TYPE_NEW2;
}

function isNew2BatchType(type) {
  return normalizeBatchType(type) === BATCH_TYPE_NEW2;
}

function isOldBatchType(type) {
  return normalizeBatchType(type) === BATCH_TYPE_OLD;
}

function batchTypeLabel(type) {
  const t = normalizeBatchType(type);
  if (t === BATCH_TYPE_OLD) return 'Old (live + optional DG Bot)';
  if (t === BATCH_TYPE_NEW2) return 'New batch 2.0 (2.0 modules + exercises)';
  return 'New (full content)';
}

/** Student exercise list: new2 → v2 only (must be assigned to student's batch); new → v1 only. */
function exerciseVersionClauseForBatch(batchType, batchKeys = []) {
  const t = normalizeBatchType(batchType);
  if (t === BATCH_TYPE_NEW2) {
    const keys = Array.isArray(batchKeys) ? batchKeys.filter(Boolean) : [];
    if (!keys.length) {
      // Student has no batch — do not show unassigned v2 exercises.
      return { version: 'v2', targetBatches: { $in: ['__no_batch__'] } };
    }
    // Empty targetBatches on an exercise means not yet assigned — hidden from students.
    return {
      version: 'v2',
      targetBatches: { $in: keys },
    };
  }
  return { $or: [{ version: { $ne: 'v2' } }, { version: { $exists: false } }] };
}

/** Student DG module list: new2 → v2 only; new → v1 only. */
function dgModuleVersionClauseForBatch(batchType) {
  const t = normalizeBatchType(batchType);
  if (t === BATCH_TYPE_NEW2) {
    return { version: 'v2' };
  }
  return { $or: [{ version: { $ne: 'v2' } }, { version: { $exists: false } }] };
}

function exerciseVersionAllowedForStudent(batchType, exercise, batchKeys = []) {
  const t = normalizeBatchType(batchType);
  const isV2 = exercise?.version === 'v2';
  if (t === BATCH_TYPE_NEW2) {
    if (!isV2) return false;
    const targets = Array.isArray(exercise?.targetBatches) ? exercise.targetBatches : [];
    if (!targets.length) return false;
    const keys = Array.isArray(batchKeys) ? batchKeys : [];
    return keys.some((key) => targets.includes(key));
  }
  return !isV2;
}

module.exports = {
  BATCH_TYPE_NEW,
  BATCH_TYPE_OLD,
  BATCH_TYPE_NEW2,
  VALID_BATCH_TYPES,
  normalizeBatchType,
  isValidBatchTypeInput,
  isLearningEnabled,
  isNew2BatchType,
  isOldBatchType,
  batchTypeLabel,
  exerciseVersionClauseForBatch,
  dgModuleVersionClauseForBatch,
  exerciseVersionAllowedForStudent,
};
