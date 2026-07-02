// models/ClassFeedback.js
const mongoose = require('mongoose');

const classFeedbackSchema = new mongoose.Schema({
  studentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  studentEmail: { type: String, default: '' },
  batch:       { type: String, required: true },
  meetingId:   { type: mongoose.Schema.Types.ObjectId, ref: 'MeetingLink', required: true },
  classTitle:  { type: String, required: true },
  classDate:   { type: Date, required: true },

  // Q1: How well did you understand today's class?
  // not_really | mostly | completely
  understanding: {
    type: String,
    required: true,
    enum: ['not_really', 'mostly', 'completely'],
  },

  // Q2: How was the pace of the class?
  // too_slow | just_right | too_fast
  pace: {
    type: String,
    required: true,
    enum: ['too_slow', 'just_right', 'too_fast'],
  },

  // Q3: How confident do you feel using today's topic? (1–3 stars)
  confidence: {
    type: Number,
    required: true,
    min: 1,
    max: 3,
  },

  // Q4: How motivated are you to try out the Self-Learning part tomorrow?
  // not_motivated | somewhat_motivated | very_motivated
  motivation: {
    type: String,
    required: true,
    enum: ['not_motivated', 'somewhat_motivated', 'very_motivated'],
  },

  submittedAt: { type: Date, default: Date.now },
});

// One submission per student per class
classFeedbackSchema.index({ meetingId: 1, studentId: 1 }, { unique: true });
classFeedbackSchema.index({ batch: 1, submittedAt: -1 });
classFeedbackSchema.index({ studentId: 1, submittedAt: -1 });

module.exports = mongoose.model('ClassFeedback', classFeedbackSchema);
