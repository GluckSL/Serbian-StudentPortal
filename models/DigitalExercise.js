// models/DigitalExercise.js

const mongoose = require('mongoose');

// MCQ Question Schema
const MCQQuestionSchema = new mongoose.Schema({
  type: { type: String, enum: ['mcq'], default: 'mcq' },
  question: { type: String, required: true },
  imageUrl: { type: String, default: null },
  options: [{ type: String, required: true }],
  correctAnswerIndex: { type: Number, required: true },
  explanation: { type: String, default: '' },
  points: { type: Number, default: 1 }
}, { _id: true });

// Matching Exercise Schema
const MatchingQuestionSchema = new mongoose.Schema({
  type: { type: String, enum: ['matching'], default: 'matching' },
  instruction: { type: String, default: 'Match the items on the left with their correct pairs on the right.' },
  pairs: [{
    left: { type: String, required: true },
    right: { type: String, required: true }
  }],
  points: { type: Number, default: 1 }
}, { _id: true });

// Fill in the Blanks Schema
const FillBlankQuestionSchema = new mongoose.Schema({
  type: { type: String, enum: ['fill-blank'], default: 'fill-blank' },
  sentence: { type: String, required: true }, // Use ___ for each blank
  answers: [{ type: String, required: true }],  // Correct answers for each blank in order
  hint: { type: String, default: '' },
  caseSensitive: { type: Boolean, default: false },
  points: { type: Number, default: 1 }
}, { _id: true });

// Pronunciation Check Schema
const PronunciationQuestionSchema = new mongoose.Schema({
  type: { type: String, enum: ['pronunciation'], default: 'pronunciation' },
  word: { type: String, required: true },
  phonetic: { type: String, default: '' },
  translation: { type: String, default: '' },
  audioUrl: { type: String, default: null },
  acceptedVariants: [{ type: String }],  // alternative accepted pronunciations
  points: { type: Number, default: 1 }
}, { _id: true });

// Main Digital Exercise Schema
const DigitalExerciseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },

  targetLanguage: {
    type: String,
    enum: ['English', 'German'],
    required: true,
    default: 'German'
  },
  nativeLanguage: {
    type: String,
    enum: ['English', 'Tamil', 'Sinhala'],
    default: 'English'
  },
  level: {
    type: String,
    enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    required: true
  },
  category: {
    type: String,
    enum: ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'],
    required: true
  },
  difficulty: {
    type: String,
    enum: ['Beginner', 'Intermediate', 'Advanced'],
    required: true
  },
  estimatedDuration: { type: Number, default: 15 }, // minutes

  // Array of mixed question types using discriminator-like approach
  questions: [{
    type: { type: String, enum: ['mcq', 'matching', 'fill-blank', 'pronunciation', 'question-answer', 'listening'], required: true },
    // MCQ fields
    question: String,
    imageUrl: String,
    options: [String],
    correctAnswerIndex: Number,
    explanation: String,
    // Matching fields
    instruction: String,
    pairs: [{
      left: String,
      right: String
    }],
    // Fill-blank fields
    sentence: String,
    answers: [String],
    hint: String,
    caseSensitive: { type: Boolean, default: false },
    // Pronunciation fields
    word: String,
    phonetic: String,
    translation: String,
    audioUrl: String,
    acceptedVariants: [String],
    // Question / Answer fields
    prompt: String,
    sampleAnswers: [String],
    similarityThreshold: { type: Number, default: 70 },   // 0-100 — min AI score to pass
    scoringMode: { type: String, enum: ['full', 'proportional'], default: 'full' },
    // Listening fields (prompt reused for instruction)
    mediaUrl: String,  // URL to audio file (uploaded or external link)
    expectedTranscript: String,  // AI-extracted text, teacher-verified before publish
    attemptMode: { type: String, enum: ['typing', 'typing-or-speech'], default: 'typing' },
    // Common
    points: { type: Number, default: 1 }
  }],

  // Optional shared audio for manual listening worksheets.
  // When present, the student can play this audio for all questions in the exercise.
  sharedAudioUrl: { type: String, default: null },

  tags: [String],

  // Visibility and state
  isActive: { type: Boolean, default: true },
  visibleToStudents: { type: Boolean, default: false },
  publishedAt: { type: Date, default: null },

  // Metadata
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Analytics
  totalAttempts: { type: Number, default: 0 },
  totalCompletions: { type: Number, default: 0 },
  averageScore: { type: Number, default: 0 },

  // Soft delete
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

DigitalExerciseSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

DigitalExerciseSchema.index({ level: 1, category: 1, isActive: 1 });
DigitalExerciseSchema.index({ createdBy: 1 });
DigitalExerciseSchema.index({ visibleToStudents: 1, isActive: 1, isDeleted: 1 });

module.exports = mongoose.model('DigitalExercise', DigitalExerciseSchema);
