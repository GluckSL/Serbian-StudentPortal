// services/interactiveGames/security.js — anti-cheat, rate limits, attempt validation

const GameAnswer = require('../../models/GameAnswer');
const GameAttempt = require('../../models/GameAttempt');

const ATTEMPT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
const MIN_ANSWER_INTERVAL_MS = 400;
const MAX_ANSWERS_PER_MINUTE = 40;

const rateBuckets = new Map();

function checkRateLimit(studentId) {
  const now = Date.now();
  let bucket = rateBuckets.get(studentId);
  if (!bucket || now - bucket.windowStart > 60_000) {
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(studentId, bucket);
  }
  bucket.count += 1;
  if (bucket.count > MAX_ANSWERS_PER_MINUTE) {
    return { ok: false, message: 'Too many requests. Please slow down.' };
  }
  return { ok: true };
}

function validateAttemptActive(attempt) {
  if (!attempt) return { ok: false, message: 'Attempt not found' };
  if (attempt.status !== 'in-progress') {
    return { ok: false, message: 'Attempt is not in progress' };
  }
  const age = Date.now() - new Date(attempt.startedAt).getTime();
  if (age > ATTEMPT_MAX_AGE_MS) {
    return { ok: false, message: 'Attempt expired. Please start a new game.', expired: true };
  }
  return { ok: true };
}

async function validateAnswerSubmission(attempt, questionId, responseTimeMs) {
  const base = validateAttemptActive(attempt);
  if (!base.ok) return base;

  const rate = checkRateLimit(String(attempt.studentId));
  if (!rate.ok) return rate;

  if (responseTimeMs != null && responseTimeMs < MIN_ANSWER_INTERVAL_MS) {
    return { ok: false, message: 'Answer submitted too quickly' };
  }

  const existing = await GameAnswer.findOne({
    attemptId: attempt._id,
    questionId,
  }).lean();

  if (existing?.isCorrect) {
    return { ok: false, message: 'Question already answered', duplicate: true };
  }

  return { ok: true };
}

/** Slot placement — one record per (attempt, question, slot). */
async function validateSlotSubmission(attempt, questionId, slotIndex) {
  const base = validateAttemptActive(attempt);
  if (!base.ok) return base;

  const rate = checkRateLimit(String(attempt.studentId));
  if (!rate.ok) return rate;

  const idx = parseInt(slotIndex, 10);
  if (!Number.isFinite(idx) || idx < 0) {
    return { ok: false, message: 'Invalid slot' };
  }

  const existing = await GameAnswer.findOne({
    attemptId: attempt._id,
    questionId,
    slotIndex: idx,
    isCorrect: true,
  }).lean();

  if (existing) {
    return { ok: false, message: 'Slot already correct', duplicate: true };
  }

  return { ok: true };
}

async function expireStaleAttempts() {
  const cutoff = new Date(Date.now() - ATTEMPT_MAX_AGE_MS);
  const result = await GameAttempt.updateMany(
    { status: 'in-progress', startedAt: { $lt: cutoff } },
    { $set: { status: 'abandoned', completedAt: new Date() } }
  );
  return result.modifiedCount || 0;
}

module.exports = {
  validateAttemptActive,
  validateAnswerSubmission,
  validateSlotSubmission,
  expireStaleAttempts,
  ATTEMPT_MAX_AGE_MS,
};
