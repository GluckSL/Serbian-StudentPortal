const FinanceDashboardSettings = require('../models/FinanceDashboardSettings');
const { getAuthUserId } = require('../helpers/authUserId');
const { sendMorningReport, sendEveningReport } = require('../services/financeReportEmailService');

const getVisibleBatches = async (req, res) => {
  try {
    const settings = await FinanceDashboardSettings.getOrCreate();
    res.json({
      success: true,
      data: {
        visibleBatches: settings.visibleBatches || [],
        updatedAt: settings.updatedAt || null,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const updateVisibleBatches = async (req, res) => {
  try {
    const { batches } = req.body || {};
    if (!Array.isArray(batches)) {
      return res.status(400).json({ success: false, message: 'batches must be an array.' });
    }
    const adminId = getAuthUserId(req);
    const settings = await FinanceDashboardSettings.setVisibleBatches(batches, adminId);
    res.json({
      success: true,
      data: {
        visibleBatches: settings.visibleBatches || [],
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
    fn().catch((err) =>
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

module.exports = {
  getVisibleBatches,
  updateVisibleBatches,
  triggerReport,
};
