// models/ArenaRankedProfile.js — ELO/MMR competitive ranking

const mongoose = require('mongoose');

const ArenaRankedProfileSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  mmr: { type: Number, default: 1000 },
  tier: { type: String, default: 'bronze' },
  placementMatchesPlayed: { type: Number, default: 0 },
  placementComplete: { type: Boolean, default: false },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  seasonId: { type: String, default: '2026-s1' },
  lastPlayedAt: { type: Date, default: null },
  decayWarnedAt: { type: Date, default: null },
  smurfFlags: { type: Number, default: 0 },
}, { timestamps: true });

ArenaRankedProfileSchema.index({ mmr: -1 });
ArenaRankedProfileSchema.index({ seasonId: 1, mmr: -1 });

module.exports = mongoose.model('ArenaRankedProfile', ArenaRankedProfileSchema);
