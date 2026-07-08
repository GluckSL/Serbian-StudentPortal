const FinanceDashboardSettings = require('../models/FinanceDashboardSettings');
const { getAuthUserId } = require('../helpers/authUserId');
const { sendMorningReport, sendEveningReport } = require('../services/financeReportEmailService');

function toPlainObject(value) {
  if (!value) return {};
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

const getVisibleBatches = async (req, res) => {
  try {
    const settings = await FinanceDashboardSettings.getOrCreate();
    res.json({
      success: true,
      data: {
        visibleBatches: settings.visibleBatches || [],
        visibleBatchLevelStatuses: toPlainObject(settings.visibleBatchLevelStatuses),
        manualNextPaymentDates: toPlainObject(settings.manualNextPaymentDates),
        batchRemarks: toPlainObject(settings.batchRemarks),
        manualCommencementAmounts: toPlainObject(settings.manualCommencementAmounts),
        languageBatches: settings.languageBatches || [],
        excludedPendingBatches: settings.excludedPendingBatches || [],
        excludedStudentPending: toPlainObject(settings.excludedStudentPending),
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updateVisibleBatches = async (req, res) => {
  try {
    const { batches, batchLevelStatuses } = req.body || {};
    if (!Array.isArray(batches)) {
      return res.status(400).json({ success: false, message: 'batches must be an array.' });
    }
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.setVisibleBatches(batches, adminId, batchLevelStatuses);
    res.json({
      success: true,
      data: {
        visibleBatches: settings.visibleBatches || [],
        visibleBatchLevelStatuses: toPlainObject(settings.visibleBatchLevelStatuses),
        manualNextPaymentDates: toPlainObject(settings.manualNextPaymentDates),
        batchRemarks: toPlainObject(settings.batchRemarks),
        manualCommencementAmounts: toPlainObject(settings.manualCommencementAmounts),
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updateBatchCommencementDate = async (req, res) => {
  try {
    const batch = String(req.body?.batch || '').trim();
    if (!batch) {
      return res.status(400).json({ success: false, message: 'batch is required.' });
    }
    const date = req.body?.date;
    const dateIso = date == null || date === '' ? null : String(date).trim();
    if (dateIso && !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
      return res.status(400).json({ success: false, message: 'date must be YYYY-MM-DD.' });
    }
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.setManualNextPaymentDate(batch, dateIso, adminId);
    res.json({
      success: true,
      data: {
        batch,
        date: dateIso,
        manualNextPaymentDates: toPlainObject(settings.manualNextPaymentDates),
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updateBatchRemark = async (req, res) => {
  try {
    const batch = String(req.body?.batch || '').trim();
    if (!batch) {
      return res.status(400).json({ success: false, message: 'batch is required.' });
    }
    const remark = req.body?.remark;
    const text = remark == null || remark === '' ? null : String(remark).trim();
    if (text && text.length > 500) {
      return res.status(400).json({ success: false, message: 'remark must be 500 characters or fewer.' });
    }
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.setBatchRemark(batch, text, adminId);
    res.json({
      success: true,
      data: {
        batch,
        remark: text,
        batchRemarks: toPlainObject(settings.batchRemarks),
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updateBatchCommencementAmount = async (req, res) => {
  try {
    const batch = String(req.body?.batch || '').trim();
    if (!batch) {
      return res.status(400).json({ success: false, message: 'batch is required.' });
    }
    const clear = req.body?.clear === true;
    const amounts = clear
      ? null
      : {
          lkr: req.body?.lkr,
          inr: req.body?.inr,
        };
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.setManualCommencementAmount(batch, amounts, adminId);
    const saved = toPlainObject(settings.manualCommencementAmounts)[batch] || null;
    res.json({
      success: true,
      data: {
        batch,
        amounts: saved,
        manualCommencementAmounts: toPlainObject(settings.manualCommencementAmounts),
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const triggerReport = async (req, res) => {
  try {
    const type = String(req.params.type || '').toLowerCase();
    if (!['morning', 'evening'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be "morning" or "evening".' });
    }
    // Run async — don't wait so the HTTP response is instant
    const fn = type === 'morning' ? sendMorningReport : sendEveningReport;
    // force: true — manual triggers bypass the daily idempotency guard so admins can resend.
    fn({ force: true }).catch((err) =>
      console.error(`[FinanceReport] ❌ Manual ${type} trigger failed:`, err.message),
    );
    res.json({
      success: true,
      message: `${type === 'morning' ? '10 AM morning' : '6 PM evening'} finance report is being sent.`,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updateLanguageBatches = async (req, res) => {
  try {
    const { batches } = req.body || {};
    if (!Array.isArray(batches)) {
      return res.status(400).json({ success: false, message: 'batches must be an array.' });
    }
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.setLanguageBatches(batches, adminId);
    res.json({
      success: true,
      data: {
        languageBatches: settings.languageBatches || [],
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updatePendingBatchExclusion = async (req, res) => {
  try {
    const batch = String(req.body?.batch || '').trim();
    if (!batch) {
      return res.status(400).json({ success: false, message: 'batch is required.' });
    }
    const exclude = req.body?.excluded === true;
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.toggleExcludedPendingBatch(batch, exclude, adminId);
    res.json({
      success: true,
      data: {
        batch,
        excluded: exclude,
        excludedPendingBatches: settings.excludedPendingBatches || [],
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updatePendingStudentExclusion = async (req, res) => {
  try {
    const batch = String(req.body?.batch || '').trim();
    const studentId = String(req.body?.studentId || '').trim();
    if (!batch) {
      return res.status(400).json({ success: false, message: 'batch is required.' });
    }
    if (!studentId) {
      return res.status(400).json({ success: false, message: 'studentId is required.' });
    }
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.toggleExcludedStudentPending(
      batch,
      studentId,
      req.body?.pending,
      adminId,
    );
    const batchMap = toPlainObject(settings.excludedStudentPending)[batch] || {};
    res.json({
      success: true,
      data: {
        batch,
        studentId,
        excluded: studentId in batchMap,
        students: batchMap,
        excludedStudentPending: toPlainObject(settings.excludedStudentPending),
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updateExcludedStudentsForBatch = async (req, res) => {
  try {
    const batch = String(req.body?.batch || '').trim();
    if (!batch) {
      return res.status(400).json({ success: false, message: 'batch is required.' });
    }
    const students = req.body?.students;
    if (students != null && typeof students !== 'object') {
      return res.status(400).json({ success: false, message: 'students must be an object.' });
    }
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.setExcludedStudentsForBatch(batch, students || {}, adminId);
    res.json({
      success: true,
      data: {
        batch,
        students: toPlainObject(settings.excludedStudentPending)[batch] || {},
        excludedStudentPending: toPlainObject(settings.excludedStudentPending),
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = {
  getVisibleBatches,
  updateVisibleBatches,
  updateBatchCommencementDate,
  updateBatchRemark,
  updateBatchCommencementAmount,
  triggerReport,
  updateLanguageBatches,
  updatePendingBatchExclusion,
  updatePendingStudentExclusion,
  updateExcludedStudentsForBatch,
};
