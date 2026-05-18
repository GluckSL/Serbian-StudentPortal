/**
 * Maps each CEFR level to an approximate total journey length in days.
 * (Replaces spreadsheet “total hours” with calendar-based journey days.)
 */
export const TOTAL_JOURNEY_DAYS_BY_LEVEL: Record<string, number> = {
  A1: 90,
  A2: 85,
  B1: 80,
  B2: 75,
  C1: 70,
  C2: 65,
};

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

export function journeyDayRemaining(currentDay: number | null, totalDays: number): number | null {
  if (currentDay == null || totalDays <= 0) return null;
  return Math.max(0, totalDays - currentDay);
}

export function journeyProgressRatio(currentDay: number | null, totalDays: number): number | null {
  if (currentDay == null || totalDays <= 0) return null;
  return Math.min(1, Math.max(0, currentDay / totalDays));
}
