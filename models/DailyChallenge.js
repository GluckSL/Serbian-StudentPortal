// models/DailyChallenge.js — daily challenge definitions

const mongoose = require('mongoose');

const DailyChallengeSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  challengeType: {
    type: String,
    enum: ['games_completed', 'xp_earned', 'perfect_accuracy', 'time_limit_complete', 'correct_answers'],
    required: true,
  },
  targetValue: { type: Number, required: true, min: 1 },
  xpReward: { type: Number, default: 25, min: 0 },
  gameType: {
    type: String,
    enum: ['scramble_rush', 'sentence_builder', 'matching', 'flashcards', 'image_matching', 'gender_stack', 'flapjugation', 'whackawort', 'memory', null],
    default: null,
  },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('DailyChallenge', DailyChallengeSchema);
