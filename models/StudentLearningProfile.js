// models/StudentLearningProfile.js — adaptive learning / mastery tracking

const mongoose = require('mongoose');

const WeakItemSchema = new mongoose.Schema({
  key: { type: String, required: true },
  label: { type: String, default: '' },
  errorCount: { type: Number, default: 0 },
  lastSeenAt: { type: Date, default: Date.now },
}, { _id: false });

const StudentLearningProfileSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  masteryScore: { type: Number, default: 0 }, // 0–100
  weakVocabulary: { type: [WeakItemSchema], default: [] },
  weakGrammar: { type: [WeakItemSchema], default: [] },
  recommendedGameSetIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'GameSet' }],
  spacedRepetitionDue: [{ questionId: { type: mongoose.Schema.Types.ObjectId }, dueAt: { type: Date } }],
  retentionRisk: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
  lastAnalyzedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('StudentLearningProfile', StudentLearningProfileSchema);
