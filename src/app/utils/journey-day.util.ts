/** Standard journey: Day 1–200. Optional trial batch: Trial (0) on start date, then Day 1… */
export const JOURNEY_DAY_MAX = 200;
export const STANDARD_JOURNEY_MIN = 1;
export const TRIAL_JOURNEY_DAY = 0;

export function clampStandardJourneyDay(raw: unknown, max = JOURNEY_DAY_MAX): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < STANDARD_JOURNEY_MIN) return STANDARD_JOURNEY_MIN;
  const cap = max != null ? max : JOURNEY_DAY_MAX;
  if (n > cap) return cap;
  return n;
}

export function clampJourneyDayForBatch(
  raw: unknown,
  max = JOURNEY_DAY_MAX,
  trialDayEnabled = false
): number {
  if (!trialDayEnabled) return clampStandardJourneyDay(raw, max);
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < TRIAL_JOURNEY_DAY) return TRIAL_JOURNEY_DAY;
  const cap = max != null ? max : JOURNEY_DAY_MAX;
  if (n > cap) return cap;
  return n;
}

/** @deprecated prefer clampStandardJourneyDay or clampJourneyDayForBatch */
export function clampJourneyDay(raw: unknown, max = JOURNEY_DAY_MAX): number {
  return clampStandardJourneyDay(raw, max);
}

export function isValidJourneyDay(raw: unknown, trialDayEnabled = false): boolean {
  const n = Number(raw);
  const min = trialDayEnabled ? TRIAL_JOURNEY_DAY : STANDARD_JOURNEY_MIN;
  return Number.isFinite(n) && n >= min && n <= JOURNEY_DAY_MAX;
}

export function computeJourneyDayFromStartDate(
  startDate: string | Date | null | undefined,
  now: Date = new Date(),
  max = JOURNEY_DAY_MAX,
  trialDayEnabled = false
): number {
  if (!startDate) return trialDayEnabled ? TRIAL_JOURNEY_DAY : STANDARD_JOURNEY_MIN;
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let startUTC: number;
  if (typeof startDate === 'string') {
    const parts = startDate.split('-').map(Number);
    startUTC = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  } else {
    startUTC = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  }
  const elapsed = Math.max(0, Math.floor((todayUTC - startUTC) / 86_400_000));
  if (trialDayEnabled) return clampJourneyDayForBatch(elapsed, max, true);
  return clampStandardJourneyDay(elapsed + 1, max);
}

export function journeyDaysThrough(currentDay: number, trialDayEnabled = false): number[] {
  const n = clampJourneyDayForBatch(currentDay, JOURNEY_DAY_MAX, trialDayEnabled);
  const start = trialDayEnabled ? TRIAL_JOURNEY_DAY : STANDARD_JOURNEY_MIN;
  return Array.from({ length: n - start + 1 }, (_, i) => start + i);
}

export function formatJourneyDayLabel(day: number, trialDayEnabled = false): string {
  if (trialDayEnabled && day === TRIAL_JOURNEY_DAY) return 'Trial';
  return `Day ${day}`;
}

export function isTrialJourneyDay(day: number): boolean {
  return Number(day) === TRIAL_JOURNEY_DAY;
}
