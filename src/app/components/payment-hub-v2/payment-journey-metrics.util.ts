/**
 * End-of-segment day for each CEFR level on the 200-day journey (aligned with journey level sync).
 * A1: days 1–42, A2: 43–84, B1: 85–145, B2: 146–200.
 */
export const TOTAL_JOURNEY_DAYS_BY_LEVEL: Record<string, number> = {
  A1: 42,
  A2: 84,
  B1: 145,
  B2: 200,
  C1: 200,
  C2: 200,
};

const JOURNEY_LEVEL_RANGES: { min: number; max: number; level: string }[] = [
  { min: 1, max: 42, level: 'A1' },
  { min: 43, max: 84, level: 'A2' },
  { min: 85, max: 145, level: 'B1' },
  { min: 146, max: 200, level: 'B2' },
];

export function levelForJourneyDay(day: number | null | undefined): string {
  const d = Math.min(200, Math.max(1, Math.floor(Number(day) || 1)));
  for (const r of JOURNEY_LEVEL_RANGES) {
    if (d >= r.min && d <= r.max) return r.level;
  }
  return 'B2';
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function totalJourneyDaysForLevel(level: string | undefined | null): number {
  const key = (level || 'A1').toUpperCase().trim();
  return TOTAL_JOURNEY_DAYS_BY_LEVEL[key] ?? TOTAL_JOURNEY_DAYS_BY_LEVEL['A1'];
}

export function enrollmentStartDate(student: {
  dateJoined?: string;
  enrollmentDate?: string;
  createdAt?: string;
} | null | undefined): Date | null {
  const raw = student?.dateJoined || student?.enrollmentDate || student?.createdAt;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 1-based day index since enrollment start (aligned with “Date elaps” style tracking). */
export function currentJourneyDayFromEnrollment(student: {
  dateJoined?: string;
  enrollmentDate?: string;
  createdAt?: string;
} | null | undefined, now: Date = new Date()): number | null {
  const start = enrollmentStartDate(student);
  if (!start) return null;
  const elapsed = Math.floor((now.getTime() - start.getTime()) / DAY_MS);
  return Math.max(1, elapsed + 1);
}

/** Portal journey day (currentCourseDay), else enrollment-based estimate. */
export function currentJourneyDayFromStudent(student: {
  currentCourseDay?: number | null;
  dateJoined?: string;
  enrollmentDate?: string;
  createdAt?: string;
} | null | undefined): number | null {
  const raw = student?.currentCourseDay;
  if (raw != null && Number.isFinite(Number(raw))) {
    return Math.min(200, Math.max(1, Math.floor(Number(raw))));
  }
  return currentJourneyDayFromEnrollment(student);
}

export function journeyDayRemaining(currentDay: number | null, totalDays: number): number | null {
  if (currentDay == null || totalDays <= 0) return null;
  return Math.max(0, totalDays - currentDay);
}

export function journeyProgressRatio(currentDay: number | null, totalDays: number): number | null {
  if (currentDay == null || totalDays <= 0) return null;
  return Math.min(1, Math.max(0, currentDay / totalDays));
}
