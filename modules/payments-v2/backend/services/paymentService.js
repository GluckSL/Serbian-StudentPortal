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

const getEmailService = () => require('./emailService');

const logAudit = (data) => PaymentAuditLog.create(data).catch((e) => console.error('[Audit]', e.message));

const getUser = (userId) =>
  mongoose.model('User').findById(userId).select('name email batch level').lean().catch(() => null);

// ─── Rebuild StudentPaymentProfile ───────────────────────────────────────────

const recalculateStudentProfile = async (studentId) => {
  const [requests, approvedSubmissions] = await Promise.all([
    PaymentRequest.find({ studentId, isArchived: false }).lean(),
    PaymentFlowSubmission.find({ studentId, status: 'APPROVED', isArchived: false }).lean(),
  ]);

  const currencyMap = {};
  for (const s of approvedSubmissions) {
    if (!currencyMap[s.currency]) currencyMap[s.currency] = { currency: s.currency, totalPaid: 0, pendingApprovalAmount: 0, overdueAmount: 0, expectedAmount: 0 };
    currencyMap[s.currency].totalPaid += s.paidAmount;
  }
  for (const r of requests) {
    if (!currencyMap[r.currency]) currencyMap[r.currency] = { currency: r.currency, totalPaid: 0, pendingApprovalAmount: 0, overdueAmount: 0, expectedAmount: 0 };
    if (['SUBMITTED', 'UNDER_REVIEW'].includes(r.status)) currencyMap[r.currency].pendingApprovalAmount += r.amountRemaining || r.amount;
    if (r.status === 'OVERDUE') currencyMap[r.currency].overdueAmount += r.amountRemaining || r.amount;
    if (['REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'PARTIALLY_PAID'].includes(r.status)) currencyMap[r.currency].expectedAmount += r.amountRemaining || r.amount;
  }

  const totalPaid = approvedSubmissions.reduce((s, sub) => s + sub.paidAmount, 0);
  const totalRequested = requests.reduce((s, r) => s + r.amount, 0);
  const pendingApprovalAmount = requests.filter((r) => ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status)).reduce((s, r) => s + r.amount, 0);
  const overdueAmount = requests.filter((r) => r.status === 'OVERDUE').reduce((s, r) => s + (r.amountRemaining || r.amount), 0);
  const expectedAmount = requests.filter((r) => !['APPROVED', 'FULLY_PAID', 'REJECTED', 'OVERDUE'].includes(r.status)).reduce((s, r) => s + (r.amountRemaining || r.amount), 0);

  const overdueCount = requests.filter((r) => r.status === 'OVERDUE').length;
  const activeRequestCount = requests.filter((r) => ['REQUESTED', 'SUBMITTED', 'UNDER_REVIEW', 'REUPLOAD_REQUIRED'].includes(r.status)).length;
  const completedRequestCount = requests.filter((r) => ['APPROVED', 'FULLY_PAID'].includes(r.status)).length;
  const pendingApprovalCount = requests.filter((r) => ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status)).length;
  const rejectedCount = requests.filter((r) => r.status === 'REJECTED').length;

  const sorted = [...approvedSubmissions].sort((a, b) => new Date(b.approvedAt) - new Date(a.approvedAt));
  const lastSub = sorted[0];

  let overallStatus = 'CLEAR';
  if (overdueCount > 0) overallStatus = 'OVERDUE';
  else if (pendingApprovalCount > 0) overallStatus = 'PENDING_REVIEW';
  else if (activeRequestCount > 0) overallStatus = 'REQUESTED';
  else if (completedRequestCount > 0 && activeRequestCount === 0 && overdueCount === 0) overallStatus = 'CLEAR';

  const paymentHealthScore = Math.max(0, 100 - overdueCount * 20 - rejectedCount * 5);

  return StudentPaymentProfile.findOneAndUpdate(
    { studentId },
    { studentId, totalPaid, pendingApprovalAmount, overdueAmount, expectedAmount, totalRequested, currencyBreakdown: Object.values(currencyMap), totalRequestCount: requests.length, activeRequestCount, completedRequestCount, overdueCount, pendingApprovalCount, fullyPaidCount: completedRequestCount, rejectedCount, lastPaymentDate: lastSub?.approvedAt, lastPaymentAmount: lastSub?.paidAmount, lastPaymentCurrency: lastSub?.currency, overallStatus, paymentHealthScore, lastRebuiltAt: new Date() },
    { upsert: true, new: true }
  );
};

// ─── CREATE PAYMENT REQUEST(S) ───────────────────────────────────────────────

const createPaymentRequests = async ({ studentIds, adminId, adminRole, adminName, amount, currency, paymentType, customType, dueDate, remarks, installmentAllowed, scheduledInstallments, notificationToggle, isDraft, batchId, targetType }) => {
  const operationId = new mongoose.Types.ObjectId();
  const bulkOp = await BulkPaymentOperation.create({ _id: operationId, createdBy: adminId, targetType: targetType || (studentIds.length === 1 ? 'INDIVIDUAL' : 'MULTIPLE'), targetBatch: batchId, amount, currency, paymentType, dueDate, remarks, installmentAllowed, totalStudents: studentIds.length, isDraft: isDraft || false, status: 'PROCESSING' });

  const results = [];
  const requestIds = [];
  const failedStudents = [];

  for (const studentId of studentIds) {
    try {
      const request = await PaymentRequest.create({ studentId, requestedBy: adminId, amount, currency, paymentType, customType: paymentType === 'Custom' ? customType : undefined, dueDate, remarks, installmentAllowed: Boolean(installmentAllowed), totalInstallments: installmentAllowed ? (scheduledInstallments?.length || 1) : 1, amountRemaining: amount, isDraft: isDraft || false, batchId, bulkOperationId: operationId, status: 'REQUESTED' });
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

const submitPayment = async ({ paymentRequestId, studentId, paidAmount, currency, transactionId, screenshotKey, screenshotOriginalName, screenshotMimeType, screenshotSize, paymentMethod, installmentNumber }) => {
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

  const submission = await PaymentFlowSubmission.create({ paymentRequestId, studentId, paidAmount, currency, transactionId, screenshotKey, screenshotOriginalName, screenshotMimeType, screenshotSize, paymentMethod: paymentMethod || 'Bank Transfer', installmentId, installmentNumber, status: 'SUBMITTED', submittedAt: new Date() });
  request.status = 'SUBMITTED';
  await request.save();

  await logAudit({ entityType: 'PaymentFlowSubmission', entityId: submission._id, action: 'SCREENSHOT_UPLOADED', performedBy: studentId, performedByRole: 'STUDENT', previousState: { status: previousStatus }, newState: { status: 'SUBMITTED' }, studentId });
  await timelineService.onScreenshotUploaded(submission, studentId);
  await recalculateStudentProfile(studentId);
  notificationService.notifyAdminNewSubmission(null, submission).catch(() => {});
  return submission;
};

// ─── APPROVE PAYMENT ─────────────────────────────────────────────────────────

const approveSubmission = async ({ submissionId, adminId, adminRole, adminName, adminRemarks }) => {
  const submission = await PaymentFlowSubmission.findById(submissionId).populate('paymentRequestId').populate('studentId', 'name email batch level');
  if (!submission) throw new Error('Submission not found');
  if (submission.status === 'APPROVED') throw new Error('Already approved');

  const request = submission.paymentRequestId;
  const student = submission.studentId;
  const previousStatus = submission.status;

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
  await logAudit({ entityType: 'PaymentFlowSubmission', entityId: submission._id, action: 'REJECTED', performedBy: adminId, performedByRole: adminRole, previousState: { status: previousStatus }, newState: { status: 'REJECTED', rejectionReason }, studentId: student._id || student });
  await timelineService.onPaymentRejected(submission, adminId, adminRole, adminName, rejectionReason);
  await recalculateStudentProfile(student._id || student);

  notificationService.notifyPaymentRejected(student._id || student, { ...submission.toObject(), rejectionReason }).catch(() => {});
  if (student.email) getEmailService().sendPaymentRejectedEmail(student, { ...submission.toObject(), rejectionReason }).catch(() => {});

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
  request.isArchived = true;
  request.archivedAt = new Date();
  request.archivedBy = adminId;
  request.archiveReason = reason;
  await request.save();
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

module.exports = { createPaymentRequests, submitPayment, approveSubmission, rejectSubmission, requestReupload, addInternalNote, archiveRequest, detectAndMarkOverdue, recalculateStudentProfile, getPaymentDashboardStats, logAudit, getUser };
