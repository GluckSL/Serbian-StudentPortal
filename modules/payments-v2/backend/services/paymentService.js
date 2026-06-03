/**
 * Payment Service — Core Business Logic
 */
const mongoose = require('mongoose');
const PaymentRequest = require('../models/PaymentRequest');
const PaymentFlowSubmission = require('../models/PaymentSubmission');
const PaymentInstallment = require('../models/PaymentInstallment');
const StudentPaymentProfile = require('../models/StudentPaymentProfile');
const PaymentAuditLog = require('../models/PaymentAuditLog');
const BulkPaymentOperation = require('../models/BulkPaymentOperation');

const notificationService = require('./notificationService');
const timelineService = require('./timelineService');
const installmentService = require('./installmentService');
const receiptService = require('./receiptService');
const { computeLiveTotalsFromData } = require('../utils/currencyBreakdownHelper');

const getEmailService = () => require('./emailService');

const { activatePublicSignupStudent } = require('../../../../utils/signupActivation');


const logAudit = (data) => PaymentAuditLog.create(data).catch((e) => console.error('[Audit]', e.message));

const getUser = (userId) =>
  mongoose.model('User').findById(userId).select('name email batch level').lean().catch(() => null);

// ─── Rebuild StudentPaymentProfile ───────────────────────────────────────────

const recalculateStudentProfile = async (studentId) => {
  const [requests, approvedSubmissions, pendingSubmissions] = await Promise.all([
    PaymentRequest.find({ studentId, isArchived: false }).lean(),
    PaymentFlowSubmission.find({ studentId, status: 'APPROVED', isArchived: false }).lean(),
    PaymentFlowSubmission.find({ studentId, status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] }, isArchived: false }).lean(),
  ]);

  const activeRequestIds = new Set(requests.map((r) => String(r._id)));
  const approvedForActiveRequests = approvedSubmissions.filter((s) =>
    activeRequestIds.has(String(s.paymentRequestId)),
  );
  const pendingForActiveRequests = pendingSubmissions.filter((s) =>
    activeRequestIds.has(String(s.paymentRequestId)),
  );

  const live = computeLiveTotalsFromData(requests, approvedSubmissions, pendingSubmissions);
  const {
    totalPaid,
    pendingApprovalAmount,
    overdueAmount,
    overallStatus,
    currencyBreakdown,
  } = live;

  const totalRequested = requests.reduce((s, r) => s + r.amount, 0);
  const expectedAmount = requests
    .filter((r) => !['APPROVED', 'FULLY_PAID', 'REJECTED', 'OVERDUE'].includes(r.status))
    .reduce((s, r) => s + (r.amountRemaining || r.amount), 0);

  const overdueCount = requests.filter((r) => r.status === 'OVERDUE').length;
  const activeRequestCount = requests.filter((r) =>
    ['REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'REUPLOAD_REQUIRED'].includes(r.status),
  ).length;
  const completedRequestCount = requests.filter((r) => ['APPROVED', 'FULLY_PAID'].includes(r.status)).length;
  const pendingApprovalCount = pendingForActiveRequests.length;
  const rejectedCount = requests.filter((r) => r.status === 'REJECTED').length;

  const sorted = [...approvedForActiveRequests].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
  const lastSub = sorted[0];

  const paymentHealthScore = Math.max(0, 100 - overdueCount * 20 - rejectedCount * 5);

  const profile = await StudentPaymentProfile.findOneAndUpdate(
    { studentId },
    {
      studentId,
      totalPaid,
      pendingApprovalAmount,
      overdueAmount,
      expectedAmount,
      totalRequested,
      currencyBreakdown,
      totalRequestCount: requests.length,
      activeRequestCount,
      completedRequestCount,
      overdueCount,
      pendingApprovalCount,
      fullyPaidCount: completedRequestCount,
      rejectedCount,
      lastPaymentDate: lastSub?.approvedAt,
      lastPaymentAmount: lastSub?.paidAmount,
      lastPaymentCurrency: lastSub?.currency,
      overallStatus,
      paymentHealthScore,
      lastRebuiltAt: new Date(),
    },
    { upsert: true, new: true }
  );

  try {
    const journeyDue = require('./journeyLanguageFeeDueService');
    journeyDue.syncForStudent(studentId).catch((e) => console.error('[JourneyDue]', e.message));
  } catch (_) { /* optional */ }

  return profile;
};

// ─── CREATE PAYMENT REQUEST(S) ───────────────────────────────────────────────

const createPaymentRequests = async ({ studentIds, adminId, adminRole, adminName, amount, currency, paymentType, customType, dueDate, remarks, installmentAllowed, scheduledInstallments, notificationToggle, isDraft, batchId, targetType }) => {
  // Validate installment plan when provided
  if (installmentAllowed && scheduledInstallments?.length) {
    for (let i = 0; i < scheduledInstallments.length; i++) {
      const s = scheduledInstallments[i];
      if (!s.amount || s.amount <= 0) throw new Error(`Installment ${i + 1}: amount must be a positive number`);
      if (!s.dueDate) throw new Error(`Installment ${i + 1}: dueDate is required`);
    }
    const sum = scheduledInstallments.reduce((t, s) => t + Number(s.amount), 0);
    if (Math.abs(sum - Number(amount)) > 0.01) {
      throw new Error(`Installment amounts must add up to the total (${amount}). Got ${sum}.`);
    }
  }
  const operationId = new mongoose.Types.ObjectId();
  const bulkOp = await BulkPaymentOperation.create({ _id: operationId, createdBy: adminId, targetType: targetType || (studentIds.length === 1 ? 'INDIVIDUAL' : 'MULTIPLE'), targetBatch: batchId, amount, currency, paymentType, dueDate, remarks, installmentAllowed, totalStudents: studentIds.length, isDraft: isDraft || false, status: 'PROCESSING' });

  const results = [];
  const requestIds = [];
  const failedStudents = [];

  for (const studentId of studentIds) {
    try {
      // When using installments, anchor the parent dueDate to the first slice's date
      const effectiveDueDate = (installmentAllowed && scheduledInstallments?.length)
        ? scheduledInstallments[0].dueDate
        : dueDate;
      const request = await PaymentRequest.create({ studentId, requestedBy: adminId, amount, currency, paymentType, customType: paymentType === 'Custom' ? customType : undefined, dueDate: effectiveDueDate, remarks, installmentAllowed: Boolean(installmentAllowed), totalInstallments: installmentAllowed ? (scheduledInstallments?.length || 1) : 1, amountRemaining: amount, isDraft: isDraft || false, batchId, bulkOperationId: operationId, status: 'REQUESTED' });
      await installmentService.initializeInstallments(request, scheduledInstallments || []);
      await logAudit({ entityType: 'PaymentRequest', entityId: request._id, action: 'CREATED', performedBy: adminId, performedByRole: adminRole, newState: { status: 'REQUESTED', amount, currency }, studentId });
      await timelineService.onRequestCreated(request, adminId, adminRole, adminName);
      if (!isDraft && notificationToggle) {
        notificationService.notifyPaymentRequestCreated(studentId, request).catch(() => {});
        getUser(studentId).then((student) => { if (student) getEmailService().sendPaymentRequestEmail(student, request).catch(() => {}); });
      }
      await recalculateStudentProfile(studentId);
      requestIds.push(request._id);
      results.push(request);
    } catch (err) {
      failedStudents.push({ studentId, reason: err.message });
    }
  }

  const opStatus = failedStudents.length === 0 ? 'COMPLETED' : failedStudents.length === studentIds.length ? 'FAILED' : 'PARTIAL_FAILURE';
  await BulkPaymentOperation.findByIdAndUpdate(operationId, { successCount: results.length, failedCount: failedStudents.length, failedStudents, requestIds, status: opStatus, completedAt: new Date(), notificationSent: notificationToggle && !isDraft });

  return { requests: results, bulkOperation: { ...bulkOp.toObject(), status: opStatus, successCount: results.length, failedCount: failedStudents.length }, failedStudents };
};

// ─── SUBMIT PAYMENT ──────────────────────────────────────────────────────────

const submitPayment = async ({ paymentRequestId, studentId, paidAmount, currency, transactionId, screenshotKey, screenshotOriginalName, screenshotMimeType, screenshotSize, paymentMethod, installmentNumber, paymentDateTime, accountHolderName }) => {
  const request = await PaymentRequest.findOne({ _id: paymentRequestId, studentId });
  if (!request) throw new Error('Payment request not found or does not belong to this student');
  if (['FULLY_PAID', 'APPROVED'].includes(request.status)) throw new Error('This payment is already fully paid');
  if (request.isArchived) throw new Error('This payment request is archived');

  const previousStatus = request.status;
  let installmentId = null;
  if (installmentNumber) {
    const inst = await PaymentInstallment.findOne({ paymentRequestId, installmentNumber });
    if (inst) { installmentId = inst._id; inst.status = 'SUBMITTED'; await inst.save(); }
  }

  const submission = await PaymentFlowSubmission.create({
    paymentRequestId,
    studentId,
    paidAmount,
    currency,
    transactionId,
    screenshotKey,
    screenshotOriginalName,
    screenshotMimeType,
    screenshotSize,
    paymentMethod: paymentMethod || 'Bank Transfer',
    paymentDateTime: paymentDateTime || null,
    accountHolderName: accountHolderName ? String(accountHolderName).trim() : '',
    installmentId,
    installmentNumber,
    status: 'SUBMITTED',
    submittedAt: new Date(),
  });
  request.status = 'SUBMITTED';
  await request.save();

  await logAudit({ entityType: 'PaymentFlowSubmission', entityId: submission._id, action: 'SCREENSHOT_UPLOADED', performedBy: studentId, performedByRole: 'STUDENT', previousState: { status: previousStatus }, newState: { status: 'SUBMITTED' }, studentId });
  await timelineService.onScreenshotUploaded(submission, studentId);
  await recalculateStudentProfile(studentId);
  notificationService.notifyAdminNewSubmission(null, submission).catch(() => {});
  return submission;
};

// ─── APPROVE PAYMENT ─────────────────────────────────────────────────────────

const approveSubmission = async ({ submissionId, adminId, adminRole, adminName, adminRemarks, paidAmount: paidAmountOverride }) => {
  const submission = await PaymentFlowSubmission.findById(submissionId).populate('paymentRequestId').populate('studentId', 'name email batch level');
  if (!submission) throw new Error('Submission not found');
  if (submission.status === 'APPROVED') throw new Error('Already approved');

  const request = submission.paymentRequestId;
  const student = submission.studentId;
  const previousStatus = submission.status;

  if (paidAmountOverride !== undefined && paidAmountOverride !== null && paidAmountOverride !== '') {
    const amount = Number(paidAmountOverride);
    if (!amount || amount <= 0 || Number.isNaN(amount)) throw new Error('Credited amount must be a positive number');
    const otherApproved = await PaymentFlowSubmission.find({
      paymentRequestId: request._id,
      status: 'APPROVED',
      isArchived: false,
      _id: { $ne: submission._id },
    }).lean();
    const otherTotal = otherApproved.reduce((s, sub) => s + sub.paidAmount, 0);
    if (otherTotal + amount > request.amount + 0.01) {
      throw new Error(`Credited amount cannot exceed request total (${request.currency} ${request.amount})`);
    }
    submission.paidAmount = amount;
  }

  submission.status = 'APPROVED';
  submission.approvedBy = adminId;
  submission.approvedAt = new Date();
  submission.reviewedBy = adminId;
  submission.reviewedAt = new Date();
  submission.adminRemarks = adminRemarks;
  await submission.save();

  await installmentService.applyPaymentToInstallments(request._id, submission._id, submission.paidAmount);
  const refreshedRequest = await PaymentRequest.findById(request._id);
  const isFullyPaid = refreshedRequest.status === 'FULLY_PAID';

  // Attach request remarks to submission for email
  submission.requestRemarks = refreshedRequest.remarks;
  submission.paymentType = refreshedRequest.paymentType;
  submission.customType = refreshedRequest.customType;

  await recalculateStudentProfile(submission.studentId._id || submission.studentId);

  await logAudit({ entityType: 'PaymentFlowSubmission', entityId: submission._id, action: 'APPROVED', performedBy: adminId, performedByRole: adminRole, previousState: { status: previousStatus }, newState: { status: 'APPROVED', approvedBy: adminId, amountApproved: submission.paidAmount }, studentId: student._id || student, metadata: { isFullyPaid, newRequestStatus: refreshedRequest.status } });

  await timelineService.onPaymentApproved(submission, adminId, adminRole, adminName, isFullyPaid);

  const { receiptNumber, receiptKey } = await receiptService.generateAndStoreReceipt({ student, submission: submission.toObject(), request: refreshedRequest.toObject(), approvedByName: adminName, uploadToS3: Boolean(process.env.S3_BUCKET) });
  submission.receiptGenerated = true;
  submission.receiptNumber = receiptNumber;
  if (receiptKey) submission.receiptKey = receiptKey;
  await submission.save();

  await timelineService.onReceiptGenerated(submission, receiptNumber);

  notificationService.notifyPaymentApproved(student._id || student, { ...submission.toObject(), receiptNumber }).catch(() => {});
  if (student.email) {
    getEmailService().sendPaymentApprovedEmail(student, { ...submission.toObject(), receiptNumber }).catch((e) => console.error('[Email]', e.message));
  }

  // ── Public signup: activate account + send Web App ID / password welcome email ──
  if (refreshedRequest.source === 'PUBLIC_SIGNUP') {
    try {
      const studentId = student._id || student;
      const result = await activatePublicSignupStudent(studentId, {
        paymentRequestId: refreshedRequest._id,
      });
      if (!result.ok && result.reason !== 'not_public_signup') {
        console.warn('[paymentService] PUBLIC_SIGNUP activation:', result.reason);
      }
    } catch (hookErr) {
      console.error('[paymentService] PUBLIC_SIGNUP activation hook failed:', hookErr?.message || hookErr);
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  return { submission: submission.toObject(), request: refreshedRequest.toObject(), receiptNumber, isFullyPaid };
};

// ─── REJECT SUBMISSION ────────────────────────────────────────────────────────

const rejectSubmission = async ({ submissionId, adminId, adminRole, adminName, rejectionReason }) => {
  const submission = await PaymentFlowSubmission.findById(submissionId).populate('studentId', 'name email');
  if (!submission) throw new Error('Submission not found');
  if (submission.status === 'APPROVED') throw new Error('Cannot reject an already approved payment');

  const previousStatus = submission.status;
  submission.status = 'REJECTED';
  submission.rejectionReason = rejectionReason;
  submission.reviewedBy = adminId;
  submission.reviewedAt = new Date();
  await submission.save();

  const request = await PaymentRequest.findById(submission.paymentRequestId);
  if (request) { request.status = 'REJECTED'; await request.save(); }

  const student = submission.studentId;
  const studentId = student?._id || student;
  if (!studentId) throw new Error('Student not found for this submission');

  await logAudit({ entityType: 'PaymentFlowSubmission', entityId: submission._id, action: 'REJECTED', performedBy: adminId, performedByRole: adminRole, previousState: { status: previousStatus }, newState: { status: 'REJECTED', rejectionReason }, studentId });
  await timelineService.onPaymentRejected(submission, adminId, adminRole, adminName, rejectionReason);
  await recalculateStudentProfile(studentId);

  const submissionPayload = { ...submission.toObject(), rejectionReason };
  notificationService.notifyPaymentRejected(studentId, submissionPayload).catch(() => {});
  if (student?.email) {
    getEmailService().sendPaymentRejectedEmail(student, submissionPayload).catch((e) => console.error('[Email]', e.message));
  }

  return submission;
};

// ─── REQUEST REUPLOAD ────────────────────────────────────────────────────────

const requestReupload = async ({ submissionId, adminId, adminRole, adminName, reuploadNote }) => {
  const submission = await PaymentFlowSubmission.findById(submissionId);
  if (!submission) throw new Error('Submission not found');

  submission.status = 'REUPLOAD_REQUIRED';
  submission.reuploadNote = reuploadNote;
  submission.reviewedBy = adminId;
  submission.reviewedAt = new Date();
  await submission.save();

  const request = await PaymentRequest.findById(submission.paymentRequestId);
  if (request) { request.status = 'REUPLOAD_REQUIRED'; await request.save(); }

  await logAudit({ entityType: 'PaymentFlowSubmission', entityId: submission._id, action: 'REUPLOAD_REQUESTED', performedBy: adminId, performedByRole: adminRole, newState: { status: 'REUPLOAD_REQUIRED', reuploadNote }, studentId: submission.studentId });
  await timelineService.onReuploadRequested(submission, adminId, adminName, reuploadNote);

  notificationService.createNotification({ recipientId: submission.studentId, recipientRole: 'STUDENT', type: 'REUPLOAD_REQUIRED', title: 'Screenshot Reupload Required', message: `Please re-upload your payment screenshot. Note: ${reuploadNote || 'Please submit a clearer screenshot.'}`, relatedEntityType: 'PaymentFlowSubmission', relatedEntityId: submission._id, priority: 'HIGH' }).catch(() => {});

  return submission;
};

// ─── ADD INTERNAL NOTE ───────────────────────────────────────────────────────

const addInternalNote = async ({ requestId, adminId, adminRole, adminName, note, followUpDate, taggedAdmin }) => {
  const request = await PaymentRequest.findById(requestId);
  if (!request) throw new Error('Payment request not found');
  const noteObj = { note, addedBy: adminId, addedAt: new Date(), followUpDate, taggedAdmin };
  request.internalNotes.push(noteObj);
  await request.save();
  await timelineService.onNoteAdded(request, adminId, adminRole, adminName, noteObj);
  return request;
};

// ─── ARCHIVE ─────────────────────────────────────────────────────────────────

const archiveRequest = async ({ requestId, adminId, adminRole, reason }) => {
  const request = await PaymentRequest.findById(requestId);
  if (!request) throw new Error('Payment request not found');
  const archivedAt = new Date();
  request.isArchived = true;
  request.archivedAt = archivedAt;
  request.archivedBy = adminId;
  request.archiveReason = reason;
  await request.save();

  await PaymentFlowSubmission.updateMany(
    { paymentRequestId: request._id, isArchived: false },
    { $set: { isArchived: true, archivedAt, archivedBy: adminId } },
  );

  await logAudit({ entityType: 'PaymentRequest', entityId: request._id, action: 'DELETED', performedBy: adminId, performedByRole: adminRole, metadata: { reason, archiveType: 'SOFT_DELETE' }, studentId: request.studentId });
  await recalculateStudentProfile(request.studentId);
  return request;
};

// ─── DETECT & MARK OVERDUE ───────────────────────────────────────────────────

const detectAndMarkOverdue = async () => {
  const now = new Date();
  const overdueRequests = await PaymentRequest.find({ dueDate: { $lt: now }, status: { $in: ['REQUESTED', 'REUPLOAD_REQUIRED'] }, isArchived: false });
  const updatedIds = [];
  for (const req of overdueRequests) {
    const prevStatus = req.status;
    req.status = 'OVERDUE';
    await req.save();
    await timelineService.onOverdueMarked(req);
    await logAudit({ entityType: 'PaymentRequest', entityId: req._id, action: 'STATUS_CHANGED', performedBy: req.studentId, performedByRole: 'SYSTEM', previousState: { status: prevStatus }, newState: { status: 'OVERDUE' }, studentId: req.studentId });
    await recalculateStudentProfile(req.studentId);
    updatedIds.push(req._id);
  }
  await installmentService.markOverdueInstallments();
  return { updatedCount: updatedIds.length, updatedIds };
};

// ─── DASHBOARD STATS ─────────────────────────────────────────────────────────

const getPaymentDashboardStats = async () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const [totalReceivedOverall, totalReceivedThisMonth, pendingApproval, expectedThisMonth, overdueData] = await Promise.all([
    PaymentFlowSubmission.aggregate([{ $match: { status: 'APPROVED', isArchived: false } }, { $group: { _id: '$currency', total: { $sum: '$paidAmount' }, count: { $sum: 1 } } }]),
    PaymentFlowSubmission.aggregate([{ $match: { status: 'APPROVED', approvedAt: { $gte: startOfMonth, $lte: endOfMonth }, isArchived: false } }, { $group: { _id: '$currency', total: { $sum: '$paidAmount' }, count: { $sum: 1 } } }]),
    PaymentFlowSubmission.aggregate([{ $match: { status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] }, isArchived: false } }, { $group: { _id: '$currency', total: { $sum: '$paidAmount' }, count: { $sum: 1 } } }]),
    PaymentRequest.aggregate([{ $match: { dueDate: { $gte: startOfMonth, $lte: endOfMonth }, status: { $nin: ['APPROVED', 'FULLY_PAID', 'REJECTED'] }, isArchived: false } }, { $group: { _id: '$currency', total: { $sum: '$amountRemaining' } } }]),
    PaymentRequest.aggregate([{ $match: { dueDate: { $lt: now }, status: { $nin: ['APPROVED', 'FULLY_PAID', 'REJECTED'] }, isArchived: false } }, { $group: { _id: '$currency', total: { $sum: '$amountRemaining' }, count: { $sum: 1 } } }]),
  ]);

  const toMap = (arr) => arr.reduce((acc, i) => ({ ...acc, [i._id]: { total: i.total, count: i.count || 0 } }), {});
  return {
    totalReceived: { overall: toMap(totalReceivedOverall), thisMonth: toMap(totalReceivedThisMonth) },
    pendingApproval: { byCurrency: toMap(pendingApproval), count: pendingApproval.reduce((s, i) => s + i.count, 0) },
    expectedThisMonth: toMap(expectedThisMonth),
    overdue: { byCurrency: toMap(overdueData), studentCount: overdueData.reduce((s, i) => s + i.count, 0) },
  };
};

// ─── CORRECT APPROVED AMOUNT (admin mistake) ─────────────────────────────────

const correctApprovedSubmissionAmount = async ({ submissionId, newPaidAmount, adminId, adminRole, adminRemarks }) => {
  const amount = Number(newPaidAmount);
  if (!amount || amount < 0 || Number.isNaN(amount)) throw new Error('newPaidAmount must be a non-negative number');

  const submission = await PaymentFlowSubmission.findById(submissionId).populate('paymentRequestId');
  if (!submission) throw new Error('Submission not found');
  if (submission.status !== 'APPROVED') throw new Error('Only approved payments can be corrected');
  if (submission.isArchived) throw new Error('Submission is archived');

  const request = submission.paymentRequestId;
  if (!request) throw new Error('Linked payment request not found');

  const otherApproved = await PaymentFlowSubmission.find({
    paymentRequestId: request._id,
    status: 'APPROVED',
    isArchived: false,
    _id: { $ne: submission._id },
  }).lean();
  const otherTotal = otherApproved.reduce((s, sub) => s + sub.paidAmount, 0);
  if (otherTotal + amount > request.amount + 0.01) {
    throw new Error(`Corrected amount cannot exceed request total (${request.currency} ${request.amount})`);
  }

  const previousAmount = submission.paidAmount;
  submission.paidAmount = amount;
  if (adminRemarks?.trim()) {
    submission.adminRemarks = submission.adminRemarks
      ? `${submission.adminRemarks} | Correction: ${adminRemarks.trim()}`
      : `Correction: ${adminRemarks.trim()}`;
  }
  await submission.save();

  await installmentService.recalculateRequestFromApprovedSubmissions(request._id);
  await recalculateStudentProfile(submission.studentId);

  await logAudit({
    entityType: 'PaymentFlowSubmission',
    entityId: submission._id,
    action: 'AMOUNT_CORRECTED',
    performedBy: adminId,
    performedByRole: adminRole,
    previousState: { paidAmount: previousAmount },
    newState: { paidAmount: amount },
    studentId: submission.studentId,
    metadata: { adminRemarks, requestId: request._id },
  });

  return { submission: submission.toObject(), previousAmount, newPaidAmount: amount };
};

const correctStudentTotalPaid = async ({ studentId, currency, correctedTotalPaid, adminId, adminRole, adminRemarks }) => {
  const target = Number(correctedTotalPaid);
  if (target < 0 || Number.isNaN(target)) throw new Error('correctedTotalPaid must be a non-negative number');
  const ccy = String(currency || 'LKR').toUpperCase();
  if (!['LKR', 'INR', 'USD'].includes(ccy)) throw new Error('currency must be LKR, INR, or USD');

  const subs = await PaymentFlowSubmission.find({
    studentId,
    currency: ccy,
    status: 'APPROVED',
    isArchived: false,
  }).sort({ approvedAt: -1 });

  const currentTotal = subs.reduce((s, sub) => s + sub.paidAmount, 0);
  let delta = target - currentTotal;
  if (Math.abs(delta) < 0.01) {
    return { currentTotal, correctedTotalPaid: target, changed: false };
  }

  const affectedRequestIds = new Set();
  const reason = adminRemarks?.trim() || 'Admin correction';

  if (delta < 0) {
    for (const sub of subs) {
      if (delta >= -0.01) break;
      const reduction = Math.min(sub.paidAmount, -delta);
      if (reduction <= 0) continue;
      const prev = sub.paidAmount;
      sub.paidAmount = prev - reduction;
      sub.adminRemarks = sub.adminRemarks
        ? `${sub.adminRemarks} | Correction: ${reason}`
        : `Correction: ${reason}`;
      await sub.save();
      delta += reduction;
      affectedRequestIds.add(String(sub.paymentRequestId));
      await logAudit({
        entityType: 'PaymentFlowSubmission',
        entityId: sub._id,
        action: 'AMOUNT_CORRECTED',
        performedBy: adminId,
        performedByRole: adminRole,
        previousState: { paidAmount: prev },
        newState: { paidAmount: sub.paidAmount },
        studentId,
        metadata: { adminRemarks: reason, currency: ccy },
      });
    }
    if (delta < -0.01) {
      throw new Error('Could not apply full reduction — check approved payments for this currency');
    }
  } else {
    const sub = subs[0];
    if (!sub) throw new Error(`No approved ${ccy} payments found for this student`);
    const request = await PaymentRequest.findById(sub.paymentRequestId);
    if (!request) throw new Error('Linked payment request not found');
    const onRequest = await PaymentFlowSubmission.find({
      paymentRequestId: request._id,
      status: 'APPROVED',
      isArchived: false,
    }).lean();
    const requestPaid = onRequest.reduce((s, x) => s + x.paidAmount, 0);
    if (requestPaid + delta > request.amount + 0.01) {
      throw new Error(`Increase would exceed request amount (${request.currency} ${request.amount})`);
    }
    const prev = sub.paidAmount;
    sub.paidAmount = prev + delta;
    sub.adminRemarks = sub.adminRemarks
      ? `${sub.adminRemarks} | Correction: ${reason}`
      : `Correction: ${reason}`;
    await sub.save();
    affectedRequestIds.add(String(sub.paymentRequestId));
    await logAudit({
      entityType: 'PaymentFlowSubmission',
      entityId: sub._id,
      action: 'AMOUNT_CORRECTED',
      performedBy: adminId,
      performedByRole: adminRole,
      previousState: { paidAmount: prev },
      newState: { paidAmount: sub.paidAmount },
      studentId,
      metadata: { adminRemarks: reason, currency: ccy },
    });
  }

  for (const rid of affectedRequestIds) {
    await installmentService.recalculateRequestFromApprovedSubmissions(rid);
  }
  await recalculateStudentProfile(studentId);

  return {
    currentTotal,
    correctedTotalPaid: target,
    changed: true,
    affectedRequestIds: [...affectedRequestIds],
  };
};

// ─── Bulk reset payment data (admin — before Excel re-import) ────────────────

const bulkResetStudentPayments = async ({ studentIds, adminId, adminRole, reason }) => {
  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    throw new Error('studentIds array is required');
  }
  if (studentIds.length > 500) {
    throw new Error('Maximum 500 students per bulk reset');
  }

  const uniqueIds = [...new Set(studentIds.map(String))];
  const User = mongoose.model('User');
  const students = await User.find({ _id: { $in: uniqueIds }, role: 'STUDENT' }).select('_id').lean();
  const validIds = students.map((s) => s._id);
  if (!validIds.length) {
    throw new Error('No valid student IDs provided');
  }

  const archivedAt = new Date();
  const archiveReason = reason?.trim() || 'Bulk payment reset before re-import';

  const activeRequests = await PaymentRequest.find({
    studentId: { $in: validIds },
    isArchived: false,
  }).select('_id').lean();
  const requestIds = activeRequests.map((r) => r._id);

  const reqResult = await PaymentRequest.updateMany(
    { studentId: { $in: validIds }, isArchived: false },
    { $set: { isArchived: true, archivedAt, archivedBy: adminId, archiveReason } },
  );

  const subResult = await PaymentFlowSubmission.updateMany(
    { studentId: { $in: validIds }, isArchived: false },
    { $set: { isArchived: true, archivedAt, archivedBy: adminId } },
  );

  if (requestIds.length) {
    await PaymentFlowSubmission.updateMany(
      { paymentRequestId: { $in: requestIds }, isArchived: false },
      { $set: { isArchived: true, archivedAt, archivedBy: adminId } },
    );
  }

  for (const sid of validIds) {
    await recalculateStudentProfile(sid);
    await logAudit({
      entityType: 'StudentPaymentProfile',
      entityId: sid,
      action: 'BULK_RESET',
      performedBy: adminId,
      performedByRole: adminRole,
      studentId: sid,
      metadata: { reason: archiveReason },
    });
  }

  return {
    studentsProcessed: validIds.length,
    requestsArchived: reqResult.modifiedCount,
    submissionsArchived: subResult.modifiedCount,
  };
};

module.exports = {
  createPaymentRequests,
  submitPayment,
  approveSubmission,
  rejectSubmission,
  requestReupload,
  addInternalNote,
  archiveRequest,
  detectAndMarkOverdue,
  recalculateStudentProfile,
  getPaymentDashboardStats,
  logAudit,
  getUser,
  correctApprovedSubmissionAmount,
  correctStudentTotalPaid,
  bulkResetStudentPayments,
};
