const PaymentTimelineEvent = require('../models/PaymentTimelineEvent');

const create = (data) => PaymentTimelineEvent.create(data).catch((e) => console.error('[Timeline]', e.message));

const onRequestCreated = (request, adminId, adminRole, adminName) =>
  create({ paymentRequestId: request._id, studentId: request.studentId, eventType: 'REQUEST_CREATED', actor: adminId, actorRole: adminRole, actorName: adminName, description: `Payment request created for ${request.currency} ${request.amount}` });

const onScreenshotUploaded = (submission, studentId) =>
  create({ paymentRequestId: submission.paymentRequestId, studentId, eventType: 'SCREENSHOT_UPLOADED', actorRole: 'STUDENT', description: 'Student uploaded payment screenshot' });

const onPaymentApproved = (submission, adminId, adminRole, adminName, isFullyPaid) =>
  create({ paymentRequestId: submission.paymentRequestId, studentId: submission.studentId, eventType: isFullyPaid ? 'FULLY_PAID' : 'PAYMENT_APPROVED', actor: adminId, actorRole: adminRole, actorName: adminName, description: `Payment of ${submission.currency} ${submission.paidAmount} approved${isFullyPaid ? ' — Fully paid!' : ''}` });

const onPaymentRejected = (submission, adminId, adminRole, adminName, reason) =>
  create({ paymentRequestId: submission.paymentRequestId, studentId: submission.studentId, eventType: 'PAYMENT_REJECTED', actor: adminId, actorRole: adminRole, actorName: adminName, description: `Payment rejected: ${reason}` });

const onReuploadRequested = (submission, adminId, adminName, note) =>
  create({ paymentRequestId: submission.paymentRequestId, studentId: submission.studentId, eventType: 'REUPLOAD_REQUESTED', actor: adminId, actorName: adminName, description: `Reupload requested: ${note || ''}` });

const onReceiptGenerated = (submission, receiptNumber) =>
  create({ paymentRequestId: submission.paymentRequestId, studentId: submission.studentId, eventType: 'RECEIPT_GENERATED', description: `Receipt generated: ${receiptNumber}` });

const onOverdueMarked = (request) =>
  create({ paymentRequestId: request._id, studentId: request.studentId, eventType: 'MARKED_OVERDUE', actorRole: 'SYSTEM', description: 'Payment marked overdue' });

const onNoteAdded = (request, adminId, adminRole, adminName, note) =>
  create({ paymentRequestId: request._id, studentId: request.studentId, eventType: 'NOTE_ADDED', actor: adminId, actorRole: adminRole, actorName: adminName, description: note.note });

const getTimelineForRequest = (paymentRequestId) =>
  PaymentTimelineEvent.find({ paymentRequestId }).sort({ createdAt: -1 }).lean();

module.exports = { onRequestCreated, onScreenshotUploaded, onPaymentApproved, onPaymentRejected, onReuploadRequested, onReceiptGenerated, onOverdueMarked, onNoteAdded, getTimelineForRequest };
