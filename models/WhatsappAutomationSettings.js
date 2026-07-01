/**
 * Stores per-automation batch targeting settings for WhatsApp automated reminders.
 *
 * When allBatches is true (default), the automation runs for ALL batches.
 * When allBatches is false, only students in targetBatches receive the message.
 */
const mongoose = require('mongoose');

const AUTOMATION_TYPES = [
  'CLASS_REMINDER',
  'ABSENT_DURING_CLASS',
  'ABSENT_AFTER_CLASS',
  'MISSED_ACTIVITIES',
  'EXCESSIVE_ABSENCES',
  'WEEKLY_PROGRESS_REPORT',
  'CONSECUTIVE_ABSENCE',
  'DAILY_TASK_REMINDER',
  'PAYMENT_OVERDUE_REMINDER',
];

const WhatsappAutomationSettingsSchema = new mongoose.Schema({
  automationType: {
    type: String,
    required: true,
    unique: true,
    enum: AUTOMATION_TYPES,
    index: true,
  },
  /** If true, the automation fires for all batches (no restriction). Default: true. */
  allBatches: {
    type: Boolean,
    default: true,
  },
  /** Batch names (matching BatchConfig.batchName) to include when allBatches is false. */
  targetBatches: {
    type: [String],
    default: [],
  },
  updatedAt: { type: Date, default: Date.now },
});

WhatsappAutomationSettingsSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

const WhatsappAutomationSettings = mongoose.model('WhatsappAutomationSettings', WhatsappAutomationSettingsSchema);

module.exports = WhatsappAutomationSettings;
module.exports.AUTOMATION_TYPES = AUTOMATION_TYPES;
