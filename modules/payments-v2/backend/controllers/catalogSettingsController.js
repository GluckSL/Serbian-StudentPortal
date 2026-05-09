/**
 * Payment Hub catalog settings controller.
 * Admin: GET/PUT /catalog/settings
 * Student: GET /my/catalog  (cumulative CEFR levels up to student's own level)
 */
const mongoose = require('mongoose');
const PaymentHubCatalog = require('../models/PaymentHubCatalog');
const { getAuthUserId } = require('../helpers/authUserId');

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// ─── Admin: get full catalog ───────────────────────────────────────────────
const getCatalogSettings = async (req, res) => {
  try {
    const catalog = await PaymentHubCatalog.getOrCreate();
    res.json({ success: true, data: catalog });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Admin: update catalog ─────────────────────────────────────────────────
const updateCatalogSettings = async (req, res) => {
  try {
    const { cefrRows, referenceRows, defaultInstallmentSchedule } = req.body;

    const adminId = getAuthUserId(req);

    const update = { updatedAt: new Date(), updatedBy: adminId || undefined };

    if (Array.isArray(cefrRows)) {
      const validated = cefrRows.map((r, i) => ({
        code: r.code,
        order: r.order ?? (i + 1),
        lkr: Number(r.lkr) || 0,
        inr: Number(r.inr) || 0,
      }));
      if (validated.some(r => !CEFR_ORDER.includes(r.code))) {
        return res.status(400).json({ success: false, message: 'Invalid CEFR code. Allowed: A1, A2, B1, B2, C1, C2.' });
      }
      update.cefrRows = validated;
    }

    if (Array.isArray(referenceRows)) {
      update.referenceRows = referenceRows.map(r => ({
        label: String(r.label || '').trim(),
        lkr: Number(r.lkr) || 0,
        inr: Number(r.inr) || 0,
      })).filter(r => r.label);
    }

    if (defaultInstallmentSchedule !== undefined) {
      const s = defaultInstallmentSchedule || {};
      update.defaultInstallmentSchedule = {
        title: String(s.title || '').trim(),
        notes: String(s.notes || '').trim(),
        steps: Array.isArray(s.steps) ? s.steps.map(step => ({
          label: step.label ? String(step.label).trim() : undefined,
          daysFromEnrollment: step.daysFromEnrollment != null ? Number(step.daysFromEnrollment) : undefined,
          amountLkr: step.amountLkr != null ? Number(step.amountLkr) : undefined,
          amountInr: step.amountInr != null ? Number(step.amountInr) : undefined,
        })) : [],
      };
    }

    const catalog = await PaymentHubCatalog.findByIdAndUpdate(
      'global',
      { $set: update },
      { new: true, upsert: true },
    );
    res.json({ success: true, data: catalog });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ─── Student: get visible catalog (cumulative CEFR up to own level) ────────
const getMyCatalog = async (req, res) => {
  try {
    const catalog = await PaymentHubCatalog.getOrCreate();

    const studentId = getAuthUserId(req);
    let studentLevel = '';
    if (studentId) {
      const User = mongoose.model('User');
      const u = await User.findById(studentId).select('level').lean();
      studentLevel = (u?.level || '').toUpperCase();
    }
    const levelIdx = CEFR_ORDER.indexOf(studentLevel);

    let visibleRows;
    if (levelIdx >= 0) {
      const maxOrder = levelIdx + 1;
      visibleRows = (catalog.cefrRows || [])
        .filter(r => r.order <= maxOrder)
        .sort((a, b) => a.order - b.order);
    } else {
      visibleRows = [];
    }

    res.json({
      success: true,
      data: {
        cefrRows: visibleRows,
        defaultInstallmentSchedule: catalog.defaultInstallmentSchedule || null,
        studentLevel: studentLevel || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = { getCatalogSettings, updateCatalogSettings, getMyCatalog };
