const mongoose = require('mongoose');

const recordingViewSchema = new mongoose.Schema({
  recording: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRecording', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  watchDuration: { type: Number, default: 0 }, // seconds
  startedAt: { type: Date, default: Date.now },
  lastUpdatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

recordingViewSchema.index({ recording: 1, student: 1, startedAt: -1 });

module.exports = mongoose.model('RecordingView', recordingViewSchema);
