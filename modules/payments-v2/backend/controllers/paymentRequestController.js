/**
 * Payment Request Controller
 * Auth note: JWT from routes/auth.js sets req.user.id (also supports legacy req.user.userId)
 *            req.user.role    (ADMIN / TEACHER_ADMIN / SUB_ADMIN / STUDENT)
 *            req.financeRole  (SUPER_ADMIN / FINANCE_ADMIN / VIEW_ONLY / STUDENT — set by attachFinanceRole)
 */
const mongoose = require('mongoose');
const PaymentRequest = require('../models/PaymentRequest');
const PaymentInstallment = require('../models/PaymentInstallment');
const StudentPaymentProfile = require('../models/StudentPaymentProfile');
const PaymentHubCatalog = require('../models/PaymentHubCatalog');
const paymentService = require('../services/paymentService');
const installmentService = require('../services/installmentService');
const timelineService = require('../services/timelineService');
const { getAuthUserId } = require('../helpers/authUserId');
const proofR2 = require('../services/paymentProofR2Service');
const { inferCurrencyFromPhone } = require('../utils/currencyHelper');
const {
  paidTotalsFromBreakdown,
  pendingTotalsFromBreakdown,
  overdueTotalsFromBreakdown,
  enrichProfileCurrencyTotals,
  groupDocsByStudentId,
  mongoPaidFieldsFromProfile,
  mongoPendingFieldsFromProfile,
  mongoOverdueFieldsFromProfile,
  emptyCurrencyBucket,
  addToCurrencyBucket,
  computeBalanceDueFromRequests,
} = require('../utils/currencyBreakdownHelper');
const {
  computeTotalsForStudentLevel,
  computeTotalsForAllPayments,
  computePaidSlotBadges,
  computeTotalsForLevelSlot,
  isSlotSettledPaid,
  filterRequestsForSlot,
} = require('../utils/levelSlotHelper');
const { JOURNEY_DUE_FROM_DAY, computeLanguageFeeStatus } = require('../helpers/languageFeeStatus');
const {
  getDocsPaymentStudentIds,
  getDocsPaymentOverview: buildDocsPaymentOverview,
  isDocsFullPaidByReceived,
  docsFullQuotationForRow,
} = require('../helpers/docsPaymentCohortHelper');
const {
  getFilteredStudentIds,
  parseHubFilters,
  applyTestAccountFilter,
  filterSummaryLabel,
  hasActiveFilters,
} = require('../helpers/paymentHubStudentFilter');
const {
  aggregateHubDashboardStats,
  aggregateBatchPaymentInsights,
  buildLevelPriceMap,
  buildSubscriptionPriceMapLookup,
  buildStudentLevelSlotTotals,
  pendingTotalsForStudent,
  applyJourneyOverdueAmounts,
  effectiveOutstandingBalance,
  VALID_STUDENT_INSIGHTS,
  filterStudentsByInsight,
  overdueSinceForStudent,
  studentMatchesInsight,
} = require('../helpers/paymentHubStatsAggregator');
const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// ─── Helper to get admin name from user model ──────────────────────────────
const getAdminName = async (userId) => {
  const user = await paymentService.getUser(userId);
  return user?.name || 'Admin';
};

// ─── Create payment requests (bulk-capable) ───────────────────────────────
const createRequests = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const adminRole = req.user.role;
    const adminName = await getAdminName(adminId);

    const {
      studentIds, amount, currency, paymentType, customType,
      dueDate, remarks, installmentAllowed, scheduledInstallments,
      notificationToggle, isDraft, batchId, targetType,
    } = req.body;

    if (!studentIds?.length) {
      return res.status(400).json({ success: false, message: 'At least one studentId is required' });
    }

    const result = await paymentService.createPaymentRequests({
      studentIds,
      adminId,
      adminRole,
      adminName,
      amount,
      currency,
      paymentType,
      customType,
      dueDate,
      remarks,
      installmentAllowed,
      scheduledInstallments,
      notificationToggle,
      isDraft,
      batchId,
      targetType,
    });

    res.status(201).json({
      success: true,
      data: result.requests,
      bulkOperation: result.bulkOperation,
      failedStudents: result.failedStudents,
      count: result.requests.length,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Get all requests (admin view) ────────────────────────────────────────
const getAllRequests = async (req, res) => {
  try {
    const {
      page = 1, limit = 20, sort = '-createdAt',
      search, batch, level, currency, status,
      dateFrom, dateTo, monthYear, dueDateFrom, dueDateTo,
      includeArchived = 'false',
    } = req.query;

    const query = { isArchived: includeArchived === 'true' ? undefined : false };
    if (query.isArchived === undefined) delete query.isArchived;
    if (currency) query.currency = currency;
    if (status) query.status = status;
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }
    if (monthYear) {
      const [year, month] = monthYear.split('-').map(Number);
      query.createdAt = { $gte: new Date(year, month - 1, 1), $lte: new Date(year, month, 0) };
    }
    if (dueDateFrom || dueDateTo) {
      query.dueDate = {};
      if (dueDateFrom) query.dueDate.$gte = new Date(dueDateFrom);
      if (dueDateTo) query.dueDate.$lte = new Date(dueDateTo);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [requests, total] = await Promise.all([
      PaymentRequest.find(query)
        .populate('studentId', 'name email batch level enrollmentDate')
        .populate('requestedBy', 'name')
        .sort(sort)
        .skip(skip)
        .limit(Number(limit)),
      PaymentRequest.countDocuments(query),
    ]);

    res.json({ success: true, data: requests, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Dashboard summary stats ───────────────────────────────────────────────
const getDashboardStats = async (req, res) => {
  try {
    const { filters, studentIds } = await getFilteredStudentIds(req.query);
    const agg = await aggregateHubDashboardStats(studentIds, {
      includeTestAccounts: filters.includeTestAccounts,
    });

    const pick = (bucket) => {
      const lkr = bucket.LKR || 0;
      const inr = bucket.INR || 0;
      const usd = bucket.USD || 0;
      if (filters.currency === 'LKR') return { lkr, inr: 0, usd: 0 };
      if (filters.currency === 'INR') return { lkr: 0, inr, usd: 0 };
      if (filters.currency === 'USD') return { lkr: 0, inr: 0, usd };
      return { lkr, inr, usd };
    };

    const received = pick(agg.received);
    const pending = pick(agg.pending);
    const overdue = pick(agg.overdue);
    const totalPayment = pick(agg.totalPaymentExpected);
    const totalDue = pick(agg.totalDue);
    const expectedMonth = pick(agg.expectedThisMonth || { LKR: 0, INR: 0, USD: 0 });

    const data = {
      totalPaymentExpectedLKR: totalPayment.lkr,
      totalPaymentExpectedINR: totalPayment.inr,
      totalPaymentExpectedUSD: totalPayment.usd,
      catalogPaymentBreakdown: agg.catalogPaymentBreakdown || [],
      totalReceivedLKR: received.lkr,
      totalReceivedINR: received.inr,
      totalReceivedUSD: received.usd,
      totalDueLKR: totalDue.lkr,
      totalDueINR: totalDue.inr,
      totalDueUSD: totalDue.usd,
      pendingApprovalAmountLKR: pending.lkr,
      pendingApprovalAmountINR: pending.inr,
      pendingApprovalAmountUSD: pending.usd,
      totalExpectedThisMonthLKR: expectedMonth.lkr,
      totalExpectedThisMonthINR: expectedMonth.inr,
      totalExpectedThisMonthUSD: expectedMonth.usd,
      totalOverdueLKR: overdue.lkr,
      totalOverdueINR: overdue.inr,
      totalOverdueUSD: overdue.usd,
      overdueCount: agg.overdueRequestCount,
      totalStudents: agg.totalStudents,
      fullyPaidStudents: agg.fullyPaidStudents,
      balanceStudents: agg.balanceStudents,
      overdueStudents: agg.overdueStudents,
      docsPaidStudents: agg.docsPaidStudents,
      visaPaidStudents: agg.visaPaidStudents,
      activeStudents: agg.activeStudents,
      filtered: hasActiveFilters(filters),
      filterSummary: filterSummaryLabel(filters),
    };

    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Student financial profile table (All Payments hub) ────────────────
// Lists every STUDENT from User, left-joins StudentPaymentProfile. Students
// without a profile still appear (zeros / NO_REQUESTS). Total count respects filters.
const getStudentTable = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      batch,
      level,
      languageFeeStatus: languageFeeStatusFilter,
      studentStatus,
      subscription,
      sort = 'name',
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const hubFilters = parseHubFilters(req.query);
    const userMatch = applyTestAccountFilter({ role: 'STUDENT' }, hubFilters);
    if (batch) userMatch.batch = batch;
    if (level) userMatch.level = level;
    if (studentStatus && String(studentStatus).trim()) {
      userMatch.studentStatus = String(studentStatus).trim();
    }
    if (subscription && String(subscription).trim()) {
      userMatch.subscription = String(subscription).trim();
    }
    if (search && String(search).trim()) {
      const q = String(search).trim();
      userMatch.$or = [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ];
    }
    if (req.query.dateFrom || req.query.dateTo) {
      userMatch.enrollmentDate = {};
      if (req.query.dateFrom) userMatch.enrollmentDate.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) userMatch.enrollmentDate.$lte = new Date(req.query.dateTo);
    }

    const studentInsight = String(hubFilters.studentInsight || '').trim().toLowerCase();
    let pipelineMatch = userMatch;
    if (studentInsight && VALID_STUDENT_INSIGHTS.includes(studentInsight)) {
      const candidates = await mongoose.model('User')
        .find(userMatch)
        .select('_id level currentCourseDay')
        .lean();
      const matched = await filterStudentsByInsight(candidates, studentInsight);
      const matchedIds = matched.map((s) => s._id);
      pipelineMatch = {
        _id: {
          $in: matchedIds.length
            ? matchedIds
            : [new mongoose.Types.ObjectId('000000000000000000000000')],
        },
      };
    }

    let sortStage = { name: 1 };
    if (sort === '-lastRebuiltAt' || sort === 'lastRebuiltAt') {
      sortStage = { sortDate: sort === '-lastRebuiltAt' ? -1 : 1 };
    } else if (sort === 'paid' || sort === '-paid') {
      sortStage = { totalPaidSort: sort === '-paid' ? -1 : 1 };
    } else if (sort === 'overdue' || sort === '-overdue') {
      sortStage = { overdueSort: sort === '-overdue' ? -1 : 1 };
    }

    const pipeline = [
      { $match: pipelineMatch },
      {
        $lookup: {
          from: 'studentpaymentprofiles',
          localField: '_id',
          foreignField: 'studentId',
          as: 'profileArr',
        },
      },
      { $addFields: { profile: { $arrayElemAt: ['$profileArr', 0] } } },
      {
        $lookup: {
          from: 'paymentrequests',
          let: { studentId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ['$studentId', '$$studentId'] },
                paymentType: 'LANGUAGE_FEE',
                isArchived: false,
                amountRemaining: { $gt: 0 },
                status: { $nin: ['REJECTED', 'FULLY_PAID'] },
              },
            },
            { $group: { _id: null, balance: { $sum: '$amountRemaining' } } },
          ],
          as: 'langFeeAgg',
        },
      },
      {
        $addFields: {
          effectiveStatus: { $ifNull: ['$profile.overallStatus', 'NO_REQUESTS'] },
          sortDate: { $ifNull: ['$profile.lastRebuiltAt', '$createdAt'] },
          totalPaidSort: { $ifNull: ['$profile.totalPaid', 0] },
          overdueSort: { $ifNull: ['$profile.overdueCount', 0] },
          languageFeeBalance: {
            $ifNull: [{ $arrayElemAt: ['$langFeeAgg.balance', 0] }, 0],
          },
          journeyDay: {
            $min: [
              200,
              {
                $max: [
                  1,
                  {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$currentCourseDay', null] },
                          { $gte: ['$currentCourseDay', 1] },
                        ],
                      },
                      { $floor: '$currentCourseDay' },
                      1,
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          languageFeeStatus: {
            $cond: {
              if: { $lte: ['$languageFeeBalance', 0] },
              then: 'FULL_PAID',
              else: {
                $cond: {
                  if: { $lt: ['$journeyDay', JOURNEY_DUE_FROM_DAY] },
                  then: 'BALANCE',
                  else: 'DUE',
                },
              },
            },
          },
        },
      },
    ];

    const feeStatus = String(languageFeeStatusFilter || '').trim().toUpperCase();
    if (feeStatus && ['FULL_PAID', 'BALANCE', 'DUE'].includes(feeStatus)) {
      pipeline.push({ $match: { languageFeeStatus: feeStatus } });
    }

    pipeline.push({ $sort: sortStage });
    pipeline.push({
      $facet: {
        total: [{ $count: 'count' }],
        rows: [
          { $skip: skip },
          { $limit: Number(limit) },
          {
            $project: {
              _id: '$_id',
              studentId: {
                _id: '$_id',
                name: '$name',
                email: '$email',
                batch: '$batch',
                level: '$level',
                phoneNumber: '$phoneNumber',
                currentCourseDay: '$currentCourseDay',
                enrollmentDate: '$enrollmentDate',
                dateJoined: '$enrollmentDate',
                registeredAt: '$registeredAt',
                createdAt: '$createdAt',
                isTestAccount: '$isTestAccount',
              },
              totalPaid: { $ifNull: ['$profile.totalPaid', 0] },
              ...mongoPaidFieldsFromProfile('$profile.currencyBreakdown'),
              ...mongoPendingFieldsFromProfile('$profile.currencyBreakdown'),
              ...mongoOverdueFieldsFromProfile('$profile.currencyBreakdown'),
              pendingApprovalAmount: { $ifNull: ['$profile.pendingApprovalAmount', 0] },
              overdueAmount: { $ifNull: ['$profile.overdueAmount', 0] },
              overallStatus: '$effectiveStatus',
              languageFeeBalance: 1,
              languageFeeStatus: 1,
              lastRebuiltAt: '$profile.lastRebuiltAt',
            },
          },
        ],
      },
    });

    const PaymentFlowSubmission = require('../models/PaymentSubmission');

    const [aggregateResult, catalog] = await Promise.all([
      mongoose.model('User').aggregate(pipeline),
      PaymentHubCatalog.getOrCreate(),
    ]);
    const [result] = aggregateResult;
    const total = result.total[0]?.count || 0;
    const rawRows = result.rows || [];

    const pageStudentIds = rawRows.map((row) => row._id).filter(Boolean);
    const [pageRequests, pageApprovedSubs, pagePendingSubs] = pageStudentIds.length
      ? await Promise.all([
          PaymentRequest.find({ studentId: { $in: pageStudentIds }, isArchived: false }).lean(),
          PaymentFlowSubmission.find({
            studentId: { $in: pageStudentIds },
            status: 'APPROVED',
            isArchived: false,
          }).lean(),
          PaymentFlowSubmission.find({
            studentId: { $in: pageStudentIds },
            status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
            isArchived: false,
          }).lean(),
        ])
      : [[], [], []];
    const requestsByStudent = groupDocsByStudentId(pageRequests);
    const approvedByStudent = groupDocsByStudentId(pageApprovedSubs);
    const pendingByStudent = groupDocsByStudentId(pagePendingSubs);
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

    const data = rawRows.map((row) => {
      const sid = String(row._id);
      const studentRequests = requestsByStudent[sid] || [];
      const studentLevel = row?.studentId?.level;
      const { live: allLive } = computeTotalsForAllPayments(
        studentRequests,
        approvedByStudent[sid] || [],
        pendingByStudent[sid] || [],
        studentLevel,
      );
      const { live, balanceDue, levelRequests } = computeTotalsForStudentLevel(
        studentRequests,
        approvedByStudent[sid] || [],
        pendingByStudent[sid] || [],
        studentLevel,
      );

      const inferredCurrency = inferCurrencyFromPhone(row?.studentId?.phoneNumber);
      const level = String(studentLevel || '').trim().toUpperCase();
      const levelPrice = levelPriceMap.get(level) || { LKR: 0, INR: 0, USD: 0 };
      const catalogGaps = {
        LKR: Math.max(0, (levelPrice.LKR || 0) - (Number(live.totalPaidLKR) || 0)),
        INR: Math.max(0, (levelPrice.INR || 0) - (Number(live.totalPaidINR) || 0)),
        USD: Math.max(0, (levelPrice.USD || 0) - (Number(live.totalPaidUSD) || 0)),
      };
      const catalogBalance = catalogGaps.LKR + catalogGaps.INR + catalogGaps.USD;
      const hasMappedPayments = levelRequests.some(
        (r) => !r.isArchived && r.status !== 'REJECTED',
      );
      const journeyDayRaw = Number(row?.studentId?.currentCourseDay);
      const journeyDay = Number.isFinite(journeyDayRaw)
        ? Math.min(200, Math.max(1, Math.floor(journeyDayRaw)))
        : 1;

      const effectiveBalance =
        balanceDue.total > 0
          ? balanceDue.total
          : !hasMappedPayments && catalogBalance > 0
            ? catalogBalance
            : 0;
      const pendingFields =
        balanceDue.total > 0
          ? {
              pendingApprovalAmount: balanceDue.total,
              pendingApprovalAmountLKR: balanceDue.pendingApprovalAmountLKR,
              pendingApprovalAmountINR: balanceDue.pendingApprovalAmountINR,
              pendingApprovalAmountUSD: balanceDue.pendingApprovalAmountUSD,
            }
          : !hasMappedPayments && catalogBalance > 0
            ? {
                pendingApprovalAmount: catalogBalance,
                pendingApprovalAmountLKR: catalogGaps.LKR,
                pendingApprovalAmountINR: catalogGaps.INR,
                pendingApprovalAmountUSD: catalogGaps.USD,
                overdueAmountLKR: 0,
                overdueAmountINR: 0,
                overdueAmountUSD: 0,
              }
            : {
                pendingApprovalAmount: 0,
                pendingApprovalAmountLKR: 0,
                pendingApprovalAmountINR: 0,
                pendingApprovalAmountUSD: 0,
              };

      const approvedForStudent = approvedByStudent[sid] || [];

      return {
        ...row,
        totalPaid: allLive.totalPaid,
        totalPaidLKR: allLive.totalPaidLKR,
        totalPaidINR: allLive.totalPaidINR,
        totalPaidUSD: allLive.totalPaidUSD,
        paidSlots: computePaidSlotBadges(studentRequests, approvedForStudent, studentLevel),
        ...pendingFields,
        overdueAmount: live.overdueAmount,
        overdueAmountLKR: live.overdueAmountLKR,
        overdueAmountINR: live.overdueAmountINR,
        overdueAmountUSD: live.overdueAmountUSD,
        overallStatus: live.overallStatus,
        inferredCurrency,
        languageFeeBalance: effectiveBalance,
        languageFeeStatus: computeLanguageFeeStatus(effectiveBalance, journeyDay),
      };
    });

    res.json({
      success: true,
      data,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Full student payment history (with submissions + timeline) ────────────
const getStudentPaymentHistory = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { page = 1, limit = 15 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    await paymentService.recalculateStudentProfile(studentId);

    const [allRequests, profile] = await Promise.all([
      PaymentRequest.find({ studentId, isArchived: false })
        .populate('requestedBy', 'name')
        .sort({ createdAt: -1 }),
      StudentPaymentProfile.findOne({ studentId }).populate('studentId', 'name email batch level enrollmentDate'),
    ]);
    const total = allRequests.length;

    const PaymentFlowSubmission = require('../models/PaymentSubmission');
    const allSubmissions = await PaymentFlowSubmission.find({ studentId, isArchived: false })
      .populate('approvedBy', 'name')
      .populate('reviewedBy', 'name')
      .lean();

    const submissionsMap = {};
    for (const sub of allSubmissions) {
      const key = String(sub.paymentRequestId);
      if (!submissionsMap[key]) submissionsMap[key] = [];
      submissionsMap[key].push(sub);
    }

    const attachSubmissions = (req) => ({
      ...(typeof req.toObject === 'function' ? req.toObject() : req),
      submissions: submissionsMap[String(req._id)] || [],
    });

    const slotRequests = allRequests.map(attachSubmissions);

    const combined = await Promise.all(
      allRequests.slice(skip, skip + Number(limit)).map(async (req) => {
        const base = attachSubmissions(req);
        const installments = await installmentService.getInstallmentsForRequest(req._id);
        return { ...base, installments };
      })
    );

    const studentDoc = await mongoose.model('User')
      .findById(studentId)
      .select('name email batch level enrollmentDate createdAt currentCourseDay studentStatus subscription regNo')
      .lean();

    const [allActiveRequests, allApprovedSubs, allPendingSubs, catalog] = await Promise.all([
      PaymentRequest.find({ studentId, isArchived: false })
        .select('currency amount amountRemaining status isArchived paymentType customType')
        .lean(),
      PaymentFlowSubmission.find({ studentId, status: 'APPROVED', isArchived: false })
        .select('paymentRequestId paidAmount')
        .lean(),
      PaymentFlowSubmission.find({
        studentId,
        status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
        isArchived: false,
      })
        .select('paymentRequestId paidAmount currency')
        .lean(),
      PaymentHubCatalog.getOrCreate(),
    ]);
    const levelPriceMap = buildLevelPriceMap(catalog);
    const pendingBucket = pendingTotalsForStudent(
      allActiveRequests,
      allApprovedSubs,
      allPendingSubs,
      studentDoc,
      levelPriceMap,
    );
    const languageFeeBalance = effectiveOutstandingBalance(
      allActiveRequests,
      allApprovedSubs,
      allPendingSubs,
      studentDoc,
      levelPriceMap,
    );
    const pendingTotal = (pendingBucket.LKR || 0) + (pendingBucket.INR || 0) + (pendingBucket.USD || 0);
    const journeyDay = studentDoc?.currentCourseDay;
    const languageFeeStatus = computeLanguageFeeStatus(languageFeeBalance, journeyDay);

    const enrichedProfile = enrichProfileCurrencyTotals(
      profile
        ? typeof profile.toObject === 'function'
          ? profile.toObject()
          : profile
        : null,
    );
    if (enrichedProfile) {
      enrichedProfile.languageFeeBalance = languageFeeBalance;
      enrichedProfile.languageFeeStatus = languageFeeStatus;
      enrichedProfile.pendingApprovalAmount = pendingTotal;
      enrichedProfile.pendingApprovalAmountLKR = pendingBucket.LKR;
      enrichedProfile.pendingApprovalAmountINR = pendingBucket.INR;
      enrichedProfile.pendingApprovalAmountUSD = pendingBucket.USD;
    }

    res.json({
      success: true,
      data: {
        student: studentDoc || profile?.studentId || null,
        profile: enrichedProfile,
        languageFeeBalance,
        languageFeeStatus,
        slotRequests,
        requests: combined,
        total,
        page: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Get timeline for a single payment request ────────────────────────────
const getRequestTimeline = async (req, res) => {
  try {
    const timeline = await timelineService.getTimelineForRequest(req.params.requestId);
    res.json({ success: true, data: timeline });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Add internal note ────────────────────────────────────────────────────
const addInternalNote = async (req, res) => {
  try {
    const { note, followUpDate, taggedAdmin } = req.body;
    const adminId = getAuthUserId(req);
    const adminName = await getAdminName(adminId);

    const result = await paymentService.addInternalNote({
      requestId: req.params.requestId,
      adminId,
      adminRole: req.user.role,
      adminName,
      note,
      followUpDate,
      taggedAdmin,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ─── Archive (soft delete) ────────────────────────────────────────────────
const archiveRequest = async (req, res) => {
  try {
    const result = await paymentService.archiveRequest({
      requestId: req.params.requestId,
      adminId: getAuthUserId(req),
      adminRole: req.user.role,
      reason: req.body.reason,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ─── Run overdue detection (admin trigger) ────────────────────────────────
const runOverdueDetection = async (req, res) => {
  try {
    const result = await paymentService.detectAndMarkOverdue();
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Monthly analytics ────────────────────────────────────────────────────
const getMonthlyAnalytics = async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;
    const PaymentFlowSubmission = require('../models/PaymentSubmission');

    const [monthly, statusDist, currencyDist, overdueByMonth] = await Promise.all([
      PaymentFlowSubmission.aggregate([
        { $match: { status: 'APPROVED', approvedAt: { $gte: new Date(`${year}-01-01`), $lte: new Date(`${year}-12-31`) } } },
        { $group: { _id: { month: { $month: '$approvedAt' }, currency: '$currency' }, total: { $sum: '$paidAmount' }, count: { $sum: 1 } } },
        { $sort: { '_id.month': 1 } },
      ]),
      PaymentRequest.aggregate([
        { $match: { isArchived: false } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      PaymentFlowSubmission.aggregate([
        { $match: { status: 'APPROVED' } },
        { $group: { _id: '$currency', total: { $sum: '$paidAmount' }, count: { $sum: 1 } } },
      ]),
      PaymentRequest.aggregate([
        { $match: { status: 'OVERDUE', isArchived: false } },
        { $group: { _id: { month: { $month: '$dueDate' } }, count: { $sum: 1 }, total: { $sum: '$amountRemaining' } } },
        { $sort: { '_id.month': 1 } },
      ]),
    ]);

    res.json({ success: true, data: { monthly, statusDist, currencyDist, overdueByMonth } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Student-facing: submit payment (multipart: screenshot + fields) ────
const studentSubmitPayment = async (req, res) => {
  try {
    const studentId = getAuthUserId(req);
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const paymentRequestId = req.body.paymentRequestId;
    const paidAmount = Number(req.body.paidAmount);
    const currency = req.body.currency;
    const transactionId = req.body.transactionId || undefined;
    const paymentMethod = req.body.paymentMethod || 'Bank Transfer';
    const installmentNumber = req.body.installmentNumber ? Number(req.body.installmentNumber) : undefined;
    const accountHolderName = String(req.body.accountHolderName || '').trim();
    const paymentDateTimeRaw = req.body.paymentDateTime;
    let paymentDateTime = null;
    if (paymentDateTimeRaw) {
      paymentDateTime = new Date(paymentDateTimeRaw);
      if (Number.isNaN(paymentDateTime.getTime())) {
        return res.status(400).json({ success: false, message: 'paymentDateTime is invalid' });
      }
    }

    if (!paymentRequestId) {
      return res.status(400).json({ success: false, message: 'paymentRequestId is required' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'screenshot file is required (field name: screenshot)' });
    }
    if (!paidAmount || paidAmount <= 0 || Number.isNaN(paidAmount)) {
      return res.status(400).json({ success: false, message: 'valid paidAmount is required' });
    }
    if (!['LKR', 'INR', 'USD'].includes(currency)) {
      return res.status(400).json({ success: false, message: 'currency must be LKR, INR, or USD' });
    }
    if (!accountHolderName || accountHolderName.length < 2) {
      return res.status(400).json({ success: false, message: 'accountHolderName is required' });
    }
    if (!paymentDateTime) {
      return res.status(400).json({ success: false, message: 'paymentDateTime is required' });
    }

    let screenshotKey;
    const screenshotOriginalName = req.file.originalname;
    const screenshotMimeType = req.file.mimetype;
    const screenshotSize = req.file.size;
    const path = require('path');

    if (proofR2.isPaymentR2Configured() && req.file.buffer) {
      // Multer memoryStorage — upload buffer to R2
      const ext = path.extname(screenshotOriginalName || '').slice(0, 10) || '.jpg';
      const r2Key = `payment-hub-v2/proofs/${studentId}/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      const { publicUrl } = await proofR2.putPaymentProof(req.file.buffer, r2Key, screenshotMimeType);
      screenshotKey = publicUrl || r2Key;
    } else {
      // Multer diskStorage fallback — store path relative to uploads root
      screenshotKey = `payment-hub-v2/${req.file.filename}`;
    }

    const submission = await paymentService.submitPayment({
      paymentRequestId,
      studentId,
      paidAmount,
      currency,
      transactionId,
      screenshotKey,
      screenshotOriginalName,
      screenshotMimeType,
      screenshotSize,
      paymentMethod,
      installmentNumber,
      paymentDateTime,
      accountHolderName,
    });

    res.status(201).json({ success: true, data: submission });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ─── Browse students for Send Request tab (User-primary aggregation) ─────
// Aggregates User (role=STUDENT) with optional StudentPaymentProfile lookup.
// Supports: search, batch, level, plan (→ User.subscription), page, limit.
// Uses $facet so total count always matches applied filters.
const browseStudents = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      batch,
      level,
      plan, // maps to User.subscription
      sort = 'name',
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    // Build the $match stage on User collection
    const userMatch = { role: 'STUDENT', isActive: true };
    if (search) {
      userMatch.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }
    if (batch) userMatch.batch = batch;
    if (level) userMatch.level = level;
    if (plan) userMatch.subscription = plan;

    const sortField = sort === '-name' ? { name: -1 } : sort === 'email' ? { email: 1 } : { name: 1 };

    const pipeline = [
      { $match: userMatch },
      {
        $lookup: {
          from: 'studentpaymentprofiles',
          localField: '_id',
          foreignField: 'studentId',
          as: 'profileArr',
        },
      },
      // Pick first profile doc (or null) — avoids $unwind + preserveNullAndEmptyArrays (older servers / typos)
      {
        $addFields: {
          profile: { $arrayElemAt: ['$profileArr', 0] },
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          batch: 1,
          level: 1,
          subscription: 1,
          enrollmentDate: 1,
          createdAt: 1,
          phoneNumber: 1,
          totalPaid: { $ifNull: ['$profile.totalPaid', 0] },
          ...mongoPaidFieldsFromProfile('$profile.currencyBreakdown'),
          ...mongoPendingFieldsFromProfile('$profile.currencyBreakdown'),
          ...mongoOverdueFieldsFromProfile('$profile.currencyBreakdown'),
          pendingApprovalAmount: { $ifNull: ['$profile.pendingApprovalAmount', 0] },
          overdueAmount: { $ifNull: ['$profile.overdueAmount', 0] },
          balanceDue: {
            $add: [
              { $ifNull: ['$profile.overdueAmount', 0] },
              { $ifNull: ['$profile.pendingApprovalAmount', 0] },
            ],
          },
          overallStatus: { $ifNull: ['$profile.overallStatus', 'NO_REQUESTS'] },
          lastPaymentDate: '$profile.lastPaymentDate',
        },
      },
      { $sort: sortField },
      {
        $facet: {
          total: [{ $count: 'count' }],
          rows: [{ $skip: skip }, { $limit: Number(limit) }],
        },
      },
    ];

    const [result] = await mongoose.model('User').aggregate(pipeline);
    const total = result.total[0]?.count || 0;

    // Attach inferred currency so the admin form can pre-select the right one
    const rows = (result.rows || []).map((row) => ({
      ...row,
      inferredCurrency: inferCurrencyFromPhone(row.phoneNumber),
    }));

    res.json({
      success: true,
      data: rows,
      total,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Student-facing: get own requests ────────────────────────────────────
const { buildStudentInstallmentView } = require('../services/installmentVisibility');

// ─── Admin: update installment amounts/dates (before proofs in progress) ───
const updateInstallmentSchedule = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { requestId } = req.params;
    const { installments: bodyRows } = req.body || {};
    if (!Array.isArray(bodyRows) || bodyRows.length === 0) {
      return res.status(400).json({ success: false, message: 'installments array is required' });
    }

    const paymentReq = await PaymentRequest.findById(requestId);
    if (!paymentReq || paymentReq.isArchived) {
      return res.status(404).json({ success: false, message: 'Payment request not found' });
    }
    if (!paymentReq.installmentAllowed) {
      return res.status(400).json({ success: false, message: 'This request is not an installment plan' });
    }

    const PaymentFlowSubmission = require('../models/PaymentSubmission');
    const obstructing = await PaymentFlowSubmission.countDocuments({
      paymentRequestId: paymentReq._id,
      isArchived: false,
      status: { $nin: ['REJECTED'] },
    });
    if (obstructing > 0) {
      return res.status(400).json({
        success: false,
        message:
          'You can only change instalments when there are no active payment proofs (submitted or approved). Reject or clear in-flight proofs first.',
      });
    }

    const existing = await PaymentInstallment.find({ paymentRequestId: paymentReq._id }).sort({ installmentNumber: 1 });
    if (existing.length !== bodyRows.length) {
      return res.status(400).json({
        success: false,
        message: `This plan has ${existing.length} instalment row(s); send the same count.`,
      });
    }

    const total = bodyRows.reduce((s, row) => s + Number(row.requestedAmount ?? row.amount ?? 0), 0);
    if (Math.abs(total - Number(paymentReq.amount)) > 0.02) {
      return res.status(400).json({
        success: false,
        message: `Instalment amounts must add up to ${paymentReq.amount} ${paymentReq.currency}`,
      });
    }

    for (const row of bodyRows) {
      const num = Number(row.installmentNumber);
      const inst = existing.find((e) => e.installmentNumber === num);
      if (!inst) {
        return res.status(400).json({ success: false, message: `Unknown instalment number ${num}` });
      }
      if (!['PENDING', 'REJECTED', 'OVERDUE'].includes(inst.status)) {
        return res.status(400).json({
          success: false,
          message: `Cannot edit instalment ${num} while it is in status ${inst.status}`,
        });
      }
      const reqAmt = Number(row.requestedAmount ?? row.amount);
      const due = row.dueDate ? new Date(row.dueDate) : null;
      if (!due || Number.isNaN(due.getTime())) {
        return res.status(400).json({ success: false, message: `Invalid due date for instalment ${num}` });
      }
      if (!reqAmt || reqAmt <= 0) {
        return res.status(400).json({ success: false, message: `Invalid amount for instalment ${num}` });
      }
      const paid = Number(inst.paidAmount) || 0;
      inst.requestedAmount = reqAmt;
      inst.dueDate = due;
      inst.remainingAmount = Math.max(0, reqAmt - paid);
      await inst.save();
    }

    const firstDue = await PaymentInstallment.findOne({ paymentRequestId: paymentReq._id }).sort({ installmentNumber: 1 });
    if (firstDue?.dueDate) {
      paymentReq.dueDate = firstDue.dueDate;
      await paymentReq.save();
    }

    await paymentService.recalculateStudentProfile(paymentReq.studentId);
    const updated = await installmentService.getInstallmentsForRequest(paymentReq._id);
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const studentGetOwnRequests = async (req, res) => {
  try {
    const studentId = getAuthUserId(req);
    if (!studentId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [requests, total] = await Promise.all([
      PaymentRequest.find({ studentId, isArchived: false })
        .populate('requestedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      PaymentRequest.countDocuments({ studentId, isArchived: false }),
    ]);

    const now = new Date();
    const enriched = await Promise.all(
      requests.map(async (r) => {
        const obj = r.toObject();
        if (r.installmentAllowed) {
          const installments = await installmentService.getInstallmentsForRequest(r._id);
          obj.installments = installments;
          obj.studentInstallmentView = buildStudentInstallmentView(installments, now);
        }
        return obj;
      })
    );

    res.json({ success: true, data: enriched, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function detectLevelFromPaymentRequest(req) {
  const hay = [req.customType, req.remarks, req.paymentType]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  for (const lv of CEFR_LEVELS) {
    if (new RegExp(`\\b${lv}\\b`).test(hay)) return lv;
  }
  return null;
}

// ─── Batch payment summary (aggregated — no per-student payload) ─────────────
const getBatchPaymentSummary = async (req, res) => {
  try {
    const { batch, level, studentStatus, cohort, subscription, batches } = req.query;
    const batchFilters = parseHubFilters(req.query);
    const batchList = String(batches || '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const data = await aggregateBatchPaymentInsights({
      batch: batch && String(batch).trim() ? String(batch).trim() : undefined,
      batches: batchList.length ? batchList : undefined,
      level: level && String(level).trim() ? String(level).trim() : undefined,
      studentStatus: studentStatus && String(studentStatus).trim() ? String(studentStatus).trim() : undefined,
      cohort: cohort && String(cohort).trim() ? String(cohort).trim() : undefined,
      subscription: subscription && String(subscription).trim() ? String(subscription).trim() : undefined,
      includeTestAccounts: batchFilters.includeTestAccounts,
    });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Batch students: payment breakdown for Payment Hub batch insights ───────
const getBatchStudentsPaymentDetail = async (req, res) => {
  try {
    const batchRaw = decodeURIComponent(String(req.params.batch || '').trim());
    if (!batchRaw) {
      return res.status(400).json({ success: false, message: 'Batch name is required' });
    }

    const batchFilters = parseHubFilters(req.query);
    const User = mongoose.model('User');
    const PaymentFlowSubmission = require('../models/PaymentSubmission');
    const batchRegex = new RegExp(`^${batchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

    const userQuery = applyTestAccountFilter({ role: 'STUDENT', batch: batchRegex }, batchFilters);
    if (batchFilters.studentStatus) {
      userQuery.studentStatus = batchFilters.studentStatus;
    }

    const [students, batchInsights] = await Promise.all([
      User.find(userQuery)
        .select('name email batch level phoneNumber enrollmentDate createdAt currentCourseDay batchStartedOn courseStartDates subscription studentStatus')
        .sort({ name: 1 })
        .lean(),
      aggregateBatchPaymentInsights({
        batch: batchRaw,
        studentStatus: batchFilters.studentStatus || undefined,
        includeTestAccounts: batchFilters.includeTestAccounts,
      }),
    ]);

    const batchSummary = (batchInsights.batches || []).find(
      (row) => String(row.batch || '').trim().toLowerCase() === batchRaw.toLowerCase(),
    ) || null;

    if (!students.length) {
      return res.json({
        success: true,
        data: {
          batch: batchRaw,
          students: [],
          batchSummary,
          insightCounts: {
            all: 0,
            paid_full: batchSummary?.fullyPaidStudents ?? 0,
            have_balance: batchSummary?.balanceStudents ?? 0,
            overdue: batchSummary?.overdueStudents ?? 0,
            paid_docs: batchSummary?.docsPaidStudents ?? 0,
            paid_visa: batchSummary?.visaPaidStudents ?? 0,
          },
        },
      });
    }

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
    // Per-student price map respects plan-specific rates (e.g. Silver = 30k LKR)
    const getPriceMapBatch = buildSubscriptionPriceMapLookup(catalog);

    const profileByStudent = {};
    for (const p of profiles) {
      profileByStudent[String(p.studentId)] = p;
    }

    const requestsByStudent = {};
    for (const r of requests) {
      const sid = String(r.studentId);
      if (!requestsByStudent[sid]) requestsByStudent[sid] = [];
      requestsByStudent[sid].push(r);
    }

    const requestById = {};
    for (const r of requests) {
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

    const rows = students.map((student) => {
      const sid = String(student._id);
      const levelPriceMap = getPriceMapBatch(student.subscription);
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
        if (pt === 'DOCS_PAYMENT') {
          addToCurrencyBucket(docsPaidByCurrency, ccy, paid);
          continue;
        }
        if (pt === 'VISA_PAYMENT') {
          addToCurrencyBucket(visaPaidByCurrency, ccy, paid);
          continue;
        }

        const lv =
          detectLevelFromPaymentRequest(req) ||
          (pt === 'LANGUAGE_FEE' ? String(student.level || '').toUpperCase().trim() : null);
        if (lv && levelPaid[lv] != null) {
          addToCurrencyBucket(levelPaid[lv], ccy, paid);
        } else {
          addToCurrencyBucket(otherPaidByCurrency, ccy, paid);
        }
      }

      const currentDay = student.currentCourseDay != null
        ? Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay))))
        : null;
      const studentPendingSubs = pendingByStudent[sid] || [];
      const overdueSince = overdueSinceForStudent(
        student,
        studentRequests,
        studentSubs,
        studentPendingSubs,
        levelPriceMap,
      );
      const { live: langLive } = computeTotalsForStudentLevel(
        studentRequests,
        studentSubs,
        studentPendingSubs,
        student.level,
      );
      const langPendingStudent = pendingTotalsForStudent(
        studentRequests,
        studentSubs,
        studentPendingSubs,
        student,
        levelPriceMap,
      );
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

      const insightFlags = Object.fromEntries(
        VALID_STUDENT_INSIGHTS.map((key) => [
          key,
          studentMatchesInsight(
            student,
            studentRequests,
            studentSubs,
            studentPendingSubs,
            levelPriceMap,
            key,
          ),
        ]),
      );

      return {
        studentId: sid,
        name: student.name,
        email: student.email,
        batch: student.batch,
        level: student.level || '—',
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
        openRequestCount: studentRequests.filter((r) => !['PAID', 'CANCELLED'].includes(String(r.status))).length,
        insightFlags,
      };
    });

    const insightCounts = {
      all: rows.length,
      paid_full: rows.filter((r) => r.insightFlags?.paid_full).length,
      have_balance: rows.filter((r) => r.insightFlags?.have_balance).length,
      overdue: rows.filter((r) => r.insightFlags?.overdue).length,
      paid_docs: rows.filter((r) => r.insightFlags?.paid_docs).length,
      paid_visa: rows.filter((r) => r.insightFlags?.paid_visa).length,
    };

    res.json({
      success: true,
      data: {
        batch: batchRaw,
        students: rows,
        batchSummary,
        insightCounts,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const correctStudentTotalPaid = async (req, res) => {
  try {
    const { currency, correctedTotalPaid, adminRemarks } = req.body;
    const target = Number(correctedTotalPaid);
    if (target < 0 || Number.isNaN(target)) {
      return res.status(400).json({ success: false, message: 'correctedTotalPaid must be a non-negative number' });
    }
    if (!adminRemarks?.trim()) {
      return res.status(400).json({ success: false, message: 'adminRemarks (reason) is required' });
    }
    const adminId = getAuthUserId(req);
    const result = await paymentService.correctStudentTotalPaid({
      studentId: req.params.studentId,
      currency,
      correctedTotalPaid: target,
      adminId,
      adminRole: req.user.role,
      adminRemarks,
    });
    res.json({
      success: true,
      data: result,
      message: result.changed
        ? `Total received updated to ${target} ${currency || 'LKR'}.`
        : 'No change — total already matches.',
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

const bulkResetStudentPayments = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { studentIds, reason } = req.body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ success: false, message: 'studentIds array is required' });
    }

    for (let i = 0; i < studentIds.length; i++) {
      if (!studentIds[i] || !mongoose.isValidObjectId(studentIds[i])) {
        return res.status(400).json({ success: false, message: `studentIds[${i}] is invalid` });
      }
    }

    const result = await paymentService.bulkResetStudentPayments({
      studentIds,
      adminId,
      adminRole: req.user.role,
      reason,
    });

    return res.json({
      success: true,
      message: `Reset payment data for ${result.studentsProcessed} student(s). Total received, pending, and overdue are now 0.`,
      data: result,
    });
  } catch (e) {
    console.error('[BulkReset]', e);
    return res.status(400).json({ success: false, message: e.message || 'Bulk reset failed' });
  }
};

// ─── Finance dashboard: cohort-level student payment detail ──────────────────
const VISA_DOC_SUBSCRIPTIONS_FD = ['VISA_DOC', 'VISA_DOC_ONLY', 'DOCS_RECOGNITION'];

const getCohortStudentsPaymentDetail = async (req, res) => {
  try {
    const cohort = String(req.query.cohort || 'all').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toUpperCase();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(300, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const search = String(req.query.search || '').trim();
    const insight = String(req.query.insight || '').trim().toLowerCase();
    const selectedLevels = String(req.query.levels || '')
      .split(',')
      .map((level) => level.trim())
      .filter(Boolean);
    const selectedBatches = String(req.query.batches || '')
      .split(',')
      .map((batch) => batch.trim())
      .filter(Boolean);
    const selectedStudentStatuses = String(req.query.studentStatuses || '')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);

    const User = mongoose.model('User');
    const PaymentFlowSubmission = require('../models/PaymentSubmission');

    const userQuery = { role: 'STUDENT', isTestAccount: { $ne: true } };

    if (cohort === 'platinum') {
      userQuery.subscription = 'PLATINUM';
    } else if (cohort === 'silver') {
      userQuery.subscription = 'SILVER';
    } else if (cohort === 'visa_docs' || cohort === 'visa-docs') {
      userQuery.subscription = { $in: VISA_DOC_SUBSCRIPTIONS_FD };
    } else if (cohort === 'docs_payment' || cohort === 'docs-payment') {
      const docsStudentIds = await getDocsPaymentStudentIds(
        User,
        PaymentRequest,
        PaymentFlowSubmission,
      );
      if (!docsStudentIds.length) {
        return res.json({
          success: true,
          data: {
            students: [],
            cohort,
            status,
            totalStudents: 0,
            page: 1,
            limit,
            totalPages: 1,
            levelOptions: [],
            batchOptions: [],
            statusOptions: [],
            insightCounts: { all: 0, paid_full: 0, have_balance: 0, overdue: 0 },
            levelSummaries: [],
            totalPaidLKR: 0,
            totalPaidINR: 0,
            totalPaidUSD: 0,
            totalPendingLKR: 0,
            totalPendingINR: 0,
            totalPendingUSD: 0,
          },
        });
      }
      userQuery._id = { $in: docsStudentIds };
    }

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(escaped, 'i');
      userQuery.$or = [{ name: rx }, { email: rx }, { batch: rx }];
    }

    const levelOptionsQuery = { ...userQuery };
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

    const batchOptionsRaw = await User.aggregate([
      { $match: levelOptionsQuery },
      {
        $group: {
          _id: {
            $cond: [
              { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ['$batch', ''] } } } }, 0] },
              { $trim: { input: '$batch' } },
              'Unassigned',
            ],
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { total: -1, _id: 1 } },
    ]);
    const batchOptions = batchOptionsRaw.map((row) => ({
      value: row._id === 'Unassigned' ? '__EMPTY__' : row._id,
      label: row._id,
      total: row.total,
    }));

    const statusOptionsRaw = await User.aggregate([
      { $match: levelOptionsQuery },
      {
        $group: {
          _id: {
            $toUpper: { $trim: { input: { $ifNull: ['$studentStatus', 'UNCERTAIN'] } } },
          },
          total: { $sum: 1 },
        },
      },
      { $sort: { total: -1, _id: 1 } },
    ]);
    const statusOptions = statusOptionsRaw.map((row) => ({
      value: row._id,
      label: row._id,
      total: row.total,
    }));

    if (selectedBatches.length) {
      const exactBatches = selectedBatches.filter((batch) => batch !== '__EMPTY__');
      const includeEmptyBatch = selectedBatches.includes('__EMPTY__');
      if (includeEmptyBatch && exactBatches.length) {
        userQuery.$and = [
          ...(userQuery.$and || []),
          {
            $or: [
              { batch: { $in: exactBatches } },
              { batch: { $exists: false } },
              { batch: null },
              { batch: '' },
            ],
          },
        ];
      } else if (includeEmptyBatch) {
        userQuery.$and = [
          ...(userQuery.$and || []),
          { $or: [{ batch: { $exists: false } }, { batch: null }, { batch: '' }] },
        ];
      } else {
        userQuery.batch = { $in: exactBatches };
      }
    }

    if (selectedStudentStatuses.length) {
      const statuses = status
        ? selectedStudentStatuses.filter((value) => value === status)
        : selectedStudentStatuses;
      if (!statuses.length) {
        userQuery._id = { $in: [] };
      } else {
        userQuery.studentStatus = statuses.length === 1 ? statuses[0] : { $in: statuses };
      }
    } else if (status) {
      userQuery.studentStatus = status;
    }

    if (selectedLevels.length) {
      const exactLevels = selectedLevels.filter((level) => level !== '__EMPTY__');
      const includeEmpty = selectedLevels.includes('__EMPTY__');
      if (includeEmpty && exactLevels.length) {
        userQuery.$and = [
          ...(userQuery.$and || []),
          {
            $or: [
              { level: { $in: exactLevels } },
              { level: { $exists: false } },
              { level: null },
              { level: '' },
            ],
          },
        ];
      } else if (includeEmpty) {
        userQuery.$and = [
          ...(userQuery.$and || []),
          { $or: [{ level: { $exists: false } }, { level: null }, { level: '' }] },
        ];
      } else {
        userQuery.level = { $in: exactLevels };
      }
    }

    const students = await User.find(levelOptionsQuery)
      .select('name email batch level phoneNumber enrollmentDate createdAt currentCourseDay batchStartedOn courseStartDates studentStatus subscription')
      .sort({ name: 1 })
      .lean();

    const emptyTotals = {
      students: [],
      cohort,
      status,
      totalStudents: 0,
      page: 1,
      limit,
      totalPages: 1,
      totalPaidLKR: 0,
      totalPaidINR: 0,
      totalPaidUSD: 0,
      totalPendingLKR: 0,
      totalPendingINR: 0,
      totalPendingUSD: 0,
      levelOptions,
      batchOptions,
      statusOptions,
      insightCounts: { all: 0, paid_full: 0, have_balance: 0, overdue: 0 },
      levelSummaries: [],
    };
    if (!students.length) {
      return res.json({ success: true, data: emptyTotals });
    }

    const studentIds = students.map((s) => s._id);
    const [catalog, profiles, requests, submissions, pendingSubmissions] = await Promise.all([
      PaymentHubCatalog.getOrCreate(),
      StudentPaymentProfile.find({ studentId: { $in: studentIds } }).lean(),
      PaymentRequest.find({ studentId: { $in: studentIds }, isArchived: false }).lean(),
      PaymentFlowSubmission.find({ studentId: { $in: studentIds }, status: 'APPROVED', isArchived: false })
        .select('studentId paymentRequestId paidAmount currency status submittedAt approvedAt paymentDate')
        .lean(),
      PaymentFlowSubmission.find({ studentId: { $in: studentIds }, status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] }, isArchived: false })
        .select('studentId paymentRequestId paidAmount currency status submittedAt approvedAt paymentDate')
        .lean(),
    ]);
    // Build a per-subscription price map lookup so Silver students use 30k LKR / 1180 INR
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

    const rows = students.map((student) => {
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
        if (!req) { addToCurrencyBucket(otherPaidByCurrency, ccy, paid); continue; }
        const pt = String(req.paymentType || '').toUpperCase();
        if (pt === 'DOCS_PAYMENT') { addToCurrencyBucket(docsPaidByCurrency, ccy, paid); continue; }
        if (pt === 'VISA_PAYMENT') { addToCurrencyBucket(visaPaidByCurrency, ccy, paid); continue; }
        const lv = detectLevelFromPaymentRequest(req) || (pt === 'LANGUAGE_FEE' ? String(student.level || '').toUpperCase().trim() : null);
        if (lv && levelPaid[lv] != null) {
          addToCurrencyBucket(levelPaid[lv], ccy, paid);
        } else {
          addToCurrencyBucket(otherPaidByCurrency, ccy, paid);
        }
      }

      const currentDay = student.currentCourseDay != null ? Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay)))) : null;
      const studentPendingSubs = pendingByStudent[sid] || [];
      const overdueSince = overdueSinceForStudent(student, studentRequests, studentSubs, studentPendingSubs, levelPriceMap);
      const { live: langLive } = computeTotalsForStudentLevel(studentRequests, studentSubs, studentPendingSubs, student.level);
      const langPendingStudent = pendingTotalsForStudent(studentRequests, studentSubs, studentPendingSubs, student, levelPriceMap);
      const langOverdueStudent = applyJourneyOverdueAmounts(student, langPendingStudent, {
        LKR: langLive.overdueAmountLKR || 0,
        INR: langLive.overdueAmountINR || 0,
        USD: langLive.overdueAmountUSD || 0,
      });
      const { levelSlots, allLanguageFees } = buildStudentLevelSlotTotals(student, studentRequests, studentSubs, studentPendingSubs, levelPriceMap);
      const docsSlot = computeTotalsForLevelSlot(studentRequests, studentSubs, studentPendingSubs, 'DOCS', student.level);
      const docsLive = docsSlot.live || {};
      const docsBalance = docsSlot.balanceDue || {};
      const docsRequests = filterRequestsForSlot(studentRequests, 'DOCS', student.level);
      const docsQuotedByCurrency = emptyCurrencyBucket();
      for (const req of docsRequests) {
        addToCurrencyBucket(docsQuotedByCurrency, req.currency, Math.max(0, Number(req.amount) || 0));
      }
      const docsExpectedLKR = Math.max(
        docsQuotedByCurrency.LKR || 0,
        (docsPaidByCurrency.LKR || 0) + (docsBalance.pendingApprovalAmountLKR || 0) + (docsLive.overdueAmountLKR || 0),
      );
      const docsExpectedINR = Math.max(
        docsQuotedByCurrency.INR || 0,
        (docsPaidByCurrency.INR || 0) + (docsBalance.pendingApprovalAmountINR || 0) + (docsLive.overdueAmountINR || 0),
      );
      const docsExpectedUSD = Math.max(
        docsQuotedByCurrency.USD || 0,
        (docsPaidByCurrency.USD || 0) + (docsBalance.pendingApprovalAmountUSD || 0) + (docsLive.overdueAmountUSD || 0),
      );

      return {
        studentId: sid,
        name: student.name,
        email: student.email,
        batch: student.batch,
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
        docsPaidLKR: docsPaidByCurrency.LKR || 0,
        docsPaidINR: docsPaidByCurrency.INR || 0,
        docsPaidUSD: docsPaidByCurrency.USD || 0,
        docsPendingLKR: docsLive.pendingApprovalAmountLKR || 0,
        docsPendingINR: docsLive.pendingApprovalAmountINR || 0,
        docsPendingUSD: docsLive.pendingApprovalAmountUSD || 0,
        docsOverdueLKR: docsLive.overdueAmountLKR || 0,
        docsOverdueINR: docsLive.overdueAmountINR || 0,
        docsOverdueUSD: docsLive.overdueAmountUSD || 0,
        docsBalanceLKR: docsBalance.pendingApprovalAmountLKR || 0,
        docsBalanceINR: docsBalance.pendingApprovalAmountINR || 0,
        docsBalanceUSD: docsBalance.pendingApprovalAmountUSD || 0,
        docsExpectedLKR,
        docsExpectedINR,
        docsExpectedUSD,
        docsPaidFull: isSlotSettledPaid(studentRequests, studentSubs, 'DOCS', student.level),
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
        openRequestCount: studentRequests.filter((r) => !['PAID', 'CANCELLED'].includes(String(r.status))).length,
      };
    });

    const isDocsCohort = cohort === 'docs_payment' || cohort === 'docs-payment';
    const docsPaidTotalForRow = (r) => (r.docsPaidLKR || 0) + (r.docsPaidINR || 0) + (r.docsPaidUSD || 0);
    const docsRemainingTotalForRow = (r) =>
      (r.docsBalanceLKR || 0) + (r.docsBalanceINR || 0) + (r.docsBalanceUSD || 0)
      + (r.docsOverdueLKR || 0) + (r.docsOverdueINR || 0) + (r.docsOverdueUSD || 0);
    const docsOverdueTotalForRow = (r) => (r.docsOverdueLKR || 0) + (r.docsOverdueINR || 0) + (r.docsOverdueUSD || 0);
    const pendingTotalForRow = (r) => isDocsCohort
      ? (r.docsBalanceLKR || 0) + (r.docsBalanceINR || 0) + (r.docsBalanceUSD || 0)
      : (r.langPendingLKR || 0) + (r.langPendingINR || 0) + (r.langPendingUSD || 0);
    const overdueTotalForRow = (r) => isDocsCohort
      ? docsOverdueTotalForRow(r)
      : (r.langOverdueLKR || 0) + (r.langOverdueINR || 0) + (r.langOverdueUSD || 0);
    const remainingTotalForRow = (r) => pendingTotalForRow(r) + overdueTotalForRow(r);
    const rowCurrentLevelSlot = (r) => r.levelSlots?.[String(r.level || '').toUpperCase().trim()] || null;
    const rowCurrentLevelIsPaidFull = (r) => {
      const slot = rowCurrentLevelSlot(r);
      const remaining = remainingTotalForRow(r);
      if (!slot) {
        return remaining <= 0 && ((r.langPaidLKR || 0) + (r.langPaidINR || 0) + (r.langPaidUSD || 0)) > 0;
      }
      const expectedLKR = slot.expectedLKR || 0;
      const expectedINR = slot.expectedINR || 0;
      const expectedUSD = slot.expectedUSD || 0;
      const hasExpected = expectedLKR > 0 || expectedINR > 0 || expectedUSD > 0;
      if (!hasExpected) {
        return remaining <= 0 && ((slot.receivedLKR || 0) + (slot.receivedINR || 0) + (slot.receivedUSD || 0)) > 0;
      }
      return (
        remaining <= 0 &&
        (expectedLKR <= 0 || (slot.receivedLKR || 0) >= expectedLKR) &&
        (expectedINR <= 0 || (slot.receivedINR || 0) >= expectedINR) &&
        (expectedUSD <= 0 || (slot.receivedUSD || 0) >= expectedUSD)
      );
    };
    const rowMatchesInsight = (r, key) => {
      if (!key) return true;
      if (isDocsCohort) {
        const remaining = docsRemainingTotalForRow(r);
        const overdue = docsOverdueTotalForRow(r);
        switch (key) {
          case 'paid_full':
            return isDocsFullPaidByReceived(r);
          case 'have_balance':
            return !isDocsFullPaidByReceived(r);
          case 'overdue':
            return docsOverdueTotalForRow(r) > 0;
          default:
            return true;
        }
      }
      const pending = pendingTotalForRow(r);
      const overdue = overdueTotalForRow(r);
      const remaining = pending + overdue;
      const status = String(r.overallStatus || '').toUpperCase();
      switch (key) {
        case 'paid_full':
          return rowCurrentLevelIsPaidFull(r);
        case 'have_balance':
          return remaining > 0 || ['BALANCE', 'DUE', 'OVERDUE'].includes(status);
        case 'overdue':
          return overdue > 0 || status === 'OVERDUE';
        default:
          return true;
      }
    };
    const rowMatchesSelectedBatch = (r) => {
      if (!selectedBatches.length) return true;
      const exactBatches = selectedBatches.filter((batch) => batch !== '__EMPTY__');
      const includeEmpty = selectedBatches.includes('__EMPTY__');
      const rowBatch = String(r.batch || '').trim();
      return exactBatches.includes(rowBatch) || (includeEmpty && !rowBatch);
    };
    const rowMatchesSelectedStudentStatus = (r) => {
      if (!selectedStudentStatuses.length) return true;
      const rowStatus = String(r.studentStatus || 'UNCERTAIN').trim().toUpperCase();
      return selectedStudentStatuses.includes(rowStatus);
    };
    const rowMatchesSelectedLevel = (r) => {
      if (!selectedLevels.length) return true;
      const exactLevels = selectedLevels.filter((level) => level !== '__EMPTY__');
      const includeEmpty = selectedLevels.includes('__EMPTY__');
      const rowLevel = String(r.level || '').trim();
      return exactLevels.includes(rowLevel) || (includeEmpty && (!rowLevel || rowLevel === '—'));
    };
    const levelSummaries = isDocsCohort ? [] : levelOptions.map((opt) => {
      const levelRows = rows.filter((r) => {
        const rowLevel = String(r.level || '').trim();
        return opt.value === '__EMPTY__' ? (!rowLevel || rowLevel === '—') : rowLevel === opt.value;
      });
      return levelRows.reduce((acc, r) => {
        const remainingLKR = (r.langPendingLKR || 0) + (r.langOverdueLKR || 0);
        const remainingINR = (r.langPendingINR || 0) + (r.langOverdueINR || 0);
        const remainingUSD = (r.langPendingUSD || 0) + (r.langOverdueUSD || 0);
        acc.totalStudents += 1;
        acc.receivedLKR += r.langPaidLKR || 0;
        acc.receivedINR += r.langPaidINR || 0;
        acc.receivedUSD += r.langPaidUSD || 0;
        acc.remainingLKR += remainingLKR;
        acc.remainingINR += remainingINR;
        acc.remainingUSD += remainingUSD;
        if (remainingLKR + remainingINR + remainingUSD > 0) acc.remainingStudents += 1;
        return acc;
      }, {
        level: opt.value,
        label: opt.label,
        totalStudents: 0,
        receivedLKR: 0,
        receivedINR: 0,
        receivedUSD: 0,
        remainingLKR: 0,
        remainingINR: 0,
        remainingUSD: 0,
        remainingStudents: 0,
      });
    }).filter((row) => row.totalStudents > 0);

    const tableFilteredRows = rows
      .filter(rowMatchesSelectedLevel)
      .filter(rowMatchesSelectedBatch)
      .filter(rowMatchesSelectedStudentStatus);
    const insightCounts = {
      all: tableFilteredRows.length,
      paid_full: tableFilteredRows.filter((r) => rowMatchesInsight(r, 'paid_full')).length,
      have_balance: tableFilteredRows.filter((r) => rowMatchesInsight(r, 'have_balance')).length,
      overdue: tableFilteredRows.filter((r) => rowMatchesInsight(r, 'overdue')).length,
    };

    const addMoney = (a, b) => ({ lkr: a.lkr + b.lkr, inr: a.inr + b.inr, usd: a.usd + b.usd });
    const emptyMoney = () => ({ lkr: 0, inr: 0, usd: 0 });
    const rowDocsAmounts = (r) => {
      const received = { lkr: r.docsPaidLKR || 0, inr: r.docsPaidINR || 0, usd: r.docsPaidUSD || 0 };
      const pending = {
        lkr: (r.docsBalanceLKR || 0) + (r.docsPendingLKR || 0) + (r.docsOverdueLKR || 0),
        inr: (r.docsBalanceINR || 0) + (r.docsPendingINR || 0) + (r.docsOverdueINR || 0),
        usd: (r.docsBalanceUSD || 0) + (r.docsPendingUSD || 0) + (r.docsOverdueUSD || 0),
      };
      const overdue = { lkr: r.docsOverdueLKR || 0, inr: r.docsOverdueINR || 0, usd: r.docsOverdueUSD || 0 };
      const expected = docsFullQuotationForRow(r);
      return { expected, received, pending, overdue };
    };
    const sumDocsInsightAmounts = (key, sourceRows) => {
      const matched = key === 'all' ? sourceRows : sourceRows.filter((r) => rowMatchesInsight(r, key));
      return matched.reduce((acc, r) => {
        const { expected, received, pending, overdue } = rowDocsAmounts(r);
        if (key === 'overdue') {
          return {
            expected: addMoney(acc.expected, expected),
            received: addMoney(acc.received, received),
            pending: addMoney(acc.pending, pending),
            overdue: addMoney(acc.overdue, overdue),
          };
        }
        return {
          expected: addMoney(acc.expected, expected),
          received: addMoney(acc.received, received),
          pending: addMoney(acc.pending, pending),
        };
      }, key === 'overdue'
        ? { expected: emptyMoney(), received: emptyMoney(), pending: emptyMoney(), overdue: emptyMoney() }
        : { expected: emptyMoney(), received: emptyMoney(), pending: emptyMoney() });
    };
    const insightAmounts = isDocsCohort ? {
      all: sumDocsInsightAmounts('all', tableFilteredRows),
      paid_full: sumDocsInsightAmounts('paid_full', tableFilteredRows),
      have_balance: sumDocsInsightAmounts('have_balance', tableFilteredRows),
      overdue: sumDocsInsightAmounts('overdue', tableFilteredRows),
    } : undefined;

    const filteredRows = tableFilteredRows.filter((r) => rowMatchesInsight(r, insight));
    const totalStudents = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(totalStudents / limit));
    const safePage = Math.min(page, totalPages);
    const pageRows = filteredRows.slice((safePage - 1) * limit, safePage * limit);

    let totalPaidLKR = 0, totalPaidINR = 0, totalPaidUSD = 0;
    let totalPendingLKR = 0, totalPendingINR = 0, totalPendingUSD = 0;
    let totalExpectedLKR = 0, totalExpectedINR = 0, totalExpectedUSD = 0;
    for (const r of filteredRows) {
      if (isDocsCohort) {
        const docsAmounts = rowDocsAmounts(r);
        totalPaidLKR += docsAmounts.received.lkr;
        totalPaidINR += docsAmounts.received.inr;
        totalPaidUSD += docsAmounts.received.usd;
        totalPendingLKR += docsAmounts.pending.lkr;
        totalPendingINR += docsAmounts.pending.inr;
        totalPendingUSD += docsAmounts.pending.usd;
        totalExpectedLKR += docsAmounts.expected.lkr;
        totalExpectedINR += docsAmounts.expected.inr;
        totalExpectedUSD += docsAmounts.expected.usd;
      } else {
        totalPaidLKR += r.totalPaidLKR || 0;
        totalPaidINR += r.totalPaidINR || 0;
        totalPaidUSD += r.totalPaidUSD || 0;
        totalPendingLKR += (r.langPendingLKR || 0) + (r.langOverdueLKR || 0);
        totalPendingINR += (r.langPendingINR || 0) + (r.langOverdueINR || 0);
        totalPendingUSD += (r.langPendingUSD || 0) + (r.langOverdueUSD || 0);
      }
    }

    res.json({
      success: true,
      data: {
        students: pageRows,
        cohort,
        status,
        totalStudents,
        page: safePage,
        limit,
        totalPages,
        totalPaidLKR,
        totalPaidINR,
        totalPaidUSD,
        totalPendingLKR,
        totalPendingINR,
        totalPendingUSD,
        totalExpectedLKR: isDocsCohort ? totalExpectedLKR : undefined,
        totalExpectedINR: isDocsCohort ? totalExpectedINR : undefined,
        totalExpectedUSD: isDocsCohort ? totalExpectedUSD : undefined,
        levelOptions,
        batchOptions,
        statusOptions,
        insightCounts,
        insightAmounts,
        levelSummaries,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const getDocsPaymentOverview = async (req, res) => {
  try {
    const User = mongoose.model('User');
    const PaymentFlowSubmission = require('../models/PaymentSubmission');
    const data = await buildDocsPaymentOverview(User, PaymentRequest, PaymentFlowSubmission);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  createRequests,
  getAllRequests,
  getDashboardStats,
  getStudentTable,
  browseStudents,
  getBatchPaymentSummary,
  getBatchStudentsPaymentDetail,
  getCohortStudentsPaymentDetail,
  getDocsPaymentOverview,
  getStudentPaymentHistory,
  getRequestTimeline,
  addInternalNote,
  archiveRequest,
  runOverdueDetection,
  getMonthlyAnalytics,
  studentSubmitPayment,
  studentGetOwnRequests,
  updateInstallmentSchedule,
  correctStudentTotalPaid,
  bulkResetStudentPayments,
};
