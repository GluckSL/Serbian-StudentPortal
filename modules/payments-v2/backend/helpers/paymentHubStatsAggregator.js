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
const { computeTotalsForStudentLevel, computeTotalsForAllPayments } = require('../utils/levelSlotHelper');
const { computeLanguageFeeStatus } = require('./languageFeeStatus');
const { EXCLUDE_TEST } = require('../../../../utils/analyticsFilters');

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function buildLevelPriceMap(catalog) {
  const levelPriceMap = new Map();
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

/** Same pending LKR/INR/USD as one student table row (current level only). */
function pendingTotalsForStudent(studentRequests, approvedSubs, pendingSubs, student, levelPriceMap) {
  const { live, balanceDue, levelRequests, level } = computeTotalsForStudentLevel(
    studentRequests,
    approvedSubs,
    pendingSubs,
    student?.level,
  );
  const hasMappedPayments = levelRequests.some((r) => !r.isArchived && r.status !== 'REJECTED');

  const levelKey = level || String(student?.level || '').trim().toUpperCase();
  const levelPrice = levelPriceMap.get(levelKey) || { LKR: 0, INR: 0, USD: 0 };
  const catalogGaps = {
    LKR: Math.max(0, (levelPrice.LKR || 0) - (Number(live.totalPaidLKR) || 0)),
    INR: Math.max(0, (levelPrice.INR || 0) - (Number(live.totalPaidINR) || 0)),
    USD: Math.max(0, (levelPrice.USD || 0) - (Number(live.totalPaidUSD) || 0)),
  };
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

/** Per-student language fee from hub catalog (CEFR level × fee row). */
function catalogFeeForStudent(student, levelPriceMap) {
  const level = String(student?.level || 'A1').trim().toUpperCase();
  const lp = levelPriceMap.get(level) || { LKR: 0, INR: 0, USD: 0 };
  return { level, LKR: lp.LKR, INR: lp.INR, USD: lp.USD };
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
  const reqs = (studentRequests || []).filter(
    (r) => !r.isArchived && String(r.paymentType) === paymentType,
  );
  if (!reqs.length) return false;
  const reqIds = new Set(reqs.map((r) => String(r._id)));
  const paid = (approvedSubs || [])
    .filter((s) => reqIds.has(String(s.paymentRequestId)))
    .reduce((sum, s) => sum + (Number(s.paidAmount) || 0), 0);
  if (paid > 0) return true;
  return reqs.some((r) => ['APPROVED', 'FULLY_PAID'].includes(r.status));
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
  const levelKey = level || String(student?.level || 'A1').trim().toUpperCase();
  const levelPrice = levelPriceMap.get(levelKey) || { LKR: 0, INR: 0, USD: 0 };
  const catalogGaps = {
    LKR: Math.max(0, (levelPrice.LKR || 0) - (Number(live.totalPaidLKR) || 0)),
    INR: Math.max(0, (levelPrice.INR || 0) - (Number(live.totalPaidINR) || 0)),
    USD: Math.max(0, (levelPrice.USD || 0) - (Number(live.totalPaidUSD) || 0)),
  };
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
    const overdueStudent = {
      LKR: live.overdueAmountLKR,
      INR: live.overdueAmountINR,
      USD: live.overdueAmountUSD,
    };
    addBuckets(overdue, overdueStudent);

    const pendingStudent = pendingTotalsForStudent(
      studentRequests,
      approved,
      pendingSubmissions,
      student,
      levelPriceMap,
    );
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
    pending: emptyCurrencyBucket(),
    overdue: emptyCurrencyBucket(),
    expected: emptyCurrencyBucket(),
    due: emptyCurrencyBucket(),
    fullyPaidStudents: 0,
    balanceStudents: 0,
    overdueStudents: 0,
    docsPaidStudents: 0,
    visaPaidStudents: 0,
    levelCounts: {},
    journeyDaySum: 0,
    journeyDayCount: 0,
    maxStudentDay: null,
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
  return {
    batch,
    studentCount: acc.studentCount,
    totalPaid: receivedLKR + (acc.received.INR || 0) + (acc.received.USD || 0),
    totalPaidLKR: receivedLKR,
    totalPaidINR: acc.received.INR || 0,
    totalPaidUSD: acc.received.USD || 0,
    totalPendingLKR: acc.pending.LKR || 0,
    totalPendingINR: acc.pending.INR || 0,
    totalPendingUSD: acc.pending.USD || 0,
    totalOverdueLKR: acc.overdue.LKR || 0,
    totalOverdueINR: acc.overdue.INR || 0,
    totalOverdueUSD: acc.overdue.USD || 0,
    totalExpectedLKR: expectedLKR,
    totalExpectedINR: acc.expected.INR || 0,
    totalExpectedUSD: acc.expected.USD || 0,
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
  };
}

/**
 * Per-batch payment insights using the same rules as Payment Hub dashboard + table.
 * @param {{ batch?: string, level?: string }} filters
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

  const [students, catalog] = await Promise.all([
    User.find(userQuery).select('_id batch level phoneNumber currentCourseDay').lean(),
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
    const receivedStudent = {
      LKR: allLive.totalPaidLKR,
      INR: allLive.totalPaidINR,
      USD: allLive.totalPaidUSD,
    };
    const overdueStudent = {
      LKR: live.overdueAmountLKR,
      INR: live.overdueAmountINR,
      USD: live.overdueAmountUSD,
    };
    const pendingStudent = pendingTotalsForStudent(
      studentRequests,
      approved,
      pendingSubmissions,
      student,
      levelPriceMap,
    );
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

    if (langStatus === 'FULL_PAID') acc.fullyPaidStudents += 1;
    if (langStatus === 'BALANCE' || bucketTotal(pendingStudent) > 0) acc.balanceStudents += 1;
    if (
      langStatus === 'DUE'
      || bucketTotal(overdueStudent) > 0
      || studentRequests.some((r) => r.status === 'OVERDUE')
    ) {
      acc.overdueStudents += 1;
    }
    if (hasApprovedPaymentForType(studentRequests, approved, 'DOCS_PAYMENT')) acc.docsPaidStudents += 1;
    if (hasApprovedPaymentForType(studentRequests, approved, 'VISA_PAYMENT')) acc.visaPaidStudents += 1;

    addBuckets(totalsAcc.received, receivedStudent);
    addBuckets(totalsAcc.pending, pendingStudent);
    addBuckets(totalsAcc.overdue, overdueStudent);
    addBuckets(totalsAcc.expected, expectedStudent);
    addBuckets(totalsAcc.due, dueStudent);
    totalsAcc.studentCount += 1;
    totalsAcc.journeyDaySum += jDay;
    totalsAcc.journeyDayCount += 1;
    if (langStatus === 'FULL_PAID') totalsAcc.fullyPaidStudents += 1;
    if (langStatus === 'BALANCE' || bucketTotal(pendingStudent) > 0) totalsAcc.balanceStudents += 1;
    if (
      langStatus === 'DUE'
      || bucketTotal(overdueStudent) > 0
      || studentRequests.some((r) => r.status === 'OVERDUE')
    ) {
      totalsAcc.overdueStudents += 1;
    }
    if (hasApprovedPaymentForType(studentRequests, approved, 'DOCS_PAYMENT')) totalsAcc.docsPaidStudents += 1;
    if (hasApprovedPaymentForType(studentRequests, approved, 'VISA_PAYMENT')) totalsAcc.visaPaidStudents += 1;
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
  const overdueStudent = {
    LKR: live.overdueAmountLKR || 0,
    INR: live.overdueAmountINR || 0,
    USD: live.overdueAmountUSD || 0,
  };

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

module.exports = {
  aggregateHubDashboardStats,
  aggregateBatchPaymentInsights,
  buildLevelPriceMap,
  pendingTotalsForStudent,
  effectiveOutstandingBalance,
  VALID_STUDENT_INSIGHTS,
  studentMatchesInsight,
  filterStudentsByInsight,
};
