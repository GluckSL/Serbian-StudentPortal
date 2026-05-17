// services/interactiveGames/antiCheat.js — multiplayer + XP fraud detection

const ArenaAuditLog = require('../../models/ArenaAuditLog');
const XpTransaction = require('../../models/XpTransaction');

const socketBuckets = new Map();
const MAX_SOCKET_EVENTS_PER_MIN = 80;
const MAX_XP_PER_HOUR = 2000;

function checkSocketRate(studentId) {
  const now = Date.now();
  let b = socketBuckets.get(String(studentId));
  if (!b || now - b.start > 60_000) {
    b = { start: now, count: 0 };
    socketBuckets.set(String(studentId), b);
  }
  b.count += 1;
  return b.count <= MAX_SOCKET_EVENTS_PER_MIN;
}

function validateMultiplayerAnswer(studentId, { isCorrect, points, responseTimeMs, questionIndex }) {
  if (!checkSocketRate(studentId)) {
    return { ok: false, message: 'Rate limit exceeded' };
  }
  if (responseTimeMs != null && responseTimeMs < 200) {
    return { ok: false, message: 'Answer too fast' };
  }
  if (points != null && (points > 50 || points < 0)) {
    return { ok: false, message: 'Invalid points' };
  }
  if (questionIndex != null && (questionIndex < 0 || questionIndex > 500)) {
    return { ok: false, message: 'Invalid question index' };
  }
  return { ok: true };
}

/** Server-authoritative battle answers — client never sends points/isCorrect */
function validateBattleAnswer(studentId, payload) {
  if (!checkSocketRate(studentId)) {
    return { ok: false, message: 'Rate limit exceeded' };
  }
  const roundIndex = payload?.roundIndex;
  if (roundIndex == null || roundIndex < 0 || roundIndex > 100) {
    return { ok: false, message: 'Invalid round' };
  }
  const hasTyped = typeof payload?.typedWord === 'string' && payload.typedWord.length > 0;
  const hasTokens = Array.isArray(payload?.orderedTokens) && payload.orderedTokens.length > 0;
  if (!hasTyped && !hasTokens) {
    return { ok: false, message: 'Empty answer' };
  }
  if (hasTyped && payload.typedWord.length > 80) {
    return { ok: false, message: 'Answer too long' };
  }
  if (hasTokens && payload.orderedTokens.length > 60) {
    return { ok: false, message: 'Too many tokens' };
  }
  return { ok: true };
}

async function detectXpFraud(studentId) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const agg = await XpTransaction.aggregate([
    { $match: { studentId, createdAt: { $gte: hourAgo } } },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);
  const total = agg[0]?.total || 0;
  if (total > MAX_XP_PER_HOUR) {
    await ArenaAuditLog.create({
      actorId: studentId,
      action: 'xp_fraud_suspected',
      severity: 'critical',
      metadata: { totalXpLastHour: total },
    });
    return { suspicious: true, total };
  }
  return { suspicious: false, total };
}

async function getAntiCheatSummary(limit = 30) {
  return ArenaAuditLog.find({
    action: { $in: ['multiplayer_cheat_blocked', 'xp_fraud_suspected', 'suspicious_gameplay'] },
  }).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = {
  validateMultiplayerAnswer,
  validateBattleAnswer,
  checkSocketRate,
  detectXpFraud,
  getAntiCheatSummary,
};
