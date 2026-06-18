/** Course plans — full portal access */
export const COURSE_PLANS = new Set(['SILVER', 'PLATINUM']);

/** Service plans — no classes / DG bot / arena */
export const SERVICE_PLANS = new Set([
  'DOCS_RECOGNITION',
  'VISA_DOC',
  'POST_LANDING',
  'VISA_DOC_ONLY',
]);

export interface CatalogReferenceRow {
  label: string;
  lkr: number;
  inr: number;
}

export function normalizeSubscription(raw: string | null | undefined): string {
  const normalized = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) return '';
  if (normalized.includes('PLATINUM') || normalized === 'PLAT') return 'PLATINUM';
  if (normalized.includes('SILVER') || normalized === 'SIL') return 'SILVER';
  if (normalized === 'VISA_DOCS') return 'VISA_DOC';
  return normalized;
}

export function isCoursePlan(subscription: string | null | undefined): boolean {
  return COURSE_PLANS.has(normalizeSubscription(subscription));
}

export function isServicePlan(subscription: string | null | undefined): boolean {
  return SERVICE_PLANS.has(normalizeSubscription(subscription));
}

const SERVICE_CATALOG_KEY: Record<string, string> = {
  DOCS_RECOGNITION: 'doc',
  VISA_DOC: 'visa',
  VISA_DOC_ONLY: 'visa',
  POST_LANDING: 'relocation',
};

const SERVICE_FALLBACK: Record<string, { lkr: number; inr: number }> = {
  DOCS_RECOGNITION: { lkr: 354000, inr: 106200 },
  VISA_DOC: { lkr: 472000, inr: 141600 },
  VISA_DOC_ONLY: { lkr: 472000, inr: 141600 },
  POST_LANDING: { lkr: 1180000, inr: 354000 },
};

function findReferenceRow(rows: CatalogReferenceRow[], keyword: string): CatalogReferenceRow | null {
  const key = keyword.toLowerCase();
  return (
    rows.find((r) => {
      const label = String(r.label || '').toLowerCase();
      if (key === 'doc') return label.includes('doc');
      if (key === 'visa') return label.includes('visa');
      if (key === 'relocation') return label.includes('reloc');
      return label.includes(key);
    }) || null
  );
}

export function getServicePlanAmount(
  subscription: string,
  currency: 'INR' | 'LKR',
  referenceRows: CatalogReferenceRow[],
): number {
  const sub = normalizeSubscription(subscription);
  const catalogKey = SERVICE_CATALOG_KEY[sub];
  if (!catalogKey) return 0;
  const row = findReferenceRow(referenceRows, catalogKey);
  if (row) {
    const amount = currency === 'LKR' ? row.lkr : row.inr;
    if (amount > 0) return amount;
  }
  const fb = SERVICE_FALLBACK[sub];
  if (!fb) return 0;
  return currency === 'LKR' ? fb.lkr : fb.inr;
}

export function formatPlanLabel(subscription: string | null | undefined): string {
  const v = normalizeSubscription(subscription);
  const map: Record<string, string> = {
    SILVER: 'Silver',
    PLATINUM: 'Platinum',
    DOCS_RECOGNITION: 'Docs recognition',
    VISA_DOC: 'Visa doc',
    VISA_DOC_ONLY: 'Visa doc',
    POST_LANDING: 'Post landing',
  };
  return map[v] || subscription || '—';
}
