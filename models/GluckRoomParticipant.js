const mongoose = require('mongoose');

const GluckRoomParticipantSchema = new mongoose.Schema({
  sessionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GluckRoomSession',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  role: {
    type: String,
    enum: ['host', 'teacher', 'admin', 'student'],
    required: true
  },
  joinedAt: {
    type: Date,
    default: null
  },
  leftAt: {
    type: Date,
    default: null
  },
  durationSeconds: {
    type: Number,
    default: 0
  },
  isPresent: {
    type: Boolean,
    default: false
  },
  isMuted: {
    type: Boolean,
    default: false
  },
  isCameraDisabled: {
    type: Boolean,
    default: false
  },
  wasRemoved: {
    type: Boolean,
    default: false
  },
  joinMethod: {
    type: String,
    enum: ['batch_access', 'manual', 'admin_override', 'host_invite'],
    default: 'batch_access'
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

GluckRoomParticipantSchema.index({ sessionId: 1, userId: 1 }, { unique: true });
GluckRoomParticipantSchema.index({ userId: 1, joinedAt: -1 });

module.exports = mongoose.model('GluckRoomParticipant', GluckRoomParticipantSchema);
