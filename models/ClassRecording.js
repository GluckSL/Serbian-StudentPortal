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
  /** When false, recording stays in admin lists but is hidden from student class recordings (same idea as Zoom publish). */
  isPublished: { type: Boolean, default: true },
  publishedAt: { type: Date, default: null },
  /** 200-day journey: which day this recording is scheduled for (optional). */
  courseDay: {
    type: Number,
    default: null,
    required: false,
    validate: {
      validator(v) { return v == null || (Number.isFinite(v) && v >= 0 && v <= 200); },
      message: 'courseDay must be between 0 and 200 or unset'
    }
  },
  /** Recording duration in seconds (optional; set when known). */
  duration: {
    type: Number,
    default: null,
    min: 0
  },
  /** Optional Zoom meeting ID for manual uploads (display / search parity with auto-recordings). */
  zoomMeetingId: { type: String, default: null, trim: true },
}, { timestamps: true });

classRecordingSchema.index({ active: 1, level: 1, batches: 1 });
classRecordingSchema.index({ courseDay: 1, active: 1, isPublished: 1 });
classRecordingSchema.index({ active: 1, isPublished: 1, level: 1, plan: 1, batches: 1, createdAt: -1 });

module.exports = mongoose.model('ClassRecording', classRecordingSchema);
