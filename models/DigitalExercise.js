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
  sentence: { type: String, required: true }, // Use _ or ___ (each run = one blank)
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
    type: { type: String, enum: ['mcq', 'matching', 'fill-blank', 'word_bank_fill', 'pronunciation', 'question-answer', 'listening', 'video-pronunciation', 'singular_plural', 'jumble-word', 'rearrange', 'image_pin_match'], required: true },
    // Common optional context shown above the question to students.
    context: { type: String, default: '' },
    // Instruction and example shown in a highlighted banner above the question body.
    // Instruction = what to do; example = worked sample (optional).
    example: { type: String, default: '' },
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
      right: String,
      singular: String,
      plural: String
    }],
    // Fill-blank fields
    sentence: String,
    answers: [String],
    hint: String,
    caseSensitive: { type: Boolean, default: false },
    // Word-bank-fill fields
    wordBank: [String],
    items: [{
      prompt: String,
      answer: String,
      acceptedAnswers: [{ type: String }]
    }],
    reusableWords: { type: Boolean, default: true },
    // Pronunciation fields
    word: String,
    phonetic: String,
    translation: String,
    audioUrl: String,
    acceptedVariants: [String],
    // Question / Answer fields
    prompt: String,
    sampleAnswers: [String],
    // Story passage for worksheet-style questions (e.g. true/false reading).
    storyParagraph: { type: String, default: '' },
    similarityThreshold: { type: Number, default: 70 },   // 0-100 — min AI score to pass
    scoringMode: { type: String, enum: ['full', 'proportional'], default: 'full' },
    aiGradingEnabled: { type: Boolean, default: true },
    // Listening fields (prompt reused for instruction)
    mediaUrl: String,  // URL to audio file (uploaded or external link)
    expectedTranscript: String,  // AI-extracted text, teacher-verified before publish
    attemptMode: { type: String, enum: ['typing', 'typing-or-speech'], default: 'typing' },
    // Video pronunciation (watch clip, speak caption)
    videoUrl: String,
    caption: String,
    secondaryCaption: String,
    secondaryCaptionAtSeconds: { type: Number, default: 5 },
    // Common
    points: { type: Number, default: 1 },
    // Per-question attachment (image, audio, PDF, video) visible only for this question
    attachmentUrl: { type: String, default: '' },
    // When attachment is audio: max play-button presses per exercise attempt (omit/null = unlimited)
    attachmentAudioMaxPlaysPerAttempt: { type: Number, default: null, min: 1, max: 99 },
    // Teacher explanation of why the correct answer is right; shown to students in review
    answerExplanation: { type: String, default: '' },
    // Worksheet metadata: set by AI when generated from a structured worksheet
    sectionTitle: { type: String, default: null },  // e.g. "STUFE 1 – LEICHT | Übung L1.1"
    tier: { type: String, enum: ['easy', 'medium', 'hard', null], default: null }
    ,
    // Worksheet category label for question-answer style tasks.
    // Example: "true-false", "sentence-transformation", "error-correction", etc.
    worksheetKind: { type: String, default: null },
    // Jumble-word fields
    scrambledText: { type: String, default: '' },  // e.g. "Z I M M E W O H N R"
    boldLetter: { type: String, default: '' },      // single character shown bold as a hint
    expectedWord: { type: String, default: '' },    // correct assembled word
    categoryTip: { type: String, default: '' },      // optional hint text below instruction
    // Rearrange fields (word / sentence ordering)
    rearrangePrompt: { type: String, default: '' },  // question text shown to students
    rearrangeAnswer: { type: String, default: '' },  // correct ordered sentence (for typing compare)
    rearrangeTokens: [{ type: String }],              // correct ordered tokens (for drag/drop compare)
    // Image Pin Match fields
    labels: [{
      id: { type: String, required: true },
      text: { type: String, required: true },
      correctPinId: { type: String, required: true }
    }],
    pins: [{
      id: { type: String, required: true },
      x: { type: Number, min: 0, max: 100, required: true },
      y: { type: Number, min: 0, max: 100, required: true }
    }],
    settings: {
      randomizeLabels: { type: Boolean, default: true },
      allowRetry: { type: Boolean, default: true }
    },
    // Sub-questions with same context/hints/images
    subQuestions: [{
      type: { type: String, enum: ['mcq', 'matching', 'fill-blank', 'word_bank_fill', 'pronunciation', 'question-answer', 'listening', 'video-pronunciation', 'singular_plural', 'jumble-word', 'rearrange', 'image_pin_match'], required: true },
      // Common optional context shown above the question to students.
      context: { type: String, default: '' },
      // Instruction and example shown in a highlighted banner above the question body.
      example: { type: String, default: '' },
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
        right: String,
        singular: String,
        plural: String
      }],
      // Fill-blank fields
      sentence: String,
      answers: [String],
      hint: String,
      caseSensitive: { type: Boolean, default: false },
      // Word-bank-fill fields
      wordBank: [String],
      items: [{
        prompt: String,
        answer: String,
        acceptedAnswers: [{ type: String }]
      }],
      reusableWords: { type: Boolean, default: true },
      // Pronunciation fields
      word: String,
      phonetic: String,
      translation: String,
      audioUrl: String,
      acceptedVariants: [String],
      // Question / Answer fields
      prompt: String,
      sampleAnswers: [String],
      // Story passage for worksheet-style questions (e.g. true/false reading).
      storyParagraph: { type: String, default: '' },
      similarityThreshold: { type: Number, default: 70 },
      scoringMode: { type: String, enum: ['full', 'proportional'], default: 'full' },
      aiGradingEnabled: { type: Boolean, default: true },
      // Listening fields
      mediaUrl: String,
      expectedTranscript: String,
      attemptMode: { type: String, enum: ['typing', 'typing-or-speech'], default: 'typing' },
      // Video pronunciation fields
      videoUrl: String,
      caption: String,
      secondaryCaption: String,
      secondaryCaptionAtSeconds: { type: Number, default: 5 },
      // Common
      points: { type: Number, default: 1 },
      attachmentUrl: { type: String, default: '' },
      attachmentAudioMaxPlaysPerAttempt: { type: Number, default: null, min: 1, max: 99 },
      answerExplanation: { type: String, default: '' },
      sectionTitle: { type: String, default: null },
      tier: { type: String, enum: ['easy', 'medium', 'hard', null], default: null },
      worksheetKind: { type: String, default: null },
      // Jumble-word fields
      scrambledText: { type: String, default: '' },
      boldLetter: { type: String, default: '' },
      expectedWord: { type: String, default: '' },
      categoryTip: { type: String, default: '' },
      // Rearrange fields
      rearrangePrompt: { type: String, default: '' },
      rearrangeAnswer: { type: String, default: '' },
      rearrangeTokens: [{ type: String }],
      // Image Pin Match fields
      labels: [{
        id: { type: String, required: true },
        text: { type: String, required: true },
        correctPinId: { type: String, required: true }
      }],
      pins: [{
        id: { type: String, required: true },
        x: { type: Number, min: 0, max: 100, required: true },
        y: { type: Number, min: 0, max: 100, required: true }
      }],
      settings: {
        randomizeLabels: { type: Boolean, default: true },
        allowRetry: { type: Boolean, default: true }
      }
    }]
  }],

  // Optional shared audio for manual listening worksheets.
  // When present, the student can play this audio for all questions in the exercise.
  sharedAudioUrl: { type: String, default: null },

  // Video pronunciation exercises: optional feedback sounds (exercise-wide).
  // On correct / incorrect, the player picks one entry at random (if any) and plays audioUrl.
  // caption is optional on-screen hint text (e.g. "Try again").
  videoSuccessFeedback: [{
    audioUrl: { type: String, required: true },
    caption: { type: String, default: '' }
  }],
  videoRetryFeedback: [{
    audioUrl: { type: String, required: true },
    caption: { type: String, default: '' }
  }],

  tags: [String],

  /**
   * Optional: day in the 200-day course when this exercise is assigned.
   * Omit or null = general pool (any student who can see published exercises).
   * If set, students only see it when currentCourseDay >= courseDay (browse + play).
   */
  courseDay: { type: Number, default: null, min: 1, max: 200 },

  /**
   * Optional within-day sequence letter (a, b, c …).
   * When set, students must complete every exercise with an earlier letter on the
   * same courseDay (with score ≥ 60 %) before this one unlocks.
   * Null / empty = ungated (always accessible once the day unlocks).
   */
  sequenceLetter: {
    type: String,
    default: null,
    trim: true,
    lowercase: true,
    match: /^[a-z]$/
  },

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
DigitalExerciseSchema.index({ courseDay: 1, visibleToStudents: 1, isDeleted: 1 });
DigitalExerciseSchema.index({ courseDay: 1, sequenceLetter: 1 });
DigitalExerciseSchema.index({ isDeleted: 1, createdAt: -1 });

module.exports = mongoose.model('DigitalExercise', DigitalExerciseSchema);
