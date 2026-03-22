const mongoose = require('mongoose');

const classRecordingSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  videoUrl: { type: String, required: true, trim: true },
  batches: [{ type: String, trim: true }],
  level: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], required: true },
  plan: { type: String, enum: ['SILVER', 'PLATINUM', 'ALL'], default: 'ALL' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  active: { type: Boolean, default: true }
}, { timestamps: true });

classRecordingSchema.index({ active: 1, level: 1, batches: 1 });

module.exports = mongoose.model('ClassRecording', classRecordingSchema);
