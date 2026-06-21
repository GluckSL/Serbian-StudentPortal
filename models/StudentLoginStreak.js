const mongoose = require('mongoose');

const StudentLoginStreakSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  currentStreak: { type: Number, default: 0 },
  bestStreak: { type: Number, default: 0 },
  lastLoginDate: { type: String, default: null },
  weeklyDays: { type: Number, default: 0 },
  weekKey: { type: String, default: null },
  weeklyRewardTier: {
    type: String,
    default: null,
    enum: [null, 'bronze', 'silver', 'gold', 'trophy'],
  },
  totalTrophies: { type: Number, default: 0 },
  loggedDates: { type: [String], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('StudentLoginStreak', StudentLoginStreakSchema);
