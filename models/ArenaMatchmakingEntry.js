// models/ArenaMatchmakingEntry.js — matchmaking queue entries

const mongoose = require('mongoose');

const ArenaMatchmakingEntrySchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  mode: { type: String, enum: ['casual', 'ranked'], default: 'casual', index: true },
  gameType: { type: String, enum: ['scramble_rush', 'sentence_builder', 'any'], default: 'any' },
  skillRating: { type: Number, default: 1000 },
  region: { type: String, default: 'global', index: true },
  queuedAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('ArenaMatchmakingEntry', ArenaMatchmakingEntrySchema);
