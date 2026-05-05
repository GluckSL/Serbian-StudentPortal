// models/ExerciseAttempt.js

const mongoose = require('mongoose');

const QuestionResponseSchema = new mongoose.Schema({
  questionIndex: { type: Number, required: true },
  questionType: { type: String, enum: ['mcq', 'matching', 'fill-blank', 'pronunciation', 'question-answer', 'listening', 'video-pronunciation', 'singular_plural', 'jumble-word', 'rearrange'] },
  // MCQ response
  selectedOptionIndex: Number,
  // Matching response: array of { leftIndex, rightIndex }
  matchingResponse: [{
    leftIndex: Number,
    rightIndex: Number,
    // Optional: submitted right value so grading can work even when the UI shuffles.
    rightValue: String
  }],
  // Fill-blank response: array of answers per blank
  fillBlankResponses: [String],
  // Singular/plural: student typed plural per row (same order as question.pairs)
  singularPluralResponses: [String],
  // Pronunciation response
  spokenText: String,
  pronunciationScore: Number, // 0-100
  // Question/Answer response
  qaResponse: String,
  // Listening response (typed or transcribed from speech)
  listeningText: String,
  // Jumble-word response
  jumbleWordResponse: String,
  // Common
  isCorrect: { type: Boolean, default: false },
  pointsEarned: { type: Number, default: 0 }
}, { _id: false });

const ExerciseAttemptSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  exerciseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DigitalExercise',
    required: true
  },

  // Attempt details
  attemptNumber: { type: Number, default: 1 },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  timeSpentSeconds: { type: Number, default: 0 },

  // Scoring
  totalPoints: { type: Number, default: 0 },       // max possible
  earnedPoints: { type: Number, default: 0 },
  scorePercentage: { type: Number, default: 0 },    // 0-100

  // Status
  status: {
    type: String,
    enum: ['in-progress', 'completed', 'abandoned'],
    default: 'in-progress'
  },

  // Individual question responses
  responses: [QuestionResponseSchema],

  createdAt: { type: Date, default: Date.now }
});

// Index for fast queries by student, exercise, date
ExerciseAttemptSchema.index({ studentId: 1, exerciseId: 1 });
ExerciseAttemptSchema.index({ studentId: 1, status: 1 }); // batch progress overall aggregate
ExerciseAttemptSchema.index({ exerciseId: 1, status: 1 });
ExerciseAttemptSchema.index({ studentId: 1, createdAt: -1 });
// Daily completion tracking
ExerciseAttemptSchema.index({ exerciseId: 1, createdAt: -1 });

module.exports = mongoose.model('ExerciseAttempt', ExerciseAttemptSchema);
