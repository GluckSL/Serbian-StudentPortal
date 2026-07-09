require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const BatchConfig = require('../models/BatchConfig');
const { mergePortalBatchNames } = require('../utils/portalBatchPresets');
const { computeBatchDay } = require('../utils/journeyPause');
const { levelForJourneyDay, isOldBatchType } = require('../services/journeyLevelSync.service');
const { BATCH_TYPE_OLD, normalizeBatchType } = require('../utils/batchType');
const { EXCLUDE_TEST } = require('../utils/analyticsFilters');

const MIN_BATCH = 35;
const levelOptions = ['A1', 'A2', 'B1', 'B2'];

function isEligible(batchName, batchType) {
  if (String(batchType || '').toLowerCase() === 'old') return false;
  const label = String(batchName || '').trim();
  if (/test/i.test(label)) return false;
  if (!/^(\d+)$/.test(label)) return false;
  return parseInt(label, 10) >= MIN_BATCH;
}

function initLevelFilter(rows) {
  const active = new Set(
    rows.map((b) => b.batchLevel).filter((lv) => lv && levelOptions.includes(lv))
  );
  return active.size ? active : new Set(levelOptions);
}

function visibleBatches(rows, selectedLevels) {
  return rows.filter((b) => !b.batchLevel || selectedLevels.has(b.batchLevel));
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const studentBatchNames = await User.distinct('batch', { role: 'STUDENT', batch: { $ne: null, $ne: '' } });
  const configBatchNames = await BatchConfig.distinct('batchName', { batchName: { $ne: null, $ne: '' } });
  const allBatchNames = mergePortalBatchNames([...new Set([...studentBatchNames, ...configBatchNames])]);
  const configs = await BatchConfig.find({ batchName: { $in: allBatchNames } }).lean();
  const configMap = Object.fromEntries(configs.map((c) => [c.batchName, c]));

  const allRows = allBatchNames.map((name) => {
    const cfg = configMap[name] || { batchType: BATCH_TYPE_OLD, journeyActive: false };
    const day = computeBatchDay(cfg);
    const batchType = normalizeBatchType(cfg.batchType);
    const batchLevel = isOldBatchType(batchType) ? cfg.oldBatchManualLevel || 'A1' : levelForJourneyDay(day);
    return { batchName: name, batchType, batchLevel, batchCurrentDay: day, journeyActive: !!cfg.journeyActive };
  });

  const combined = [...allRows.filter((b) => b.journeyActive), ...allRows.filter((b) => !b.journeyActive)];
  const eligible = combined.filter((b) => isEligible(b.batchName, b.batchType));
  const selectedLevels = initLevelFilter(eligible);
  const visible = visibleBatches(eligible, selectedLevels);

  const counts = await User.aggregate([
    { $match: { role: 'STUDENT', batch: { $in: visible.map((b) => b.batchName) }, ...EXCLUDE_TEST } },
    { $group: { _id: '$batch', count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);
  const total = counts.reduce((s, c) => s + c.count, 0);

  console.log('Eligible:', eligible.map((b) => `${b.batchName}(${b.batchLevel})`).join(', '));
  console.log('Selected levels:', [...selectedLevels]);
  console.log('Visible:', visible.map((b) => `${b.batchName}(${b.batchLevel})`).join(', '));
  console.log('Batch 35 visible?', visible.some((b) => b.batchName === '35'));
  console.log('Visible student total:', total);

  // Simulate progress updating batch 35 to B1 while init had A2
  const rows = eligible.map((b) => ({ ...b }));
  const b35 = rows.find((b) => b.batchName === '35');
  if (b35) {
    const initLevels = initLevelFilter(rows);
    b35.batchLevel = 'B1';
    const after = visibleBatches(rows, initLevels);
    console.log('\nIf batch 35 level changes A2→B1 after init:');
    console.log('Init levels:', [...initLevels]);
    console.log('Visible after:', after.map((b) => b.batchName).join(', '));
    console.log('Batch 35 visible?', after.some((b) => b.batchName === '35'));
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
