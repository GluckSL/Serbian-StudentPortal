// routes/engagementOverviewCrmExport.js
// Read-only CRM export for the Batch Engagement Overview (all 4 tabs).
// Auth: Authorization: Bearer <ENGAGEMENT_OVERVIEW_EXPORT_TOKEN>
// Mounted at /api/crm/engagement-overview (see app.js).

'use strict';

const express = require('express');
const router = express.Router();
const { buildEngagementExport } = require('../services/engagementOverviewCrmExport');

// GET /api/crm/engagement-overview/export
// Query params:
//   lite=true  — omit students[] arrays, return band counts only
router.get('/export', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const lite = req.query.lite === 'true';
    const data = await buildEngagementExport({ lite });
    res.json(data);
  } catch (err) {
    console.error('GET /api/crm/engagement-overview/export', err);
    res.status(500).json({ success: false, message: 'Failed to build engagement export.' });
  }
});

module.exports = router;
