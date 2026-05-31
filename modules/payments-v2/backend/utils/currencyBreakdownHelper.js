/** Extract per-currency amounts from StudentPaymentProfile.currencyBreakdown */

const CURRENCIES = ['LKR', 'INR', 'USD'];

const amountFromBreakdown = (breakdown, currency, field = 'totalPaid') => {
  if (!Array.isArray(breakdown)) return 0;
  const key = String(currency).toUpperCase();
  let sum = 0;
  for (const row of breakdown) {
    if (String(row?.currency || '').toUpperCase() === key) {
      sum += Number(row[field]) || 0;
    }
  }
  return sum;
};

const paidTotalsFromBreakdown = (breakdown) => ({
  totalPaidLKR: amountFromBreakdown(breakdown, 'LKR'),
  totalPaidINR: amountFromBreakdown(breakdown, 'INR'),
  totalPaidUSD: amountFromBreakdown(breakdown, 'USD'),
});

const pendingTotalsFromBreakdown = (breakdown) => ({
  pendingApprovalAmountLKR: amountFromBreakdown(breakdown, 'LKR', 'pendingApprovalAmount'),
  pendingApprovalAmountINR: amountFromBreakdown(breakdown, 'INR', 'pendingApprovalAmount'),
  pendingApprovalAmountUSD: amountFromBreakdown(breakdown, 'USD', 'pendingApprovalAmount'),
});

const overdueTotalsFromBreakdown = (breakdown) => ({
  overdueAmountLKR: amountFromBreakdown(breakdown, 'LKR', 'overdueAmount'),
  overdueAmountINR: amountFromBreakdown(breakdown, 'INR', 'overdueAmount'),
  overdueAmountUSD: amountFromBreakdown(breakdown, 'USD', 'overdueAmount'),
});

const enrichProfileCurrencyTotals = (profile) => {
  if (!profile) return null;
  const breakdown = profile.currencyBreakdown;
  return {
    ...profile,
    ...paidTotalsFromBreakdown(breakdown),
    ...pendingTotalsFromBreakdown(breakdown),
    ...overdueTotalsFromBreakdown(breakdown),
  };
};

/** Mongo $reduce: sum one field for a currency from currencyBreakdown array */
const mongoReduceByCurrency = (breakdownExpr, currency, field = 'totalPaid') => ({
  $reduce: {
    input: { $ifNull: [breakdownExpr, []] },
    initialValue: 0,
    in: {
      $add: [
        '$$value',
        {
          $cond: [
            { $eq: [{ $toUpper: { $ifNull: ['$$this.currency', ''] } }, currency] },
            { $ifNull: [`$$this.${field}`, 0] },
            0,
          ],
        },
      ],
    },
  },
});

/** $addFields stage fragment: totalPaidLKR / INR / USD from profile.currencyBreakdown */
const mongoPaidFieldsFromProfile = (breakdownPath = '$profile.currencyBreakdown') => ({
  totalPaidLKR: mongoReduceByCurrency(breakdownPath, 'LKR'),
  totalPaidINR: mongoReduceByCurrency(breakdownPath, 'INR'),
  totalPaidUSD: mongoReduceByCurrency(breakdownPath, 'USD'),
});

const mongoPendingFieldsFromProfile = (breakdownPath = '$profile.currencyBreakdown') => ({
  pendingApprovalAmountLKR: mongoReduceByCurrency(breakdownPath, 'LKR', 'pendingApprovalAmount'),
  pendingApprovalAmountINR: mongoReduceByCurrency(breakdownPath, 'INR', 'pendingApprovalAmount'),
  pendingApprovalAmountUSD: mongoReduceByCurrency(breakdownPath, 'USD', 'pendingApprovalAmount'),
});

const mongoOverdueFieldsFromProfile = (breakdownPath = '$profile.currencyBreakdown') => ({
  overdueAmountLKR: mongoReduceByCurrency(breakdownPath, 'LKR', 'overdueAmount'),
  overdueAmountINR: mongoReduceByCurrency(breakdownPath, 'INR', 'overdueAmount'),
  overdueAmountUSD: mongoReduceByCurrency(breakdownPath, 'USD', 'overdueAmount'),
});

const emptyCurrencyBucket = () => ({ LKR: 0, INR: 0, USD: 0 });

const normalizeCurrencyCode = (currency) => {
  const c = String(currency || 'LKR').toUpperCase();
  return c === 'LKR' || c === 'INR' || c === 'USD' ? c : 'USD';
};

const addToCurrencyBucket = (bucket, currency, amount) => {
  const code = normalizeCurrencyCode(currency);
  bucket[code] += Number(amount) || 0;
};

module.exports = {
  CURRENCIES,
  amountFromBreakdown,
  paidTotalsFromBreakdown,
  pendingTotalsFromBreakdown,
  overdueTotalsFromBreakdown,
  enrichProfileCurrencyTotals,
  mongoReduceByCurrency,
  mongoPaidFieldsFromProfile,
  mongoPendingFieldsFromProfile,
  mongoOverdueFieldsFromProfile,
  emptyCurrencyBucket,
  normalizeCurrencyCode,
  addToCurrencyBucket,
};
