// models/GameSet.js
// GlückArena: admin-created game package (top-level container for questions + levels)

const mongoose = require('mongoose');

const TimerSettingsSchema = new mongoose.Schema({
  sessionLimitSeconds: { type: Number, default: null },  // null = no overall time limit
  perQuestionSeconds: { type: Number, default: null },   // null = no per-question timer
}, { _id: false });

const GenderStackSettingsSchema = new mongoose.Schema({
  /** Seconds between new word spawns (admin: 3–5) */
  spawnIntervalSeconds: { type: Number, default: 4, min: 3, max: 5 },
  /** Seconds for a word to fall from the top to the shelf line */
  fallDurationSeconds: { type: Number, default: 1.2, min: 0.5, max: 3 },
}, { _id: false });

const SpinWheelSettingsSchema = new mongoose.Schema({
  centerLabel: { type: String, default: 'ergänze den Satz!' },
}, { _id: false });

const TapBoxesSettingsSchema = new mongoose.Schema({
  /** Custom play-area background (R2/S3); null = default green board */
  backgroundUrl: { type: String, default: null },
}, { _id: false });

const GameSetSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  thumbnailUrl: { type: String, default: null },
  icon: { type: String, default: 'sports_esports' },  // Material icon name fallback

  gameType: {
    type: String,
    enum: ['scramble_rush', 'sentence_builder', 'matching', 'flashcards', 'image_matching', 'gender_stack', 'flapjugation', 'whackawort', 'memory', 'jumbled_words', 'hangman', 'word_picture_match', 'multiple_choice', 'spin_wheel', 'tap_boxes', 'word_search'],
    required: true,
  },

  difficulty: {
    type: String,
    enum: ['Beginner', 'Intermediate', 'Advanced'],
    required: true,
    default: 'Beginner',
  },

  level: {
    type: String,
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    default: null,
  },

  category: {
    type: String,
    enum: ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'],
    default: 'Vocabulary',
  },

  tags: [{ type: String, trim: true }],

  targetLanguage: {
    type: String,
    enum: ['English', 'German'],
    default: 'German',
  },

  xpReward: { type: Number, default: 50, min: 0 },

  timerSettings: { type: TimerSettingsSchema, default: () => ({}) },

  /** Gender Stack: spawn rate and fall speed */
  genderStackSettings: { type: GenderStackSettingsSchema, default: () => ({}) },

  /** Spin Wheel: center hub label */
  spinWheelSettings: { type: SpinWheelSettingsSchema, default: () => ({}) },

  /** Tap the Boxes: optional custom board background image */
  tapBoxesSettings: { type: TapBoxesSettingsSchema, default: () => ({}) },

  // Journey gating — mirrors DigitalExercise gating conventions
  visibleToStudents: { type: Boolean, default: false },
  courseDay: { type: Number, default: null },
  sequenceLetter: { type: String, default: null },

  /** Normalized batch keys from Journey; empty = all batches (pilot) */
  targetBatchKeys: { type: [String], default: [] },

  isPublished: { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },

  // Metadata
  questionCount: { type: Number, default: 0 },  // denormalized count updated on question save/delete
  estimatedDurationMinutes: { type: Number, default: 10 },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

GameSetSchema.index({ gameType: 1, isPublished: 1, isDeleted: 1 });
GameSetSchema.index({ level: 1, difficulty: 1, isPublished: 1 });
GameSetSchema.index({ visibleToStudents: 1, isPublished: 1, isDeleted: 1 });
GameSetSchema.index({ courseDay: 1 });
GameSetSchema.index({ targetBatchKeys: 1, visibleToStudents: 1, isPublished: 1, isDeleted: 1 });

module.exports = mongoose.model('GameSet', GameSetSchema);
