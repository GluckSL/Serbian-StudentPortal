/** Journey day under 10 → Balance; day 10+ → Due (language fee still owed). */
export const JOURNEY_DUE_FROM_DAY = 10;

export type LanguageFeeStatus = 'FULL_PAID' | 'BALANCE' | 'DUE';

export function normalizeJourneyDay(day: number | null | undefined): number {
  if (day == null || !Number.isFinite(Number(day))) return 1;
  return Math.min(200, Math.max(1, Math.floor(Number(day))));
}

export function computeLanguageFeeStatus(
  languageFeeBalance: number,
  journeyDay: number | null | undefined,
): LanguageFeeStatus {
  const bal = Number(languageFeeBalance) || 0;
  if (bal <= 0) return 'FULL_PAID';
  const day = normalizeJourneyDay(journeyDay);
  return day < JOURNEY_DUE_FROM_DAY ? 'BALANCE' : 'DUE';
}

export const LANGUAGE_FEE_STATUS_OPTIONS: { value: '' | LanguageFeeStatus; label: string }[] = [
  { value: '', label: 'All language fee statuses' },
  { value: 'FULL_PAID', label: 'Full paid' },
  { value: 'BALANCE', label: 'Balance (journey day under 10)' },
  { value: 'DUE', label: 'Due (journey day 10+)' },
];

export const LANGUAGE_FEE_STATUS_LABELS: Record<LanguageFeeStatus, string> = {
  FULL_PAID: 'Full paid',
  BALANCE: 'Balance',
  DUE: 'Due',
};

export function languageFeeStatusClass(status: string): string {
  const map: Record<string, string> = {
    FULL_PAID: 'pill-green',
    BALANCE: 'pill-amber',
    DUE: 'pill-red',
  };
  return map[status] || 'pill-grey';
}
