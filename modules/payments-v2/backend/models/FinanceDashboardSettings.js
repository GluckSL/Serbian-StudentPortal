const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  visibleBatches: {
    type: [String],
    default: [],
  },
  visibleBatchLevelStatuses: {
    type: Map,
    of: String,
    default: {},
  },
  /** Manual next payment dates for old batches (batch name → YYYY-MM-DD). */
  manualNextPaymentDates: {
    type: Map,
    of: String,
    default: {},
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

function normalizeBatchLevelStatuses(raw, visibleBatches, existing = {}) {
  const allowed = new Set(['A1:ONGOING', 'A1:COMPLETED', 'A2:ONGOING', 'A2:COMPLETED', 'B1:ONGOING', 'B1:COMPLETED', 'B2:ONGOING', 'B2:COMPLETED']);
  const source = raw && typeof raw === 'object' ? raw : existing;
  const out = {};
  for (const batch of visibleBatches) {
    const value = String(source[batch] || '').trim().toUpperCase();
    if (allowed.has(value)) out[batch] = value;
  }
  return out;
}

schema.statics.setVisibleBatches = async function setVisibleBatches(batches, updatedBy, batchLevelStatuses) {
  const visibleBatches = normalizeBatchList(batches);
  const existing = await this.findById('global').lean();
  const existingStatuses =
    existing?.visibleBatchLevelStatuses instanceof Map
      ? Object.fromEntries(existing.visibleBatchLevelStatuses)
      : existing?.visibleBatchLevelStatuses || {};
  const existingManualDates =
    existing?.manualNextPaymentDates instanceof Map
      ? Object.fromEntries(existing.manualNextPaymentDates)
      : existing?.manualNextPaymentDates || {};
  const visibleBatchLevelStatuses = normalizeBatchLevelStatuses(batchLevelStatuses, visibleBatches, existingStatuses);
  const manualNextPaymentDates = {};
  for (const batch of visibleBatches) {
    if (existingManualDates[batch]) manualNextPaymentDates[batch] = existingManualDates[batch];
  }
  return this.findByIdAndUpdate(
    'global',
    {
      $set: {
        visibleBatches,
        visibleBatchLevelStatuses,
        manualNextPaymentDates,
        updatedAt: new Date(),
        updatedBy: updatedBy || undefined,
      },
    },
    { new: true, upsert: true },
  ).lean();
};

schema.statics.setManualNextPaymentDate = async function setManualNextPaymentDate(batch, dateIso, updatedBy) {
  const label = String(batch || '').trim();
  if (!label) throw new Error('batch is required.');

  const existing = await this.findById('global').lean();
  const manualDates =
    existing?.manualNextPaymentDates instanceof Map
      ? Object.fromEntries(existing.manualNextPaymentDates)
      : { ...(existing?.manualNextPaymentDates || {}) };

  if (dateIso) {
    manualDates[label] = String(dateIso).trim();
  } else {
    delete manualDates[label];
  }

  return this.findByIdAndUpdate(
    'global',
    {
      $set: {
        manualNextPaymentDates: manualDates,
        updatedAt: new Date(),
        updatedBy: updatedBy || undefined,
      },
    },
    { new: true, upsert: true },
  ).lean();
};

module.exports = mongoose.model('FinanceDashboardSettings', schema, 'finance_dashboard_settings');
