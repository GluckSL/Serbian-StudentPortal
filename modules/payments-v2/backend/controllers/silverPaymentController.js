/**
 * Silver Payment List controller.
 * Manages a persistent list of students displayed on the Finance Dashboard
 * "Silver Payment" card. Students can be added from GO Tamil / GO Sinhala batches,
 * other regular batches, or by individual search.
 */

const mongoose = require('mongoose');
const SilverPaymentList = require('../models/SilverPaymentList');
const PaymentRequest = require('../models/PaymentRequest');
const StudentPaymentProfile = require('../models/StudentPaymentProfile');
const PaymentHubCatalog = require('../models/PaymentHubCatalog');
const {
  emptyCurrencyBucket,
  addToCurrencyBucket,
  paidTotalsFromBreakdown,
  pendingTotalsFromBreakdown,
  overdueTotalsFromBreakdown,
} = require('../utils/currencyBreakdownHelper');
const {
  computeTotalsForStudentLevel,
} = require('../utils/levelSlotHelper');
const {
  buildSubscriptionPriceMapLookup,
  buildStudentLevelSlotTotals,
  pendingTotalsForStudent,
  applyJourneyOverdueAmounts,
  overdueSinceForStudent,
} = require('../helpers/paymentHubStatsAggregator');
const { inferCurrencyFromPhone } = require('../utils/currencyHelper');
const { computeLanguageFeeStatus } = require('../helpers/languageFeeStatus');
const {
  goStudentQuery,
} = require('../../../../utils/goSilverTrack');

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const PREV_LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2'];

function prevLevelsPendingForStudentRow(row) {
  const currentLevel = String(row.level || '').toUpperCase().trim();
  const currentIdx = PREV_LEVEL_ORDER.indexOf(currentLevel);
  if (currentIdx <= 0) return { lkr: 0, inr: 0, usd: 0 };
  let lkr = 0;
  let inr = 0;
  let usd = 0;
  for (const lvl of PREV_LEVEL_ORDER.slice(0, currentIdx)) {
    const slot = row.levelSlots?.[lvl];
    if (!slot) continue;
    lkr += slot.pendingLKR || 0;
    inr += slot.pendingINR || 0;
    usd += slot.pendingUSD || 0;
  }
  return { lkr, inr, usd };
}

function detectLevel(req) {
  const hay = [req.customType, req.remarks, req.paymentType]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  for (const lv of CEFR_LEVELS) {
    if (new RegExp(`\\b${lv}\\b`).test(hay)) return lv;
  }
  return null;
}

// ─── Build payment rows for an array of User documents ──────────────────────
async function buildPaymentRows(students) {
  if (!students.length) return [];

  const PaymentFlowSubmission = require('../models/PaymentSubmission');
  const studentIds = students.map((s) => s._id);

  const [catalog, profiles, requests, submissions, pendingSubmissions] = await Promise.all([
    PaymentHubCatalog.getOrCreate(),
    StudentPaymentProfile.find({ studentId: { $in: studentIds } }).lean(),
    PaymentRequest.find({ studentId: { $in: studentIds }, isArchived: false }).lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: studentIds },
      status: 'APPROVED',
      isArchived: false,
    })
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

  const getPriceMap = buildSubscriptionPriceMapLookup(catalog);

  const profileByStudent = {};
  for (const p of profiles) profileByStudent[String(p.studentId)] = p;

  const requestsByStudent = {};
  const requestById = {};
  for (const r of requests) {
    const sid = String(r.studentId);
    if (!requestsByStudent[sid]) requestsByStudent[sid] = [];
    requestsByStudent[sid].push(r);
    requestById[String(r._id)] = r;
  }

  const subsByStudent = {};
  for (const sub of submissions) {
    const sid = String(sub.studentId);
    if (!subsByStudent[sid]) subsByStudent[sid] = [];
    subsByStudent[sid].push(sub);
  }

  const pendingByStudent = {};
  for (const sub of pendingSubmissions) {
    const sid = String(sub.studentId);
    if (!pendingByStudent[sid]) pendingByStudent[sid] = [];
    pendingByStudent[sid].push(sub);
  }

  return students.map((student) => {
    const sid = String(student._id);
    const levelPriceMap = getPriceMap(student.subscription);
    const profile = profileByStudent[sid] || null;
    const studentRequests = requestsByStudent[sid] || [];
    const studentSubs = subsByStudent[sid] || [];
    const levelPaid = Object.fromEntries(CEFR_LEVELS.map((l) => [l, emptyCurrencyBucket()]));
    const docsPaidByCurrency = emptyCurrencyBucket();
    const visaPaidByCurrency = emptyCurrencyBucket();
    const otherPaidByCurrency = emptyCurrencyBucket();
    let lastPaymentDate = profile?.lastPaymentDate || null;
    let lastPaymentAmount = profile?.lastPaymentAmount || 0;
    let lastPaymentCurrency = profile?.lastPaymentCurrency || '';

    for (const sub of studentSubs) {
      const paid = Number(sub.paidAmount) || 0;
      if (paid <= 0) continue;
      const req = requestById[String(sub.paymentRequestId)];
      const payDate = sub.approvedAt || sub.paymentDate || sub.submittedAt;
      if (payDate && (!lastPaymentDate || new Date(payDate) > new Date(lastPaymentDate))) {
        lastPaymentDate = payDate;
        lastPaymentAmount = paid;
        lastPaymentCurrency = sub.currency || lastPaymentCurrency;
      }
      const ccy = sub.currency || req?.currency || 'LKR';
      if (!req) {
        addToCurrencyBucket(otherPaidByCurrency, ccy, paid);
        continue;
      }
      const pt = String(req.paymentType || '').toUpperCase();
      if (pt === 'DOCS_PAYMENT') { addToCurrencyBucket(docsPaidByCurrency, ccy, paid); continue; }
      if (pt === 'VISA_PAYMENT') { addToCurrencyBucket(visaPaidByCurrency, ccy, paid); continue; }
      const lv = detectLevel(req) || (pt === 'LANGUAGE_FEE' ? String(student.level || '').toUpperCase().trim() : null);
      if (lv && levelPaid[lv] != null) {
        addToCurrencyBucket(levelPaid[lv], ccy, paid);
      } else {
        addToCurrencyBucket(otherPaidByCurrency, ccy, paid);
      }
    }

    const currentDay =
      student.currentCourseDay != null
        ? Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay))))
        : null;
    const studentPendingSubs = pendingByStudent[sid] || [];
    const overdueSince = overdueSinceForStudent(student, studentRequests, studentSubs, studentPendingSubs, levelPriceMap);
    const { live: langLive } = computeTotalsForStudentLevel(studentRequests, studentSubs, studentPendingSubs, student.level);
    const langPendingStudent = pendingTotalsForStudent(studentRequests, studentSubs, studentPendingSubs, student, levelPriceMap);
    const langOverdueStudent = applyJourneyOverdueAmounts(student, langPendingStudent, {
      LKR: langLive.overdueAmountLKR || 0,
      INR: langLive.overdueAmountINR || 0,
      USD: langLive.overdueAmountUSD || 0,
    });
    const { levelSlots, allLanguageFees } = buildStudentLevelSlotTotals(
      student,
      studentRequests,
      studentSubs,
      studentPendingSubs,
      levelPriceMap,
    );

    return {
      studentId: sid,
      name: student.name,
      email: student.email,
      batch: student.batch,
      goLanguage: student.goLanguage || null,
      level: student.level || '—',
      studentStatus: student.studentStatus,
      subscription: student.subscription,
      currentJourneyDay: currentDay,
      totalPaid: profile?.totalPaid ?? 0,
      ...paidTotalsFromBreakdown(profile?.currencyBreakdown),
      ...pendingTotalsFromBreakdown(profile?.currencyBreakdown),
      ...overdueTotalsFromBreakdown(profile?.currencyBreakdown),
      langPaidLKR: langLive.totalPaidLKR || 0,
      langPaidINR: langLive.totalPaidINR || 0,
      langPaidUSD: langLive.totalPaidUSD || 0,
      langPendingLKR: langPendingStudent.LKR || 0,
      langPendingINR: langPendingStudent.INR || 0,
      langPendingUSD: langPendingStudent.USD || 0,
      langOverdueLKR: langOverdueStudent.LKR || 0,
      langOverdueINR: langOverdueStudent.INR || 0,
      langOverdueUSD: langOverdueStudent.USD || 0,
      pendingApprovalAmount: profile?.pendingApprovalAmount ?? 0,
      overdueAmount: profile?.overdueAmount ?? 0,
      overdueSince,
      overallStatus: profile?.overallStatus || 'NO_REQUESTS',
      levelPaid,
      levelSlots,
      allLanguageFees,
      docsPaidByCurrency,
      visaPaidByCurrency,
      otherPaidByCurrency,
      lastPaymentDate,
      lastPaymentAmount,
      lastPaymentCurrency,
      inferredCurrency: inferCurrencyFromPhone(student.phoneNumber),
      openRequestCount: studentRequests.filter(
        (r) => !['PAID', 'CANCELLED'].includes(String(r.status)),
      ).length,
    };
  });
}

// ─── GET /finance-dashboard/silver-payment/count ─────────────────────────────
const getCount = async (req, res) => {
  try {
    const count = await SilverPaymentList.countDocuments();
    return res.json({ success: true, count });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── GET /finance-dashboard/silver-payment/students ──────────────────────────
const getSilverPaymentStudents = async (req, res) => {
  try {
    const User = mongoose.model('User');
    const search = String(req.query.search || '').trim();
    const insight = String(req.query.insight || '').trim().toLowerCase();
    const selectedLevels = String(req.query.levels || '')
      .split(',')
      .map((level) => level.trim())
      .filter(Boolean);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(300, Math.max(10, parseInt(req.query.limit, 10) || 50));

    const listEntries = await SilverPaymentList.find().lean();
    const studentIds = listEntries.map((e) => e.studentId);

    const emptyLevelOptions = [];

    if (!studentIds.length) {
      return res.json({
        success: true,
        data: {
          students: [],
          totalStudents: 0,
          page: 1,
          totalPages: 1,
          levelOptions: emptyLevelOptions,
          insightCounts: { all: 0, paid_full: 0, have_balance: 0, overdue: 0 },
          insightAmounts: {
            all: { lkr: 0, inr: 0, usd: 0 },
            paid_full: { lkr: 0, inr: 0, usd: 0 },
            have_balance: { lkr: 0, inr: 0, usd: 0 },
            overdue: { lkr: 0, inr: 0, usd: 0 },
          },
          totalPaidLKR: 0,
          totalPaidINR: 0,
          totalPaidUSD: 0,
          totalPendingLKR: 0,
          totalPendingINR: 0,
          totalPendingUSD: 0,
          totalLastLevelPendingLKR: 0,
          totalLastLevelPendingINR: 0,
          totalLastLevelPendingUSD: 0,
          lastLevelPendingStudentCount: 0,
        },
      });
    }

    const levelOptionsQuery = {
      _id: { $in: studentIds },
      role: 'STUDENT',
    };

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      levelOptionsQuery.$or = [{ name: rx }, { email: rx }, { batch: rx }];
    }

    const levelOptionsRaw = await User.aggregate([
      { $match: levelOptionsQuery },
      {
        $group: {
          _id: {
            $cond: [
              { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$level', ''] } } } }, 0] },
              { $trim: { input: '$level' } },
              'Unspecified',
            ],
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { total: -1, _id: 1 } },
    ]);
    const levelOptions = levelOptionsRaw.map((row) => ({
      value: row._id === 'Unspecified' ? '__EMPTY__' : row._id,
      label: row._id,
      total: row.total,
    }));

    const students = await User.find(levelOptionsQuery)
      .select(
        'name email batch level phoneNumber enrollmentDate createdAt currentCourseDay batchStartedOn courseStartDates studentStatus subscription goLanguage goStatus',
      )
      .sort({ name: 1 })
      .lean();

    const rows = await buildPaymentRows(students);

    const rowAmounts = (r) => ({
      received: { lkr: r.langPaidLKR || 0, inr: r.langPaidINR || 0, usd: r.langPaidUSD || 0 },
      pending: { lkr: r.langPendingLKR || 0, inr: r.langPendingINR || 0, usd: r.langPendingUSD || 0 },
      overdue: { lkr: r.langOverdueLKR || 0, inr: r.langOverdueINR || 0, usd: r.langOverdueUSD || 0 },
    });
    const addMoney = (a, b) => ({ lkr: a.lkr + b.lkr, inr: a.inr + b.inr, usd: a.usd + b.usd });
    const moneyTotal = (m) => m.lkr + m.inr + m.usd;
    const rowOutstanding = (r) => {
      const { pending, overdue } = rowAmounts(r);
      return addMoney(pending, overdue);
    };
    const rowReceivedTotal = (r) => {
      const { received } = rowAmounts(r);
      return moneyTotal(received);
    };
    const rowOutstandingTotal = (r) => moneyTotal(rowOutstanding(r));
    const rowLangFeeStatus = (r) => {
      const { pending, overdue } = rowAmounts(r);
      return computeLanguageFeeStatus(moneyTotal(addMoney(pending, overdue)), r.currentJourneyDay);
    };

    const rowMatchesInsight = (r, key) => {
      if (!key) return true;
      const status = rowLangFeeStatus(r);
      const received = rowReceivedTotal(r);
      const outstanding = rowOutstandingTotal(r);
      const overdueAmt =
        (r.langOverdueLKR || 0) + (r.langOverdueINR || 0) + (r.langOverdueUSD || 0);
      switch (key) {
        case 'paid_full':
          return outstanding <= 0 && received > 0;
        case 'have_balance':
          return outstanding > 0 || status === 'BALANCE';
        case 'overdue':
          return overdueAmt > 0 || status === 'DUE';
        default:
          return true;
      }
    };

    const rowMatchesSelectedLevel = (r) => {
      if (!selectedLevels.length) return true;
      const exactLevels = selectedLevels.filter((level) => level !== '__EMPTY__');
      const includeEmpty = selectedLevels.includes('__EMPTY__');
      const rowLevel = String(r.level || '').trim();
      return exactLevels.includes(rowLevel) || (includeEmpty && (!rowLevel || rowLevel === '—'));
    };

    const levelFilteredRows = rows.filter(rowMatchesSelectedLevel);

    const sumInsightAmounts = (key, sourceRows) => {
      const empty = { lkr: 0, inr: 0, usd: 0 };
      const matched = key === 'all' ? sourceRows : sourceRows.filter((r) => rowMatchesInsight(r, key));
      return matched.reduce((acc, r) => {
        const { received, pending, overdue } = rowAmounts(r);
        const outstanding = addMoney(pending, overdue);
        if (key === 'all') {
          return addMoney(acc, addMoney(received, outstanding));
        }
        if (key === 'have_balance') {
          return addMoney(acc, outstanding);
        }
        if (key === 'overdue') {
          return addMoney(acc, overdue);
        }
        if (key === 'paid_full') {
          return addMoney(acc, received);
        }
        return acc;
      }, empty);
    };

    const insightCounts = {
      all: levelFilteredRows.length,
      paid_full: levelFilteredRows.filter((r) => rowMatchesInsight(r, 'paid_full')).length,
      have_balance: levelFilteredRows.filter((r) => rowMatchesInsight(r, 'have_balance')).length,
      overdue: levelFilteredRows.filter((r) => rowMatchesInsight(r, 'overdue')).length,
    };

    const insightAmounts = {
      all: sumInsightAmounts('all', levelFilteredRows),
      paid_full: sumInsightAmounts('paid_full', levelFilteredRows),
      have_balance: sumInsightAmounts('have_balance', levelFilteredRows),
      overdue: sumInsightAmounts('overdue', levelFilteredRows),
    };

    const filtered = insight
      ? levelFilteredRows.filter((r) => rowMatchesInsight(r, insight))
      : levelFilteredRows;
    const totalStudents = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalStudents / limit));
    const safePageNum = Math.min(page, totalPages);
    const paged = filtered.slice((safePageNum - 1) * limit, safePageNum * limit);

    const totalPaidLKR = levelFilteredRows.reduce((s, r) => s + (r.langPaidLKR || 0), 0);
    const totalPaidINR = levelFilteredRows.reduce((s, r) => s + (r.langPaidINR || 0), 0);
    const totalPaidUSD = levelFilteredRows.reduce((s, r) => s + (r.langPaidUSD || 0), 0);
    const totalPendingLKR = levelFilteredRows.reduce((s, r) => s + (r.langPendingLKR || 0) + (r.langOverdueLKR || 0), 0);
    const totalPendingINR = levelFilteredRows.reduce((s, r) => s + (r.langPendingINR || 0) + (r.langOverdueINR || 0), 0);
    const totalPendingUSD = levelFilteredRows.reduce((s, r) => s + (r.langPendingUSD || 0) + (r.langOverdueUSD || 0), 0);
    const totalOverdueLKR = levelFilteredRows.reduce((s, r) => s + (r.langOverdueLKR || 0), 0);
    const totalOverdueINR = levelFilteredRows.reduce((s, r) => s + (r.langOverdueINR || 0), 0);
    const totalOverdueUSD = levelFilteredRows.reduce((s, r) => s + (r.langOverdueUSD || 0), 0);

    let totalLastLevelPendingLKR = 0;
    let totalLastLevelPendingINR = 0;
    let totalLastLevelPendingUSD = 0;
    let lastLevelPendingStudentCount = 0;
    for (const r of levelFilteredRows) {
      const prev = prevLevelsPendingForStudentRow(r);
      totalLastLevelPendingLKR += prev.lkr;
      totalLastLevelPendingINR += prev.inr;
      totalLastLevelPendingUSD += prev.usd;
      if (prev.lkr + prev.inr + prev.usd > 0) lastLevelPendingStudentCount += 1;
    }

    return res.json({
      success: true,
      data: {
        students: paged,
        totalStudents,
        page: safePageNum,
        totalPages,
        levelOptions,
        insightCounts,
        insightAmounts,
        totalPaidLKR,
        totalPaidINR,
        totalPaidUSD,
        totalPendingLKR,
        totalPendingINR,
        totalPendingUSD,
        totalOverdueLKR,
        totalOverdueINR,
        totalOverdueUSD,
        totalLastLevelPendingLKR,
        totalLastLevelPendingINR,
        totalLastLevelPendingUSD,
        lastLevelPendingStudentCount,
      },
    });
  } catch (e) {
    console.error('[SilverPayment] getSilverPaymentStudents', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── GET /finance-dashboard/silver-payment/batch-options ────────────────────
const getBatchOptions = async (req, res) => {
  try {
    const User = mongoose.model('User');
    const BatchConfig = mongoose.model('BatchConfig');

    const [goTamilCount, goSinhalaCount, regularBatches] = await Promise.all([
      User.countDocuments(goStudentQuery('tamil')),
      User.countDocuments(goStudentQuery('sinhala')),
      BatchConfig.find({ journeyActive: true })
        .select('batchName')
        .sort({ batchName: 1 })
        .lean(),
    ]);

    const specialBatches = [
      {
        id: '__GO_TAMIL__',
        label: 'GO Tamil (GO-SILVER)',
        description: `${goTamilCount} students in GO Tamil batch`,
        studentCount: goTamilCount,
        type: 'go',
      },
      {
        id: '__GO_SINHALA__',
        label: 'GO Sinhala (GO-SINHALA)',
        description: `${goSinhalaCount} students in GO Sinhala batch`,
        studentCount: goSinhalaCount,
        type: 'go',
      },
    ];

    const regularOptions = regularBatches.map((b) => ({
      id: b.batchName,
      label: b.batchName,
      description: 'Regular batch',
      type: 'regular',
    }));

    return res.json({ success: true, batches: [...specialBatches, ...regularOptions] });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── POST /finance-dashboard/silver-payment/add-from-batch ──────────────────
function resolveBatchQuery(batchId) {
  if (batchId === '__GO_TAMIL__') {
    return { userQuery: goStudentQuery('tamil'), sourceLabel: 'GO Tamil' };
  }
  if (batchId === '__GO_SINHALA__') {
    return { userQuery: goStudentQuery('sinhala'), sourceLabel: 'GO Sinhala' };
  }
  return { userQuery: { role: 'STUDENT', batch: batchId }, sourceLabel: batchId };
}

const addFromBatch = async (req, res) => {
  try {
    const User = mongoose.model('User');
    const rawIds = Array.isArray(req.body?.batchIds)
      ? req.body.batchIds
      : req.body?.batchId
        ? [req.body.batchId]
        : [];
    const batchIds = [...new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean))];

    if (!batchIds.length) {
      return res.status(400).json({ success: false, message: 'At least one batch is required.' });
    }

    const studentIdSet = new Set();
    const sourceByStudent = {};

    for (const batchId of batchIds) {
      const { userQuery, sourceLabel } = resolveBatchQuery(batchId);
      const students = await User.find(userQuery).select('_id').lean();
      for (const s of students) {
        const sid = String(s._id);
        studentIdSet.add(sid);
        sourceByStudent[sid] = sourceLabel;
      }
    }

    if (!studentIdSet.size) {
      return res.json({
        success: true,
        added: 0,
        alreadyExists: 0,
        total: await SilverPaymentList.countDocuments(),
        message: 'No students found in the selected batch(es).',
      });
    }

    const ops = [...studentIdSet].map((sid) => ({
      updateOne: {
        filter: { studentId: sid },
        update: {
          $setOnInsert: {
            studentId: sid,
            source: sourceByStudent[sid] || 'batch',
            addedAt: new Date(),
          },
        },
        upsert: true,
      },
    }));
    const result = await SilverPaymentList.bulkWrite(ops);
    const added = result.upsertedCount || 0;
    const total = await SilverPaymentList.countDocuments();
    const batchLabel = batchIds.length === 1 ? `"${batchIds[0]}"` : `${batchIds.length} batches`;

    return res.json({
      success: true,
      added,
      alreadyExists: studentIdSet.size - added,
      total,
      message: `Added ${added} student(s) from ${batchLabel} (${studentIdSet.size - added} already in list).`,
    });
  } catch (e) {
    console.error('[SilverPayment] addFromBatch', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── GET /finance-dashboard/silver-payment/search ────────────────────────────
const searchStudents = async (req, res) => {
  try {
    const User = mongoose.model('User');
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ success: true, students: [] });
    }

    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(escaped, 'i');
    const students = await User.find({
      role: 'STUDENT',
      isTestAccount: { $ne: true },
      $or: [{ name: rx }, { email: rx }, { regNo: rx }],
    })
      .select('_id name email regNo subscription batch level studentStatus')
      .limit(20)
      .lean();

    const existingIds = new Set(
      (await SilverPaymentList.find({ studentId: { $in: students.map((s) => s._id) } }).lean()).map(
        (e) => String(e.studentId),
      ),
    );

    const result = students.map((s) => ({
      studentId: String(s._id),
      name: s.name,
      email: s.email,
      regNo: s.regNo || '',
      subscription: s.subscription,
      batch: s.batch || '',
      level: s.level || '',
      studentStatus: s.studentStatus || '',
      alreadyAdded: existingIds.has(String(s._id)),
    }));

    return res.json({ success: true, students: result });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── POST /finance-dashboard/silver-payment/add-student ──────────────────────
const addStudent = async (req, res) => {
  try {
    const User = mongoose.model('User');
    const studentId = String(req.body?.studentId || '').trim();
    if (!studentId) {
      return res.status(400).json({ success: false, message: 'studentId is required.' });
    }

    const user = await User.findOne({ _id: studentId, role: 'STUDENT' }).select('_id name').lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }

    const exists = await SilverPaymentList.findOne({ studentId: user._id });
    if (exists) {
      return res.json({ success: true, added: false, message: 'Student is already in the Silver Payment list.' });
    }

    await SilverPaymentList.create({ studentId: user._id, source: 'search' });
    const total = await SilverPaymentList.countDocuments();
    return res.json({ success: true, added: true, total, message: `${user.name} added to Silver Payment list.` });
  } catch (e) {
    console.error('[SilverPayment] addStudent', e);
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ─── DELETE /finance-dashboard/silver-payment/students/:studentId ────────────
const removeStudent = async (req, res) => {
  try {
    const studentId = String(req.params.studentId || '').trim();
    const result = await SilverPaymentList.deleteOne({ studentId });
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: 'Student not found in Silver Payment list.' });
    }
    const total = await SilverPaymentList.countDocuments();
    return res.json({ success: true, total, message: 'Student removed from Silver Payment list.' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  getCount,
  getSilverPaymentStudents,
  getBatchOptions,
  addFromBatch,
  searchStudents,
  addStudent,
  removeStudent,
};
