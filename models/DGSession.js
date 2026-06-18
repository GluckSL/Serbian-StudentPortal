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
        /** Role-play conversation (persisted for admin analytics). */
        'conv_student',
        'conv_ai',
        'conv_hint',
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
    /** 0–100 time-goal progress when the student ended the session (Gluck Buddy hub). */
    moduleCompletionPercent: { type: Number, default: null },
    /** True when the module counts as finished in the student hub (100% goal or natural conversation wrap-up). */
    moduleFullyComplete: { type: Boolean, default: false },
    logs: { type: [DGSessionLogSchema], default: [] },
  },
  { timestamps: true }
);

DGSessionSchema.index({ studentId: 1, moduleId: 1, completed: 1, createdAt: -1 });
DGSessionSchema.index({ studentId: 1, createdAt: 1 });

module.exports = mongoose.model('DGSession', DGSessionSchema);
