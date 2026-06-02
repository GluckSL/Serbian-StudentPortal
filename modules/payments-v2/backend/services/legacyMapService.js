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

/** Stable identity for legacy rows — level/customType included so A1 vs A2 do not collide. */
const buildFingerprint = (studentId, paymentType, paymentDate, paidAmount, currency, customType) => {
  const raw = [
    String(studentId),
    String(paymentType).toUpperCase(),
    String(customType || '').trim().toUpperCase(),
    new Date(paymentDate).toISOString().slice(0, 10),
    String(paidAmount),
    String(currency).toUpperCase(),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
};

/** Pre–level-slot fingerprints (remarks in hash) — used only for duplicate detection. */
const buildLegacyFingerprint = (studentId, paymentType, paymentDate, paidAmount, currency, remarks) => {
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

const dayBoundsUtc = (paymentDate) => {
  const d = new Date(paymentDate);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
  return { start, end };
};

const findExistingLegacySubmission = async ({ studentId, paymentType, customType, dueDate, paidAmount, currency, remarks, session }) => {
  const fingerprint = buildFingerprint(studentId, paymentType, dueDate, paidAmount, currency, customType);
  const legacyFp = buildLegacyFingerprint(studentId, paymentType, dueDate, paidAmount, currency, remarks);
  const fingerprints = [fingerprint, legacyFp].filter((v, i, a) => a.indexOf(v) === i);

  let existing = await PaymentFlowSubmission.findOne({ legacyFingerprint: { $in: fingerprints } })
    .session(session)
    .lean();
  if (existing) return { existing, fingerprint };

  const { start, end } = dayBoundsUtc(dueDate);
  existing = await PaymentFlowSubmission.findOne({
    studentId,
    paidAmount,
    currency,
    source: SOURCE,
    isImported: true,
    status: 'APPROVED',
    approvedAt: { $gte: start, $lte: end },
  })
    .session(session)
    .lean();
  if (!existing) return { existing: null, fingerprint };

  const existingRequest = await PaymentRequest.findById(existing.paymentRequestId).session(session).lean();
  if (!existingRequest || existingRequest.paymentType !== paymentType) return { existing: null, fingerprint };
  if (customType && existingRequest.customType
    && String(existingRequest.customType).toUpperCase() !== String(customType).toUpperCase()) {
    return { existing: null, fingerprint };
  }
  return { existing, fingerprint };
};

const LEVEL_SLOTS = new Set(['A1', 'A2', 'B1', 'B2']);

/**
 * Consolidate level-slot requests to a single quoted total (e.g. A1 = LKR 75,000).
 * Merges approved submissions onto the primary request and archives duplicates.
 */
const reconcileLevelSlotQuote = async ({ studentId, adminId, slotKey, currency, quotedTotal, session }) => {
  const slot = String(slotKey || '').trim().toUpperCase();
  if (!LEVEL_SLOTS.has(slot)) {
    return { updated: false, skipped: true };
  }
  const total = Number(quotedTotal);
  if (!total || total <= 0 || Number.isNaN(total)) {
    return { updated: false, skipped: true };
  }

  const requests = await PaymentRequest.find({
    studentId,
    paymentType: 'CUSTOM_PAYMENT',
    customType: { $regex: new RegExp(`^${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    currency,
    isArchived: false,
  })
    .session(session)
    .sort({ legacyImportedAt: 1, createdAt: 1 });

  if (!requests.length) {
    return { updated: false, noRequests: true, quotedTotal: total };
  }

  const requestIds = requests.map((r) => r._id);
  const submissions = await PaymentFlowSubmission.find({
    paymentRequestId: { $in: requestIds },
    status: 'APPROVED',
    isArchived: false,
  }).session(session);

  const totalPaid = submissions.reduce((s, sub) => s + (Number(sub.paidAmount) || 0), 0);
  const currentQuoted = requests.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const primary = requests[0];
  const extras = requests.slice(1);
  const now = new Date();

  for (const sub of submissions) {
    const parentId = String(sub.paymentRequestId);
    if (extras.some((r) => String(r._id) === parentId)) {
      sub.paymentRequestId = primary._id;
      await sub.save({ session });
    }
  }

  for (const req of extras) {
    req.isArchived = true;
    req.archivedAt = now;
    req.archivedBy = adminId;
    req.archiveReason = `${slot} slot consolidated — quoted total set to ${currency} ${total}`;
    await req.save({ session });
  }

  const amountRemaining = Math.max(0, total - totalPaid);
  primary.amount = total;
  primary.amountRemaining = amountRemaining;
  primary.status = amountRemaining <= 0 ? 'FULLY_PAID' : 'REQUESTED';
  await primary.save({ session });

  const changed =
    extras.length > 0
    || Math.abs(currentQuoted - total) > 0.02
    || Math.abs((primary.amountRemaining ?? 0) - amountRemaining) > 0.02;

  return {
    updated: changed,
    primaryRequestId: primary._id,
    quotedTotal: total,
    totalPaid,
    previousQuoted: currentQuoted,
    amountRemaining,
    archivedCount: extras.length,
  };
};

// ── Create one approved legacy record ─────────────────────────────────────────

const createLegacyRecord = async ({ studentId, adminId, paymentType, customType, amount, paidAmount, currency, paymentDate, remarks, session }) => {
  const now = new Date();
  const dueDate = paymentDate ? new Date(paymentDate) : now;
  const { existing, fingerprint } = await findExistingLegacySubmission({
    studentId,
    paymentType,
    customType,
    dueDate,
    paidAmount,
    currency,
    remarks,
    session,
  });

  // Duplicate check (participate in txn so we do not race another in-flight legacy insert)
  if (existing) {
    const existingRequest = await PaymentRequest.findById(existing.paymentRequestId).session(session).lean();
    const levelLabel = customType ? ` (${customType})` : '';
    const sameSlot =
      !customType ||
      !existingRequest?.customType ||
      String(existingRequest.customType).toUpperCase() === String(customType).toUpperCase();
    if (sameSlot) {
      return {
        request: existingRequest || { _id: existing.paymentRequestId },
        submission: existing,
        alreadyMapped: true,
      };
    }
    throw Object.assign(
      new Error(
        `Duplicate legacy record detected for ${paymentType}${levelLabel} on ${dueDate.toISOString().slice(0, 10)} (${currency} ${paidAmount}). Change the date, amount, or currency, or refresh the page if this payment is already listed.`,
      ),
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

      // Custom payments (level slots + docs-style custom lines)
      for (const custom of customPayments) {
        const paidAmount = Number(custom.amount) || 0;
        const quotedTotal = Number(custom.quotedTotal) > 0 ? Number(custom.quotedTotal) : null;
        let reconciled = null;

        if (quotedTotal) {
          reconciled = await reconcileLevelSlotQuote({
            studentId,
            adminId,
            slotKey: custom.paymentType,
            currency: custom.currency,
            quotedTotal,
            session,
          });
        }

        const remainingAfter = reconciled?.amountRemaining;
        const shouldRecordPayment =
          paidAmount > 0
          && (!reconciled?.updated || (remainingAfter != null && remainingAfter > 0.02 && paidAmount <= remainingAfter + 0.02));

        let record = null;
        if (shouldRecordPayment) {
          record = await createLegacyRecord({
            studentId,
            adminId,
            paymentType: 'CUSTOM_PAYMENT',
            customType: custom.paymentType,
            amount: quotedTotal || paidAmount,
            paidAmount,
            currency: custom.currency,
            paymentDate: custom.paymentDate,
            remarks: custom.remarks,
            session,
          });
        }

        results.custom.push({
          requestId: record?.request?._id || reconciled?.primaryRequestId,
          submissionId: record?.submission?._id,
          reconciled,
          alreadyMapped: record?.alreadyMapped,
        });
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

module.exports = { mapLegacyPayments, bulkMapLegacyLanguageFees, reconcileLevelSlotQuote };
