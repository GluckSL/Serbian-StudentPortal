/**
 * One-time style migration: batches incorrectly stored as "general" after the
 * new→general rename should be restored to "new" (full journey content).
 */
const BatchConfig = require('../models/BatchConfig');

async function migrateBatchTypesFromGeneralToNew() {
  const result = await BatchConfig.updateMany(
    { batchType: 'general' },
    { $set: { batchType: 'new' } }
  );
  const n = result.modifiedCount ?? result.nModified ?? 0;
  if (n > 0) {
    console.log(`[migrateBatchTypes] Restored ${n} batch(es) from general → new`);
  }
  return n;
}

module.exports = { migrateBatchTypesFromGeneralToNew };
