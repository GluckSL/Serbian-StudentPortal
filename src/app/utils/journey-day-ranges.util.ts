/** Journey day ranges per CEFR level (aligned with backend). */
export const JOURNEY_LEVEL_DAY_RANGES: { level: string; dayStart: number; dayEnd: number }[] = [
  { level: 'A1', dayStart: 1, dayEnd: 42 },
  { level: 'A2', dayStart: 43, dayEnd: 84 },
  { level: 'B1', dayStart: 85, dayEnd: 149 },
  { level: 'B2', dayStart: 150, dayEnd: 214 },
];

export function levelForJourneyDay(day: number): string {
  const d = Math.min(220, Math.max(1, Math.floor(Number(day) || 1)));
  for (const r of JOURNEY_LEVEL_DAY_RANGES) {
    if (d >= r.dayStart && d <= r.dayEnd) return r.level;
  }
  return 'B2';
}
