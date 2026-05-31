const { allStudentBatchStringsForContent, normalizeBatch } = require('./effectiveStudentBatch');

function normalizeBatchKey(value) {
  return normalizeBatch(value);
}

function normalizeBatchKeys(values) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(values) ? values : []) {
    const k = normalizeBatchKey(v);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function studentTargetBatchKeys(student) {
  const labels = allStudentBatchStringsForContent(student);
  return normalizeBatchKeys(labels);
}

/**
 * Mongo query snippet: module is visible to the student batch when:
 * - module has no batch keys (unassigned = visible to all), OR
 * - module targetBatchKeys intersects student's target batch keys.
 */
function moduleTargetingQuery(studentKeys) {
  const keys = Array.isArray(studentKeys) ? studentKeys.filter(Boolean) : [];
  return {
    $or: [
      { targetBatchKeys: { $exists: false } },
      { targetBatchKeys: { $size: 0 } },
      ...(keys.length ? [{ targetBatchKeys: { $in: keys } }] : []),
    ],
  };
}

module.exports = {
  normalizeBatchKey,
  normalizeBatchKeys,
  studentTargetBatchKeys,
  moduleTargetingQuery,
};

