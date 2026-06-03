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

/**
 * Live totals from active requests + submissions (same rules as recalculateStudentProfile).
 * Used by the Payment Hub student table so totals match the student detail page.
 */
const computeLiveTotalsFromData = (requests, approvedSubmissions, pendingSubmissions) => {
  const activeRequestIds = new Set((requests || []).map((r) => String(r._id)));
  const approvedForActiveRequests = (approvedSubmissions || []).filter((s) =>
    activeRequestIds.has(String(s.paymentRequestId)),
  );
  const pendingForActiveRequests = (pendingSubmissions || []).filter((s) =>
    activeRequestIds.has(String(s.paymentRequestId)),
  );

  const currencyMap = {};
  for (const s of approvedForActiveRequests) {
    if (!currencyMap[s.currency]) {
      currencyMap[s.currency] = {
        currency: s.currency,
        totalPaid: 0,
        pendingApprovalAmount: 0,
        overdueAmount: 0,
        expectedAmount: 0,
      };
    }
    currencyMap[s.currency].totalPaid += Number(s.paidAmount) || 0;
  }
  for (const s of pendingForActiveRequests) {
    if (!currencyMap[s.currency]) {
      currencyMap[s.currency] = {
        currency: s.currency,
        totalPaid: 0,
        pendingApprovalAmount: 0,
        overdueAmount: 0,
        expectedAmount: 0,
      };
    }
    currencyMap[s.currency].pendingApprovalAmount += Number(s.paidAmount) || 0;
  }
  for (const r of requests || []) {
    if (!currencyMap[r.currency]) {
      currencyMap[r.currency] = {
        currency: r.currency,
        totalPaid: 0,
        pendingApprovalAmount: 0,
        overdueAmount: 0,
        expectedAmount: 0,
      };
    }
    if (r.status === 'OVERDUE') {
      currencyMap[r.currency].overdueAmount += Number(r.amountRemaining) || Number(r.amount) || 0;
    }
    if (['REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'PARTIALLY_PAID'].includes(r.status)) {
      currencyMap[r.currency].expectedAmount += Number(r.amountRemaining) || Number(r.amount) || 0;
    }
  }

  const breakdown = Object.values(currencyMap);
  const totalPaid = approvedForActiveRequests.reduce((s, sub) => s + (Number(sub.paidAmount) || 0), 0);
  const pendingApprovalAmount = pendingForActiveRequests.reduce(
    (s, sub) => s + (Number(sub.paidAmount) || 0),
    0,
  );
  const overdueAmount = (requests || [])
    .filter((r) => r.status === 'OVERDUE')
    .reduce((s, r) => s + (Number(r.amountRemaining) || Number(r.amount) || 0), 0);

  const overdueCount = (requests || []).filter((r) => r.status === 'OVERDUE').length;
  const activeRequestCount = (requests || []).filter((r) =>
    ['REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'REUPLOAD_REQUIRED'].includes(r.status),
  ).length;
  const completedRequestCount = (requests || []).filter((r) =>
    ['APPROVED', 'FULLY_PAID'].includes(r.status),
  ).length;
  const pendingApprovalCount = pendingForActiveRequests.length;

  let overallStatus = 'CLEAR';
  if (overdueCount > 0) overallStatus = 'OVERDUE';
  else if (pendingApprovalCount > 0) overallStatus = 'PENDING_REVIEW';
  else if (activeRequestCount > 0) overallStatus = 'REQUESTED';
  else if (completedRequestCount > 0 && activeRequestCount === 0 && overdueCount === 0) {
    overallStatus = 'CLEAR';
  }

  return {
    totalPaid,
    pendingApprovalAmount,
    overdueAmount,
    overallStatus,
    currencyBreakdown: breakdown,
    ...paidTotalsFromBreakdown(breakdown),
    ...pendingTotalsFromBreakdown(breakdown),
    ...overdueTotalsFromBreakdown(breakdown),
  };
};

/** Group an array of docs by studentId (string keys). */
const groupDocsByStudentId = (docs) => {
  const map = {};
  for (const doc of docs || []) {
    const sid = String(doc.studentId);
    if (!map[sid]) map[sid] = [];
    map[sid].push(doc);
  }
  return map;
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
  computeLiveTotalsFromData,
  groupDocsByStudentId,
  mongoReduceByCurrency,
  mongoPaidFieldsFromProfile,
  mongoPendingFieldsFromProfile,
  mongoOverdueFieldsFromProfile,
  emptyCurrencyBucket,
  normalizeCurrencyCode,
  addToCurrencyBucket,
};
