// models/GameAttempt.js
// GlückArena: student game session — one per play-through

const mongoose = require('mongoose');

const GameAttemptSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  gameSetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GameSet',
    required: true,
  },

  gameType: {
    type: String,
    enum: ['scramble_rush', 'sentence_builder', 'matching', 'flashcards', 'image_matching', 'gender_stack', 'flapjugation', 'whackawort', 'memory', 'jumbled_words', 'hangman', 'word_picture_match', 'multiple_choice', 'spin_wheel', 'tap_boxes', 'word_search'],
    required: true,
  },

  status: {
    type: String,
    enum: ['in-progress', 'completed', 'abandoned'],
    default: 'in-progress',
  },

  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null },
  timeSpentSeconds: { type: Number, default: 0 },

  // Scoring
  score: { type: Number, default: 0 },
  xpEarned: { type: Number, default: 0 },
  accuracy: { type: Number, default: 0 },         // 0–100 percentage
  totalQuestions: { type: Number, default: 0 },
  correctAnswers: { type: Number, default: 0 },

  // Scramble Rush specific
  livesRemaining: { type: Number, default: 3 },
  currentLevel: { type: Number, default: 1 },
  wordsCompleted: { type: Number, default: 0 },

  attemptNumber: { type: Number, default: 1 },
}, { timestamps: true });

GameAttemptSchema.index({ gameSetId: 1, status: 1, score: -1 });
GameAttemptSchema.index({ studentId: 1, gameSetId: 1, createdAt: -1 });
GameAttemptSchema.index({ studentId: 1, status: 1, completedAt: -1 });
GameAttemptSchema.index({ studentId: 1, completedAt: -1 });
GameAttemptSchema.index({ studentId: 1, startedAt: 1 });
// Leaderboard queries by completion window
GameAttemptSchema.index({ status: 1, completedAt: -1, xpEarned: -1 });

module.exports = mongoose.model('GameAttempt', GameAttemptSchema);
