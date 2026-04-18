const mongoose = require('mongoose');

const classRecordingSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  videoUrl: { type: String, default: '', trim: true },
  sourceType: { type: String, enum: ['URL', 'HLS_UPLOAD'], default: 'URL' },
  hlsKey: { type: String, default: null, trim: true },
  status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'ready' },
  errorMessage: { type: String, default: null, trim: true },
  batches: [{ type: String, trim: true }],
  level: { type: String, enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], required: true },
  plan: { type: String, enum: ['SILVER', 'PLATINUM', 'ALL'], default: 'ALL' },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  active: { type: Boolean, default: true },
  /** When false, students do not see the recording (same idea as Zoom publish). Defaults true for legacy URL rows. */
  isPublished: { type: Boolean, default: true },
  publishedAt: { type: Date, default: null }
}, { timestamps: true });

classRecordingSchema.index({ active: 1, level: 1, batches: 1 });

module.exports = mongoose.model('ClassRecording', classRecordingSchema);
