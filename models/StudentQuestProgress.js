// models/StudentQuestProgress.js — student quest progress per period window

const mongoose = require('mongoose');

const StudentQuestProgressSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  questId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quest', required: true },
  questKey: { type: String, required: true },
  period: { type: String, enum: ['daily', 'weekly', 'seasonal'], required: true },
  periodKey: { type: String, required: true }, // date / week / season id
  progress: { type: Number, default: 0 },
  targetValue: { type: Number, required: true },
  isCompleted: { type: Boolean, default: false },
  isClaimed: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

StudentQuestProgressSchema.index({ studentId: 1, questKey: 1, periodKey: 1 }, { unique: true });

module.exports = mongoose.model('StudentQuestProgress', StudentQuestProgressSchema);
