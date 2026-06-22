/** CEFR level slots — keep in sync with modules/payments-v2/backend/utils/levelSlotHelper.js */

export type LanguageLevelSlot = 'A1' | 'A2' | 'B1' | 'B2';
export type PaymentSlotKey = LanguageLevelSlot | 'DOCS' | 'VISA';

const LANGUAGE_LEVELS: LanguageLevelSlot[] = ['A1', 'A2', 'B1', 'B2'];

export function normalizeLevel(level: string | undefined | null): LanguageLevelSlot | null {
  const val = String(level || '').trim().toUpperCase();
  if (LANGUAGE_LEVELS.includes(val as LanguageLevelSlot)) return val as LanguageLevelSlot;
  return null;
}

/** Detect A1–B2 from customType / remarks (word-boundary match — avoids false hits in emails). */
export function detectLevelFromRequest(req: {
  customType?: string | null;
  remarks?: string | null;
  paymentType?: string | null;
}): LanguageLevelSlot | null {
  const hay = [req?.customType, req?.remarks, req?.paymentType]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  for (const lv of LANGUAGE_LEVELS) {
    if (new RegExp(`\\b${lv}\\b`).test(hay)) return lv;
  }
  return null;
}

/** Map a payment request to a hub slot — same rules as Payment Hub backend. */
export function slotForPaymentRequest(
  req: {
    paymentType?: string | null;
    customType?: string | null;
    remarks?: string | null;
    isArchived?: boolean;
  },
  studentLevel: string | undefined | null,
): PaymentSlotKey | null {
  if (!req || req.isArchived) return null;
  const pt = String(req.paymentType || '').trim().toUpperCase();
  if (pt === 'DOCS_PAYMENT') return 'DOCS';
  if (pt === 'VISA_PAYMENT') return 'VISA';
  if (pt === 'CUSTOM_PAYMENT' || pt === 'CUSTOM') {
    return normalizeLevel(req.customType) || detectLevelFromRequest(req);
  }
  if (pt === 'LANGUAGE_FEE') {
    return (
      normalizeLevel(req.customType)
      || normalizeLevel(studentLevel)
      || detectLevelFromRequest(req)
    );
  }
  return detectLevelFromRequest(req);
}
