// models/GameAnswer.js
// GlückArena: per-answer audit record within a GameAttempt

const mongoose = require('mongoose');

const GameAnswerSchema = new mongoose.Schema({
  attemptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GameAttempt',
    required: true,
    index: true,
  },

  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GameQuestion',
    required: true,
  },

  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  submittedAt: { type: Date, default: Date.now },
  responseTimeMs: { type: Number, default: 0 },

  // ── Scramble Rush ─────────────────────────────────────────────────────────
  typedWord: { type: String, default: '' },

  // ── Sentence Builder ──────────────────────────────────────────────────────
  orderedTokens: [{ type: String }],
  /** Per-word slot placement (sentence builder instant mode) */
  slotIndex: { type: Number, default: null },

  // ── Shared result ─────────────────────────────────────────────────────────
  isCorrect: { type: Boolean, default: false },
  pointsEarned: { type: Number, default: 0 },
}, { timestamps: true });

GameAnswerSchema.index({ attemptId: 1, questionId: 1, slotIndex: 1 }, { unique: true });
GameAnswerSchema.index({ studentId: 1, submittedAt: -1 });

module.exports = mongoose.model('GameAnswer', GameAnswerSchema);
