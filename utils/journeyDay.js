/**
 * Journey days: standard batches use 1–200 (start date = Day 1).
 * When trialDayEnabled on a batch: start date = Trial (stored as 0), then Day 1, 2, …
 */

const JOURNEY_DAY_MAX = 200;
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

function computeJourneyDayFromStartDate(
  startDate,
  now = new Date(),
  max = JOURNEY_DAY_MAX,
  trialDayEnabled = false
) {
  if (!startDate) return trialDayEnabled ? TRIAL_JOURNEY_DAY : STANDARD_JOURNEY_MIN;
  const elapsed = daysSinceJourneyStart(startDate, now);
  if (trialDayEnabled) return clampJourneyDayForBatch(elapsed, max, true);
  return clampStandardJourneyDay(elapsed + 1, max);
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

function formatJourneyDayLabel(day, trialDayEnabled = false) {
  const n = Number(day);
  if (trialDayEnabled && n === TRIAL_JOURNEY_DAY) return 'Trial';
  return `Day ${n}`;
}

module.exports = {
  JOURNEY_DAY_MAX,
  STANDARD_JOURNEY_MIN,
  TRIAL_JOURNEY_DAY,
  MS_PER_DAY,
  clampStandardJourneyDay,
  clampJourneyDayForBatch,
  clampJourneyDay,
  utcMidnightMs,
  daysSinceJourneyStart,
  computeJourneyDayFromStartDate,
  isValidJourneyDay,
  isTrialJourneyDay,
  journeyDayRangeStart,
  formatJourneyDayLabel
};
