// services/interactiveGames/scoring.js
// GlückArena: centralised point and XP calculation rules

const BASE_POINTS = {
  scramble_rush: 10,
  sentence_builder: 15,
  matching: 10,
  flashcards: 5,
  image_matching: 10,
  gender_stack: 10,
};

const PER_ANSWER_XP = {
  scramble_rush: 3,
  sentence_builder: 5,
  matching: 3,
  flashcards: 2,
  image_matching: 3,
  gender_stack: 3,
};

/**
 * Points awarded per correct answer for a given game type.
 */
function basePoints(gameType) {
  return BASE_POINTS[gameType] ?? 10;
}

/**
 * XP awarded per correct answer (small real-time reward).
 */
function perAnswerXp(gameType) {
  return PER_ANSWER_XP[gameType] ?? 3;
}

/**
 * Bonus XP awarded on game completion.
 * Uses set.xpReward as the base and scales by accuracy.
 *
 * accuracy: 0–100
 * Returns the XP bonus integer.
 */
/** Points per correctly placed word (sentence builder slots). */
function slotPoints(gameType) {
  return gameType === 'sentence_builder' ? 10 : basePoints(gameType);
}

/**
 * Speed bonus when a full sentence is completed within the per-question limit.
 * @param {number} elapsedMs time spent on this question
 * @param {number} limitSeconds from GameSet.timerSettings.perQuestionSeconds
 */
function sentenceSpeedBonus(elapsedMs, limitSeconds) {
  const limitMs = Math.max((limitSeconds || 30) * 1000, 5000);
  if (elapsedMs <= limitMs * 0.4) return 20;
  if (elapsedMs <= limitMs * 0.6) return 12;
  if (elapsedMs <= limitMs * 0.85) return 6;
  return 0;
}

function completionXpBonus(set, accuracy) {
  const base = set?.xpReward ?? 50;
  const multiplier = accuracy >= 90 ? 1.0 : accuracy >= 70 ? 0.75 : accuracy >= 50 ? 0.5 : 0.25;
  return Math.round(base * multiplier);
}

module.exports = { basePoints, perAnswerXp, completionXpBonus, slotPoints, sentenceSpeedBonus };
