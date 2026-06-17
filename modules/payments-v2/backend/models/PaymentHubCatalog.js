const mongoose = require('mongoose');

const cefrRowSchema = new mongoose.Schema({
  code: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], required: true },
  order: { type: Number, required: true },
  lkr: { type: Number, default: 0 },
  inr: { type: Number, default: 0 },
}, { _id: false });

const referenceRowSchema = new mongoose.Schema({
  label: { type: String, required: true },
  lkr: { type: Number, default: 0 },
  inr: { type: Number, default: 0 },
}, { _id: false });

/** Flat per-level fee override for a specific subscription plan (e.g. SILVER). */
const subscriptionRateSchema = new mongoose.Schema({
  subscription: { type: String, required: true },
  lkr: { type: Number, default: 0 },
  inr: { type: Number, default: 0 },
}, { _id: false });

const scheduleStepSchema = new mongoose.Schema({
  label: { type: String },
  daysFromEnrollment: { type: Number },
  amountLkr: { type: Number },
  amountInr: { type: Number },
}, { _id: false });

const schema = new mongoose.Schema({
  _id: { type: String, default: 'global' },
  cefrRows: [cefrRowSchema],
  referenceRows: [referenceRowSchema],
  /** Per-plan flat fee overrides. If a student's subscription matches an entry here,
   *  this flat rate (per level) is used instead of cefrRows. */
  subscriptionRates: { type: [subscriptionRateSchema], default: [] },
  defaultInstallmentSchedule: {
    title: { type: String },
    notes: { type: String },
    steps: [scheduleStepSchema],
  },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});

const DEFAULT_SUBSCRIPTION_RATES = [
  { subscription: 'SILVER', lkr: 30000, inr: 1180 },
];

/** Default seed matching the admin spreadsheet */
const DEFAULT_CEFR = [
  { code: 'A1', order: 1, lkr: 75000, inr: 23600 },
  { code: 'A2', order: 2, lkr: 75000, inr: 23600 },
  { code: 'B1', order: 3, lkr: 75000, inr: 29500 },
  { code: 'B2', order: 4, lkr: 75000, inr: 29500 },
  { code: 'C1', order: 5, lkr: 0, inr: 0 },
  { code: 'C2', order: 6, lkr: 0, inr: 0 },
];

const DEFAULT_REFERENCE = [
  { label: 'Doc', lkr: 354000, inr: 106200 },
  { label: 'Visa', lkr: 472000, inr: 141600 },
  { label: 'Relocation', lkr: 1180000, inr: 354000 },
  { label: 'PayA1-B-', lkr: 318600, inr: 0 },
];

/** Returns the singleton document, creating it with defaults if absent. */
schema.statics.getOrCreate = async function () {
  let doc = await this.findById('global');
  if (!doc) {
    doc = await this.create({
      _id: 'global',
      cefrRows: DEFAULT_CEFR,
      referenceRows: DEFAULT_REFERENCE,
      subscriptionRates: DEFAULT_SUBSCRIPTION_RATES,
      defaultInstallmentSchedule: {
        title: '',
        notes: '',
        steps: [],
      },
    });
  }
  // Migrate existing docs: seed subscriptionRates if missing
  if (!doc.subscriptionRates || doc.subscriptionRates.length === 0) {
    doc.subscriptionRates = DEFAULT_SUBSCRIPTION_RATES;
    await doc.save();
  }
  return doc;
};

module.exports = mongoose.model('PaymentHubCatalog', schema, 'payment_hub_catalog');
