const mongoose = require('mongoose');

const GluckRoomSessionSchema = new mongoose.Schema({
  sessionName: {
    type: String,
    required: true,
    trim: true
  },
  hostId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  scheduledStartTime: {
    type: Date,
    required: true
  },
  scheduledEndTime: {
    type: Date
  },
  actualStartTime: {
    type: Date
  },
  actualEndTime: {
    type: Date
  },
  maxDurationMinutes: {
    type: Number,
    default: 180,
    min: 15,
    max: 300
  },
  batch: {
    type: String,
    required: true
  },
  courseDay: {
    type: Number,
    min: 1,
    max: 200,
    default: null
  },
  level: {
    type: String,
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', null],
    default: null
  },
  accessType: {
    type: String,
    enum: ['batch', 'manual', 'open'],
    default: 'batch'
  },
  allowedBatches: [{
    type: String
  }],
  allowedStudents: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  livekitRoomName: {
    type: String,
    required: true,
    unique: true
  },
  egressId: {
    type: String
  },
  status: {
    type: String,
    enum: ['scheduled', 'active', 'ended', 'cancelled'],
    default: 'scheduled'
  },
  maxParticipants: {
    type: Number,
    default: 100
  },
  participantCount: {
    type: Number,
    default: 0
  },
  recordingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GluckRoomRecording',
    default: null
  },
  recordingKey: {
    type: String,
    default: null
  },
  recordingDuration: {
    type: Number,
    default: null
  },
  isRecordingPublished: {
    type: Boolean,
    default: true
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

GluckRoomSessionSchema.index({ hostId: 1, status: 1 });
GluckRoomSessionSchema.index({ batch: 1, status: 1 });
GluckRoomSessionSchema.index({ scheduledStartTime: 1 });

GluckRoomSessionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (!this.livekitRoomName) {
    this.livekitRoomName = `gluckroom_${this._id}_${Date.now()}`;
  }
  next();
});

module.exports = mongoose.model('GluckRoomSession', GluckRoomSessionSchema);
