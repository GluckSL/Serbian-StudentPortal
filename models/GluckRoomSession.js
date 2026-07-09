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
    max: 1440
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
  targetJourneyDay: {
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
  plan: {
    type: String,
    enum: ['SILVER', 'PLATINUM', 'VISA_DOC_ONLY', null],
    default: null
  },
  agenda: {
    type: String,
    trim: true,
    default: ''
  },
  timezone: {
    type: String,
    default: 'Asia/Kolkata'
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
  scheduleType: {
    type: String,
    enum: ['single', 'journey'],
    default: 'single'
  },
  journeySettings: {
    weekdays: [{ type: Number, min: 0, max: 6 }],
    startClock: { type: String },
    bulkScheduleId: { type: String }
  },
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
  autoStartLockedAt: {
    type: Date,
    default: null
  },
  emptiedAt: {
    type: Date,
    default: null
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
  recordingEnabled: {
    type: Boolean,
    default: false
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
GluckRoomSessionSchema.index({ 'journeySettings.bulkScheduleId': 1 });

GluckRoomSessionSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  if (!this.livekitRoomName) {
    this.livekitRoomName = `gluckroom_${this._id}_${Date.now()}`;
  }
  next();
});

module.exports = mongoose.model('GluckRoomSession', GluckRoomSessionSchema);
