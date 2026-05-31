const mongoose = require('mongoose');

const goRecordingResourceSchema = new mongoose.Schema({
  recordingType: { type: String, enum: ['manual', 'zoom'], required: true, index: true },
  classRecordingId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClassRecording', index: true },
  meetingLinkId: { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingLink', index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  originalName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileSize: { type: Number, default: 0 },
  mimeType: { type: String },
  uploadedAt: { type: Date, default: Date.now }
});

goRecordingResourceSchema.index({ recordingType: 1, classRecordingId: 1 });
goRecordingResourceSchema.index({ recordingType: 1, meetingLinkId: 1 });

module.exports = mongoose.model('GoRecordingResource', goRecordingResourceSchema);
