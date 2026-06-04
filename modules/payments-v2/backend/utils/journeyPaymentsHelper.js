/**
 * Payment summary for Journey / student overview — synced with Payment Hub v2.
 */
const PaymentRequest = require('../models/PaymentRequest');
const PaymentFlowSubmission = require('../models/PaymentSubmission');
const { recalculateStudentProfile } = require('../services/paymentService');
const {
  enrichProfileCurrencyTotals,
  computeLiveTotalsFromData,
  emptyCurrencyBucket,
  normalizeCurrencyCode,
} = require('./currencyBreakdownHelper');

const PAYMENT_TYPE_LABELS = {
  LANGUAGE_FEE: 'Language course fee',
  DOCS_PAYMENT: 'Documentation',
  VISA_PAYMENT: 'Visa',
  CUSTOM_PAYMENT: 'Custom',
};

const SLOT_KEYS = ['A1', 'A2', 'B1', 'B2', 'DOCS', 'VISA'];

const formatPaymentLabel = (req) => {
  const base = PAYMENT_TYPE_LABELS[req.paymentType] || req.paymentType || 'Payment';
  if (req.paymentType === 'CUSTOM_PAYMENT' && req.customType) {
    return `${base} — ${req.customType}`;
  }
  return base;
};

const normalizeLevel = (level) => {
  const val = String(level || '').trim().toUpperCase();
  if (val === 'A1' || val === 'A2' || val === 'B1' || val === 'B2') return val;
  return null;
};

const slotForRequest = (req, studentLevel) => {
  if (req.paymentType === 'DOCS_PAYMENT') return 'DOCS';
  if (req.paymentType === 'VISA_PAYMENT') return 'VISA';
  if (req.paymentType === 'CUSTOM_PAYMENT') return normalizeLevel(req.customType);
  if (req.paymentType !== 'LANGUAGE_FEE') return null;
  return normalizeLevel(req.customType) || normalizeLevel(studentLevel);
};

const slotSummaryFromRequests = (requests, studentLevel) => {
  const summaries = {};
  for (const key of SLOT_KEYS) {
    summaries[key] = {
      requestCount: 0,
      settledCount: 0,
      paid: emptyCurrencyBucket(),
      balance: emptyCurrencyBucket(),
    };
  }
  for (const req of requests) {
    const slot = slotForRequest(req, studentLevel);
    if (!slot || !summaries[slot]) continue;
    const currency = normalizeCurrencyCode(req.currency);
    const requested = Math.max(0, req.amount ?? 0);
    const isSettled = req.status === 'FULLY_PAID' || req.status === 'APPROVED';
    const balance = isSettled ? 0 : Math.max(0, req.amountRemaining ?? 0);
    const paid = Math.max(0, requested - balance);
    const s = summaries[slot];
    s.requestCount += 1;
    s.paid[currency] += paid;
    s.balance[currency] += balance;
    if (balance === 0 || isSettled) s.settledCount += 1;
  }
  return summaries;
};

const primaryCurrencyFromTotals = (totals) => {
  const order = ['LKR', 'INR', 'USD'];
  let best = 'LKR';
  let bestPaid = 0;
  for (const c of order) {
    const paid = totals[`totalPaid${c}`] || 0;
    if (paid > bestPaid) {
      bestPaid = paid;
      best = c;
    }
  }
  return best;
};

const sumRequestedByCurrency = (requests) => {
  const bucket = emptyCurrencyBucket();
  for (const req of requests) {
    const c = normalizeCurrencyCode(req.currency);
    bucket[c] += Math.max(0, req.amount ?? 0);
  }
  return bucket;
};

/**
 * @returns {Promise<object|null>} Journey payments payload, or null if no hub records.
 */
const buildPaymentHubJourneyPayments = async (studentId, studentLevel) => {
  const sid = String(studentId);
  await recalculateStudentProfile(sid);

  const [requests, approvedSubmissions, pendingSubmissions] = await Promise.all([
    PaymentRequest.find({ studentId: sid, isArchived: false }).sort({ createdAt: -1 }).lean(),
    PaymentFlowSubmission.find({ studentId: sid, status: 'APPROVED', isArchived: false }).lean(),
    PaymentFlowSubmission.find({
      studentId: sid,
      status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      isArchived: false,
    }).lean(),
  ]);

  if (!requests.length) return null;

  const live = computeLiveTotalsFromData(requests, approvedSubmissions, pendingSubmissions);
  const requestedByCurrency = sumRequestedByCurrency(requests);
  const currency = primaryCurrencyFromTotals(live);
  const totalAmount = requestedByCurrency[currency] || requests.reduce((s, r) => s + (r.amount || 0), 0);
  const paidAmount = live[`totalPaid${currency}`] ?? live.totalPaid ?? 0;
  const pendingAmount =
    (live[`overdueAmount${currency}`] || 0) +
    (live[`pendingApprovalAmount${currency}`] || 0) +
    requests
      .filter((r) => normalizeCurrencyCode(r.currency) === currency && !['APPROVED', 'FULLY_PAID', 'REJECTED'].includes(r.status))
      .reduce((s, r) => s + Math.max(0, r.amountRemaining ?? 0), 0);

  const paymentHistory = requests
    .map((req) => {
      const requested = Math.max(0, req.amount ?? 0);
      const isSettled = req.status === 'FULLY_PAID' || req.status === 'APPROVED';
      const balance = isSettled ? 0 : Math.max(0, req.amountRemaining ?? 0);
      const paid = Math.max(0, requested - balance);
      return {
        id: String(req._id),
        amount: paid,
        requestedAmount: requested,
        balance,
        currency: normalizeCurrencyCode(req.currency),
        date: req.updatedAt || req.createdAt,
        method: req.status,
        note: formatPaymentLabel(req),
        status: req.status,
        slot: slotForRequest(req, studentLevel),
      };
    })
    .filter((row) => row.amount > 0 || ['APPROVED', 'FULLY_PAID', 'SUBMITTED', 'UNDER_REVIEW', 'OVERDUE', 'REQUESTED'].includes(row.status));

  const hubRequests = requests.map((req) => ({
    id: String(req._id),
    paymentType: req.paymentType,
    customType: req.customType || '',
    label: formatPaymentLabel(req),
    amount: req.amount ?? 0,
    paidAmount: Math.max(0, (req.amount ?? 0) - Math.max(0, req.amountRemaining ?? 0)),
    balance: Math.max(0, req.amountRemaining ?? 0),
    currency: normalizeCurrencyCode(req.currency),
    status: req.status,
    dueDate: req.dueDate,
    createdAt: req.createdAt,
    remarks: req.remarks || '',
    slot: slotForRequest(req, studentLevel),
  }));

  return {
    source: 'payment_hub',
    currency,
    totalPackageAmount: totalAmount,
    totalAmount,
    paidAmount,
    pendingAmount: Math.max(0, pendingAmount),
    totalPaidLKR: live.totalPaidLKR ?? 0,
    totalPaidINR: live.totalPaidINR ?? 0,
    totalPaidUSD: live.totalPaidUSD ?? 0,
    pendingApprovalAmountLKR: live.pendingApprovalAmountLKR ?? 0,
    pendingApprovalAmountINR: live.pendingApprovalAmountINR ?? 0,
    pendingApprovalAmountUSD: live.pendingApprovalAmountUSD ?? 0,
    overdueAmountLKR: live.overdueAmountLKR ?? 0,
    overdueAmountINR: live.overdueAmountINR ?? 0,
    overdueAmountUSD: live.overdueAmountUSD ?? 0,
    overallStatus: live.overallStatus || 'CLEAR',
    requestCount: requests.length,
    payments: paymentHistory,
    hubRequests,
    slotBreakdown: slotSummaryFromRequests(requests, studentLevel),
    invoices: [],
  };
};

/**
 * Prefer Payment Hub when the student has hub records; otherwise legacy ledger / invoices.
 */
const resolveJourneyPayments = async (studentId, studentEmail, studentLevel, legacyResolver) => {
  try {
    const hub = await buildPaymentHubJourneyPayments(studentId, studentLevel);
    if (hub) return hub;
  } catch (e) {
    console.warn('[journeyPayments] hub sync failed:', e.message);
  }
  return legacyResolver(studentId, studentEmail);
};

module.exports = {
  buildPaymentHubJourneyPayments,
  resolveJourneyPayments,
  enrichProfileCurrencyTotals,
};
