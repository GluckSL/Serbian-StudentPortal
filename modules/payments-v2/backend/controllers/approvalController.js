/**
 * Approval Controller
 * Auth user id: req.user.id (JWT from routes/auth.js) — see helpers/authUserId.js
 */
const PaymentFlowSubmission = require('../models/PaymentSubmission');
const paymentService = require('../services/paymentService');
const s3Service = require('../services/s3Service');
const { getAuthUserId } = require('../helpers/authUserId');

const getAdminName = async (userId) => {
  const user = await paymentService.getUser(userId);
  return user?.name || 'Admin';
};

// ─── Approval Queue (admin) ────────────────────────────────────────────────
const getApprovalQueue = async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'SUBMITTED,UNDER_REVIEW', sort = '-submittedAt' } = req.query;
    const statusArr = status.split(',').map((s) => s.trim());
    const skip = (Number(page) - 1) * Number(limit);

    const [submissions, total] = await Promise.all([
      PaymentFlowSubmission.find({ status: { $in: statusArr }, isArchived: false })
        .populate('studentId', 'name email batch level')
        .populate('paymentRequestId', 'amount amountRemaining currency paymentType customType dueDate remarks installmentAllowed totalInstallments')
        .populate('reviewedBy', 'name')
        .populate('approvedBy', 'name')
        .sort(sort)
        .skip(skip)
        .limit(Number(limit)),
      PaymentFlowSubmission.countDocuments({ status: { $in: statusArr }, isArchived: false }),
    ]);

    const enriched = await Promise.all(
      submissions.map(async (sub) => {
        let screenshotViewUrl = null;
        if (sub.screenshotKey) {
          screenshotViewUrl = await s3Service.resolveScreenshotViewUrl(sub.screenshotKey).catch(() => null);
        }
        return { ...sub.toObject(), screenshotViewUrl };
      })
    );

    res.json({ success: true, data: enriched, total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Single submission detail ──────────────────────────────────────────────
const getSubmissionDetail = async (req, res) => {
  try {
    const submission = await PaymentFlowSubmission.findById(req.params.submissionId)
      .populate('studentId', 'name email batch level enrollmentDate')
      .populate('paymentRequestId')
      .populate('approvedBy', 'name email')
      .populate('reviewedBy', 'name email');

    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    let screenshotViewUrl = null;
    if (submission.screenshotKey) {
      screenshotViewUrl = await s3Service.resolveScreenshotViewUrl(submission.screenshotKey).catch(() => null);
    }

    const PaymentAuditLog = require('../models/PaymentAuditLog');
    const auditLogs = await PaymentAuditLog.find({ entityId: submission._id, entityType: 'PaymentFlowSubmission' })
      .populate('performedBy', 'name')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: { ...submission.toObject(), screenshotViewUrl, auditLogs } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Approve ──────────────────────────────────────────────────────────────
const approvePayment = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    const adminName = await getAdminName(adminId);
    const result = await paymentService.approveSubmission({
      submissionId: req.params.submissionId,
      adminId,
      adminRole: req.user.role,
      adminName,
      adminRemarks: req.body.adminRemarks,
      paidAmount: req.body.paidAmount,
    });
    res.json({ success: true, data: result.submission, receiptNumber: result.receiptNumber, isFullyPaid: result.isFullyPaid, message: result.isFullyPaid ? 'Payment fully paid and approved.' : 'Payment approved (partial).' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ─── Reject ───────────────────────────────────────────────────────────────
const rejectPayment = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    if (!rejectionReason?.trim()) return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    const adminId = getAuthUserId(req);
    const adminName = await getAdminName(adminId);
    const result = await paymentService.rejectSubmission({
      submissionId: req.params.submissionId,
      adminId,
      adminRole: req.user.role,
      adminName,
      rejectionReason: rejectionReason.trim(),
    });
    res.json({ success: true, data: result, message: 'Payment rejected.' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ─── Request Reupload ─────────────────────────────────────────────────────
const requestReupload = async (req, res) => {
  try {
    const { reuploadNote } = req.body;
    const adminId = getAuthUserId(req);
    const adminName = await getAdminName(adminId);
    const result = await paymentService.requestReupload({ submissionId: req.params.submissionId, adminId, adminRole: req.user.role, adminName, reuploadNote: reuploadNote || 'Please re-upload a clearer screenshot.' });
    res.json({ success: true, data: result, message: 'Reupload requested.' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ─── Move to Under Review ─────────────────────────────────────────────────
const moveToUnderReview = async (req, res) => {
  try {
    const submission = await PaymentFlowSubmission.findById(req.params.submissionId);
    if (!submission) return res.status(404).json({ success: false, message: 'Not found' });
    if (submission.status !== 'SUBMITTED') return res.status(400).json({ success: false, message: 'Can only move SUBMITTED to UNDER_REVIEW' });
    submission.status = 'UNDER_REVIEW';
    submission.reviewedBy = getAuthUserId(req);
    submission.reviewedAt = new Date();
    await submission.save();
    res.json({ success: true, data: submission, message: 'Moved to Under Review.' });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

// ─── Correct approved amount (admin data entry mistake) ─────────────────────
const correctApprovedAmount = async (req, res) => {
  try {
    const newPaidAmount = Number(req.body.newPaidAmount);
    if (newPaidAmount < 0 || Number.isNaN(newPaidAmount)) {
      return res.status(400).json({ success: false, message: 'newPaidAmount must be a non-negative number' });
    }
    const adminId = getAuthUserId(req);
    const result = await paymentService.correctApprovedSubmissionAmount({
      submissionId: req.params.submissionId,
      newPaidAmount,
      adminId,
      adminRole: req.user.role,
      adminRemarks: req.body.adminRemarks,
    });
    res.json({
      success: true,
      data: result,
      message: `Payment amount corrected from ${result.previousAmount} to ${result.newPaidAmount}.`,
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
};

module.exports = {
  getApprovalQueue,
  getSubmissionDetail,
  approvePayment,
  rejectPayment,
  requestReupload,
  moveToUnderReview,
  correctApprovedAmount,
};
