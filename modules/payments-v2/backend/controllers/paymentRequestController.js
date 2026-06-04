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
  computeLiveTotalsFromData,
  groupDocsByStudentId,
  mongoPaidFieldsFromProfile,
  mongoPendingFieldsFromProfile,
  mongoOverdueFieldsFromProfile,
  emptyCurrencyBucket,
  addToCurrencyBucket,
  computeBalanceDueFromRequests,
} = require('../utils/currencyBreakdownHelper');
const { JOURNEY_DUE_FROM_DAY, computeLanguageFeeStatus } = require('../helpers/languageFeeStatus');
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
    const raw = await paymentService.getPaymentDashboardStats();

    // Pull per-currency totals from nested structure
    const g = (map, cur) => (map && map[cur] && map[cur].total) || 0;

    // Student counts: total from User; payment-state from profiles where they exist
    const User = mongoose.model('User');
    const [totalStudents, fullyPaidStudents, activeStudents] = await Promise.all([
      User.countDocuments({ role: 'STUDENT' }),
      StudentPaymentProfile.countDocuments({ overallStatus: 'CLEAR' }),
      StudentPaymentProfile.countDocuments({
        overallStatus: { $in: ['REQUESTED', 'PENDING_REVIEW', 'OVERDUE'] },
      }),
    ]);

    const data = {
      // Total received (all time)
      totalReceivedLKR: g(raw.totalReceived?.overall, 'LKR'),
      totalReceivedINR: g(raw.totalReceived?.overall, 'INR'),
      totalReceivedUSD: g(raw.totalReceived?.overall, 'USD'),
      // Pending approval (submitted but not yet approved)
      pendingApprovalAmountLKR: g(raw.pendingApproval?.byCurrency, 'LKR'),
      pendingApprovalAmountINR: g(raw.pendingApproval?.byCurrency, 'INR'),
      pendingApprovalAmountUSD: g(raw.pendingApproval?.byCurrency, 'USD'),
      // Expected this month (due but not yet paid)
      totalExpectedThisMonthLKR: g(raw.expectedThisMonth, 'LKR'),
      totalExpectedThisMonthINR: g(raw.expectedThisMonth, 'INR'),
      totalExpectedThisMonthUSD: g(raw.expectedThisMonth, 'USD'),
      // Overdue
      totalOverdueLKR: g(raw.overdue?.byCurrency, 'LKR'),
      totalOverdueINR: g(raw.overdue?.byCurrency, 'INR'),
      totalOverdueUSD: g(raw.overdue?.byCurrency, 'USD'),
      overdueCount: raw.overdue?.studentCount || 0,
      // Student summary
      totalStudents,
      fullyPaidStudents,
      activeStudents,
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

    const userMatch = { role: 'STUDENT' };
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

    let sortStage = { name: 1 };
    if (sort === '-lastRebuiltAt' || sort === 'lastRebuiltAt') {
      sortStage = { sortDate: sort === '-lastRebuiltAt' ? -1 : 1 };
    } else if (sort === 'paid' || sort === '-paid') {
      sortStage = { totalPaidSort: sort === '-paid' ? -1 : 1 };
    } else if (sort === 'overdue' || sort === '-overdue') {
      sortStage = { overdueSort: sort === '-overdue' ? -1 : 1 };
    }

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

    const amountForCurrency = (currency, row) => {
      if (currency === 'INR') return Number(row?.totalPaidINR) || 0;
      if (currency === 'LKR') return Number(row?.totalPaidLKR) || 0;
      return Number(row?.totalPaidUSD) || 0;
    };

    const currencyFieldsForBalance = (currency, amount) => {
      const balance = Math.max(0, Number(amount) || 0);
      return {
        pendingApprovalAmountLKR: currency === 'LKR' ? balance : 0,
        pendingApprovalAmountINR: currency === 'INR' ? balance : 0,
        pendingApprovalAmountUSD: currency === 'USD' ? balance : 0,
        overdueAmountLKR: 0,
        overdueAmountINR: 0,
        overdueAmountUSD: 0,
      };
    };

    const data = rawRows.map((row) => {
      const sid = String(row._id);
      const studentRequests = requestsByStudent[sid] || [];
      const live = computeLiveTotalsFromData(
        studentRequests,
        approvedByStudent[sid] || [],
        pendingByStudent[sid] || [],
      );

      const balanceDue = computeBalanceDueFromRequests(
        studentRequests,
        approvedByStudent[sid] || [],
      );

      const inferredCurrency = inferCurrencyFromPhone(row?.studentId?.phoneNumber);
      const level = String(row?.studentId?.level || '').trim().toUpperCase();
      const levelPrice = levelPriceMap.get(level) || { LKR: 0, INR: 0, USD: 0 };
      const targetFee = Number(levelPrice[inferredCurrency] || 0);
      const paidForTargetCurrency = amountForCurrency(inferredCurrency, live);
      const catalogGaps = {
        LKR: Math.max(0, (levelPrice.LKR || 0) - (Number(live.totalPaidLKR) || 0)),
        INR: Math.max(0, (levelPrice.INR || 0) - (Number(live.totalPaidINR) || 0)),
        USD: Math.max(0, (levelPrice.USD || 0) - (Number(live.totalPaidUSD) || 0)),
      };
      const catalogBalance = catalogGaps.LKR + catalogGaps.INR + catalogGaps.USD;
      const hasMappedPayments = studentRequests.some(
        (r) => !r.isArchived && r.status !== 'REJECTED',
      );
      const journeyDayRaw = Number(row?.studentId?.currentCourseDay);
      const journeyDay = Number.isFinite(journeyDayRaw)
        ? Math.min(200, Math.max(1, Math.floor(journeyDayRaw)))
        : 1;

      const effectiveBalance =
        balanceDue.total > 0
          ? balanceDue.total
          : hasMappedPayments
            ? 0
            : catalogBalance;
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

      return {
        ...row,
        totalPaid: live.totalPaid,
        totalPaidLKR: live.totalPaidLKR,
        totalPaidINR: live.totalPaidINR,
        totalPaidUSD: live.totalPaidUSD,
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

    const [requests, total, profile] = await Promise.all([
      PaymentRequest.find({ studentId, isArchived: false })
        .populate('requestedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      PaymentRequest.countDocuments({ studentId, isArchived: false }),
      StudentPaymentProfile.findOne({ studentId }).populate('studentId', 'name email batch level enrollmentDate'),
    ]);

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

    const combined = await Promise.all(
      requests.map(async (req) => {
        const subs = submissionsMap[String(req._id)] || [];
        const installments = await installmentService.getInstallmentsForRequest(req._id);
        return { ...req.toObject(), submissions: subs, installments };
      })
    );

    const studentDoc = await mongoose.model('User')
      .findById(studentId)
      .select('name email batch level enrollmentDate createdAt currentCourseDay studentStatus subscription regNo')
      .lean();

    const [allActiveRequests, allApprovedSubs] = await Promise.all([
      PaymentRequest.find({ studentId, isArchived: false })
        .select('currency amount amountRemaining status isArchived')
        .lean(),
      PaymentFlowSubmission.find({ studentId, status: 'APPROVED', isArchived: false })
        .select('paymentRequestId paidAmount')
        .lean(),
    ]);
    const balanceDue = computeBalanceDueFromRequests(allActiveRequests, allApprovedSubs);
    const languageFeeBalance = balanceDue.total;
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
      enrichedProfile.pendingApprovalAmount = balanceDue.pendingApprovalAmount;
      enrichedProfile.pendingApprovalAmountLKR = balanceDue.pendingApprovalAmountLKR;
      enrichedProfile.pendingApprovalAmountINR = balanceDue.pendingApprovalAmountINR;
      enrichedProfile.pendingApprovalAmountUSD = balanceDue.pendingApprovalAmountUSD;
    }

    res.json({
      success: true,
      data: {
        student: studentDoc || profile?.studentId || null,
        profile: enrichedProfile,
        languageFeeBalance,
        languageFeeStatus,
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
    if (hay.includes(lv)) return lv;
  }
  return null;
}

// ─── Batch payment summary (aggregated — no per-student payload) ─────────────
const getBatchPaymentSummary = async (req, res) => {
  try {
    const { batch, level } = req.query;
    const userMatch = { role: 'STUDENT' };
    if (batch && String(batch).trim()) userMatch.batch = String(batch).trim();
    if (level && String(level).trim()) userMatch.level = String(level).trim();

    const grouped = await mongoose.model('User').aggregate([
      { $match: userMatch },
      {
        $lookup: {
          from: 'studentpaymentprofiles',
          localField: '_id',
          foreignField: 'studentId',
          as: 'profileArr',
        },
      },
      { $addFields: { profile: { $arrayElemAt: ['$profileArr', 0] } } },
      { $addFields: mongoPaidFieldsFromProfile('$profile.currencyBreakdown') },
      {
        $addFields: {
          batchLabel: {
            $let: {
              vars: { b: { $trim: { input: { $ifNull: ['$batch', ''] } } } },
              in: { $cond: [{ $eq: ['$$b', ''] }, '—', '$$b'] },
            },
          },
          levelKey: { $toUpper: { $trim: { input: { $ifNull: ['$level', ''] } } } },
        },
      },
      {
        $group: {
          _id: '$batchLabel',
          studentCount: { $sum: 1 },
          totalPaid: { $sum: { $ifNull: ['$profile.totalPaid', 0] } },
          totalPaidLKR: { $sum: '$totalPaidLKR' },
          totalPaidINR: { $sum: '$totalPaidINR' },
          totalPaidUSD: { $sum: '$totalPaidUSD' },
          levels: { $push: '$levelKey' },
          maxStudentDay: { $max: '$currentCourseDay' },
        },
      },
      { $sort: { totalPaidLKR: -1, totalPaidINR: -1, totalPaidUSD: -1 } },
    ]);

    const batches = grouped.map((row) => {
      const levelCounts = {};
      for (const lv of row.levels || []) {
        if (!lv) continue;
        levelCounts[lv] = (levelCounts[lv] || 0) + 1;
      }
      let maxDay = row.maxStudentDay;
      if (maxDay != null && Number.isFinite(Number(maxDay))) {
        maxDay = Math.min(200, Math.max(1, Math.floor(Number(maxDay))));
      } else {
        maxDay = null;
      }
      return {
        batch: row._id,
        studentCount: row.studentCount,
        totalPaid: row.totalPaid,
        totalPaidLKR: row.totalPaidLKR || 0,
        totalPaidINR: row.totalPaidINR || 0,
        totalPaidUSD: row.totalPaidUSD || 0,
        levelCounts,
        maxStudentDay: maxDay,
      };
    });

    const totalStudents = batches.reduce((s, b) => s + b.studentCount, 0);
    const batchNames = batches.map((b) => b.batch).filter((n) => n && n !== '—');

    res.json({
      success: true,
      data: { batches, totalStudents, batchNames },
    });
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

    const User = mongoose.model('User');
    const PaymentFlowSubmission = require('../models/PaymentSubmission');
    const batchRegex = new RegExp(`^${batchRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

    const students = await User.find({
      role: 'STUDENT',
      batch: batchRegex,
    })
      .select('name email batch level phoneNumber enrollmentDate createdAt currentCourseDay')
      .sort({ name: 1 })
      .lean();

    if (!students.length) {
      return res.json({ success: true, data: { batch: batchRaw, students: [] } });
    }

    const studentIds = students.map((s) => s._id);
    const [profiles, requests, submissions] = await Promise.all([
      StudentPaymentProfile.find({ studentId: { $in: studentIds } }).lean(),
      PaymentRequest.find({ studentId: { $in: studentIds }, isArchived: false }).lean(),
      PaymentFlowSubmission.find({
        studentId: { $in: studentIds },
        status: 'APPROVED',
      })
        .select('studentId paymentRequestId paidAmount currency status submittedAt approvedAt paymentDate')
        .lean(),
    ]);

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

    const rows = students.map((student) => {
      const sid = String(student._id);
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
        pendingApprovalAmount: profile?.pendingApprovalAmount ?? 0,
        overdueAmount: profile?.overdueAmount ?? 0,
        overallStatus: profile?.overallStatus || 'NO_REQUESTS',
        levelPaid,
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

    res.json({
      success: true,
      data: {
        batch: batchRaw,
        students: rows,
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

module.exports = {
  createRequests,
  getAllRequests,
  getDashboardStats,
  getStudentTable,
  browseStudents,
  getBatchPaymentSummary,
  getBatchStudentsPaymentDetail,
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
