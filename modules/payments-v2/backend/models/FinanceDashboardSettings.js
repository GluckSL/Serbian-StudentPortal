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
  /** Admin remarks per batch on the finance dashboard. */
  batchRemarks: {
    type: Map,
    of: String,
    default: {},
  },
  /** Manual projected next-level amounts per batch ({ lkr?, inr? }). */
  manualCommencementAmounts: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
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
  const existingRemarks =
    existing?.batchRemarks instanceof Map
      ? Object.fromEntries(existing.batchRemarks)
      : { ...(existing?.batchRemarks || {}) };
  const batchRemarks = {};
  for (const batch of visibleBatches) {
    if (existingRemarks[batch]) batchRemarks[batch] = existingRemarks[batch];
  }
  const existingManualAmounts =
    existing?.manualCommencementAmounts instanceof Map
      ? Object.fromEntries(existing.manualCommencementAmounts)
      : { ...(existing?.manualCommencementAmounts || {}) };
  const manualCommencementAmounts = {};
  for (const batch of visibleBatches) {
    if (existingManualAmounts[batch]) manualCommencementAmounts[batch] = existingManualAmounts[batch];
  }
  return this.findByIdAndUpdate(
    'global',
    {
      $set: {
        visibleBatches,
        visibleBatchLevelStatuses,
        manualNextPaymentDates,
        batchRemarks,
        manualCommencementAmounts,
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

schema.statics.setBatchRemark = async function setBatchRemark(batch, remark, updatedBy) {
  const label = String(batch || '').trim();
  if (!label) throw new Error('batch is required.');

  const existing = await this.findById('global').lean();
  const remarks =
    existing?.batchRemarks instanceof Map
      ? Object.fromEntries(existing.batchRemarks)
      : { ...(existing?.batchRemarks || {}) };

  const text = remark == null ? '' : String(remark).trim();
  if (text) {
    remarks[label] = text.slice(0, 500);
  } else {
    delete remarks[label];
  }

  return this.findByIdAndUpdate(
    'global',
    {
      $set: {
        batchRemarks: remarks,
        updatedAt: new Date(),
        updatedBy: updatedBy || undefined,
      },
    },
    { new: true, upsert: true },
  ).lean();
};

function normalizeCommencementAmount(value) {
  if (!value || typeof value !== 'object') return null;
  const lkr = value.lkr == null || value.lkr === '' ? null : Number(value.lkr);
  const inr = value.inr == null || value.inr === '' ? null : Number(value.inr);
  const out = {};
  if (lkr != null && Number.isFinite(lkr) && lkr >= 0) out.lkr = Math.round(lkr);
  if (inr != null && Number.isFinite(inr) && inr >= 0) out.inr = Math.round(inr);
  return Object.keys(out).length ? out : null;
}

schema.statics.setManualCommencementAmount = async function setManualCommencementAmount(batch, amounts, updatedBy) {
  const label = String(batch || '').trim();
  if (!label) throw new Error('batch is required.');

  const existing = await this.findById('global').lean();
  const manualAmounts =
    existing?.manualCommencementAmounts instanceof Map
      ? Object.fromEntries(existing.manualCommencementAmounts)
      : { ...(existing?.manualCommencementAmounts || {}) };

  const normalized = normalizeCommencementAmount(amounts);
  if (normalized) {
    manualAmounts[label] = normalized;
  } else {
    delete manualAmounts[label];
  }

  return this.findByIdAndUpdate(
    'global',
    {
      $set: {
        manualCommencementAmounts: manualAmounts,
        updatedAt: new Date(),
        updatedBy: updatedBy || undefined,
      },
    },
    { new: true, upsert: true },
  ).lean();
};

module.exports = mongoose.model('FinanceDashboardSettings', schema, 'finance_dashboard_settings');
