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
const paymentService = require('../services/paymentService');
const installmentService = require('../services/installmentService');
const timelineService = require('../services/timelineService');
const { getAuthUserId } = require('../helpers/authUserId');
const proofR2 = require('../services/paymentProofR2Service');
const { inferCurrencyFromPhone } = require('../utils/currencyHelper');

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
    const { page = 1, limit = 20, search, batch, level, overallStatus, sort = 'name' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const userMatch = { role: 'STUDENT' };
    if (batch) userMatch.batch = batch;
    if (level) userMatch.level = level;
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
        $addFields: {
          effectiveStatus: { $ifNull: ['$profile.overallStatus', 'NO_REQUESTS'] },
          sortDate: { $ifNull: ['$profile.lastRebuiltAt', '$createdAt'] },
          totalPaidSort: { $ifNull: ['$profile.totalPaid', 0] },
          overdueSort: { $ifNull: ['$profile.overdueCount', 0] },
        },
      },
    ];

    if (overallStatus) {
      pipeline.push({ $match: { effectiveStatus: String(overallStatus) } });
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
              pendingApprovalAmount: { $ifNull: ['$profile.pendingApprovalAmount', 0] },
              overdueAmount: { $ifNull: ['$profile.overdueAmount', 0] },
              overallStatus: '$effectiveStatus',
              lastRebuiltAt: '$profile.lastRebuiltAt',
            },
          },
        ],
      },
    });

    const [result] = await mongoose.model('User').aggregate(pipeline);
    const total = result.total[0]?.count || 0;
    const rawRows = result.rows || [];
    const data = rawRows.map((row) => ({
      ...row,
      inferredCurrency: inferCurrencyFromPhone(row?.studentId?.phoneNumber),
    }));

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
    const allSubmissions = await PaymentFlowSubmission.find({ studentId })
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

    const studentDoc = await mongoose.model('User').findById(studentId).select('name email batch level enrollmentDate createdAt').lean();

    res.json({
      success: true,
      data: {
        student: studentDoc || profile?.studentId || null,
        profile: profile || null,
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

module.exports = {
  createRequests,
  getAllRequests,
  getDashboardStats,
  getStudentTable,
  browseStudents,
  getStudentPaymentHistory,
  getRequestTimeline,
  addInternalNote,
  archiveRequest,
  runOverdueDetection,
  getMonthlyAnalytics,
  studentSubmitPayment,
  studentGetOwnRequests,
  updateInstallmentSchedule,
};
