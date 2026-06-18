/**
 * Dashboard KPI totals using the same rules as Payment Hub student table rows.
 */
const mongoose = require('mongoose');
const PaymentRequest = require('../models/PaymentRequest');
const PaymentFlowSubmission = require('../models/PaymentSubmission');
const PaymentHubCatalog = require('../models/PaymentHubCatalog');
const {
  groupDocsByStudentId,
  emptyCurrencyBucket,
  addToCurrencyBucket,
} = require('../utils/currencyBreakdownHelper');
const {
  LANGUAGE_LEVELS,
  computeTotalsForLevelSlot,
  computeTotalsForStudentLevel,
  computeTotalsForAllPayments,
  slotForRequest,
} = require('../utils/levelSlotHelper');
const { computeLanguageFeeStatus, JOURNEY_DUE_FROM_DAY } = require('./languageFeeStatus');
const { inferCurrencyFromPhone } = require('../utils/currencyHelper');
const { EXCLUDE_TEST } = require('../../../../utils/analyticsFilters');

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function buildLevelPriceMap(catalog, subscription) {
  const levelPriceMap = new Map();

  // Check for a plan-specific flat rate override
  if (subscription) {
    const key = String(subscription).trim().toUpperCase();
    const planRate = (catalog?.subscriptionRates || []).find(
      (r) => String(r?.subscription || '').trim().toUpperCase() === key,
    );
    if (planRate) {
      const lkr = Number(planRate.lkr) || 0;
      const inr = Number(planRate.inr) || 0;
      for (const code of CEFR_ORDER) {
        levelPriceMap.set(code, { LKR: lkr, INR: inr, USD: 0 });
      }
      return levelPriceMap;
    }
  }

  for (const r of catalog?.cefrRows || []) {
    const code = String(r?.code || '').trim().toUpperCase();
    if (!CEFR_ORDER.includes(code)) continue;
    levelPriceMap.set(code, {
      LKR: Number(r?.lkr) || 0,
      INR: Number(r?.inr) || 0,
      USD: 0,
    });
  }
  return levelPriceMap;
}

/**
 * Build a lookup function that returns the correct levelPriceMap for a student
 * based on their subscription, falling back to the default catalog pricing.
 */
function buildSubscriptionPriceMapLookup(catalog) {
  const defaultMap = buildLevelPriceMap(catalog);
  const cache = new Map();
  return function getLevelPriceMapForStudent(subscription) {
    if (!subscription) return defaultMap;
    const key = String(subscription).trim().toUpperCase();
    if (cache.has(key)) return cache.get(key);
    const planRate = (catalog?.subscriptionRates || []).find(
      (r) => String(r?.subscription || '').trim().toUpperCase() === key,
    );
    if (planRate) {
      const lkr = Number(planRate.lkr) || 0;
      const inr = Number(planRate.inr) || 0;
      const m = new Map();
      for (const code of CEFR_ORDER) m.set(code, { LKR: lkr, INR: inr, USD: 0 });
      cache.set(key, m);
      return m;
    }
    cache.set(key, defaultMap);
    return defaultMap;
  };
}

function studentInferredCurrency(student) {
  return inferCurrencyFromPhone(student?.phoneNumber);
}

/** Fee currency for catalog totals: INR for +91 phones, otherwise LKR (incl. missing/94). */
function feeCurrencyForStudent(student) {
  return inferCurrencyFromPhone(student?.phoneNumber) === 'INR' ? 'INR' : 'LKR';
}

/** Infer fee currency for a level slot (+91 phone, or INR already received on this slot). */
function feeCurrencyForLevelSlot(student, studentRequests, approvedSubs, slot, studentLevel) {
  if (inferCurrencyFromPhone(student?.phoneNumber) === 'INR') return 'INR';
  const slotReceived = receivedBucketsByLevelSlot(studentRequests, approvedSubs, studentLevel)[slot];
  if ((slotReceived?.INR || 0) > 0) return 'INR';
  return 'LKR';
}

/** Catalog fee for a level slot when the student is currently on that level. */
function catalogFeeForLevelSlot(student, levelPriceMap, slot, studentRequests, approvedSubs) {
  const studentLevel = String(student?.level || '').trim().toUpperCase();
  if (studentLevel !== slot) return { LKR: 0, INR: 0, USD: 0 };
  const lp = levelPriceMap.get(slot) || { LKR: 0, INR: 0, USD: 0 };
  const ccy = feeCurrencyForLevelSlot(student, studentRequests, approvedSubs, slot, studentLevel);
  return {
    LKR: ccy === 'LKR' ? (lp.LKR || 0) : 0,
    INR: ccy === 'INR' ? (lp.INR || 0) : 0,
    USD: 0,
  };
}

/** Catalog fee for one student — only in their inferred currency (INR / LKR / USD from phone). */
function catalogGapsForStudent(student, levelPriceMap, live) {
  const levelKey = String(student?.level || 'A1').trim().toUpperCase();
  const levelPrice = levelPriceMap.get(levelKey) || { LKR: 0, INR: 0, USD: 0 };
  const ccy = studentInferredCurrency(student);
  return {
    LKR: ccy === 'LKR' ? Math.max(0, (levelPrice.LKR || 0) - (Number(live?.totalPaidLKR) || 0)) : 0,
    INR: ccy === 'INR' ? Math.max(0, (levelPrice.INR || 0) - (Number(live?.totalPaidINR) || 0)) : 0,
    USD: ccy === 'USD' ? Math.max(0, (levelPrice.USD || 0) - (Number(live?.totalPaidUSD) || 0)) : 0,
  };
}

/** Same pending LKR/INR/USD as one student table row (current level only). */
function pendingTotalsForStudent(studentRequests, approvedSubs, pendingSubs, student, levelPriceMap) {
  const { live, balanceDue, levelRequests, level } = computeTotalsForStudentLevel(
    studentRequests,
    approvedSubs,
    pendingSubs,
    student?.level,
  );
  const hasMappedPayments = levelRequests.some((r) => !r.isArchived && r.status !== 'REJECTED');

  const catalogGaps = catalogGapsForStudent(student, levelPriceMap, live);
  const catalogBalance = catalogGaps.LKR + catalogGaps.INR + catalogGaps.USD;

  if (balanceDue.total > 0) {
    return {
      LKR: balanceDue.pendingApprovalAmountLKR,
      INR: balanceDue.pendingApprovalAmountINR,
      USD: balanceDue.pendingApprovalAmountUSD,
    };
  }
  if (!hasMappedPayments && catalogBalance > 0) {
    return { LKR: catalogGaps.LKR, INR: catalogGaps.INR, USD: catalogGaps.USD };
  }
  return { LKR: 0, INR: 0, USD: 0 };
}

function addBuckets(target, source) {
  target.LKR += source.LKR || 0;
  target.INR += source.INR || 0;
  target.USD += source.USD || 0;
}

function emptyLevelSlotAccumulator() {
  return {
    received: emptyCurrencyBucket(),
    pending: emptyCurrencyBucket(),
    overdue: emptyCurrencyBucket(),
    /** Catalog fee × students currently on this level (inferred currency per student). */
    expected: emptyCurrencyBucket(),
  };
}

function createEmptyLevelSlots() {
  return Object.fromEntries(LANGUAGE_LEVELS.map((slot) => [slot, emptyLevelSlotAccumulator()]));
}

/** Catalog gap for a specific CEFR slot when the student is currently on that level. */
function catalogGapsForLevelSlot(student, levelPriceMap, live, slot, studentRequests, approvedSubs) {
  const studentLevel = String(student?.level || '').trim().toUpperCase();
  if (studentLevel !== slot) return { LKR: 0, INR: 0, USD: 0 };
  const levelPrice = levelPriceMap.get(slot) || { LKR: 0, INR: 0, USD: 0 };
  const ccy = feeCurrencyForLevelSlot(student, studentRequests, approvedSubs, slot, studentLevel);
  return {
    LKR: ccy === 'LKR' ? Math.max(0, (levelPrice.LKR || 0) - (Number(live?.totalPaidLKR) || 0)) : 0,
    INR: ccy === 'INR' ? Math.max(0, (levelPrice.INR || 0) - (Number(live?.totalPaidINR) || 0)) : 0,
    USD: ccy === 'USD' ? Math.max(0, (levelPrice.USD || 0) - (Number(live?.totalPaidUSD) || 0)) : 0,
  };
}

function pendingTotalsForLevelSlot(studentRequests, approvedSubs, pendingSubs, student, levelPriceMap, slot) {
  const { live, balanceDue, levelRequests } = computeTotalsForLevelSlot(
    studentRequests,
    approvedSubs,
    pendingSubs,
    slot,
    student?.level,
  );
  const hasMappedPayments = levelRequests.some((r) => !r.isArchived && r.status !== 'REJECTED');
  const catalogGaps = catalogGapsForLevelSlot(
    student,
    levelPriceMap,
    live,
    slot,
    studentRequests,
    approvedSubs,
  );
  const catalogBalance = catalogGaps.LKR + catalogGaps.INR + catalogGaps.USD;

  if (balanceDue.total > 0) {
    return {
      LKR: balanceDue.pendingApprovalAmountLKR,
      INR: balanceDue.pendingApprovalAmountINR,
      USD: balanceDue.pendingApprovalAmountUSD,
    };
  }
  if (!hasMappedPayments && catalogBalance > 0) {
    return { LKR: catalogGaps.LKR, INR: catalogGaps.INR, USD: catalogGaps.USD };
  }
  return { LKR: 0, INR: 0, USD: 0 };
}

function slotExpectedFromParts(received, pending, overdue) {
  return {
    LKR: (received.LKR || 0) + (pending.LKR || 0) + (overdue.LKR || 0),
    INR: (received.INR || 0) + (pending.INR || 0) + (overdue.INR || 0),
    USD: (received.USD || 0) + (pending.USD || 0) + (overdue.USD || 0),
  };
}

/** Approved submission totals per A1–B2 slot (matches batch student detail levelPaid buckets). */
function receivedBucketsByLevelSlot(studentRequests, approvedSubs, studentLevel) {
  const slots = Object.fromEntries(LANGUAGE_LEVELS.map((s) => [s, emptyCurrencyBucket()]));
  const reqById = new Map((studentRequests || []).map((r) => [String(r._id), r]));
  for (const sub of approvedSubs || []) {
    const paid = Number(sub.paidAmount) || 0;
    if (paid <= 0) continue;
    const req = reqById.get(String(sub.paymentRequestId));
    if (!req || req.isArchived || req.status === 'REJECTED') continue;
    const slot = slotForRequest(req, studentLevel);
    if (!slot || !LANGUAGE_LEVELS.includes(slot)) continue;
    addToCurrencyBucket(slots[slot], sub.currency || req.currency || 'LKR', paid);
  }
  return slots;
}

/** Approved received for one CEFR slot (submission attribution; matches levelPaid buckets). */
function receivedForLevelSlot(studentRequests, approvedSubs, studentLevel, slot) {
  const bySub = receivedBucketsByLevelSlot(studentRequests, approvedSubs, studentLevel)[slot];
  if (bucketTotal(bySub) > 0) return bySub;
  const { live } = computeTotalsForLevelSlot(studentRequests, approvedSubs, [], slot, studentLevel);
  return {
    LKR: live.totalPaidLKR || 0,
    INR: live.totalPaidINR || 0,
    USD: live.totalPaidUSD || 0,
  };
}

/**
 * When journey day ≥ 10, the full language-fee balance is past due — not only formally OVERDUE requests.
 */
function applyJourneyOverdueAmounts(student, pending, overdue) {
  const totalPending = bucketTotal(pending);
  if (totalPending <= 0) return overdue || emptyCurrencyBucket();
  const langStatus = computeLanguageFeeStatus(totalPending, journeyDayForStudent(student));
  if (langStatus !== 'DUE') return overdue || emptyCurrencyBucket();
  const p = pending || emptyCurrencyBucket();
  const o = overdue || emptyCurrencyBucket();
  return {
    LKR: Math.max(o.LKR || 0, p.LKR || 0),
    INR: Math.max(o.INR || 0, p.INR || 0),
    USD: Math.max(o.USD || 0, p.USD || 0),
  };
}

/**
 * Keep catalog slot totals consistent: received ≤ expected, pending = outstanding, overdue ≤ pending.
 * When the student is not on this level (no catalog fee), keep request-based pending/overdue.
 */
function reconcileLevelSlotBuckets(catalogExpected, received, rawPending, rawOverdue) {
  const exp = catalogExpected || { LKR: 0, INR: 0, USD: 0 };
  const rec = received || { LKR: 0, INR: 0, USD: 0 };
  const rawP = rawPending || { LKR: 0, INR: 0, USD: 0 };
  const rawO = rawOverdue || { LKR: 0, INR: 0, USD: 0 };

  if (bucketTotal(exp) <= 0) {
    return {
      expected: slotExpectedFromParts(rec, rawP, rawO),
      received: rec,
      pending: rawP,
      overdue: rawO,
    };
  }

  const pending = {
    LKR: Math.max(0, (exp.LKR || 0) - (rec.LKR || 0)),
    INR: Math.max(0, (exp.INR || 0) - (rec.INR || 0)),
    USD: Math.max(0, (exp.USD || 0) - (rec.USD || 0)),
  };
  const receivedApplied = {
    LKR: Math.min(rec.LKR || 0, exp.LKR || 0),
    INR: Math.min(rec.INR || 0, exp.INR || 0),
    USD: Math.min(rec.USD || 0, exp.USD || 0),
  };
  const overdue = {
    LKR: pending.LKR > 0 && (rawO.LKR || 0) > 0 ? Math.min(pending.LKR, rawO.LKR) : 0,
    INR: pending.INR > 0 && (rawO.INR || 0) > 0 ? Math.min(pending.INR, rawO.INR) : 0,
    USD: pending.USD > 0 && (rawO.USD || 0) > 0 ? Math.min(pending.USD, rawO.USD) : 0,
  };

  return { expected: exp, received: receivedApplied, pending, overdue };
}

/** One student's reconciled A1–B2 slot (shared by batch aggregation and student detail). */
function computeReconciledLevelSlot(
  student,
  studentRequests,
  approvedSubs,
  pendingSubs,
  levelPriceMap,
  slot,
) {
  const studentLevel = String(student?.level || '').trim().toUpperCase();
  const catalogExpected = studentLevel === slot
    ? catalogFeeForLevelSlot(student, levelPriceMap, slot, studentRequests, approvedSubs)
    : { LKR: 0, INR: 0, USD: 0 };
  const received = receivedForLevelSlot(studentRequests, approvedSubs, studentLevel, slot);
  const { live: slotLive } = computeTotalsForLevelSlot(
    studentRequests,
    approvedSubs,
    pendingSubs,
    slot,
    student.level,
  );
  const rawPending = pendingTotalsForLevelSlot(
    studentRequests,
    approvedSubs,
    pendingSubs,
    student,
    levelPriceMap,
    slot,
  );
  const rawOverdue = {
    LKR: slotLive.overdueAmountLKR || 0,
    INR: slotLive.overdueAmountINR || 0,
    USD: slotLive.overdueAmountUSD || 0,
  };
  const reconciled = reconcileLevelSlotBuckets(catalogExpected, received, rawPending, rawOverdue);
  if (studentLevel === slot) {
    reconciled.overdue = applyJourneyOverdueAmounts(student, reconciled.pending, reconciled.overdue);
  }
  return reconciled;
}

function finalizeLevelSlotFields(acc) {
  const levelSlots = {};
  const allLang = emptyLevelSlotAccumulator();

  for (const slot of LANGUAGE_LEVELS) {
    const s = acc.levelSlots[slot] || emptyLevelSlotAccumulator();
    const received = { LKR: s.received.LKR || 0, INR: s.received.INR || 0, USD: s.received.USD || 0 };
    const pending = { LKR: s.pending.LKR || 0, INR: s.pending.INR || 0, USD: s.pending.USD || 0 };
    const overdue = { LKR: s.overdue.LKR || 0, INR: s.overdue.INR || 0, USD: s.overdue.USD || 0 };
    const catalogExpected = {
      LKR: s.expected.LKR || 0,
      INR: s.expected.INR || 0,
      USD: s.expected.USD || 0,
    };
    const derivedExpected = slotExpectedFromParts(received, pending, overdue);
    const catalogTotal = catalogExpected.LKR + catalogExpected.INR + catalogExpected.USD;
    const expected = catalogTotal > 0 ? catalogExpected : derivedExpected;
    levelSlots[slot] = {
      receivedLKR: received.LKR,
      receivedINR: received.INR,
      receivedUSD: received.USD,
      pendingLKR: pending.LKR,
      pendingINR: pending.INR,
      pendingUSD: pending.USD,
      overdueLKR: overdue.LKR,
      overdueINR: overdue.INR,
      overdueUSD: overdue.USD,
      expectedLKR: expected.LKR,
      expectedINR: expected.INR,
      expectedUSD: expected.USD,
    };
    addBuckets(allLang.received, received);
    addBuckets(allLang.pending, pending);
    addBuckets(allLang.overdue, overdue);
    addBuckets(allLang.expected, catalogExpected);
  }

  const allExpected = {
    LKR: allLang.expected.LKR || 0,
    INR: allLang.expected.INR || 0,
    USD: allLang.expected.USD || 0,
  };
  return {
    levelSlots,
    allLanguageFees: {
      receivedLKR: allLang.received.LKR || 0,
      receivedINR: allLang.received.INR || 0,
      receivedUSD: allLang.received.USD || 0,
      pendingLKR: allLang.pending.LKR || 0,
      pendingINR: allLang.pending.INR || 0,
      pendingUSD: allLang.pending.USD || 0,
      overdueLKR: allLang.overdue.LKR || 0,
      overdueINR: allLang.overdue.INR || 0,
      overdueUSD: allLang.overdue.USD || 0,
      expectedLKR: allExpected.LKR,
      expectedINR: allExpected.INR,
      expectedUSD: allExpected.USD,
    },
  };
}

/** Per-student language fee from hub catalog (CEFR level × fee in inferred currency only). */
function catalogFeeForStudent(student, levelPriceMap) {
  const level = String(student?.level || 'A1').trim().toUpperCase();
  const lp = levelPriceMap.get(level) || { LKR: 0, INR: 0, USD: 0 };
  const ccy = studentInferredCurrency(student);
  return {
    level,
    LKR: ccy === 'LKR' ? (lp.LKR || 0) : 0,
    INR: ccy === 'INR' ? (lp.INR || 0) : 0,
    USD: ccy === 'USD' ? (lp.USD || 0) : 0,
  };
}

function buildCatalogPaymentBreakdown(students, levelPriceMap) {
  const byLevel = new Map();
  for (const student of students) {
    const fee = catalogFeeForStudent(student, levelPriceMap);
    const key = fee.level;
    if (!byLevel.has(key)) {
      byLevel.set(key, {
        level: key,
        studentCount: 0,
        feeLKR: fee.LKR,
        feeINR: fee.INR,
        feeUSD: fee.USD,
        totalLKR: 0,
        totalINR: 0,
        totalUSD: 0,
      });
    }
    const row = byLevel.get(key);
    row.studentCount += 1;
    row.totalLKR += fee.LKR;
    row.totalINR += fee.INR;
    row.totalUSD += fee.USD;
  }
  return [...byLevel.values()].sort((a, b) => CEFR_ORDER.indexOf(a.level) - CEFR_ORDER.indexOf(b.level));
}

function dueFromPendingOverdue(pending, overdue) {
  return {
    LKR: (pending.LKR || 0) + (overdue.LKR || 0),
    INR: (pending.INR || 0) + (overdue.INR || 0),
    USD: (pending.USD || 0) + (overdue.USD || 0),
  };
}

function bucketTotal(bucket) {
  return (bucket.LKR || 0) + (bucket.INR || 0) + (bucket.USD || 0);
}

function hasApprovedPaymentForType(studentRequests, approvedSubs, paymentType) {
  const bucket = approvedPaidByTypeBucket(studentRequests, approvedSubs, paymentType);
  if (bucketTotal(bucket) > 0) return true;
  const type = String(paymentType || '').toUpperCase();
  return (studentRequests || []).some(
    (r) => !r.isArchived && String(r.paymentType || '').toUpperCase() === type
      && ['APPROVED', 'FULLY_PAID'].includes(r.status),
  );
}

function approvedPaidByTypeBucket(studentRequests, approvedSubs, paymentType) {
  const bucket = emptyCurrencyBucket();
  const type = String(paymentType || '').toUpperCase();
  const reqs = (studentRequests || []).filter(
    (r) => !r.isArchived && String(r.paymentType || '').toUpperCase() === type,
  );
  if (!reqs.length) return bucket;
  const reqById = new Map(reqs.map((r) => [String(r._id), r]));
  for (const sub of approvedSubs || []) {
    const req = reqById.get(String(sub.paymentRequestId));
    if (!req) continue;
    const paid = Number(sub.paidAmount) || 0;
    if (paid <= 0) continue;
    addToCurrencyBucket(bucket, sub.currency || req.currency || 'LKR', paid);
  }
  return bucket;
}

function emptyInsightAmounts() {
  return {
    paidFullReceived: emptyCurrencyBucket(),
    balancePending: emptyCurrencyBucket(),
    overdueAmount: emptyCurrencyBucket(),
    docsReceived: emptyCurrencyBucket(),
    visaReceived: emptyCurrencyBucket(),
  };
}

function insightAmountsToFields(insightAmounts) {
  const ia = insightAmounts || emptyInsightAmounts();
  return {
    insightPaidFullLKR: ia.paidFullReceived.LKR || 0,
    insightPaidFullINR: ia.paidFullReceived.INR || 0,
    insightPaidFullUSD: ia.paidFullReceived.USD || 0,
    insightBalanceLKR: ia.balancePending.LKR || 0,
    insightBalanceINR: ia.balancePending.INR || 0,
    insightBalanceUSD: ia.balancePending.USD || 0,
    insightOverdueLKR: ia.overdueAmount.LKR || 0,
    insightOverdueINR: ia.overdueAmount.INR || 0,
    insightOverdueUSD: ia.overdueAmount.USD || 0,
    insightDocsLKR: ia.docsReceived.LKR || 0,
    insightDocsINR: ia.docsReceived.INR || 0,
    insightDocsUSD: ia.docsReceived.USD || 0,
    insightVisaLKR: ia.visaReceived.LKR || 0,
    insightVisaINR: ia.visaReceived.INR || 0,
    insightVisaUSD: ia.visaReceived.USD || 0,
  };
}

/** Matches Payment Hub table language-fee / pending column rules (current level only). */
function effectiveOutstandingBalance(studentRequests, approved, pendingSubs, student, levelPriceMap) {
  const { live, balanceDue, levelRequests, level } = computeTotalsForStudentLevel(
    studentRequests,
    approved,
    pendingSubs,
    student?.level,
  );
  const hasMappedPayments = levelRequests.some((r) => !r.isArchived && r.status !== 'REJECTED');
  const catalogGaps = catalogGapsForStudent(student, levelPriceMap, live);
  const catalogBalance = catalogGaps.LKR + catalogGaps.INR + catalogGaps.USD;
  if (balanceDue.total > 0) return balanceDue.total;
  if (!hasMappedPayments && catalogBalance > 0) return catalogBalance;
  return 0;
}

function journeyDayForStudent(student) {
  const raw = student?.currentCourseDay;
  if (raw != null && Number.isFinite(Number(raw))) {
    return Math.min(200, Math.max(1, Math.floor(Number(raw))));
  }
  return 1;
}

function levelStartDateForStudent(student) {
  const level = String(student?.level || 'A1').trim().toUpperCase();
  const key = `${level}StartDate`;
  const fromCourse = student?.courseStartDates?.[key];
  if (fromCourse) {
    const d = new Date(fromCourse);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (student?.batchStartedOn) {
    const d = new Date(student.batchStartedOn);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** When a payment request was marked overdue (or due date if missing). */
function overdueConvertedAtForRequest(req) {
  if (!req || req.status !== 'OVERDUE') return null;
  const updated = req.updatedAt ? new Date(req.updatedAt) : null;
  if (updated && !Number.isNaN(updated.getTime())) return updated;
  const due = req.dueDate ? new Date(req.dueDate) : null;
  if (due && !Number.isNaN(due.getTime())) return due;
  return null;
}

/** Journey day 10+ with language fee owed — overdue since start + (day 10 − 1). */
function journeyOverdueSinceDate(student) {
  const jDay = journeyDayForStudent(student);
  if (jDay < JOURNEY_DUE_FROM_DAY) return null;
  const start = levelStartDateForStudent(student);
  if (!start) return null;
  const dueFrom = new Date(start);
  dueFrom.setUTCDate(dueFrom.getUTCDate() + JOURNEY_DUE_FROM_DAY - 1);
  return dueFrom;
}

function collectOverdueSinceDates(student, studentRequests, approved, pending, levelPriceMap) {
  const dates = [];
  for (const req of studentRequests || []) {
    const converted = overdueConvertedAtForRequest(req);
    if (converted) dates.push(converted);
  }
  const outstanding = effectiveOutstandingBalance(
    studentRequests,
    approved,
    pending,
    student,
    levelPriceMap,
  );
  const langStatus = computeLanguageFeeStatus(outstanding, journeyDayForStudent(student));
  if (langStatus === 'DUE' && outstanding > 0) {
    const journeyDate = journeyOverdueSinceDate(student);
    if (journeyDate) dates.push(journeyDate);
  }
  return dates;
}

/** Earliest overdue conversion date for one student (ISO), or null. */
function overdueSinceForStudent(student, studentRequests, approved, pending, levelPriceMap) {
  const dates = collectOverdueSinceDates(student, studentRequests, approved, pending, levelPriceMap);
  if (!dates.length) return null;
  let earliest = dates[0];
  for (const d of dates) {
    if (d < earliest) earliest = d;
  }
  return earliest.toISOString();
}

function trackEarliestOverdue(acc, date) {
  if (!date || Number.isNaN(date.getTime())) return;
  if (!acc.earliestOverdueAt || date < acc.earliestOverdueAt) {
    acc.earliestOverdueAt = date;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId[] | null} studentIds null = all students
 */
async function aggregateHubDashboardStats(studentIds = null, options = {}) {
  const User = mongoose.model('User');
  const userQuery = { role: 'STUDENT' };
  if (!options.includeTestAccounts) {
    Object.assign(userQuery, EXCLUDE_TEST);
  }
  if (studentIds !== null) {
    userQuery._id = { $in: studentIds.length ? studentIds : [] };
  }

  const [students, catalog] = await Promise.all([
    User.find(userQuery).select('_id level phoneNumber currentCourseDay').lean(),
    PaymentHubCatalog.getOrCreate(),
  ]);

  const ids = students.map((s) => s._id);
  const levelPriceMap = buildLevelPriceMap(catalog);

  const received = emptyCurrencyBucket();
  const pending = emptyCurrencyBucket();
  const overdue = emptyCurrencyBucket();
  const totalPaymentExpected = emptyCurrencyBucket();
  const totalDue = emptyCurrencyBucket();
  let fullyPaidStudents = 0;
  let balanceStudents = 0;
  let overdueStudents = 0;
  let docsPaidStudents = 0;
  let visaPaidStudents = 0;
  let overdueRequestCount = 0;

  if (!ids.length) {
    return {
      received,
      pending,
      overdue,
      totalPaymentExpected,
      totalDue,
      catalogPaymentBreakdown: [],
      expectedThisMonth: emptyCurrencyBucket(),
      overdueRequestCount: 0,
      totalStudents: 0,
      fullyPaidStudents: 0,
      balanceStudents: 0,
      overdueStudents: 0,
      docsPaidStudents: 0,
      visaPaidStudents: 0,
      activeStudents: 0,
    };
  }

  const [requests, approvedSubs, pendingSubs] = await Promise.all([
    PaymentRequest.find({ studentId: { $in: ids }, isArchived: false }).lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: ids },
      status: 'APPROVED',
      isArchived: false,
    }).lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: ids },
      status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      isArchived: false,
    }).lean(),
  ]);

  const requestsByStudent = groupDocsByStudentId(requests);
  const approvedByStudent = groupDocsByStudentId(approvedSubs);
  const pendingByStudent = groupDocsByStudentId(pendingSubs);

  for (const student of students) {
    const sid = String(student._id);
    const studentRequests = requestsByStudent[sid] || [];
    const approved = approvedByStudent[sid] || [];
    const pendingSubmissions = pendingByStudent[sid] || [];

    const { live: allLive } = computeTotalsForAllPayments(
      studentRequests,
      approved,
      pendingSubmissions,
      student.level,
    );
    const { live } = computeTotalsForStudentLevel(
      studentRequests,
      approved,
      pendingSubmissions,
      student.level,
    );
    addBuckets(received, {
      LKR: allLive.totalPaidLKR,
      INR: allLive.totalPaidINR,
      USD: allLive.totalPaidUSD,
    });
    const pendingStudent = pendingTotalsForStudent(
      studentRequests,
      approved,
      pendingSubmissions,
      student,
      levelPriceMap,
    );
    const overdueStudent = applyJourneyOverdueAmounts(student, pendingStudent, {
      LKR: live.overdueAmountLKR,
      INR: live.overdueAmountINR,
      USD: live.overdueAmountUSD,
    });
    addBuckets(overdue, overdueStudent);
    addBuckets(pending, pendingStudent);
    addBuckets(totalDue, dueFromPendingOverdue(pendingStudent, overdueStudent));
    addBuckets(totalPaymentExpected, catalogFeeForStudent(student, levelPriceMap));

    overdueRequestCount += studentRequests.filter((r) => r.status === 'OVERDUE').length;

    const outstanding = effectiveOutstandingBalance(
      studentRequests,
      approved,
      pendingSubmissions,
      student,
      levelPriceMap,
    );
    const journeyDay = journeyDayForStudent(student);
    const langStatus = computeLanguageFeeStatus(outstanding, journeyDay);

    if (langStatus === 'FULL_PAID') fullyPaidStudents += 1;
    if (langStatus === 'BALANCE' || bucketTotal(pendingStudent) > 0) balanceStudents += 1;
    if (langStatus === 'DUE' || bucketTotal(overdueStudent) > 0 || studentRequests.some((r) => r.status === 'OVERDUE')) {
      overdueStudents += 1;
    }
    if (hasApprovedPaymentForType(studentRequests, approved, 'DOCS_PAYMENT')) docsPaidStudents += 1;
    if (hasApprovedPaymentForType(studentRequests, approved, 'VISA_PAYMENT')) visaPaidStudents += 1;
  }

  const expectedThisMonth = await expectedThisMonthForScope(studentIds);
  const catalogPaymentBreakdown = buildCatalogPaymentBreakdown(students, levelPriceMap);

  return {
    received,
    pending,
    overdue,
    totalPaymentExpected,
    totalDue,
    catalogPaymentBreakdown,
    expectedThisMonth,
    overdueRequestCount,
    totalStudents: students.length,
    fullyPaidStudents,
    balanceStudents,
    overdueStudents,
    docsPaidStudents,
    visaPaidStudents,
    activeStudents: balanceStudents + overdueStudents,
  };
}

async function expectedThisMonthForScope(studentIds) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const match = {
    dueDate: { $gte: startOfMonth, $lte: endOfMonth },
    status: { $nin: ['APPROVED', 'FULLY_PAID', 'REJECTED'] },
    isArchived: false,
  };
  if (studentIds !== null) {
    match.studentId = {
      $in: studentIds.length ? studentIds : [new mongoose.Types.ObjectId('000000000000000000000000')],
    };
  }

  const rows = await PaymentRequest.aggregate([
    { $match: match },
    { $group: { _id: '$currency', total: { $sum: '$amountRemaining' } } },
  ]);

  const expected = emptyCurrencyBucket();
  for (const row of rows) {
    addToCurrencyBucket(expected, row._id, row.total);
  }
  return expected;
}

function batchLabelForStudent(student) {
  const b = String(student?.batch || '').trim();
  return b || '—';
}

function emptyBatchAccumulator() {
  return {
    studentCount: 0,
    received: emptyCurrencyBucket(),
    langReceived: emptyCurrencyBucket(),
    fullPending: emptyCurrencyBucket(),
    fullOverdue: emptyCurrencyBucket(),
    pending: emptyCurrencyBucket(),
    overdue: emptyCurrencyBucket(),
    expected: emptyCurrencyBucket(),
    due: emptyCurrencyBucket(),
    fullyPaidStudents: 0,
    balanceStudents: 0,
    overdueStudents: 0,
    docsPaidStudents: 0,
    visaPaidStudents: 0,
    insightAmounts: emptyInsightAmounts(),
    levelCounts: {},
    journeyDaySum: 0,
    journeyDayCount: 0,
    maxStudentDay: null,
    earliestOverdueAt: null,
    levelSlots: createEmptyLevelSlots(),
  };
}

function finalizeBatchRow(batch, acc) {
  const levelCounts = acc.levelCounts;
  const receivedLKR = acc.received.LKR || 0;
  const expectedLKR = acc.expected.LKR || 0;
  let maxDay = acc.maxStudentDay;
  if (maxDay != null && Number.isFinite(Number(maxDay))) {
    maxDay = Math.min(200, Math.max(1, Math.floor(Number(maxDay))));
  } else {
    maxDay = null;
  }
  const avgJourneyDay =
    acc.journeyDayCount > 0 ? Math.round(acc.journeyDaySum / acc.journeyDayCount) : null;

  // If the catalog has no INR/USD price configured for this batch's students, fall back to
  // deriving the expected total from what has actually been received + pending (so the
  // "Total payment" column shows INR/USD amounts whenever Indian/international students exist).
  const receivedINR = acc.received.INR || 0;
  const pendingINR = acc.pending.INR || 0;
  const overdueINR = acc.overdue.INR || 0;
  const catalogExpectedINR = acc.expected.INR || 0;
  const totalExpectedINR = catalogExpectedINR > 0
    ? catalogExpectedINR
    : receivedINR + pendingINR + overdueINR;

  const receivedUSD = acc.received.USD || 0;
  const pendingUSD = acc.pending.USD || 0;
  const overdueUSD = acc.overdue.USD || 0;
  const catalogExpectedUSD = acc.expected.USD || 0;
  const totalExpectedUSD = catalogExpectedUSD > 0
    ? catalogExpectedUSD
    : receivedUSD + pendingUSD + overdueUSD;

  const langPaidLKR = acc.langReceived.LKR || 0;
  const langPaidINR = acc.langReceived.INR || 0;
  const langPaidUSD = acc.langReceived.USD || 0;
  const fullPendingLKR = acc.fullPending.LKR || 0;
  const fullPendingINR = acc.fullPending.INR || 0;
  const fullPendingUSD = acc.fullPending.USD || 0;
  const fullOverdueLKR = acc.fullOverdue.LKR || 0;
  const fullOverdueINR = acc.fullOverdue.INR || 0;
  const fullOverdueUSD = acc.fullOverdue.USD || 0;
  const fullExpectedLKR = receivedLKR + fullPendingLKR + fullOverdueLKR;
  const fullExpectedINR = receivedINR + fullPendingINR + fullOverdueINR;
  const fullExpectedUSD = receivedUSD + fullPendingUSD + fullOverdueUSD;

  return {
    batch,
    studentCount: acc.studentCount,
    totalPaid: receivedLKR + receivedINR + receivedUSD,
    totalPaidLKR: receivedLKR,
    totalPaidINR: receivedINR,
    totalPaidUSD: receivedUSD,
    langPaidLKR,
    langPaidINR,
    langPaidUSD,
    fullPendingLKR,
    fullPendingINR,
    fullPendingUSD,
    fullOverdueLKR,
    fullOverdueINR,
    fullOverdueUSD,
    fullExpectedLKR,
    fullExpectedINR,
    fullExpectedUSD,
    totalPendingLKR: acc.pending.LKR || 0,
    totalPendingINR: pendingINR,
    totalPendingUSD: pendingUSD,
    totalOverdueLKR: acc.overdue.LKR || 0,
    totalOverdueINR: overdueINR,
    totalOverdueUSD: overdueUSD,
    totalExpectedLKR: expectedLKR,
    totalExpectedINR,
    totalExpectedUSD,
    totalDueLKR: acc.due.LKR || 0,
    totalDueINR: acc.due.INR || 0,
    totalDueUSD: acc.due.USD || 0,
    fullyPaidStudents: acc.fullyPaidStudents,
    balanceStudents: acc.balanceStudents,
    overdueStudents: acc.overdueStudents,
    docsPaidStudents: acc.docsPaidStudents,
    visaPaidStudents: acc.visaPaidStudents,
    levelCounts,
    maxStudentDay: maxDay,
    avgJourneyDay,
    collectionRateLKR:
      expectedLKR > 0 ? Math.min(100, Math.round((receivedLKR / expectedLKR) * 100)) : null,
    overdueSince: acc.earliestOverdueAt ? acc.earliestOverdueAt.toISOString() : null,
    ...insightAmountsToFields(acc.insightAmounts),
    ...finalizeLevelSlotFields(acc),
  };
}

const VISA_DOC_SUBSCRIPTIONS = ['VISA_DOC', 'VISA_DOC_ONLY', 'DOCS_RECOGNITION'];

function applyStudentCohortFilters(userQuery, filters = {}) {
  const status = filters.studentStatus && String(filters.studentStatus).trim();
  if (status) {
    userQuery.studentStatus = status.toUpperCase();
  }

  const cohort = filters.cohort || filters.subscriptionGroup;
  if (cohort && String(cohort).trim()) {
    const key = String(cohort).trim().toLowerCase();
    if (key === 'platinum') {
      userQuery.subscription = 'PLATINUM';
    } else if (key === 'silver') {
      userQuery.subscription = 'SILVER';
    } else if (key === 'visa_docs' || key === 'visa-docs' || key === 'visa') {
      userQuery.subscription = { $in: VISA_DOC_SUBSCRIPTIONS };
    }
  } else if (filters.subscription && String(filters.subscription).trim()) {
    userQuery.subscription = String(filters.subscription).trim().toUpperCase();
  }
}

/**
 * Per-batch payment insights using the same rules as Payment Hub dashboard + table.
 * @param {{ batch?: string, level?: string, studentStatus?: string, cohort?: string, subscription?: string }} filters
 */
async function aggregateBatchPaymentInsights(filters = {}) {
  const User = mongoose.model('User');
  const userQuery = { role: 'STUDENT' };
  if (!filters.includeTestAccounts) {
    Object.assign(userQuery, EXCLUDE_TEST);
  }
  if (filters.batch && String(filters.batch).trim()) {
    userQuery.batch = String(filters.batch).trim();
  }
  if (filters.level && String(filters.level).trim()) {
    userQuery.level = String(filters.level).trim();
  }
  applyStudentCohortFilters(userQuery, filters);

  const [students, catalog] = await Promise.all([
    User.find(userQuery).select('_id batch level phoneNumber currentCourseDay batchStartedOn courseStartDates').lean(),
    PaymentHubCatalog.getOrCreate(),
  ]);

  const levelPriceMap = buildLevelPriceMap(catalog);
  const batchMap = new Map();
  const totalsAcc = emptyBatchAccumulator();

  if (!students.length) {
    return { batches: [], totalStudents: 0, batchNames: [], totals: null };
  }

  const ids = students.map((s) => s._id);
  const [requests, approvedSubs, pendingSubs] = await Promise.all([
    PaymentRequest.find({ studentId: { $in: ids }, isArchived: false }).lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: ids },
      status: 'APPROVED',
      isArchived: false,
    }).lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: ids },
      status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      isArchived: false,
    }).lean(),
  ]);

  const requestsByStudent = groupDocsByStudentId(requests);
  const approvedByStudent = groupDocsByStudentId(approvedSubs);
  const pendingByStudent = groupDocsByStudentId(pendingSubs);

  for (const student of students) {
    const sid = String(student._id);
    const batch = batchLabelForStudent(student);
    if (!batchMap.has(batch)) batchMap.set(batch, emptyBatchAccumulator());
    const acc = batchMap.get(batch);

    const studentRequests = requestsByStudent[sid] || [];
    const approved = approvedByStudent[sid] || [];
    const pendingSubmissions = pendingByStudent[sid] || [];

    const { live: allLive, balanceDue: allBalanceDue } = computeTotalsForAllPayments(
      studentRequests,
      approved,
      pendingSubmissions,
      student.level,
    );
    const { live } = computeTotalsForStudentLevel(
      studentRequests,
      approved,
      pendingSubmissions,
      student.level,
    );
    const receivedStudent = {
      LKR: allLive.totalPaidLKR,
      INR: allLive.totalPaidINR,
      USD: allLive.totalPaidUSD,
    };
    const langReceivedStudent = {
      LKR: live.totalPaidLKR || 0,
      INR: live.totalPaidINR || 0,
      USD: live.totalPaidUSD || 0,
    };
    const fullPendingStudent = {
      LKR: allBalanceDue.pendingApprovalAmountLKR || 0,
      INR: allBalanceDue.pendingApprovalAmountINR || 0,
      USD: allBalanceDue.pendingApprovalAmountUSD || 0,
    };
    const fullOverdueStudent = {
      LKR: allLive.overdueAmountLKR || 0,
      INR: allLive.overdueAmountINR || 0,
      USD: allLive.overdueAmountUSD || 0,
    };
    const pendingStudent = pendingTotalsForStudent(
      studentRequests,
      approved,
      pendingSubmissions,
      student,
      levelPriceMap,
    );
    const overdueStudent = applyJourneyOverdueAmounts(student, pendingStudent, {
      LKR: live.overdueAmountLKR,
      INR: live.overdueAmountINR,
      USD: live.overdueAmountUSD,
    });
    const expectedStudent = catalogFeeForStudent(student, levelPriceMap);
    const dueStudent = dueFromPendingOverdue(pendingStudent, overdueStudent);

    const lv = String(student?.level || '').trim().toUpperCase();
    if (lv) acc.levelCounts[lv] = (acc.levelCounts[lv] || 0) + 1;

    const jDay = journeyDayForStudent(student);
    acc.journeyDaySum += jDay;
    acc.journeyDayCount += 1;
    if (student.currentCourseDay != null && Number.isFinite(Number(student.currentCourseDay))) {
      const d = Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay))));
      acc.maxStudentDay = acc.maxStudentDay == null ? d : Math.max(acc.maxStudentDay, d);
    }

    acc.studentCount += 1;
    addBuckets(acc.received, receivedStudent);
    addBuckets(acc.langReceived, langReceivedStudent);
    addBuckets(acc.fullPending, fullPendingStudent);
    addBuckets(acc.fullOverdue, fullOverdueStudent);
    for (const slot of LANGUAGE_LEVELS) {
      const reconciled = computeReconciledLevelSlot(
        student,
        studentRequests,
        approved,
        pendingSubmissions,
        levelPriceMap,
        slot,
      );
      addBuckets(acc.levelSlots[slot].expected, reconciled.expected);
      addBuckets(acc.levelSlots[slot].received, reconciled.received);
      addBuckets(acc.levelSlots[slot].pending, reconciled.pending);
      addBuckets(acc.levelSlots[slot].overdue, reconciled.overdue);
      addBuckets(totalsAcc.levelSlots[slot].expected, reconciled.expected);
      addBuckets(totalsAcc.levelSlots[slot].received, reconciled.received);
      addBuckets(totalsAcc.levelSlots[slot].pending, reconciled.pending);
      addBuckets(totalsAcc.levelSlots[slot].overdue, reconciled.overdue);
    }
    addBuckets(acc.pending, pendingStudent);
    addBuckets(acc.overdue, overdueStudent);
    addBuckets(acc.expected, expectedStudent);
    addBuckets(acc.due, dueStudent);

    const outstanding = effectiveOutstandingBalance(
      studentRequests,
      approved,
      pendingSubmissions,
      student,
      levelPriceMap,
    );
    const langStatus = computeLanguageFeeStatus(outstanding, jDay);

    if (bucketTotal(overdueStudent) > 0 || langStatus === 'DUE') {
      for (const converted of collectOverdueSinceDates(
        student,
        studentRequests,
        approved,
        pendingSubmissions,
        levelPriceMap,
      )) {
        trackEarliestOverdue(acc, converted);
        trackEarliestOverdue(totalsAcc, converted);
      }
    }

    if (langStatus === 'FULL_PAID') {
      acc.fullyPaidStudents += 1;
      addBuckets(acc.insightAmounts.paidFullReceived, receivedStudent);
    }
    if (langStatus === 'BALANCE' || bucketTotal(pendingStudent) > 0) {
      acc.balanceStudents += 1;
      addBuckets(acc.insightAmounts.balancePending, pendingStudent);
    }
    if (
      langStatus === 'DUE'
      || bucketTotal(overdueStudent) > 0
      || studentRequests.some((r) => r.status === 'OVERDUE')
    ) {
      acc.overdueStudents += 1;
      addBuckets(acc.insightAmounts.overdueAmount, overdueStudent);
    }
    if (hasApprovedPaymentForType(studentRequests, approved, 'DOCS_PAYMENT')) {
      acc.docsPaidStudents += 1;
      addBuckets(
        acc.insightAmounts.docsReceived,
        approvedPaidByTypeBucket(studentRequests, approved, 'DOCS_PAYMENT'),
      );
    }
    if (hasApprovedPaymentForType(studentRequests, approved, 'VISA_PAYMENT')) {
      acc.visaPaidStudents += 1;
      addBuckets(
        acc.insightAmounts.visaReceived,
        approvedPaidByTypeBucket(studentRequests, approved, 'VISA_PAYMENT'),
      );
    }

    addBuckets(totalsAcc.received, receivedStudent);
    addBuckets(totalsAcc.langReceived, langReceivedStudent);
    addBuckets(totalsAcc.fullPending, fullPendingStudent);
    addBuckets(totalsAcc.fullOverdue, fullOverdueStudent);
    addBuckets(totalsAcc.pending, pendingStudent);
    addBuckets(totalsAcc.overdue, overdueStudent);
    addBuckets(totalsAcc.expected, expectedStudent);
    addBuckets(totalsAcc.due, dueStudent);
    totalsAcc.studentCount += 1;
    totalsAcc.journeyDaySum += jDay;
    totalsAcc.journeyDayCount += 1;
    if (langStatus === 'FULL_PAID') {
      totalsAcc.fullyPaidStudents += 1;
      addBuckets(totalsAcc.insightAmounts.paidFullReceived, receivedStudent);
    }
    if (langStatus === 'BALANCE' || bucketTotal(pendingStudent) > 0) {
      totalsAcc.balanceStudents += 1;
      addBuckets(totalsAcc.insightAmounts.balancePending, pendingStudent);
    }
    if (
      langStatus === 'DUE'
      || bucketTotal(overdueStudent) > 0
      || studentRequests.some((r) => r.status === 'OVERDUE')
    ) {
      totalsAcc.overdueStudents += 1;
      addBuckets(totalsAcc.insightAmounts.overdueAmount, overdueStudent);
    }
    if (hasApprovedPaymentForType(studentRequests, approved, 'DOCS_PAYMENT')) {
      totalsAcc.docsPaidStudents += 1;
      addBuckets(
        totalsAcc.insightAmounts.docsReceived,
        approvedPaidByTypeBucket(studentRequests, approved, 'DOCS_PAYMENT'),
      );
    }
    if (hasApprovedPaymentForType(studentRequests, approved, 'VISA_PAYMENT')) {
      totalsAcc.visaPaidStudents += 1;
      addBuckets(
        totalsAcc.insightAmounts.visaReceived,
        approvedPaidByTypeBucket(studentRequests, approved, 'VISA_PAYMENT'),
      );
    }
  }

  const batches = [...batchMap.entries()]
    .map(([batch, acc]) => finalizeBatchRow(batch, acc))
    .sort((a, b) => b.totalPaidLKR - a.totalPaidLKR || b.totalPaidINR - a.totalPaidINR);

  const batchNames = batches.map((b) => b.batch).filter((n) => n && n !== '—');
  const totals = finalizeBatchRow('__all__', totalsAcc);
  delete totals.batch;

  return {
    batches,
    totalStudents: students.length,
    batchNames,
    totals,
  };
}

const VALID_STUDENT_INSIGHTS = ['paid_full', 'have_balance', 'overdue', 'paid_docs', 'paid_visa'];

function studentMatchesInsight(student, studentRequests, approved, pendingSubs, levelPriceMap, insight) {
  if (!insight || !VALID_STUDENT_INSIGHTS.includes(insight)) return true;

  const outstanding = effectiveOutstandingBalance(
    studentRequests,
    approved,
    pendingSubs,
    student,
    levelPriceMap,
  );
  const journeyDay = journeyDayForStudent(student);
  const langStatus = computeLanguageFeeStatus(outstanding, journeyDay);
  const pendingStudent = pendingTotalsForStudent(
    studentRequests,
    approved,
    pendingSubs,
    student,
    levelPriceMap,
  );
  const { live } = computeTotalsForStudentLevel(
    studentRequests,
    approved,
    pendingSubs,
    student?.level,
  );
  const overdueStudent = applyJourneyOverdueAmounts(student, pendingStudent, {
    LKR: live.overdueAmountLKR || 0,
    INR: live.overdueAmountINR || 0,
    USD: live.overdueAmountUSD || 0,
  });

  switch (insight) {
    case 'paid_full':
      return langStatus === 'FULL_PAID';
    case 'have_balance':
      return langStatus === 'BALANCE' || bucketTotal(pendingStudent) > 0;
    case 'overdue':
      return (
        langStatus === 'DUE'
        || bucketTotal(overdueStudent) > 0
        || (studentRequests || []).some((r) => r.status === 'OVERDUE')
      );
    case 'paid_docs':
      return hasApprovedPaymentForType(studentRequests, approved, 'DOCS_PAYMENT');
    case 'paid_visa':
      return hasApprovedPaymentForType(studentRequests, approved, 'VISA_PAYMENT');
    default:
      return true;
  }
}

/**
 * Filter candidate students by Payment Hub summary insight (same rules as dashboard KPI counts).
 * @param {object[]} students lean User docs with _id, level, currentCourseDay
 */
async function filterStudentsByInsight(students, insight) {
  if (!insight || !VALID_STUDENT_INSIGHTS.includes(insight) || !students?.length) {
    return students || [];
  }

  const PaymentFlowSubmission = require('../models/PaymentSubmission');
  const ids = students.map((s) => s._id);

  const [catalog, allRequests, allApproved, allPending] = await Promise.all([
    PaymentHubCatalog.getOrCreate(),
    PaymentRequest.find({ studentId: { $in: ids }, isArchived: false }).lean(),
    PaymentFlowSubmission.find({ studentId: { $in: ids }, status: 'APPROVED', isArchived: false }).lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: ids },
      status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      isArchived: false,
    }).lean(),
  ]);

  const levelPriceMap = buildLevelPriceMap(catalog);
  const requestsByStudent = groupDocsByStudentId(allRequests);
  const approvedByStudent = groupDocsByStudentId(allApproved);
  const pendingByStudent = groupDocsByStudentId(allPending);

  return students.filter((student) => {
    const sid = String(student._id);
    return studentMatchesInsight(
      student,
      requestsByStudent[sid] || [],
      approvedByStudent[sid] || [],
      pendingByStudent[sid] || [],
      levelPriceMap,
      insight,
    );
  });
}

function slotTotalsToFields(received, pending, overdue, expected) {
  return {
    receivedLKR: received.LKR || 0,
    receivedINR: received.INR || 0,
    receivedUSD: received.USD || 0,
    pendingLKR: pending.LKR || 0,
    pendingINR: pending.INR || 0,
    pendingUSD: pending.USD || 0,
    overdueLKR: overdue.LKR || 0,
    overdueINR: overdue.INR || 0,
    overdueUSD: overdue.USD || 0,
    expectedLKR: expected.LKR || 0,
    expectedINR: expected.INR || 0,
    expectedUSD: expected.USD || 0,
  };
}

/** Per-student A1–B2 slot totals for batch student table payment filters. */
function buildStudentLevelSlotTotals(student, studentRequests, approvedSubs, pendingSubs, levelPriceMap) {
  const levelSlots = {};
  const allLang = emptyLevelSlotAccumulator();

  for (const slot of LANGUAGE_LEVELS) {
    const reconciled = computeReconciledLevelSlot(
      student,
      studentRequests,
      approvedSubs,
      pendingSubs,
      levelPriceMap,
      slot,
    );
    levelSlots[slot] = slotTotalsToFields(
      reconciled.received,
      reconciled.pending,
      reconciled.overdue,
      reconciled.expected,
    );
    addBuckets(allLang.received, reconciled.received);
    addBuckets(allLang.pending, reconciled.pending);
    addBuckets(allLang.overdue, reconciled.overdue);
    addBuckets(allLang.expected, reconciled.expected);
  }

  const allExpected = {
    LKR: allLang.expected.LKR || 0,
    INR: allLang.expected.INR || 0,
    USD: allLang.expected.USD || 0,
  };

  return {
    levelSlots,
    allLanguageFees: slotTotalsToFields(
      allLang.received,
      allLang.pending,
      allLang.overdue,
      allExpected,
    ),
  };
}

module.exports = {
  aggregateHubDashboardStats,
  aggregateBatchPaymentInsights,
  buildLevelPriceMap,
  buildSubscriptionPriceMapLookup,
  buildStudentLevelSlotTotals,
  pendingTotalsForStudent,
  applyJourneyOverdueAmounts,
  effectiveOutstandingBalance,
  overdueSinceForStudent,
  VALID_STUDENT_INSIGHTS,
  studentMatchesInsight,
  filterStudentsByInsight,
};
