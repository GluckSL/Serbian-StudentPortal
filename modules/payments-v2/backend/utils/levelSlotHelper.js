/**
 * Map payment requests to CEFR level slots (A1–B2) — same rules as Payment Hub student detail.
 */
const {
  computeLiveTotalsFromData,
  computeBalanceDueFromRequests,
  openBalanceForRequest,
} = require('./currencyBreakdownHelper');

const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2'];
const PAYMENT_BADGE_SLOTS = ['A1', 'A2', 'B1', 'B2', 'DOCS', 'VISA'];

const normalizeLevel = (level) => {
  const val = String(level || '').trim().toUpperCase();
  if (LANGUAGE_LEVELS.includes(val)) return val;
  return null;
};

const slotForRequest = (req, studentLevel) => {
  if (!req || req.isArchived) return null;
  if (req.paymentType === 'DOCS_PAYMENT') return 'DOCS';
  if (req.paymentType === 'VISA_PAYMENT') return 'VISA';
  if (req.paymentType === 'CUSTOM_PAYMENT') return normalizeLevel(req.customType);
  if (req.paymentType !== 'LANGUAGE_FEE') return null;
  return normalizeLevel(req.customType) || normalizeLevel(studentLevel);
};

const filterRequestsForSlot = (requests, slot, studentLevel) => {
  if (!slot) {
    return (requests || []).filter((r) => !r.isArchived && r.status !== 'REJECTED');
  }
  return (requests || []).filter((req) => {
    if (req.isArchived || req.status === 'REJECTED') return false;
    return slotForRequest(req, studentLevel) === slot;
  });
};

const filterSubmissionsForRequestIds = (submissions, requestIds) => {
  const idSet = new Set((requestIds || []).map((id) => String(id)));
  return (submissions || []).filter((s) => idSet.has(String(s.paymentRequestId)));
};

/**
 * Paid / pending / overdue for the student's current CEFR level only (not prior levels).
 */
const computeTotalsForStudentLevel = (requests, approvedSubs, pendingSubs, studentLevel) => {
  const level = normalizeLevel(studentLevel);
  const levelRequests = filterRequestsForSlot(requests, level, studentLevel);
  const requestIds = levelRequests.map((r) => r._id);
  const approved = filterSubmissionsForRequestIds(approvedSubs, requestIds);
  const pending = filterSubmissionsForRequestIds(pendingSubs, requestIds);

  return {
    level,
    levelRequests,
    live: computeLiveTotalsFromData(levelRequests, approved, pending),
    balanceDue: computeBalanceDueFromRequests(levelRequests, approved),
  };
};

/**
 * Paid totals across all payment slots (A1–B2, Docs, Visa, etc.).
 */
const computeTotalsForAllPayments = (requests, approvedSubs, pendingSubs, studentLevel) => {
  const allRequests = filterRequestsForSlot(requests, null, studentLevel);
  const requestIds = allRequests.map((r) => r._id);
  const approved = filterSubmissionsForRequestIds(approvedSubs, requestIds);
  const pending = filterSubmissionsForRequestIds(pendingSubs, requestIds);

  return {
    allRequests,
    live: computeLiveTotalsFromData(allRequests, approved, pending),
    balanceDue: computeBalanceDueFromRequests(allRequests, approved),
  };
};

const paidAmountOnSlot = (slotRequests, approved) => {
  let paid = 0;
  for (const req of slotRequests) {
    const balance = openBalanceForRequest(req, approved);
    const requested = Math.max(0, Number(req.amount) || 0);
    paid += Math.max(0, requested - balance);
  }
  if (paid <= 0) {
    paid = (approved || []).reduce((sum, sub) => sum + (Number(sub.paidAmount) || 0), 0);
  }
  return paid;
};

/** Slot is fully paid when mapped requests are settled (zero balance) with payment on file. */
const isSlotSettledPaid = (requests, approvedSubs, slot, studentLevel) => {
  const slotRequests = filterRequestsForSlot(requests, slot, studentLevel);
  if (!slotRequests.length) return false;
  const requestIds = slotRequests.map((r) => r._id);
  const approved = filterSubmissionsForRequestIds(approvedSubs, requestIds);
  const balanceDue = computeBalanceDueFromRequests(slotRequests, approved);
  if (balanceDue.total > 0) return false;
  return (
    paidAmountOnSlot(slotRequests, approved) > 0
    || slotRequests.some((r) => ['APPROVED', 'FULLY_PAID'].includes(r.status))
  );
};

/**
 * Badges for Payment Hub "Total received" column.
 * Returns ['ALL'] when every slot (A1–B2, Docs, Visa) is settled; otherwise paid slot keys.
 */
const computePaidSlotBadges = (requests, approvedSubs, studentLevel) => {
  const paid = PAYMENT_BADGE_SLOTS.filter((slot) =>
    isSlotSettledPaid(requests, approvedSubs, slot, studentLevel),
  );
  if (paid.length === PAYMENT_BADGE_SLOTS.length) return ['ALL'];
  return paid;
};

module.exports = {
  LANGUAGE_LEVELS,
  PAYMENT_BADGE_SLOTS,
  normalizeLevel,
  slotForRequest,
  filterRequestsForSlot,
  filterSubmissionsForRequestIds,
  computeTotalsForStudentLevel,
  computeTotalsForAllPayments,
  computePaidSlotBadges,
};
