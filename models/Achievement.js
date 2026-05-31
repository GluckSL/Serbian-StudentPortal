// models/Achievement.js — achievement/badge catalog

const mongoose = require('mongoose');

const AchievementSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: 'emoji_events' },
  category: {
    type: String,
    enum: ['streak', 'accuracy', 'speed', 'vocabulary', 'leaderboard', 'milestone'],
    default: 'milestone',
  },
  criteriaType: {
    type: String,
    enum: [
      'streak_days',
      'correct_answers_total',
      'games_completed',
      'flawless_game',
      'leaderboard_top',
      'fast_completion',
      'total_xp',
    ],
    required: true,
  },
  criteriaValue: { type: Number, required: true, min: 1 },
  xpReward: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Achievement', AchievementSchema);
