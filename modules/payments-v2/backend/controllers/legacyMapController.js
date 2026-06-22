/**
 * Legacy Payment Map Controller
 * POST /legacy/map-payment
 * Requires finance-admin role (requireFinanceAdmin middleware).
 */
const mongoose = require('mongoose');
const { getAuthUserId } = require('../helpers/authUserId');
const {
  mapLegacyPayments,
  bulkMapLegacyLanguageFees,
  updateLegacyPaymentRequest,
  markLevelSlotFullPaid,
} = require('../services/legacyMapService');

const mapLegacyPaymentsHandler = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { studentId, languagePayment, docsPayments, visaPayments, customPayments } = req.body;

    // ── Validate studentId ────────────────────────────────────────────────────
    if (!studentId || !mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ success: false, message: 'Valid studentId is required' });
    }

    const User = mongoose.model('User');
    const student = await User.findOne({ _id: studentId, role: 'STUDENT' }).lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // ── Validate at least one payment section ─────────────────────────────────
    const hasLanguage = !!languagePayment;
    const hasDocs = Array.isArray(docsPayments) && docsPayments.length > 0;
    const hasVisa = Array.isArray(visaPayments) && visaPayments.length > 0;
    const hasCustom = Array.isArray(customPayments) && customPayments.length > 0;

    if (!hasLanguage && !hasDocs && !hasVisa && !hasCustom) {
      return res.status(400).json({ success: false, message: 'At least one payment section must be provided' });
    }

    // ── Validate language payment ─────────────────────────────────────────────
    if (hasLanguage) {
      const lp = languagePayment;
      if (!lp.totalCourseFee || lp.totalCourseFee <= 0) {
        return res.status(400).json({ success: false, message: 'languagePayment.totalCourseFee must be > 0' });
      }
      const effectivePaid = lp.markFullyPaid ? lp.totalCourseFee : lp.amountPaid;
      if (!effectivePaid || effectivePaid <= 0) {
        return res.status(400).json({ success: false, message: 'languagePayment.amountPaid must be > 0' });
      }
      if (!['LKR', 'INR', 'USD'].includes(lp.currency)) {
        return res.status(400).json({ success: false, message: 'languagePayment.currency must be LKR, INR, or USD' });
      }
      if (!lp.paymentDate || isNaN(Date.parse(lp.paymentDate))) {
        return res.status(400).json({ success: false, message: 'languagePayment.paymentDate must be a valid date' });
      }
    }

    // ── Validate array items ──────────────────────────────────────────────────
    const validateItems = (items, label) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.amount || item.amount <= 0) {
          throw new Error(`${label}[${i}].amount must be > 0`);
        }
        if (!['LKR', 'INR', 'USD'].includes(item.currency)) {
          throw new Error(`${label}[${i}].currency must be LKR, INR, or USD`);
        }
        if (!item.paymentDate || isNaN(Date.parse(item.paymentDate))) {
          throw new Error(`${label}[${i}].paymentDate must be a valid date`);
        }
      }
    };

    try {
      if (hasDocs) validateItems(docsPayments, 'docsPayments');
      if (hasVisa) validateItems(visaPayments, 'visaPayments');
      if (hasCustom) {
        for (let i = 0; i < customPayments.length; i++) {
          const item = customPayments[i];
          if (!item.paymentType || !String(item.paymentType).trim()) {
            throw new Error(`customPayments[${i}].paymentType is required`);
          }
          const hasQuote = Number(item.quotedTotal) > 0;
          const amt = Number(item.amount);
          if ((!amt || amt <= 0) && !hasQuote) {
            throw new Error(`customPayments[${i}].amount or quotedTotal is required`);
          }
          if (item.quotedTotal != null && item.quotedTotal !== '' && !hasQuote) {
            throw new Error(`customPayments[${i}].quotedTotal must be a positive number`);
          }
          if (!['LKR', 'INR', 'USD'].includes(item.currency)) {
            throw new Error(`customPayments[${i}].currency must be LKR, INR, or USD`);
          }
          if (!item.paymentDate || isNaN(Date.parse(item.paymentDate))) {
            throw new Error(`customPayments[${i}].paymentDate must be a valid date`);
          }
        }
      }
    } catch (validationErr) {
      return res.status(400).json({ success: false, message: validationErr.message });
    }

    // ── Execute ───────────────────────────────────────────────────────────────
    const results = await mapLegacyPayments({
      studentId,
      adminId,
      languagePayment,
      docsPayments: docsPayments || [],
      visaPayments: visaPayments || [],
      customPayments: customPayments || [],
    });

    return res.status(201).json({
      success: true,
      message: 'Legacy payments mapped successfully',
      data: results,
    });
  } catch (err) {
    if (err.code === 'DUPLICATE' || (err.code === 11000) || (err.errorResponse?.code === 11000)) {
      return res.status(409).json({ success: false, message: err.message || 'Duplicate legacy payment detected' });
    }
    console.error('[LegacyMap]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to map legacy payments' });
  }
};

const bulkMapLegacyLanguageFeesHandler = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: 'rows array is required and must not be empty' });
    }
    if (rows.length > 300) {
      return res.status(400).json({ success: false, message: 'Maximum 300 students per bulk operation' });
    }

    const User = mongoose.model('User');
    const normalized = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sid = r.studentId;
      if (!sid || !mongoose.isValidObjectId(sid)) {
        return res.status(400).json({ success: false, message: `rows[${i}].studentId is invalid` });
      }
      const totalCourseFee = Number(r.totalCourseFee);
      const amountPaid = Number(r.amountPaid ?? r.totalCourseFee);
      const currency = r.currency;
      if (!totalCourseFee || totalCourseFee <= 0 || Number.isNaN(totalCourseFee)) {
        return res.status(400).json({ success: false, message: `rows[${i}].totalCourseFee must be a positive number` });
      }
      if (!amountPaid || amountPaid <= 0 || Number.isNaN(amountPaid)) {
        return res.status(400).json({ success: false, message: `rows[${i}].amountPaid must be a positive number` });
      }
      if (!['LKR', 'INR', 'USD'].includes(currency)) {
        return res.status(400).json({ success: false, message: `rows[${i}].currency must be LKR, INR, or USD` });
      }
      const paymentDate = r.paymentDate ? new Date(r.paymentDate) : new Date();
      if (Number.isNaN(paymentDate.getTime())) {
        return res.status(400).json({ success: false, message: `rows[${i}].paymentDate is invalid` });
      }

      const student = await User.findOne({ _id: sid, role: 'STUDENT' }).select('_id').lean();
      if (!student) {
        return res.status(404).json({ success: false, message: `Student not found: ${sid}` });
      }

      normalized.push({
        studentId: sid,
        totalCourseFee,
        amountPaid,
        currency,
        paymentDate,
        remarks: r.remarks ? String(r.remarks).trim() : undefined,
      });
    }

    const result = await bulkMapLegacyLanguageFees({ adminId, rows: normalized });

    const allOk = result.failed.length === 0;
    return res.status(allOk ? 201 : 200).json({
      success: allOk,
      message: allOk
        ? `Recorded language fees for ${result.succeeded.length} student(s).`
        : `Partial result: ${result.succeeded.length} succeeded, ${result.failed.length} failed.`,
      data: result,
    });
  } catch (err) {
    console.error('[LegacyBulk]', err);
    return res.status(500).json({ success: false, message: err.message || 'Bulk map failed' });
  }
};

const updateLegacyPaymentRequestHandler = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { requestId } = req.params;
    if (!requestId || !mongoose.isValidObjectId(requestId)) {
      return res.status(400).json({ success: false, message: 'Valid requestId is required' });
    }

    const { amount, paidAmount, amountRemaining, currency, dueDate, remarks, status } = req.body;
    const hasField =
      amount != null
      || paidAmount != null
      || amountRemaining != null
      || currency
      || dueDate
      || remarks !== undefined
      || status;
    if (!hasField) {
      return res.status(400).json({ success: false, message: 'At least one field to update is required' });
    }

    const data = await updateLegacyPaymentRequest({
      requestId,
      adminId,
      updates: { amount, paidAmount, amountRemaining, currency, dueDate, remarks, status },
    });

    return res.json({ success: true, message: 'Payment record updated', data });
  } catch (err) {
    console.error('[LegacyUpdate]', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to update payment' });
  }
};

const markLevelSlotFullPaidHandler = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { studentId, slotKey, fullPaidAmount, currency, paymentDate, remarks } = req.body;
    if (!studentId || !mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ success: false, message: 'Valid studentId is required' });
    }
    if (!slotKey || !['A1', 'A2', 'B1', 'B2'].includes(String(slotKey).trim().toUpperCase())) {
      return res.status(400).json({ success: false, message: 'slotKey must be A1, A2, B1, or B2' });
    }

    const User = mongoose.model('User');
    const student = await User.findOne({ _id: studentId, role: 'STUDENT' }).select('_id').lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    const result = await markLevelSlotFullPaid({
      studentId,
      adminId,
      slotKey: String(slotKey).trim().toUpperCase(),
      fullPaidAmount,
      currency,
      paymentDate,
      remarks,
    });

    const slot = String(slotKey).trim().toUpperCase();
    const amt = Number(fullPaidAmount);
    const ccy = String(currency || 'LKR').toUpperCase();
    return res.status(201).json({
      success: true,
      message: `${slot} marked full paid at ${ccy} ${amt.toLocaleString('en-IN')} — no balance due`,
      data: {
        requestId: result?.request?._id,
        submissionId: result?.submission?._id,
      },
    });
  } catch (err) {
    console.error('[LevelFullPaid]', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to mark level full paid' });
  }
};

const resetPaymentSlotHandler = async (req, res) => {
  try {
    const adminId = getAuthUserId(req);
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Not authenticated' });
    }

    const { studentId } = req.params;
    const { slotKey, reason, requestIds } = req.body;
    if (!studentId || !mongoose.isValidObjectId(studentId)) {
      return res.status(400).json({ success: false, message: 'Valid studentId is required' });
    }
    const slot = String(slotKey || '').trim().toUpperCase();
    if (!['A1', 'A2', 'B1', 'B2', 'DOCS', 'VISA'].includes(slot)) {
      return res.status(400).json({ success: false, message: 'slotKey must be A1, A2, B1, B2, DOCS, or VISA' });
    }

    const paymentService = require('../services/paymentService');
    const result = await paymentService.resetPaymentSlot({
      studentId,
      slotKey: slot,
      adminId,
      adminRole: req.user.role,
      reason,
      requestIds: Array.isArray(requestIds) ? requestIds : undefined,
    });

    const cleared = result.requestsArchived > 0;
    return res.json({
      success: true,
      message: cleared
        ? `${slot} payments cleared — paid and balance are now 0 (${result.requestsArchived} record${result.requestsArchived === 1 ? '' : 's'} archived)`
        : `${slot} was already empty — nothing to reset`,
      data: result,
    });
  } catch (err) {
    console.error('[SlotReset]', err);
    return res.status(400).json({ success: false, message: err.message || 'Failed to reset payment slot' });
  }
};

module.exports = {
  mapLegacyPaymentsHandler,
  bulkMapLegacyLanguageFeesHandler,
  updateLegacyPaymentRequestHandler,
  markLevelSlotFullPaidHandler,
  resetPaymentSlotHandler,
};
