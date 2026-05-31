// services/interactiveGames/premium.js — subscription tier guards (no payment gateway)

const StudentPremium = require('../../models/StudentPremium');
const gaConfig = require('../../config/glueckArena');

const PREMIUM_PERKS = {
  free: { xpMultiplier: 1, premiumLeagues: false, exclusiveBadges: false, cosmetics: false },
  premium: { xpMultiplier: 1.5, premiumLeagues: true, exclusiveBadges: true, cosmetics: true },
  premium_plus: { xpMultiplier: 2, premiumLeagues: true, exclusiveBadges: true, cosmetics: true },
};

async function getSubscription(studentId) {
  const sub = await StudentPremium.findOne({ studentId }).lean();
  if (!sub) return { tier: 'free', perks: PREMIUM_PERKS.free, isActive: true };
  const expired = sub.expiresAt && new Date(sub.expiresAt) < new Date();
  if (expired) return { tier: 'free', perks: PREMIUM_PERKS.free, isActive: false, expired: true };
  return {
    tier: sub.tier,
    perks: { ...PREMIUM_PERKS[sub.tier] || PREMIUM_PERKS.free, ...sub.perks },
    expiresAt: sub.expiresAt,
    isActive: true,
  };
}

async function grantPremium(studentId, { tier = 'premium', days = 30, grantedBy = 'admin' } = {}) {
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const perks = PREMIUM_PERKS[tier] || PREMIUM_PERKS.premium;
  return StudentPremium.findOneAndUpdate(
    { studentId },
    { $set: { tier, expiresAt, perks, grantedBy } },
    { upsert: true, new: true }
  );
}

function hasFeature(sub, feature) {
  if (!sub?.isActive && sub?.tier !== 'free') return false;
  const perks = sub.perks || PREMIUM_PERKS.free;
  switch (feature) {
    case 'premium_leagues': return !!perks.premiumLeagues;
    case 'cosmetics': return !!perks.cosmetics;
    case 'exclusive_badges': return !!perks.exclusiveBadges;
    default: return sub.tier !== 'free';
  }
}

function xpMultiplier(sub) {
  return sub?.perks?.xpMultiplier || 1;
}

module.exports = { getSubscription, grantPremium, hasFeature, xpMultiplier, PREMIUM_PERKS };
