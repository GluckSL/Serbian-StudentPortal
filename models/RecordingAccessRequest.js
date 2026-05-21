// models/RecordingAccessRequest.js
// Tracks per-student requests for access to recordings of specific past classes.
// Platinum students get 5 approved requests per CEFR level (A1/A2/...).
// Only APPROVED requests count toward the quota; DECLINED/PENDING do not.

const mongoose = require('mongoose');

const recordingAccessRequestSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    meetingLinkId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MeetingLink',
      required: true,
    },

    // Snapshot fields (captured at submit time; level may change after)
    studentLevel: {
      type: String,
      enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
      required: true,
    },
    studentBatch: {
      type: String,
      required: true,
    },
    studentName: { type: String, default: '' },
    studentEmail: { type: String, default: '' },

    // Class metadata snapshot (for admin table without extra populates)
    classTopic: { type: String, default: '' },
    classDate: { type: Date, default: null },

    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'DECLINED'],
      default: 'PENDING',
    },

    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    declineReason: { type: String, default: '' },

    // Whether a ready ZoomRecording existed when admin reviewed
    recordingAvailable: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Admin queue index — fetch pending sorted by recency
recordingAccessRequestSchema.index({ status: 1, requestedAt: -1 });

// Quick per-student quota checks
recordingAccessRequestSchema.index({ studentId: 1, studentLevel: 1, status: 1 });

// Prevent duplicate active (PENDING or APPROVED) request for same class+level
recordingAccessRequestSchema.index(
  { studentId: 1, meetingLinkId: 1, studentLevel: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['PENDING', 'APPROVED'] } },
  }
);

module.exports = mongoose.model('RecordingAccessRequest', recordingAccessRequestSchema);
