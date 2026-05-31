/** Shared currency display config for Payment Hub (USD stored as Euro in UI). */

export type PaymentCurrencyCode = 'LKR' | 'INR' | 'USD';

export interface CurrencyBucket {
  LKR?: number;
  INR?: number;
  USD?: number;
}

export interface CurrencyPaidTotals {
  totalPaidLKR: number;
  totalPaidINR: number;
  totalPaidUSD: number;
}

export interface CurrencyPendingTotals {
  pendingApprovalAmountLKR: number;
  pendingApprovalAmountINR: number;
  pendingApprovalAmountUSD: number;
}

export interface CurrencyOverdueTotals {
  overdueAmountLKR: number;
  overdueAmountINR: number;
  overdueAmountUSD: number;
}

export interface CurrencyDisplayMeta {
  code: PaymentCurrencyCode;
  label: string;
  symbol: string;
  badgeClass: string;
}

export const PAYMENT_CURRENCIES: CurrencyDisplayMeta[] = [
  { code: 'LKR', label: 'LKR', symbol: 'Rs', badgeClass: 'ph-ccy-badge--lkr' },
  { code: 'INR', label: 'INR', symbol: '₹', badgeClass: 'ph-ccy-badge--inr' },
  { code: 'USD', label: 'Euro', symbol: '€', badgeClass: 'ph-ccy-badge--eur' },
];

export function normalizePaymentCurrency(code: string | null | undefined): PaymentCurrencyCode {
  const c = String(code || 'LKR').toUpperCase();
  if (c === 'LKR' || c === 'INR' || c === 'USD') return c;
  return 'USD';
}

export function paidTotalsFromBucket(bucket: CurrencyBucket | null | undefined): CurrencyPaidTotals {
  return {
    totalPaidLKR: bucket?.LKR ?? 0,
    totalPaidINR: bucket?.INR ?? 0,
    totalPaidUSD: bucket?.USD ?? 0,
  };
}

export function amountForCurrency(code: PaymentCurrencyCode, totals: CurrencyPaidTotals): number {
  if (code === 'LKR') return totals.totalPaidLKR ?? 0;
  if (code === 'INR') return totals.totalPaidINR ?? 0;
  return totals.totalPaidUSD ?? 0;
}

export function fmtPaymentAmount(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString('en-IN');
}
