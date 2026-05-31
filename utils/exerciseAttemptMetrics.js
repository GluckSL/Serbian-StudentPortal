'use strict';

/**
 * Shared helpers for digital exercise attempt duration.
 * Prevents inflated timeSpentSeconds when a tab is left open (wall-clock drift).
 */

/** Hard cap for any single exercise attempt (2 hours). */
const MAX_ATTEMPT_SECONDS = 2 * 60 * 60;

/** Max increase allowed per question submit (20 minutes). */
const MAX_SECONDS_PER_QUESTION_DELTA = 20 * 60;

function wallClockSeconds(attempt, endDate) {
  const startMs = attempt.startedAt ? new Date(attempt.startedAt).getTime() : 0;
  if (!startMs) return 0;
  const endMs = endDate
    ? new Date(endDate).getTime()
    : Date.now();
  if (endMs <= startMs) return 0;
  return Math.floor((endMs - startMs) / 1000);
}

/**
 * Returns trustworthy seconds for analytics / language tracking.
 * - Incomplete attempts: capped stored time only (no open-tab wall clock).
 * - Completed: min(stored, completedAt − startedAt, MAX_ATTEMPT_SECONDS).
 */
function effectiveTimeSpentSeconds(attempt) {
  const stored = Math.max(0, Number(attempt.timeSpentSeconds) || 0);
  const status = attempt.status || 'in-progress';

  if (status !== 'completed') {
    return 0;
  }

  const wallSec = wallClockSeconds(attempt, attempt.completedAt);
  if (wallSec > 0) {
    if (stored <= 0) return Math.min(wallSec, MAX_ATTEMPT_SECONDS);
    if (stored > wallSec + 120) return Math.min(wallSec, MAX_ATTEMPT_SECONDS);
    return Math.min(stored, MAX_ATTEMPT_SECONDS);
  }

  return Math.min(stored, MAX_ATTEMPT_SECONDS);
}

/**
 * Sanitizes client-reported time on save (per-question or final submit).
 */
function sanitizeReportedTimeSpentSeconds(attempt, reportedSeconds) {
  const prev = Math.max(0, Number(attempt.timeSpentSeconds) || 0);
  const reported = Math.max(0, Number(reportedSeconds) || 0);
  const cappedReported = Math.min(reported, MAX_ATTEMPT_SECONDS);
  const delta = cappedReported - prev;

  if (delta > MAX_SECONDS_PER_QUESTION_DELTA) {
    return Math.min(prev + MAX_SECONDS_PER_QUESTION_DELTA, MAX_ATTEMPT_SECONDS);
  }

  if (attempt.status === 'completed' && attempt.completedAt && attempt.startedAt) {
    const wallSec = wallClockSeconds(attempt, attempt.completedAt);
    if (wallSec > 0 && cappedReported > wallSec + 120) {
      return Math.min(Math.max(prev, wallSec), MAX_ATTEMPT_SECONDS);
    }
  }

  return cappedReported;
}

module.exports = {
  MAX_ATTEMPT_SECONDS,
  MAX_SECONDS_PER_QUESTION_DELTA,
  effectiveTimeSpentSeconds,
  sanitizeReportedTimeSpentSeconds,
};
