// models/StudentDailyChallenge.js — per-student daily challenge progress

const mongoose = require('mongoose');

const StudentDailyChallengeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  challengeId: { type: mongoose.Schema.Types.ObjectId, ref: 'DailyChallenge', required: true },
  challengeKey: { type: String, required: true },
  dateKey: { type: String, required: true, index: true }, // YYYY-MM-DD UTC

  progress: { type: Number, default: 0 },
  targetValue: { type: Number, required: true },
  isCompleted: { type: Boolean, default: false },
  isClaimed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  claimedAt: { type: Date, default: null },
}, { timestamps: true });

StudentDailyChallengeSchema.index({ studentId: 1, dateKey: 1, challengeKey: 1 }, { unique: true });

module.exports = mongoose.model('StudentDailyChallenge', StudentDailyChallengeSchema);
