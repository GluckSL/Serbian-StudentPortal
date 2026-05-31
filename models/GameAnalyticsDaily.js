// models/GameAnalyticsDaily.js — optional daily rollup cache for fast admin dashboards

const mongoose = require('mongoose');

const GameAnalyticsDailySchema = new mongoose.Schema({
  date: { type: Date, required: true, index: true },
  gameSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSet', default: null },
  gameType: { type: String, default: null },

  attemptsStarted: { type: Number, default: 0 },
  attemptsCompleted: { type: Number, default: 0 },
  attemptsAbandoned: { type: Number, default: 0 },
  uniquePlayers: { type: Number, default: 0 },
  totalXpEarned: { type: Number, default: 0 },
  totalAnswers: { type: Number, default: 0 },
  correctAnswers: { type: Number, default: 0 },
  avgSessionSeconds: { type: Number, default: 0 },
  leaderboardViews: { type: Number, default: 0 },
}, { timestamps: true });

GameAnalyticsDailySchema.index({ date: 1, gameSetId: 1 }, { unique: true });

module.exports = mongoose.model('GameAnalyticsDaily', GameAnalyticsDailySchema);
