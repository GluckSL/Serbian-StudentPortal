/** Standard journey: Day 1–220. Optional trial batch: Trial (0) on start date, then Day 1… */
export const JOURNEY_DAY_MAX = 220;
export const STANDARD_JOURNEY_MIN = 1;
export const TRIAL_JOURNEY_DAY = 0;

export const LEVEL_SCHEDULE = [
  { level: 'A1', dayStart: 1, dayEnd: 42 },
  { level: 'A2', dayStart: 43, dayEnd: 84 },
  { level: 'B1', dayStart: 85, dayEnd: 149 },
  { level: 'B2', dayStart: 150, dayEnd: 214 },
] as const;

export type LevelKey = (typeof LEVEL_SCHEDULE)[number]['level'];

export interface LevelCalendarDates {
  A1?: { startDate?: string | Date | null; endDate?: string | Date | null };
  A2?: { startDate?: string | Date | null; endDate?: string | Date | null };
  B1?: { startDate?: string | Date | null; endDate?: string | Date | null };
  B2?: { startDate?: string | Date | null; endDate?: string | Date | null };
}

function toUtcMidnightMs(value: string | Date): number {
  if (typeof value === 'string') {
    const parts = value.split('-').map(Number);
    return Date.UTC(parts[0], parts[1] - 1, parts[2]);
  }
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

export function hasLevelScheduleDates(levelCalendarDates?: LevelCalendarDates | null): boolean {
  return LEVEL_SCHEDULE.some((entry) => !!levelCalendarDates?.[entry.level]?.startDate);
}

export function computeJourneyDayFromLevelSchedule(
  levelCalendarDates: LevelCalendarDates | null | undefined,
  now: Date = new Date(),
  max = JOURNEY_DAY_MAX
): number {
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let activeLevel: (typeof LEVEL_SCHEDULE)[number] & { startUTC: number } | null = null;

  for (const entry of LEVEL_SCHEDULE) {
    const startDate = levelCalendarDates?.[entry.level]?.startDate;
    if (!startDate) continue;
    const startUTC = toUtcMidnightMs(startDate);
    if (todayUTC >= startUTC) {
      activeLevel = { ...entry, startUTC };
    }
  }

  if (!activeLevel) return STANDARD_JOURNEY_MIN;
  const elapsed = Math.max(0, Math.floor((todayUTC - activeLevel.startUTC) / 86_400_000));
  const raw = activeLevel.dayStart + elapsed;
  return clampStandardJourneyDay(Math.min(raw, activeLevel.dayEnd), max);
}

export function activeLevelScheduleEntry(
  levelCalendarDates: LevelCalendarDates | null | undefined,
  now: Date = new Date()
): ((typeof LEVEL_SCHEDULE)[number] & { startDate: string | Date }) | null {
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let active: ((typeof LEVEL_SCHEDULE)[number] & { startDate: string | Date }) | null = null;

  for (const entry of LEVEL_SCHEDULE) {
    const startDate = levelCalendarDates?.[entry.level]?.startDate;
    if (!startDate) continue;
    if (todayUTC >= toUtcMidnightMs(startDate)) {
      active = { ...entry, startDate };
    }
  }

  return active;
}

export function computeJourneyDayFromBatchConfigLike(opts: {
  batchStartDate?: string | Date | null;
  levelCalendarDates?: LevelCalendarDates | null;
  journeyLength?: number;
  trialDayEnabled?: boolean;
  trialAccessStartDate?: string | Date | null;
  now?: Date;
}): number {
  const now = opts.now ?? new Date();
  const max = opts.journeyLength ?? JOURNEY_DAY_MAX;

  if (hasLevelScheduleDates(opts.levelCalendarDates)) {
    return computeJourneyDayFromLevelSchedule(opts.levelCalendarDates, now, max);
  }

  return computeJourneyDayFromStartDate(
    opts.batchStartDate ?? null,
    now,
    max,
    !!opts.trialDayEnabled,
    opts.trialAccessStartDate ?? null
  );
}

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
  trialDayEnabled = false,
  trialAccessStartDate?: string | Date | null
): number {
  if (trialDayEnabled && trialAccessStartDate && startDate) {
    return computeJourneyDayWithTrialWindow(trialAccessStartDate, startDate, now, max);
  }
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

export function computeJourneyDayWithTrialWindow(
  trialAccessStartDate: string | Date,
  dayOneStartDate: string | Date,
  now: Date = new Date(),
  max = JOURNEY_DAY_MAX
): number {
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const toUtc = (d: string | Date) => {
    if (typeof d === 'string') {
      const parts = d.split('-').map(Number);
      return Date.UTC(parts[0], parts[1] - 1, parts[2]);
    }
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const trialStart = toUtc(trialAccessStartDate);
  const dayOneStart = toUtc(dayOneStartDate);
  if (todayUTC < trialStart) return TRIAL_JOURNEY_DAY;
  if (todayUTC < dayOneStart) return TRIAL_JOURNEY_DAY;
  const elapsed = Math.max(0, Math.floor((todayUTC - dayOneStart) / 86_400_000));
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

/** Admin content tagging on exercises/modules: 0 = Trial, 1–200 = journey days. */
export function isValidAdminCourseDay(raw: unknown): boolean {
  const n = Number(raw);
  return Number.isFinite(n) && n >= TRIAL_JOURNEY_DAY && n <= JOURNEY_DAY_MAX;
}

export function clampAdminCourseDayInput(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return TRIAL_JOURNEY_DAY;
  return Math.min(JOURNEY_DAY_MAX, Math.max(TRIAL_JOURNEY_DAY, n));
}

export function parseAdminCourseDayOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Math.floor(Number(raw));
  if (!isValidAdminCourseDay(n)) return null;
  return n;
}
