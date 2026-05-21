const mongoose = require('mongoose');

const GluckRoomRecordingSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GluckRoomSession',
    required: true
  },
  r2Key: {
    type: String,
    required: true
  },
  duration: {
    type: Number,
    default: null
  },
  status: {
    type: String,
    enum: ['processing', 'ready', 'failed'],
    default: 'processing'
  },
  errorMessage: {
    type: String,
    default: null
  },
  isPublished: {
    type: Boolean,
    default: true
  },
  publishedAt: {
    type: Date,
    default: null
  },
  publishedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  accessBatches: {
    type: [String],
    default: []
  },
  accessLevel: {
    type: String,
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null],
    default: null
  },
  accessPlan: {
    type: String,
    enum: ['SILVER', 'PLATINUM', 'VISA_DOC_ONLY', 'ALL'],
    default: 'ALL'
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

GluckRoomRecordingSchema.index({ sessionId: 1 });
GluckRoomRecordingSchema.index({ isPublished: 1, status: 1 });

module.exports = mongoose.model('GluckRoomRecording', GluckRoomRecordingSchema);
