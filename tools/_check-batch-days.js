require('dotenv').config();
const mongoose = require('mongoose');
const BatchConfig = require('../models/BatchConfig');
const { computeBatchDay } = require('../utils/journeyPause');
const { levelForJourneyDay } = require('../services/journeyLevelSync.service');
const { normBatchKey } = require('../utils/portalBatchPresets');

function cfgForName(name, configs) {
  let cfg = configs.find((c) => c.batchName === name);
  if (cfg) return cfg;
  const target = normBatchKey(name);
  return configs.find((c) => normBatchKey(c.batchName) === target) || null;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const configs = await BatchConfig.find({ batchName: { $in: ['35', '36', '37', '38', '39', '40'] } }).lean();

  for (const name of ['35', '36', '37', '38', '39', '40']) {
    const saved = cfgForName(name, configs);
    const day = computeBatchDay(saved || { batchCurrentDay: 1 });
    const level = levelForJourneyDay(day);
    console.log(
      `Batch ${name}: day=${day}, level=${level}, batchType=${saved?.batchType}, start=${saved?.batchStartDate?.toISOString?.()?.slice(0, 10)}`
    );
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
