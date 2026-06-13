const { getAnalytics, getServiceProfessionBreakdown } = require('../services/salesAnalyticsAggregator');

async function analytics(req, res) {
  try {
    const data = await getAnalytics();
    res.json({ success: true, data });
  } catch (err) {
    console.error('[KrishDash] analytics error', err);
    res.status(500).json({ success: false, message: 'Failed to load analytics' });
  }
}

async function professionBreakdown(req, res) {
  try {
    const serviceName = String(req.query.serviceName || req.query.serviceKey || '').trim();
    if (!serviceName) {
      return res.status(400).json({ success: false, message: 'serviceName is required' });
    }
    const data = await getServiceProfessionBreakdown(serviceName);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[KrishDash] professionBreakdown error', err);
    res.status(500).json({ success: false, message: 'Failed to load profession breakdown' });
  }
}

module.exports = { analytics, professionBreakdown };
