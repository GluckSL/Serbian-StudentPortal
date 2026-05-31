/**
 * Cleanup: remove legacy "general" batch type (map to "new").
 */
const BatchConfig = require('../models/BatchConfig');

async function migrateBatchTypesFromGeneralToNew() {
  const result = await BatchConfig.updateMany(
    { batchType: 'general' },
    { $set: { batchType: 'new' } }
  );
  const n = result.modifiedCount ?? result.nModified ?? 0;
  if (n > 0) {
    console.log(`[migrateBatchTypes] Converted ${n} batch(es) from general → new`);
  }
  return n;
}

module.exports = { migrateBatchTypesFromGeneralToNew };
