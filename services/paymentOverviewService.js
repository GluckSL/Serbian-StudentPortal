// services/paymentOverviewService.js
// Admin "Engagement Overview – Payment" tab.
//
// Per-batch, per-level payment health using the same rules as Payment Hub health checkup:
//   green  = full paid (no outstanding balance for levels up to selectedLevel)
//   yellow = has pending balance AND days into current level ≤ 5
//   red    = has pending balance AND days into current level > 5
//
// The selectedLevel dropdown sums A1..selectedLevel payments (cumulative, same as health checkup).

'use strict';

const BatchConfig = require('../models/BatchConfig');
const User = require('../models/User');
const PaymentRequest = require('../modules/payments-v2/backend/models/PaymentRequest');
const PaymentFlowSubmission = require('../modules/payments-v2/backend/models/PaymentSubmission');
const PaymentHubCatalog = require('../modules/payments-v2/backend/models/PaymentHubCatalog');
const {
  buildSubscriptionPriceMapLookup,
  buildStudentLevelSlotTotals,
} = require('../modules/payments-v2/backend/helpers/paymentHubStatsAggregator');
const { groupDocsByStudentId } = require('../modules/payments-v2/backend/utils/currencyBreakdownHelper');
const {
  computeJourneyDayFromBatchConfig,
  LEVEL_SCHEDULE,
} = require('../utils/journeyDay');

const LEVELS = ['A1', 'A2', 'B1', 'B2'];

// Level start days (journey day when each level begins)
const LEVEL_START_DAY = Object.fromEntries(LEVEL_SCHEDULE.map((e) => [e.level, e.dayStart]));

// ── Helpers ─────────────────────────────────────────────────────────────────

/** How many days the student is into their current CEFR level (1-based). */
function daysIntoCurrentLevel(journeyDay, level) {
  const n = Number(journeyDay);
  if (!Number.isFinite(n)) return null;
  const start = LEVEL_START_DAY[String(level || 'A1').toUpperCase()] ?? 1;
  return Math.max(1, n - start + 1);
}

/**
 * Payment health band for one student.
 * hasPending = true when any pending/overdue balance exists for levels A1..selectedLevel.
 * green  = no outstanding balance
 * yellow = balance AND daysInLevel ≤ 5
 * red    = balance AND daysInLevel > 5
 */
function paymentBand(hasPending, daysInLevel) {
  if (!hasPending) return 'green';
  if (daysInLevel == null || daysInLevel <= 5) return 'yellow';
  return 'red';
}

/** CEFR level from journey day (uses LEVEL_SCHEDULE). */
function levelFromJourneyDay(journeyDay) {
  const n = Number(journeyDay) || 1;
  for (let i = LEVEL_SCHEDULE.length - 1; i >= 0; i--) {
    if (n >= LEVEL_SCHEDULE[i].dayStart) return LEVEL_SCHEDULE[i].level;
  }
  return 'A1';
}

/** Current level for batch based on journey day. */
function currentLevelForBatch(cfg) {
  const day = computeJourneyDayFromBatchConfig(cfg, new Date());
  return levelFromJourneyDay(day);
}

/** Levels from A1 up to (including) currentLevel. */
function availableLevels(currentLevel) {
  const idx = LEVELS.indexOf(currentLevel);
  if (idx < 0) return ['A1'];
  return LEVELS.slice(0, idx + 1);
}

/**
 * Sum pending + overdue across level slots A1..selectedLevel for one student.
 * Returns { totalPending, totalPaid }.
 */
function sumSlotsUpToLevel(levelSlots, selectedLevel) {
  const upToIdx = LEVELS.indexOf(selectedLevel);
  if (upToIdx < 0) return { totalPending: 0, totalPaid: 0 };
  let totalPending = 0;
  let totalPaid = 0;
  for (const lvl of LEVELS.slice(0, upToIdx + 1)) {
    const s = levelSlots?.[lvl];
    if (!s) continue;
    totalPending += (s.pendingLKR || 0) + (s.pendingINR || 0) + (s.pendingUSD || 0)
                  + (s.overdueLKR || 0) + (s.overdueINR || 0) + (s.overdueUSD || 0);
    totalPaid    += (s.receivedLKR || 0) + (s.receivedINR || 0) + (s.receivedUSD || 0);
  }
  return { totalPending, totalPaid };
}

// ── Core ────────────────────────────────────────────────────────────────────

/**
 * Per-student payment health for one batch at a given selectedLevel.
 */
async function getBatchPaymentHealth(cfg, selectedLevel, catalog, getPriceMapForStudent,
                                     requestsByStudent, approvedByStudent, pendingByStudent) {
  const batchName = cfg.batchName;
  const batchType = cfg.batchType || 'new';
  const currentLevel = currentLevelForBatch(cfg);
  const available = availableLevels(currentLevel);
  const resolvedLevel = selectedLevel && available.includes(selectedLevel)
    ? selectedLevel
    : currentLevel;

  const students = await User.find({
    role: 'STUDENT',
    isActive: true,
    studentStatus: 'ONGOING',
    batch: batchName,
  })
    .select('_id name regNo level phoneNumber currentCourseDay batchStartedOn courseStartDates subscription')
    .lean();

  const base = {
    batchName,
    batchType,
    currentLevel,
    selectedLevel: resolvedLevel,
    availableLevels: available,
    studentCount: students.length,
    students: [],
    bands: { red: 0, yellow: 0, green: 0 },
  };

  if (!students.length) return base;

  const studentRows = students.map((student) => {
    const sid = String(student._id);
    const levelPriceMap = getPriceMapForStudent(student.subscription);
    const studentRequests = requestsByStudent[sid] || [];
    const approved = approvedByStudent[sid] || [];
    const pendingSubs = pendingByStudent[sid] || [];

    const { levelSlots } = buildStudentLevelSlotTotals(
      student, studentRequests, approved, pendingSubs, levelPriceMap
    );

    const { totalPending, totalPaid } = sumSlotsUpToLevel(levelSlots, resolvedLevel);
    const hasPending = totalPending > 0;

    const studentCurrentLevel = String(student.level || levelFromJourneyDay(student.currentCourseDay) || 'A1').toUpperCase();
    const daysInLevel = daysIntoCurrentLevel(student.currentCourseDay, studentCurrentLevel);
    const band = paymentBand(hasPending, daysInLevel);
    base.bands[band] += 1;

    return {
      studentId: sid,
      name: student.name || 'Student',
      regNo: student.regNo || '',
      level: studentCurrentLevel,
      currentJourneyDay: student.currentCourseDay ?? null,
      daysIntoLevel: daysInLevel,
      totalPending,
      totalPaid,
      band,
    };
  });

  // worst first (red → yellow → green)
  const bandOrder = { red: 0, yellow: 1, green: 2 };
  studentRows.sort((a, b) =>
    bandOrder[a.band] - bandOrder[b.band] || (b.daysIntoLevel ?? 0) - (a.daysIntoLevel ?? 0) || a.name.localeCompare(b.name)
  );
  base.students = studentRows;
  return base;
}

/** Get all active new/new2 batch configs with active journeys. */
async function getActiveBatchConfigs() {
  const [cfgs, studentBatches] = await Promise.all([
    BatchConfig.find({
      batchType: { $in: ['new', 'new2'] },
      batchStartDate: { $ne: null },
      journeyActive: true,
    })
      .select('batchName batchType batchStartDate journeyActive oldBatchManualLevel levelCalendarDates trialAccessStartDate trialDayEnabled journeyLength')
      .lean(),
    User.distinct('batch', {
      role: 'STUDENT',
      isActive: true,
      studentStatus: 'ONGOING',
      batch: { $nin: [null, ''] },
    }),
  ]);

  const batchSet = new Set(studentBatches.map(String));
  const list = cfgs.filter((cfg) => batchSet.has(String(cfg.batchName)));
  const batchNo = (name) => {
    const m = String(name || '').match(/\d+/);
    return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
  };
  return list.sort((a, b) => batchNo(a.batchName) - batchNo(b.batchName));
}

/**
 * Pre-load all payment data for a list of student IDs.
 */
async function loadPaymentData(studentIds) {
  const [catalog, requests, approvedSubs, pendingSubs] = await Promise.all([
    PaymentHubCatalog.getOrCreate(),
    PaymentRequest.find({ studentId: { $in: studentIds }, isArchived: false })
      .select('studentId paymentType customType remarks isArchived status currency amount amountRemaining dueDate')
      .lean(),
    PaymentFlowSubmission.find({ studentId: { $in: studentIds }, status: 'APPROVED', isArchived: false })
      .select('studentId paymentRequestId paidAmount currency status submittedAt approvedAt paymentDate')
      .lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: studentIds },
      status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      isArchived: false,
    })
      .select('studentId paymentRequestId paidAmount currency status submittedAt approvedAt paymentDate')
      .lean(),
  ]);
  return {
    catalog,
    requestsByStudent: groupDocsByStudentId(requests),
    approvedByStudent: groupDocsByStudentId(approvedSubs),
    pendingByStudent: groupDocsByStudentId(pendingSubs),
  };
}

/** Run async mapper with limited concurrency. */
async function mapWithConcurrency(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Payment overview across all active new/new2 batches.
 * Each batch defaults to its current CEFR level.
 */
async function getPaymentOverview() {
  const cfgs = await getActiveBatchConfigs();
  if (!cfgs.length) return { generatedAt: new Date(), batches: [] };

  // Load all students first to get their IDs for payment data
  const allStudents = await User.find({
    role: 'STUDENT',
    isActive: true,
    studentStatus: 'ONGOING',
    batch: { $in: cfgs.map((c) => c.batchName) },
  })
    .select('_id')
    .lean();

  const studentIds = allStudents.map((s) => s._id);
  const { catalog, requestsByStudent, approvedByStudent, pendingByStudent } =
    await loadPaymentData(studentIds);

  const getPriceMapForStudent = buildSubscriptionPriceMapLookup(catalog);

  const batches = await mapWithConcurrency(cfgs, 5, (cfg) =>
    getBatchPaymentHealth(
      cfg, undefined, catalog, getPriceMapForStudent,
      requestsByStudent, approvedByStudent, pendingByStudent
    )
  );

  return { generatedAt: new Date(), batches: batches.filter(Boolean) };
}

/**
 * Single batch payment health for a specific CEFR level (for the per-batch level dropdown).
 */
async function getSingleBatchPaymentHealth(batchName, selectedLevel) {
  const cfg = await BatchConfig.findOne({ batchName })
    .select('batchName batchType batchStartDate journeyActive oldBatchManualLevel levelCalendarDates trialAccessStartDate trialDayEnabled journeyLength')
    .lean();
  if (!cfg || !cfg.journeyActive) return null;

  const students = await User.find({
    role: 'STUDENT',
    isActive: true,
    studentStatus: 'ONGOING',
    batch: batchName,
  })
    .select('_id')
    .lean();

  const studentIds = students.map((s) => s._id);
  const { catalog, requestsByStudent, approvedByStudent, pendingByStudent } =
    await loadPaymentData(studentIds);

  const getPriceMapForStudent = buildSubscriptionPriceMapLookup(catalog);
  return getBatchPaymentHealth(
    cfg, selectedLevel, catalog, getPriceMapForStudent,
    requestsByStudent, approvedByStudent, pendingByStudent
  );
}

module.exports = {
  getPaymentOverview,
  getSingleBatchPaymentHealth,
  paymentBand,
  daysIntoCurrentLevel,
  availableLevels,
};
