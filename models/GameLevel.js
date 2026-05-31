// models/GameLevel.js
// GlückArena: Scramble Rush level configuration (per GameSet)

const mongoose = require('mongoose');

const GameLevelSchema = new mongoose.Schema({
  gameSetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GameSet',
    required: true,
    index: true,
  },

  levelNumber: { type: Number, required: true, min: 1 },

  lives: { type: Number, default: 3, min: 1, max: 10 },
  timeLimitSeconds: { type: Number, default: 60, min: 10, max: 600 },

  // CSS animation-duration used by the falling word animation (ms per px)
  fallSpeedMs: { type: Number, default: 8000, min: 1000 },

  // Interval between word spawns (milliseconds)
  spawnIntervalMs: { type: Number, default: 3000, min: 500 },

  // Number of words the student must answer to complete this level
  wordsRequired: { type: Number, default: 5, min: 1 },

  // Score multiplier applied to base points for words answered on this level
  scoreMultiplier: { type: Number, default: 1.0, min: 0.5, max: 10 },
}, { timestamps: true });

GameLevelSchema.index({ gameSetId: 1, levelNumber: 1 }, { unique: true });

module.exports = mongoose.model('GameLevel', GameLevelSchema);
