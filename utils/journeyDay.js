/**
 * Journey days: standard batches use 1–220 (start date = Day 1).
 * When trialDayEnabled on a batch: start date = Trial (stored as 0), then Day 1, 2, …
 */

const JOURNEY_DAY_MAX = 220;

/**
 * Level schedule definitions for the per-level start date system.
 * When levelCalendarDates[level].startDate is set for any level,
 * the batch day is computed from these ranges rather than batchStartDate.
 *
 * A1: Day 1–42   (41 class days + 1 exam day)
 * A2: Day 43–84  (41 class days + 1 exam day)
 * B1: Day 85–149 (64 class days + 1 exam day)
 * B2: Day 150–214 (64 class days + 1 exam day)
 */
const LEVEL_SCHEDULE = [
  { level: 'A1', dayStart: 1,   dayEnd: 42  },
  { level: 'A2', dayStart: 43,  dayEnd: 84  },
  { level: 'B1', dayStart: 85,  dayEnd: 149 },
  { level: 'B2', dayStart: 150, dayEnd: 214 },
];
const STANDARD_JOURNEY_MIN = 1;
const TRIAL_JOURNEY_DAY = 0;
const MS_PER_DAY = 86_400_000;

function clampStandardJourneyDay(raw, max = JOURNEY_DAY_MAX) {
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < STANDARD_JOURNEY_MIN) return STANDARD_JOURNEY_MIN;
  const cap = max != null ? max : JOURNEY_DAY_MAX;
  if (n > cap) return cap;
  return n;
}

function clampJourneyDayForBatch(raw, max = JOURNEY_DAY_MAX, trialDayEnabled = false) {
  if (!trialDayEnabled) return clampStandardJourneyDay(raw, max);
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < TRIAL_JOURNEY_DAY) return TRIAL_JOURNEY_DAY;
  const cap = max != null ? max : JOURNEY_DAY_MAX;
  if (n > cap) return cap;
  return n;
}

/** @deprecated use clampStandardJourneyDay or clampJourneyDayForBatch */
function clampJourneyDay(raw, max = JOURNEY_DAY_MAX) {
  return clampStandardJourneyDay(raw, max);
}

function utcMidnightMs(date) {
  const d = date instanceof Date ? date : new Date(date);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysSinceJourneyStart(startDate, now = new Date()) {
  if (!startDate) return 0;
  const todayUTC = utcMidnightMs(now);
  const startUTC = utcMidnightMs(new Date(startDate));
  return Math.max(0, Math.floor((todayUTC - startUTC) / MS_PER_DAY));
}

/**
 * Trial batches with trialAccessStartDate: trial window begins on that date;
 * batchStartDate is Day 1 (not trial). Legacy trial: batchStartDate is the single Trial day.
 */
function computeJourneyDayWithTrialWindow(trialAccessStartDate, dayOneStartDate, now = new Date(), max = JOURNEY_DAY_MAX) {
  const today = utcMidnightMs(now);
  const trialStart = utcMidnightMs(new Date(trialAccessStartDate));
  const dayOneStart = utcMidnightMs(new Date(dayOneStartDate));
  if (today < trialStart) return TRIAL_JOURNEY_DAY;
  if (today < dayOneStart) return TRIAL_JOURNEY_DAY;
  const elapsed = daysSinceJourneyStart(dayOneStartDate, now);
  return clampStandardJourneyDay(elapsed + 1, max);
}

/**
 * Computes the current journey day using per-level start dates stored in
 * cfg.levelCalendarDates[level].startDate.
 *
 * Algorithm:
 *   1. Walk levels A1→A2→B1→B2, find the latest whose startDate has passed.
 *   2. journeyDay = level.dayStart + daysSince(that level's startDate).
 *   3. Cap at level.dayEnd so that during inter-level breaks the batch day
 *      stays at the end of the current level until the next one begins.
 *   4. Returns Day 1 (STANDARD_JOURNEY_MIN) if no level has started yet.
 */
function computeJourneyDayFromLevelSchedule(cfg, now = new Date()) {
  const today = utcMidnightMs(now);
  const max = cfg.journeyLength != null ? cfg.journeyLength : JOURNEY_DAY_MAX;
  let activeLevel = null;
  for (const entry of LEVEL_SCHEDULE) {
    const sd = cfg.levelCalendarDates?.[entry.level]?.startDate;
    if (!sd) continue;
    const startUTC = utcMidnightMs(new Date(sd));
    if (today >= startUTC) {
      activeLevel = { ...entry, startUTC };
    }
  }
  if (!activeLevel) return STANDARD_JOURNEY_MIN;
  const elapsed = Math.floor((today - activeLevel.startUTC) / MS_PER_DAY);
  const raw = activeLevel.dayStart + elapsed;
  return clampStandardJourneyDay(Math.min(raw, activeLevel.dayEnd), max);
}

function computeJourneyDayFromBatchConfig(cfg, now = new Date()) {
  if (!cfg) return STANDARD_JOURNEY_MIN;

  // When any level start date is configured, use the level-schedule system.
  const hasLevelDates = LEVEL_SCHEDULE.some(
    (e) => cfg.levelCalendarDates?.[e.level]?.startDate
  );
  if (hasLevelDates) return computeJourneyDayFromLevelSchedule(cfg, now);

  const max = cfg.journeyLength != null ? cfg.journeyLength : JOURNEY_DAY_MAX;
  const trial = !!cfg.trialDayEnabled;
  const batchStartDate = cfg.batchStartDate;
  const trialAccessStartDate = cfg.trialAccessStartDate;

  if (!trial) {
    return computeJourneyDayFromStartDate(batchStartDate, now, max, false);
  }

  if (trialAccessStartDate && batchStartDate) {
    return computeJourneyDayWithTrialWindow(trialAccessStartDate, batchStartDate, now, max);
  }

  return computeJourneyDayFromStartDate(batchStartDate, now, max, true);
}

function computeJourneyDayFromStartDate(
  startDate,
  now = new Date(),
  max = JOURNEY_DAY_MAX,
  trialDayEnabled = false,
  trialAccessStartDate = null
) {
  if (trialDayEnabled && trialAccessStartDate && startDate) {
    return computeJourneyDayWithTrialWindow(trialAccessStartDate, startDate, now, max);
  }
  if (!startDate) return trialDayEnabled ? TRIAL_JOURNEY_DAY : STANDARD_JOURNEY_MIN;
  const elapsed = daysSinceJourneyStart(startDate, now);
  if (trialDayEnabled) return clampJourneyDayForBatch(elapsed, max, true);
  return clampStandardJourneyDay(elapsed + 1, max);
}

function contentUnlockDayForJourney(courseDay, trialDayEnabled = false) {
  const n = Number(courseDay);
  if (trialDayEnabled && n === TRIAL_JOURNEY_DAY) return STANDARD_JOURNEY_MIN;
  return n;
}

function isValidJourneyDay(raw, trialDayEnabled = false) {
  const n = Number(raw);
  const min = trialDayEnabled ? TRIAL_JOURNEY_DAY : STANDARD_JOURNEY_MIN;
  return Number.isFinite(n) && n >= min && n <= JOURNEY_DAY_MAX;
}

function isTrialJourneyDay(day) {
  return Number(day) === TRIAL_JOURNEY_DAY;
}

function journeyDayRangeStart(trialDayEnabled = false) {
  return trialDayEnabled ? TRIAL_JOURNEY_DAY : STANDARD_JOURNEY_MIN;
}

/**
 * Lowest journey day for assigned content (exercises, DG, games).
 * Silver GO students never use Trial (day 0); trial batches may use 0.
 */
function minimumAssignedContentDay(student, trialDayEnabled = false) {
  const { isSilverGoStudent } = require('./goSilverTrack');
  if (student && isSilverGoStudent(student)) return STANDARD_JOURNEY_MIN;
  return journeyDayRangeStart(trialDayEnabled);
}

/** Mongo $or: unassigned content or courseDay within [minDay, maxDay]. */
function studentAssignedCourseDayOrClause(maxDay, minDay = STANDARD_JOURNEY_MIN) {
  const min = Number.isFinite(Number(minDay)) ? Number(minDay) : STANDARD_JOURNEY_MIN;
  const max = Math.max(min, Number(maxDay) || min);
  return {
    $or: [
      { courseDay: null },
      { courseDay: { $exists: false } },
      { courseDay: { $gte: min, $lte: max } }
    ]
  };
}

function formatJourneyDayLabel(day, trialDayEnabled = false) {
  const n = Number(day);
  if (trialDayEnabled && n === TRIAL_JOURNEY_DAY) return 'Trial';
  return `Day ${n}`;
}

/** Admin content tagging: 0 = Trial, 1–200 = journey days. */
function isValidAdminCourseDay(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= TRIAL_JOURNEY_DAY && n <= JOURNEY_DAY_MAX;
}

function parseAdminCourseDay(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Math.floor(Number(raw));
  if (!isValidAdminCourseDay(n)) return null;
  return n;
}

module.exports = {
  JOURNEY_DAY_MAX,
  STANDARD_JOURNEY_MIN,
  TRIAL_JOURNEY_DAY,
  MS_PER_DAY,
  LEVEL_SCHEDULE,
  clampStandardJourneyDay,
  clampJourneyDayForBatch,
  clampJourneyDay,
  utcMidnightMs,
  daysSinceJourneyStart,
  computeJourneyDayFromStartDate,
  computeJourneyDayFromLevelSchedule,
  computeJourneyDayFromBatchConfig,
  computeJourneyDayWithTrialWindow,
  contentUnlockDayForJourney,
  isValidJourneyDay,
  isTrialJourneyDay,
  journeyDayRangeStart,
  minimumAssignedContentDay,
  studentAssignedCourseDayOrClause,
  formatJourneyDayLabel,
  isValidAdminCourseDay,
  parseAdminCourseDay
};
