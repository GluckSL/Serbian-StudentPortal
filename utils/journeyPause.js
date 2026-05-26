/**
 * Pause journey for "new" batch type: freeze batch day and skip daily student rollover
 * until an admin resumes from Journey Management.
 */

const { isLearningEnabled } = require('./batchType');

const MS_PER_DAY = 86_400_000;

function clampDay(d, max = 200) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  const cap = max != null ? max : 200;
  if (n > cap) return cap;
  return n;
}

function utcMidnightMs(date) {
  const d = date instanceof Date ? date : new Date(date);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Calendar-based batch day (ignores pause).
 */
function computeBatchDayFromCalendar(cfg) {
  if (!cfg) return 1;
  if (!cfg.batchStartDate) {
    return clampDay(cfg.batchCurrentDay, cfg.journeyLength);
  }
  const now = new Date();
  const todayUTC = utcMidnightMs(now);
  const startUTC = utcMidnightMs(new Date(cfg.batchStartDate));
  const elapsed = Math.floor((todayUTC - startUTC) / MS_PER_DAY);
  return clampDay(elapsed + 1, cfg.journeyLength);
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
      return clampDay(frozen, cfg.journeyLength);
    }
  }
  return computeBatchDayFromCalendar(cfg);
}

function shouldSkipStudentRollover(cfg) {
  return isNewBatchPaused(cfg);
}

/**
 * Apply pause / resume when journeyPaused is toggled on a new batch config.
 * @param {import('mongoose').Document} cfg - BatchConfig document (mutated)
 * @param {boolean} wantPaused
 */
function applyJourneyPauseToggle(cfg, wantPaused) {
  if (!cfg || !isLearningEnabled(cfg.batchType)) {
    cfg.journeyPaused = false;
    cfg.journeyPausedAt = null;
    cfg.journeyPausedFrozenDay = null;
    return;
  }

  const wasPaused = !!cfg.journeyPaused;
  const pause = !!wantPaused;

  if (pause && !wasPaused) {
    const liveDay = computeBatchDayFromCalendar(cfg);
    cfg.journeyPaused = true;
    cfg.journeyPausedAt = new Date();
    cfg.journeyPausedFrozenDay = liveDay;
    if (!cfg.batchStartDate) {
      cfg.batchCurrentDay = liveDay;
    }
    return;
  }

  if (!pause && wasPaused) {
    cfg.journeyPaused = false;
    const frozen = cfg.journeyPausedFrozenDay;
    if (cfg.batchStartDate && frozen != null && Number.isFinite(Number(frozen))) {
      const day = clampDay(frozen, cfg.journeyLength);
      const todayUTC = utcMidnightMs(new Date());
      const startUTC = todayUTC - (day - 1) * MS_PER_DAY;
      cfg.batchStartDate = new Date(startUTC);
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
      paused && cfg.journeyPausedFrozenDay != null ? cfg.journeyPausedFrozenDay : null
  };
}

module.exports = {
  computeBatchDay,
  computeBatchDayFromCalendar,
  isNewBatchPaused,
  shouldSkipStudentRollover,
  applyJourneyPauseToggle,
  clearJourneyPauseFields,
  journeyPauseFieldsForApi
};
