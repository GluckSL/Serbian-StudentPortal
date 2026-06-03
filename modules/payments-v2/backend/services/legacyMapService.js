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

/** Payment requests that belong to a CEFR level slot (custom A1…B2 or imported language fee for that level). */
const findLevelSlotRequests = async ({ studentId, slotKey, currency, session }) => {
  const slot = String(slotKey || '').trim().toUpperCase();
  const slotRegex = new RegExp(`^${slot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

  const customRequests = await PaymentRequest.find({
    studentId,
    paymentType: 'CUSTOM_PAYMENT',
    customType: { $regex: slotRegex },
    currency,
    isArchived: false,
  })
    .session(session)
    .sort({ legacyImportedAt: 1, createdAt: 1 });

  const User = mongoose.model('User');
  const student = await User.findById(studentId).select('level').session(session).lean();
  const studentLevel = String(student?.level || '').trim().toUpperCase();

  let languageRequests = [];
  if (studentLevel === slot) {
    languageRequests = await PaymentRequest.find({
      studentId,
      paymentType: 'LANGUAGE_FEE',
      currency,
      isArchived: false,
      $or: [
        { customType: { $regex: slotRegex } },
        { customType: { $in: [null, ''] } },
        { customType: { $exists: false } },
      ],
    })
      .session(session)
      .sort({ legacyImportedAt: 1, createdAt: 1 });
  }

  const byId = new Map();
  for (const r of [...customRequests, ...languageRequests]) {
    byId.set(String(r._id), r);
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ta = a.legacyImportedAt || a.createdAt || 0;
    const tb = b.legacyImportedAt || b.createdAt || 0;
    return new Date(ta) - new Date(tb);
  });
};

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

  const requests = await findLevelSlotRequests({ studentId, slotKey: slot, currency, session });

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
  if (amountRemaining <= 0.02) {
    primary.status = 'FULLY_PAID';
  } else if (primary.dueDate && new Date(primary.dueDate) < now) {
    primary.status = 'OVERDUE';
  } else {
    primary.status = 'REQUESTED';
  }
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
  const quoted = Number(amount) || 0;
  const paid = Number(paidAmount) || 0;
  if (paid > quoted + 0.01) {
    throw new Error(
      `Paid amount (${currency} ${paid}) cannot exceed the request amount (${currency} ${quoted}). Check for an extra zero (e.g. 750000 vs 75000).`,
    );
  }
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

// ── Admin: edit an imported / legacy-mapped payment request ───────────────────

const isEditableLegacyRequest = (request) =>
  !!request
  && !request.isArchived
  && (request.isImported === true || request.source === SOURCE);

const updateLegacyPaymentRequest = async ({ requestId, adminId, updates }) => {
  const request = await PaymentRequest.findById(requestId);
  if (!request) throw new Error('Payment request not found');
  if (!isEditableLegacyRequest(request)) {
    throw new Error('Only imported or manually mapped payments can be edited here');
  }

  const {
    amount,
    paidAmount,
    amountRemaining,
    currency,
    dueDate,
    remarks,
    status,
  } = updates || {};

  if (currency && ['LKR', 'INR', 'USD'].includes(String(currency).toUpperCase())) {
    request.currency = String(currency).toUpperCase();
  }
  if (dueDate) {
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) throw new Error('Invalid due date');
    request.dueDate = d;
  }
  if (remarks !== undefined) {
    request.remarks = String(remarks || '').trim();
  }
  if (amount != null) {
    const a = Number(amount);
    if (!a || a <= 0 || Number.isNaN(a)) throw new Error('Requested amount must be greater than zero');
    request.amount = a;
  }

  const approvedSubs = await PaymentFlowSubmission.find({
    paymentRequestId: request._id,
    status: 'APPROVED',
    isArchived: false,
  });

  const applyPaidToRequest = (paid) => {
    const safePaid = Math.max(0, paid);
    if (safePaid > request.amount + 0.02) {
      throw new Error(`Paid amount cannot exceed requested total (${request.currency} ${request.amount})`);
    }
    request.amountRemaining = Math.max(0, request.amount - safePaid);
    return safePaid;
  };

  if (paidAmount != null) {
    const paid = applyPaidToRequest(Number(paidAmount) || 0);
    if (approvedSubs.length > 1) {
      throw new Error('Multiple approved payments on this request — delete extras or edit submissions separately');
    }
    if (approvedSubs.length === 1) {
      approvedSubs[0].paidAmount = paid;
      approvedSubs[0].currency = request.currency;
      await approvedSubs[0].save();
    } else if (paid > 0) {
      const due = request.dueDate || new Date();
      const fingerprint = buildFingerprint(
        request.studentId,
        request.paymentType,
        due,
        paid,
        request.currency,
        request.customType,
      );
      await PaymentFlowSubmission.create({
        paymentRequestId: request._id,
        studentId: request.studentId,
        paidAmount: paid,
        currency: request.currency,
        paymentMethod: 'Legacy',
        status: 'APPROVED',
        approvedBy: adminId,
        approvedAt: due,
        reviewedBy: adminId,
        reviewedAt: due,
        submittedAt: due,
        source: SOURCE,
        isImported: true,
        legacyFingerprint: fingerprint,
      });
    }
  } else if (amountRemaining != null) {
    const rem = Math.max(0, Number(amountRemaining) || 0);
    if (rem > request.amount + 0.02) {
      throw new Error('Balance cannot exceed requested amount');
    }
    request.amountRemaining = rem;
    const impliedPaid = Math.max(0, request.amount - rem);
    if (approvedSubs.length > 1) {
      throw new Error('Multiple approved payments on this request — delete extras or edit submissions separately');
    }
    if (approvedSubs.length === 1) {
      approvedSubs[0].paidAmount = impliedPaid;
      approvedSubs[0].currency = request.currency;
      await approvedSubs[0].save();
    } else if (impliedPaid > 0) {
      const due = request.dueDate || new Date();
      const fingerprint = buildFingerprint(
        request.studentId,
        request.paymentType,
        due,
        impliedPaid,
        request.currency,
        request.customType,
      );
      await PaymentFlowSubmission.create({
        paymentRequestId: request._id,
        studentId: request.studentId,
        paidAmount: impliedPaid,
        currency: request.currency,
        paymentMethod: 'Legacy',
        status: 'APPROVED',
        approvedBy: adminId,
        approvedAt: due,
        reviewedBy: adminId,
        reviewedAt: due,
        submittedAt: due,
        source: SOURCE,
        isImported: true,
        legacyFingerprint: fingerprint,
      });
    }
  }

  const allowedStatuses = ['REQUESTED', 'OVERDUE', 'FULLY_PAID', 'APPROVED'];
  if (status && allowedStatuses.includes(String(status).toUpperCase())) {
    request.status = String(status).toUpperCase();
  } else {
    const rem = request.amountRemaining ?? request.amount;
    const now = new Date();
    if (rem <= 0.02) {
      request.status = 'FULLY_PAID';
    } else if (request.dueDate && new Date(request.dueDate) < now) {
      request.status = 'OVERDUE';
    } else {
      request.status = 'REQUESTED';
    }
  }

  await request.save();

  await PaymentAuditLog.create({
    entityType: 'PaymentRequest',
    entityId: request._id,
    action: 'LEGACY_UPDATED',
    performedBy: adminId,
    performedByRole: 'ADMIN',
    newState: {
      amount: request.amount,
      amountRemaining: request.amountRemaining,
      currency: request.currency,
      status: request.status,
    },
    studentId: request.studentId,
  });

  await recalculateStudentProfile(request.studentId);
  return { request: request.toObject() };
};

/**
 * Record a level as fully paid at a custom amount (e.g. course upfront with 10% discount).
 * Clears pending submissions, consolidates slot requests, sets quote = paid = fullPaidAmount.
 */
const markLevelSlotFullPaid = async ({ studentId, adminId, slotKey, fullPaidAmount, currency, paymentDate, remarks }) => {
  const slot = String(slotKey || '').trim().toUpperCase();
  if (!LEVEL_SLOTS.has(slot)) {
    throw new Error('Full paid is only available for A1, A2, B1, and B2');
  }

  const amount = Number(fullPaidAmount);
  if (!amount || amount <= 0 || Number.isNaN(amount)) {
    throw new Error('fullPaidAmount must be a positive number');
  }
  const ccy = String(currency || 'LKR').toUpperCase();
  if (!['LKR', 'INR', 'USD'].includes(ccy)) {
    throw new Error('currency must be LKR, INR, or USD');
  }
  const payDate = paymentDate ? new Date(paymentDate) : new Date();
  if (Number.isNaN(payDate.getTime())) {
    throw new Error('Invalid payment date');
  }

  const session = await mongoose.startSession();
  let result = null;

  try {
    await session.withTransaction(async () => {
      const requests = await findLevelSlotRequests({ studentId, slotKey: slot, currency: ccy, session });
      const requestIds = requests.map((r) => r._id);
      const now = new Date();
      const note = remarks?.trim() || `Full paid — ${slot} (${ccy} ${amount})`;

      if (requestIds.length) {
        await PaymentFlowSubmission.updateMany(
          {
            paymentRequestId: { $in: requestIds },
            status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
            isArchived: false,
          },
          { $set: { isArchived: true, archivedAt: now, archivedBy: adminId } },
          { session },
        );
      }

      if (!requests.length) {
        result = await createLegacyRecord({
          studentId,
          adminId,
          paymentType: 'CUSTOM_PAYMENT',
          customType: slot,
          amount,
          paidAmount: amount,
          currency: ccy,
          paymentDate: payDate,
          remarks: note,
          session,
        });
        return;
      }

      const primary = requests[0];
      const extras = requests.slice(1);

      const approvedSubs = await PaymentFlowSubmission.find({
        paymentRequestId: { $in: requestIds },
        status: 'APPROVED',
        isArchived: false,
      }).session(session);

      for (const sub of approvedSubs) {
        if (extras.some((r) => String(r._id) === String(sub.paymentRequestId))) {
          sub.paymentRequestId = primary._id;
          await sub.save({ session });
        }
      }

      for (const req of extras) {
        req.isArchived = true;
        req.archivedAt = now;
        req.archivedBy = adminId;
        req.archiveReason = `${slot} full paid — consolidated`;
        await req.save({ session });
      }

      await PaymentFlowSubmission.updateMany(
        { paymentRequestId: primary._id, status: 'APPROVED', isArchived: false },
        { $set: { isArchived: true, archivedAt: now, archivedBy: adminId } },
        { session },
      );

      primary.paymentType = 'CUSTOM_PAYMENT';
      primary.customType = slot;
      primary.amount = amount;
      primary.amountRemaining = 0;
      primary.status = 'FULLY_PAID';
      primary.currency = ccy;
      primary.dueDate = payDate;
      primary.remarks = note;
      primary.source = SOURCE;
      primary.isImported = true;
      if (!primary.legacyImportedAt) primary.legacyImportedAt = now;
      if (!primary.legacyImportedBy) primary.legacyImportedBy = adminId;
      await primary.save({ session });

      const fingerprint = buildFingerprint(studentId, 'CUSTOM_PAYMENT', payDate, amount, ccy, slot);
      const [submission] = await PaymentFlowSubmission.create(
        [{
          paymentRequestId: primary._id,
          studentId,
          paidAmount: amount,
          currency: ccy,
          paymentMethod: 'Legacy',
          status: 'APPROVED',
          approvedBy: adminId,
          approvedAt: payDate,
          reviewedBy: adminId,
          reviewedAt: payDate,
          submittedAt: payDate,
          source: SOURCE,
          isImported: true,
          legacyFingerprint: fingerprint,
        }],
        { session },
      );

      await PaymentAuditLog.create(
        [{
          entityType: 'PaymentRequest',
          entityId: primary._id,
          action: 'LEVEL_FULL_PAID',
          performedBy: adminId,
          performedByRole: 'ADMIN',
          newState: { status: 'FULLY_PAID', amount, currency: ccy, slot },
          studentId,
          metadata: { slot, fullPaidAmount: amount, remarks: note },
        }],
        { session },
      );

      result = { request: primary, submission };
    });
  } finally {
    session.endSession();
  }

  await recalculateStudentProfile(studentId);
  return result;
};

module.exports = {
  mapLegacyPayments,
  bulkMapLegacyLanguageFees,
  reconcileLevelSlotQuote,
  updateLegacyPaymentRequest,
  isEditableLegacyRequest,
  markLevelSlotFullPaid,
};
