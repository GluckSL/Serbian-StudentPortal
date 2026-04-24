const mongoose = require('mongoose');

const DGSessionLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    event: {
      type: String,
      enum: [
        'session_start',
        'scene_enter',
        'tts_play',
        'practice_attempt',
        'practice_result',
        'silence_failure',
        'scene_complete',
        'session_update',
        'session_complete',
      ],
      required: true,
    },
    sceneIndex: { type: Number, default: null },
    durationMs: { type: Number, default: null },
    attemptsDelta: { type: Number, default: 0 },
    success: { type: Boolean, default: null },
    transcript: { type: String, default: '' },
    score: { type: Number, default: null },
    silenceFailure: { type: Boolean, default: false },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const DGSessionSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    moduleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DGModule',
      required: true,
      index: true,
    },
    currentSceneIndex: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    silenceFailureCount: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    timePerSceneMs: { type: [Number], default: [] },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    logs: { type: [DGSessionLogSchema], default: [] },
  },
  { timestamps: true }
);

DGSessionSchema.index({ studentId: 1, moduleId: 1, completed: 1, createdAt: -1 });

module.exports = mongoose.model('DGSession', DGSessionSchema);
