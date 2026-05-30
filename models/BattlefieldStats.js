const mongoose = require('mongoose');

const BattlefieldStatsSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  gamesPlayed: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  elo: { type: Number, default: 1000 },
  tier: { type: String, enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond'], default: 'bronze' },
  lastGameAt: { type: Date, default: null },
}, { timestamps: true });

BattlefieldStatsSchema.index({ elo: -1 });

module.exports = mongoose.model('BattlefieldStats', BattlefieldStatsSchema);
