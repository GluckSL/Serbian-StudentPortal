export const DOCS_FULL_PAID_LKR_AMOUNTS = [300000, 354000];
export const DOCS_FULL_PAID_INR_AMOUNTS = [106200];

export function isDocsFullPaidByReceived(row: {
  docsPaidLKR?: number;
  docsPaidINR?: number;
  docsPaidUSD?: number;
}): boolean {
  const lkr = row.docsPaidLKR ?? 0;
  const inr = row.docsPaidINR ?? 0;
  const usd = row.docsPaidUSD ?? 0;
  if (usd > 0) return false;
  if (DOCS_FULL_PAID_LKR_AMOUNTS.includes(lkr) && inr === 0) return true;
  if (DOCS_FULL_PAID_INR_AMOUNTS.includes(inr) && lkr === 0) return true;
  return false;
}

export function docsFullQuotationForRow(row: {
  docsExpectedLKR?: number;
  docsExpectedINR?: number;
  docsPaidLKR?: number;
  docsPaidINR?: number;
}): { lkr: number; inr: number; usd: number } {
  const expectedLKR = row.docsExpectedLKR ?? 0;
  const expectedINR = row.docsExpectedINR ?? 0;
  const paidLKR = row.docsPaidLKR ?? 0;
  const paidINR = row.docsPaidINR ?? 0;

  if (DOCS_FULL_PAID_LKR_AMOUNTS.includes(expectedLKR)) {
    return { lkr: expectedLKR, inr: 0, usd: 0 };
  }
  if (DOCS_FULL_PAID_INR_AMOUNTS.includes(expectedINR)) {
    return { lkr: 0, inr: expectedINR, usd: 0 };
  }
  if (paidINR > 0 || expectedINR > 0) {
    return { lkr: 0, inr: 106200, usd: 0 };
  }
  if (paidLKR >= 354000 || expectedLKR >= 354000) {
    return { lkr: 354000, inr: 0, usd: 0 };
  }
  return { lkr: 300000, inr: 0, usd: 0 };
}
