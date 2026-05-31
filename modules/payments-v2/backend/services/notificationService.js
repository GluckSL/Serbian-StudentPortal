const Notification = require('../models/Notification');

const createNotification = (data) => Notification.create(data).catch((e) => console.error('[Notification]', e.message));

const notifyPaymentRequestCreated = (studentId, request) =>
  createNotification({ recipientId: studentId, recipientRole: 'STUDENT', type: 'PAYMENT_REQUESTED', title: 'New Payment Request', message: `A payment of ${request.currency} ${request.amount} has been requested. Due: ${new Date(request.dueDate).toLocaleDateString()}`, relatedEntityType: 'PaymentRequest', relatedEntityId: request._id, priority: 'HIGH' });

const notifyPaymentApproved = (studentId, submission) =>
  createNotification({ recipientId: studentId, recipientRole: 'STUDENT', type: 'PAYMENT_APPROVED', title: 'Payment Approved!', message: `Your payment of ${submission.currency} ${submission.paidAmount} has been approved.${submission.receiptNumber ? ` Receipt: ${submission.receiptNumber}` : ''}`, relatedEntityType: 'PaymentFlowSubmission', relatedEntityId: submission._id, priority: 'NORMAL' });

const notifyPaymentRejected = (studentId, submission) =>
  createNotification({ recipientId: studentId, recipientRole: 'STUDENT', type: 'PAYMENT_REJECTED', title: 'Payment Rejected', message: `Your payment screenshot was rejected. Reason: ${submission.rejectionReason}`, relatedEntityType: 'PaymentFlowSubmission', relatedEntityId: submission._id, priority: 'HIGH' });

const notifyAdminNewSubmission = (adminId, submission) =>
  createNotification({ recipientId: submission.studentId, recipientRole: 'ADMIN', type: 'NEW_SUBMISSION', title: 'New Payment Submission', message: `A student submitted a payment screenshot for review.`, relatedEntityType: 'PaymentFlowSubmission', relatedEntityId: submission._id, priority: 'NORMAL' });

module.exports = { createNotification, notifyPaymentRequestCreated, notifyPaymentApproved, notifyPaymentRejected, notifyAdminNewSubmission };
