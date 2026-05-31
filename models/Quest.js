// models/Quest.js — daily / weekly / seasonal quest definitions

const mongoose = require('mongoose');

const QuestSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  period: { type: String, enum: ['daily', 'weekly', 'seasonal'], required: true, index: true },
  questType: {
    type: String,
    enum: [
      'games_completed', 'xp_earned', 'perfect_accuracy', 'no_mistakes',
      'speed_completion', 'maintain_streak', 'seasonal_event',
    ],
    required: true,
  },
  targetValue: { type: Number, default: 1 },
  xpReward: { type: Number, default: 25 },
  coinReward: { type: Number, default: 0 },
  badgeKey: { type: String, default: null },
  seasonKey: { type: String, default: null },
  poolTag: { type: String, default: 'default' },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Quest', QuestSchema);
