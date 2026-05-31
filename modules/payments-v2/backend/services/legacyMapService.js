/**
 * Legacy Payment Mapping Service
 *
 * Creates fully-approved payment records (PaymentRequest + PaymentFlowSubmission)
 * for historical payments that exist only in Excel sheets.
 * No student emails or receipts are generated — these are back-filled admin records.
 */
const mongoose = require('mongoose');
const crypto = require('crypto');
const PaymentRequest = require('../models/PaymentRequest');
const PaymentFlowSubmission = require('../models/PaymentSubmission');
const PaymentAuditLog = require('../models/PaymentAuditLog');
const PaymentTimelineEvent = require('../models/PaymentTimelineEvent');
const { recalculateStudentProfile } = require('./paymentService');

const SOURCE = 'LEGACY_MANUAL_MAPPING';

// ── Fingerprint for duplicate detection ────────────────────────────────────────

const buildFingerprint = (studentId, paymentType, paymentDate, paidAmount, currency, remarks) => {
  const raw = [
    String(studentId),
    String(paymentType).toUpperCase(),
    new Date(paymentDate).toISOString().slice(0, 10),
    String(paidAmount),
    String(currency).toUpperCase(),
    (remarks || '').trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
};

// ── Create one approved legacy record ─────────────────────────────────────────

const createLegacyRecord = async ({ studentId, adminId, paymentType, customType, amount, paidAmount, currency, paymentDate, remarks, session }) => {
  const now = new Date();
  const dueDate = paymentDate ? new Date(paymentDate) : now;
  const fingerprint = buildFingerprint(studentId, paymentType, dueDate, paidAmount, currency, remarks);

  // Duplicate check (participate in txn so we do not race another in-flight legacy insert)
  const existing = await PaymentFlowSubmission.findOne({ legacyFingerprint: fingerprint }).session(session).lean();
  if (existing) {
    throw Object.assign(
      new Error(`Duplicate legacy record detected for ${paymentType} on ${dueDate.toISOString().slice(0, 10)} (${currency} ${paidAmount})`),
      { code: 'DUPLICATE', fingerprint },
    );
  }

  // Create PaymentRequest as the billing anchor
  const [request] = await PaymentRequest.create(
    [{
      studentId,
      requestedBy: adminId,
      amount,
      currency,
      paymentType,
      customType: ['CUSTOM_PAYMENT', 'Custom'].includes(paymentType) ? customType : undefined,
      dueDate,
      remarks,
      installmentAllowed: false,
      totalInstallments: 1,
      amountRemaining: amount,
      status: 'REQUESTED',
      source: SOURCE,
      isImported: true,
      legacyImportedAt: now,
      legacyImportedBy: adminId,
    }],
    { session },
  );

  // Create PaymentFlowSubmission already approved
  const [submission] = await PaymentFlowSubmission.create(
    [{
      paymentRequestId: request._id,
      studentId,
      paidAmount,
      currency,
      paymentMethod: 'Legacy',
      status: 'APPROVED',
      approvedBy: adminId,
      approvedAt: dueDate,
      reviewedBy: adminId,
      reviewedAt: dueDate,
      submittedAt: dueDate,
      source: SOURCE,
      isImported: true,
      legacyFingerprint: fingerprint,
    }],
    { session },
  );

  // Apply approved amount to the request inside the same transaction. Legacy rows are never
  // installment plans; applyPaymentToInstallments uses findById/save without a session and cannot
  // see uncommitted writes, so it would skip updates and break the txn flow.
  request.amountRemaining = Math.max(0, (request.amountRemaining ?? request.amount) - paidAmount);
  request.status = request.amountRemaining <= 0 ? 'FULLY_PAID' : 'REQUESTED';
  await request.save({ session });

  // Audit
  await PaymentAuditLog.create([
    {
      entityType: 'PaymentRequest',
      entityId: request._id,
      action: 'LEGACY_MAPPED',
      performedBy: adminId,
      performedByRole: 'ADMIN',
      newState: { status: 'REQUESTED', amount, currency, source: SOURCE },
      studentId,
    },
    {
      entityType: 'PaymentFlowSubmission',
      entityId: submission._id,
      action: 'LEGACY_MAPPED',
      performedBy: adminId,
      performedByRole: 'ADMIN',
      newState: { status: 'APPROVED', paidAmount, currency, source: SOURCE },
      studentId,
    },
  ], { session, ordered: true });

  // Timeline
  await PaymentTimelineEvent.create(
    [{
      paymentRequestId: request._id,
      studentId,
      eventType: 'LEGACY_PAYMENT_MAPPED',
      actor: adminId,
      actorRole: 'ADMIN',
      description: `Legacy payment mapped: ${currency} ${paidAmount} for ${paymentType}${customType ? ' — ' + customType : ''}`,
      metadata: { source: SOURCE, paidAmount, currency, paymentType },
    }],
    { session },
  );

  return { request, submission };
};

// ── Main entry point ───────────────────────────────────────────────────────────

const mapLegacyPayments = async ({ studentId, adminId, languagePayment, docsPayments = [], visaPayments = [], customPayments = [] }) => {
  const session = await mongoose.startSession();
  const results = { language: null, docs: [], visa: [], custom: [] };

  try {
    await session.withTransaction(async () => {
      // Language payment
      if (languagePayment) {
        const { totalCourseFee, amountPaid, currency, paymentDate, remarks, markFullyPaid } = languagePayment;
        const effectivePaid = markFullyPaid ? totalCourseFee : amountPaid;
        const { request, submission } = await createLegacyRecord({
          studentId, adminId,
          paymentType: 'LANGUAGE_FEE',
          amount: totalCourseFee,
          paidAmount: effectivePaid,
          currency, paymentDate, remarks, session,
        });
        results.language = { requestId: request._id, submissionId: submission._id };
      }

      // Docs payments
      for (const doc of docsPayments) {
        const { request, submission } = await createLegacyRecord({
          studentId, adminId,
          paymentType: 'DOCS_PAYMENT',
          amount: doc.amount,
          paidAmount: doc.amount,
          currency: doc.currency,
          paymentDate: doc.paymentDate,
          remarks: doc.remarks,
          session,
        });
        results.docs.push({ requestId: request._id, submissionId: submission._id });
      }

      // Visa payments
      for (const visa of visaPayments) {
        const { request, submission } = await createLegacyRecord({
          studentId, adminId,
          paymentType: 'VISA_PAYMENT',
          amount: visa.amount,
          paidAmount: visa.amount,
          currency: visa.currency,
          paymentDate: visa.paymentDate,
          remarks: visa.remarks,
          session,
        });
        results.visa.push({ requestId: request._id, submissionId: submission._id });
      }

      // Custom payments
      for (const custom of customPayments) {
        const { request, submission } = await createLegacyRecord({
          studentId, adminId,
          paymentType: 'CUSTOM_PAYMENT',
          customType: custom.paymentType,
          amount: custom.amount,
          paidAmount: custom.amount,
          currency: custom.currency,
          paymentDate: custom.paymentDate,
          remarks: custom.remarks,
          session,
        });
        results.custom.push({ requestId: request._id, submissionId: submission._id });
      }
    });
  } finally {
    session.endSession();
  }

  // Profile rebuild is outside the transaction (reads from committed data)
  await recalculateStudentProfile(studentId);

  return results;
};

// ── Bulk: one full LANGUAGE_FEE legacy record per student (balance cleared) ───

const bulkMapLegacyLanguageFees = async ({ adminId, rows }) => {
  const succeeded = [];
  const failed = [];

  for (const row of rows) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await createLegacyRecord({
          studentId: row.studentId,
          adminId,
          paymentType: 'LANGUAGE_FEE',
          amount: row.totalCourseFee,
          paidAmount: row.amountPaid,
          currency: row.currency,
          paymentDate: row.paymentDate,
          remarks: row.remarks || 'Bulk language fee — balance cleared',
          session,
        });
      });
      await recalculateStudentProfile(row.studentId);
      succeeded.push({ studentId: String(row.studentId) });
    } catch (err) {
      failed.push({
        studentId: String(row.studentId),
        message: err.message || 'Unknown error',
        code: err.code,
      });
    } finally {
      session.endSession();
    }
  }

  return { succeeded, failed };
};

module.exports = { mapLegacyPayments, bulkMapLegacyLanguageFees };
