const BATCH_TYPE_GENERAL = 'general';
const BATCH_TYPE_NEW = 'new';
const BATCH_TYPE_OLD = 'old';

const VALID_BATCH_TYPES = [BATCH_TYPE_GENERAL, BATCH_TYPE_NEW, BATCH_TYPE_OLD];

/** Unknown / missing values default to old. */
function normalizeBatchType(type) {
  const t = String(type || '').trim().toLowerCase();
  if (VALID_BATCH_TYPES.includes(t)) return t;
  return BATCH_TYPE_OLD;
}

function isValidBatchTypeInput(type) {
  return VALID_BATCH_TYPES.includes(String(type || '').trim().toLowerCase());
}

/** Only "new" batches get modules + exercises; general and old do not. */
function isLearningEnabled(type) {
  return normalizeBatchType(type) === BATCH_TYPE_NEW;
}

function isOldBatchType(type) {
  return normalizeBatchType(type) === BATCH_TYPE_OLD;
}

function isNewBatchType(type) {
  return normalizeBatchType(type) === BATCH_TYPE_NEW;
}

function batchTypeLabel(type) {
  const t = normalizeBatchType(type);
  if (t === BATCH_TYPE_OLD) return 'Old (live classes & recordings only)';
  if (t === BATCH_TYPE_NEW) return 'New (modules, exercises & live classes)';
  return 'General (no module content; live classes & recordings)';
}

module.exports = {
  BATCH_TYPE_GENERAL,
  BATCH_TYPE_NEW,
  BATCH_TYPE_OLD,
  VALID_BATCH_TYPES,
  normalizeBatchType,
  isValidBatchTypeInput,
  isLearningEnabled,
  isOldBatchType,
  isNewBatchType,
  batchTypeLabel
};
