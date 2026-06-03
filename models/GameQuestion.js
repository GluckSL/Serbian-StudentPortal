// models/GameQuestion.js
// GlückArena: per-question content, discriminated by gameType

const mongoose = require('mongoose');

const GameQuestionSchema = new mongoose.Schema({
  gameSetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GameSet',
    required: true,
    index: true,
  },

  gameType: {
    type: String,
    enum: ['scramble_rush', 'sentence_builder', 'matching', 'flashcards', 'image_matching', 'gender_stack', 'flapjugation', 'whackawort', 'memory', 'jumbled_words', 'hangman', 'word_picture_match'],
    required: true,
  },

  order: { type: Number, default: 0 },

  // ── Scramble Rush fields ─────────────────────────────────────────────────────
  // word to be typed after descrambling — NOT sent to client until answer submitted
  word: { type: String, default: '' },
  hint: { type: String, default: '' },
  imageUrl: { type: String, default: null },
  audioUrl: { type: String, default: null },
  difficultyLevel: { type: Number, min: 1, max: 5, default: 1 },
  /** Seconds for this word to reach the deadline line (admin-controlled fall speed) */
  fallDurationSeconds: { type: Number, min: 2, max: 30, default: 5 },

  // ── Image Matching fields ────────────────────────────────────────────────────
  pairs: [{
    word: { type: String, default: '' },
    hint: { type: String, default: '' },
    imageUrl: { type: String, default: null },
    audioUrl: { type: String, default: null },
  }],

  // ── Gender Stack fields ─────────────────────────────────────────────────────
  /** Grammatical gender article: der, die, or das */
  articleGender: {
    type: String,
    enum: ['der', 'die', 'das', null],
    default: null,
  },

  // ── Sentence Builder fields ──────────────────────────────────────────────────
  // correct sentence — NOT sent to client until answer submitted
  correctSentence: { type: String, default: '' },
  translation: { type: String, default: '' },
  sentenceAudioUrl: { type: String, default: null },
  randomizeWords: { type: Boolean, default: true },
  // precomputed tokens derived from correctSentence (stored for efficiency)
  tokens: [{ type: String }],

  // ── Whack-a-Wort fields ─────────────────────────────────────────────────────
  category: { type: String, default: '' },

  // ── Shared / placeholder fields ──────────────────────────────────────────────
  isPlaceholder: { type: Boolean, default: false },

  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

GameQuestionSchema.index({ gameSetId: 1, order: 1 });
GameQuestionSchema.index({ gameSetId: 1, gameType: 1, isDeleted: 1 });

module.exports = mongoose.model('GameQuestion', GameQuestionSchema);
