/**
 * Pause journey for "new" batch type: freeze batch day and skip daily student rollover
 * until an admin resumes from Journey Management.
 */

const { isLearningEnabled } = require('./batchType');
const {
  clampJourneyDayForBatch,
  utcMidnightMs,
  daysSinceJourneyStart,
  computeJourneyDayFromBatchConfig,
  MS_PER_DAY
} = require('./journeyDay');

function clampDay(d, max = 220, trialDayEnabled = false) {
  return clampJourneyDayForBatch(d, max, trialDayEnabled);
}

/**
 * Calendar-based batch day (ignores pause).
 */
function computeBatchDayFromCalendar(cfg) {
  if (!cfg) return 1;
  if (cfg.batchStartDate) {
    return computeJourneyDayFromBatchConfig(cfg);
  }
  const trial = !!cfg.trialDayEnabled;
  return clampDay(cfg.batchCurrentDay, cfg.journeyLength, trial);
}

function isNewBatchPaused(cfg) {
  if (!cfg || !isLearningEnabled(cfg.batchType)) return false;
  return !!cfg.journeyPaused;
}

/**
 * Live batch day shown in admin UI and used for batch-vs-student comparison.
 */
function computeBatchDay(cfg) {
  if (!cfg) return 1;
  if (isNewBatchPaused(cfg)) {
    const frozen = cfg.journeyPausedFrozenDay;
    if (frozen != null && Number.isFinite(Number(frozen))) {
      return clampDay(frozen, cfg.journeyLength, !!cfg.trialDayEnabled);
    }
  }
  return computeBatchDayFromCalendar(cfg);
}

function shouldSkipStudentRollover(cfg) {
  return isNewBatchPaused(cfg);
}

function pauseCalendarDays(pausedAt, resumeAt = new Date()) {
  if (!pausedAt) return 0;
  const pausedUTC = utcMidnightMs(pausedAt);
  const resumeUTC = utcMidnightMs(resumeAt);
  return Math.max(0, Math.floor((resumeUTC - pausedUTC) / MS_PER_DAY));
}

function appendPauseHistory(cfg, { day, pausedAt, resumedAt, pauseDays }) {
  if (!cfg) return;
  if (!Array.isArray(cfg.journeyPauseHistory)) {
    cfg.journeyPauseHistory = [];
  }
  cfg.journeyPauseHistory.push({
    day: clampDay(day, cfg.journeyLength),
    pausedAt: pausedAt instanceof Date ? pausedAt : new Date(pausedAt),
    resumedAt: resumedAt instanceof Date ? resumedAt : new Date(resumedAt),
    pauseDays: Math.max(0, pauseDays || 0)
  });
}

/**
 * Apply pause / resume when journeyPaused is toggled on a new batch config.
 * @param {import('mongoose').Document} cfg - BatchConfig document (mutated)
 * @param {boolean} wantPaused
 * @param {Date} [resumeAt] - optional resume timestamp (defaults to now)
 */
function applyJourneyPauseToggle(cfg, wantPaused, resumeAt) {
  if (!cfg || !isLearningEnabled(cfg.batchType)) {
    cfg.journeyPaused = false;
    cfg.journeyPausedAt = null;
    cfg.journeyPausedFrozenDay = null;
    return;
  }

  const wasPaused = !!cfg.journeyPaused;
  const pause = !!wantPaused;

  if (pause && !wasPaused) {
    const liveDay = computeBatchDay(cfg);
    cfg.journeyPaused = true;
    cfg.journeyPausedAt = new Date(utcMidnightMs(new Date()));
    cfg.journeyPausedFrozenDay = liveDay;
    if (!cfg.batchStartDate) {
      cfg.batchCurrentDay = liveDay;
    }
    return;
  }

  if (!pause && wasPaused) {
    const frozen = cfg.journeyPausedFrozenDay;
    const pausedAt = cfg.journeyPausedAt;
    const resumedAt = resumeAt instanceof Date ? resumeAt : new Date();
    cfg.journeyPaused = false;

    if (cfg.batchStartDate && pausedAt) {
      const pauseDays = pauseCalendarDays(pausedAt, resumedAt);
      if (pauseDays > 0) {
        const startUTC = utcMidnightMs(new Date(cfg.batchStartDate));
        cfg.batchStartDate = new Date(startUTC + pauseDays * MS_PER_DAY);
      }
      if (frozen != null && Number.isFinite(Number(frozen))) {
        appendPauseHistory(cfg, {
          day: frozen,
          pausedAt,
          resumedAt,
          pauseDays: pauseCalendarDays(pausedAt, resumedAt)
        });
      }
    }

    cfg.journeyPausedAt = null;
    cfg.journeyPausedFrozenDay = null;
    if (!cfg.batchStartDate && frozen != null) {
      cfg.batchCurrentDay = clampDay(frozen, cfg.journeyLength);
    }
  }
}

function clearJourneyPauseFields(cfg) {
  if (!cfg) return;
  cfg.journeyPaused = false;
  cfg.journeyPausedAt = null;
  cfg.journeyPausedFrozenDay = null;
}

function journeyPauseFieldsForApi(cfg) {
  const paused = isNewBatchPaused(cfg);
  return {
    journeyPaused: paused,
    journeyPausedAt: paused && cfg.journeyPausedAt ? cfg.journeyPausedAt : null,
    journeyPausedFrozenDay:
      paused && cfg.journeyPausedFrozenDay != null ? cfg.journeyPausedFrozenDay : null,
    journeyPauseHistory: Array.isArray(cfg.journeyPauseHistory) ? cfg.journeyPauseHistory : []
  };
}

module.exports = {
  computeBatchDay,
  computeBatchDayFromCalendar,
  isNewBatchPaused,
  shouldSkipStudentRollover,
  applyJourneyPauseToggle,
  clearJourneyPauseFields,
  journeyPauseFieldsForApi,
  pauseCalendarDays,
  utcMidnightMs,
  MS_PER_DAY
};
