// models/FeedbackBatchSettings.js
// Stores which batches have the class feedback feature enabled.
const mongoose = require('mongoose');

const feedbackBatchSettingsSchema = new mongoose.Schema({
  batch: { type: String, required: true, unique: true, index: true },
  enabled: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
});

feedbackBatchSettingsSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('FeedbackBatchSettings', feedbackBatchSettingsSchema);
