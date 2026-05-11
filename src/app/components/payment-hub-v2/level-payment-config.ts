/**
 * Default course fee per CEFR level.
 * These are only used as fallback prefill values when the pricing catalog
 * has not been configured for that level. Admin can always override
 * the value in the dialog before saving.
 */
export const LEVEL_PAYMENT_CONFIG: Record<string, number> = {
  A1: 75000,
  A2: 75000,
  B1: 85000,
  B2: 85000,
  C1: 95000,
  C2: 95000,
};

/** INR course fee per level when catalog is unavailable (A1 matches 23,600 INR spec; others scale from LKR). */
export function suggestInrForLevel(levelKey: string): number {
  const key = (levelKey || 'A1').toUpperCase().trim();
  const lkr = LEVEL_PAYMENT_CONFIG[key] ?? LEVEL_PAYMENT_CONFIG['A1'];
  return Math.round((lkr * 23600) / 75000);
}

/** Label shown next to colored payment-type badges. */
export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  LANGUAGE_FEE:    'Language Course',
  DOCS_PAYMENT:    'Documentation',
  VISA_PAYMENT:    'Visa',
  CUSTOM_PAYMENT:  'Custom',
};
