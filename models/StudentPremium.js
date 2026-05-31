// models/StudentPremium.js — subscription tier (no payment gateway)

const mongoose = require('mongoose');

const StudentPremiumSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  tier: { type: String, enum: ['free', 'premium', 'premium_plus'], default: 'free' },
  expiresAt: { type: Date, default: null },
  perks: {
    xpMultiplier: { type: Number, default: 1 },
    premiumLeagues: { type: Boolean, default: false },
    exclusiveBadges: { type: Boolean, default: false },
    cosmetics: { type: Boolean, default: false },
  },
  grantedBy: { type: String, enum: ['admin', 'trial', 'promo'], default: 'trial' },
}, { timestamps: true });

module.exports = mongoose.model('StudentPremium', StudentPremiumSchema);
