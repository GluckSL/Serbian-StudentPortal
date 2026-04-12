const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  status: { type: String, enum: ['correct', 'wrong'], default: null },
  comment: { type: String, default: '', maxlength: 1000 },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null }
}, { _id: false });

const classSubmissionSchema = new mongoose.Schema({
  meetingId: { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingLink', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fileName: { type: String, required: true },
  originalName: { type: String, required: true },
  fileUrl: { type: String, required: true },
  fileSize: { type: Number, default: 0 },
  mimeType: { type: String, default: '' },
  caption: { type: String, default: '', maxlength: 500 },
  feedback: { type: feedbackSchema, default: () => ({}) },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ClassSubmission', classSubmissionSchema);
