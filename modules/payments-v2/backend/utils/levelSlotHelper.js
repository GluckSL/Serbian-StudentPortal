/**
 * Map payment requests to CEFR level slots (A1–B2) — same rules as Payment Hub student detail.
 */
const {
  computeLiveTotalsFromData,
  computeBalanceDueFromRequests,
} = require('./currencyBreakdownHelper');

const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2'];

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

module.exports = {
  LANGUAGE_LEVELS,
  normalizeLevel,
  slotForRequest,
  filterRequestsForSlot,
  filterSubmissionsForRequestIds,
  computeTotalsForStudentLevel,
};
