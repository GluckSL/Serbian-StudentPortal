// services/ensurePortalBatches.js
// Upsert BatchConfig rows for preset portal batches (idempotent on server start).

const BatchConfig = require('../models/BatchConfig');
const { PORTAL_BATCH_PRESETS } = require('../utils/portalBatchPresets');

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ensurePortalBatches() {
  let created = 0;
  for (const batchName of PORTAL_BATCH_PRESETS) {
    const bn = String(batchName || '').trim();
    if (!bn) continue;
    const exists = await BatchConfig.findOne({
      batchName: new RegExp(`^${escapeRegExp(bn)}$`, 'i')
    }).select('_id').lean();
    if (!exists) {
      await BatchConfig.create({ batchName: bn });
      created += 1;
    }
  }
  if (created > 0) {
    console.log(`✅ Portal batches: created ${created} preset batch config(s).`);
  }
}

module.exports = { ensurePortalBatches };
