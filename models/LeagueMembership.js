// models/LeagueMembership.js — weekly league placement per student

const mongoose = require('mongoose');

const LeagueMembershipSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  weekKey: { type: String, required: true, index: true }, // e.g. 2026-W20
  tier: { type: String, enum: ['bronze', 'silver', 'gold', 'diamond'], default: 'bronze' },
  weeklyXp: { type: Number, default: 0 },
  rank: { type: Number, default: null },
  cohortId: { type: String, required: true, index: true }, // matchmaking bucket
  promoted: { type: Boolean, default: false },
  relegated: { type: Boolean, default: false },
  rewardClaimed: { type: Boolean, default: false },
}, { timestamps: true });

LeagueMembershipSchema.index({ studentId: 1, weekKey: 1 }, { unique: true });
LeagueMembershipSchema.index({ cohortId: 1, weekKey: 1, weeklyXp: -1 });

module.exports = mongoose.model('LeagueMembership', LeagueMembershipSchema);
