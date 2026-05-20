const BATCH_TYPE_NEW = 'new';
const BATCH_TYPE_OLD = 'old';

const VALID_BATCH_TYPES = [BATCH_TYPE_NEW, BATCH_TYPE_OLD];

function normalizeBatchType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (t === BATCH_TYPE_OLD) return BATCH_TYPE_OLD;
  if (t === 'general') return BATCH_TYPE_NEW;
  return BATCH_TYPE_NEW;
}

function isValidBatchTypeInput(type) {
  const t = String(type || '').trim().toLowerCase();
  return t === BATCH_TYPE_NEW || t === BATCH_TYPE_OLD || t === 'general';
}

function isLearningEnabled(type) {
  return normalizeBatchType(type) === BATCH_TYPE_NEW;
}

function isOldBatchType(type) {
  return normalizeBatchType(type) === BATCH_TYPE_OLD;
}

function batchTypeLabel(type) {
  return isOldBatchType(type) ? 'Old (live only)' : 'New (full content)';
}

module.exports = {
  BATCH_TYPE_NEW,
  BATCH_TYPE_OLD,
  VALID_BATCH_TYPES,
  normalizeBatchType,
  isValidBatchTypeInput,
  isLearningEnabled,
  isOldBatchType,
  batchTypeLabel
};
