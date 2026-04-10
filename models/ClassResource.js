const mongoose = require('mongoose');

const classResourceSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingLink', required: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true },
  originalName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileSize: { type: Number, default: 0 },
  mimeType: { type: String },
  uploadedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ClassResource', classResourceSchema);
