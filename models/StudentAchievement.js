// models/StudentAchievement.js — unlocked achievements per student

const mongoose = require('mongoose');

const StudentAchievementSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  achievementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Achievement', required: true },
  achievementKey: { type: String, required: true },
  unlockedAt: { type: Date, default: Date.now },
  progress: { type: Number, default: 0 },
  isUnlocked: { type: Boolean, default: true },
}, { timestamps: true });

StudentAchievementSchema.index({ studentId: 1, achievementKey: 1 }, { unique: true });

module.exports = mongoose.model('StudentAchievement', StudentAchievementSchema);
