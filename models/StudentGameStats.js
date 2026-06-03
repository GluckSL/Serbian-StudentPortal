// models/StudentGameStats.js
// GlückArena: denormalized per-student stats updated on each game completion.
// One document per student — upserted atomically with $inc / $max.

const mongoose = require('mongoose');

const StudentGameStatsSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },

  totalXp: { type: Number, default: 0 },
  gamesPlayed: { type: Number, default: 0 },
  gamesCompleted: { type: Number, default: 0 },
  totalCorrectAnswers: { type: Number, default: 0 },
  totalAnswers: { type: Number, default: 0 },

  // Best single-game score ever
  bestScore: { type: Number, default: 0 },

  // Streak: consecutive calendar days with at least one completed game
  currentStreak: { type: Number, default: 0 },
  bestStreak: { type: Number, default: 0 },
  lastPlayedDate: { type: Date, default: null },
  // Streak 2.0
  streakFreezes: { type: Number, default: 0 },
  streakRepairsUsedMonth: { type: String, default: null }, // YYYY-MM
  streakRepairsCount: { type: Number, default: 0 },
  weeklyStreakDays: { type: Number, default: 0 },
  weeklyStreakWeekKey: { type: String, default: null },
  weeklyStreakRewardClaimed: { type: Boolean, default: false },
  claimedStreakMilestones: { type: [Number], default: [] },
  pushReminderEnabled: { type: Boolean, default: true },
  lastStreakReminderAt: { type: Date, default: null },
  arenaLevel: { type: Number, default: 1 },

  // Per-gameType breakdowns (keyed by gameType string)
  byGameType: {
    scramble_rush: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    sentence_builder: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    matching: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    flashcards: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    image_matching: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    gender_stack: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    flapjugation: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    whackawort: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    memory: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
    jumbled_words: {
      gamesCompleted: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
    },
  },
}, { timestamps: true });

// Virtual accuracy
StudentGameStatsSchema.virtual('accuracy').get(function () {
  if (!this.totalAnswers) return 0;
  return Math.round((this.totalCorrectAnswers / this.totalAnswers) * 100);
});

StudentGameStatsSchema.set('toJSON', { virtuals: true });
StudentGameStatsSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('StudentGameStats', StudentGameStatsSchema);
