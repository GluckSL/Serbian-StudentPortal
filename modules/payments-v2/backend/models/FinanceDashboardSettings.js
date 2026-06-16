const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  visibleBatches: {
    type: [String],
    default: [],
  },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

schema.statics.getOrCreate = async function getOrCreate() {
  let doc = await this.findById('global').lean();
  if (!doc) {
    doc = await this.create({ _id: 'global', visibleBatches: [] });
    return doc.toObject ? doc.toObject() : doc;
  }
  return doc;
};

function normalizeBatchList(batches) {
  if (!Array.isArray(batches)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of batches) {
    const label = String(raw || '').trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

schema.statics.setVisibleBatches = async function setVisibleBatches(batches, updatedBy) {
  const visibleBatches = normalizeBatchList(batches);
  return this.findByIdAndUpdate(
    'global',
    {
      $set: {
        visibleBatches,
        updatedAt: new Date(),
        updatedBy: updatedBy || undefined,
      },
    },
    { new: true, upsert: true },
  ).lean();
};

module.exports = mongoose.model('FinanceDashboardSettings', schema, 'finance_dashboard_settings');
