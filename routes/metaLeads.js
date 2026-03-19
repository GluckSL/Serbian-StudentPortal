// routes/metaLeads.js
const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const { fetchMetaLeads, parseMetaLead, getPageAccessToken } = require('../services/metaLeadsService');

// Helper function to get Meta configuration
function getMetaConfig() {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  const formId = process.env.META_FORM_ID && process.env.META_FORM_ID.trim() !== '' && process.env.META_FORM_ID !== 'your_lead_form_id_here' 
    ? process.env.META_FORM_ID 
    : null; // null means fetch from all forms
  
  return { accessToken, pageId, formId };
}

// Get leads from today
router.get('/today', verifyToken, isAdmin, async (req, res) => {
  try {
    const { accessToken, pageId, formId } = getMetaConfig();

    if (!accessToken || !pageId) {
      return res.status(400).json({
        success: false,
        message: 'Meta credentials not configured. Please add META_ACCESS_TOKEN and META_PAGE_ID to .env file'
      });
    }

    // Get leads from today (midnight to now)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    console.log('📊 Fetching leads from today:', today);

    const leads = await fetchMetaLeads(accessToken, pageId, formId, today);
    const parsedLeads = leads.map(lead => parseMetaLead(lead));

    res.json({
      success: true,
      count: parsedLeads.length,
      date: today.toISOString().split('T')[0],
      leads: parsedLeads
    });

  } catch (error) {
    console.error('Error fetching today\'s leads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leads',
      error: error.response?.data?.error?.message || error.message
    });
  }
});

// Get leads from last N days
router.get('/last-days/:days', verifyToken, isAdmin, async (req, res) => {
  try {
    const { accessToken, pageId, formId } = getMetaConfig();
    const days = parseInt(req.params.days) || 7;

    if (!accessToken || !pageId) {
      return res.status(400).json({
        success: false,
        message: 'Meta credentials not configured'
      });
    }

    // Get leads from last N days
    const since = new Date();
    since.setDate(since.getDate() - days);

    console.log(`📊 Fetching leads from last ${days} days`);

    const leads = await fetchMetaLeads(accessToken, pageId, formId, since);
    const parsedLeads = leads.map(lead => parseMetaLead(lead));

    // Group by date
    const leadsByDate = {};
    parsedLeads.forEach(lead => {
      const date = new Date(lead.createdTime).toISOString().split('T')[0];
      if (!leadsByDate[date]) {
        leadsByDate[date] = [];
      }
      leadsByDate[date].push(lead);
    });

    res.json({
      success: true,
      totalCount: parsedLeads.length,
      days: days,
      leadsByDate: leadsByDate,
      leads: parsedLeads
    });

  } catch (error) {
    console.error('Error fetching leads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leads',
      error: error.response?.data?.error?.message || error.message
    });
  }
});

// Get lead statistics
router.get('/stats', verifyToken, isAdmin, async (req, res) => {
  try {
    const { accessToken, pageId, formId } = getMetaConfig();

    if (!accessToken || !pageId) {
      return res.status(400).json({
        success: false,
        message: 'Meta credentials not configured'
      });
    }

    // Get leads from last 30 days
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const leads = await fetchMetaLeads(accessToken, pageId, formId, since);
    const parsedLeads = leads.map(lead => parseMetaLead(lead));

    // Calculate statistics
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const thisWeek = new Date(today);
    thisWeek.setDate(thisWeek.getDate() - 7);

    const thisMonth = new Date(today);
    thisMonth.setDate(thisMonth.getDate() - 30);

    const todayLeads = parsedLeads.filter(lead => new Date(lead.createdTime) >= today);
    const yesterdayLeads = parsedLeads.filter(lead => {
      const leadDate = new Date(lead.createdTime);
      return leadDate >= yesterday && leadDate < today;
    });
    const weekLeads = parsedLeads.filter(lead => new Date(lead.createdTime) >= thisWeek);
    const monthLeads = parsedLeads;

    res.json({
      success: true,
      stats: {
        today: todayLeads.length,
        yesterday: yesterdayLeads.length,
        thisWeek: weekLeads.length,
        last30Days: monthLeads.length
      },
      todayLeads: todayLeads,
      recentLeads: parsedLeads.slice(0, 10) // Last 10 leads
    });

  } catch (error) {
    console.error('Error fetching lead stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch lead statistics',
      error: error.response?.data?.error?.message || error.message
    });
  }
});

// Manual sync endpoint (existing)
router.post('/sync', verifyToken, isAdmin, async (req, res) => {
  try {
    const { accessToken, pageId, formId } = getMetaConfig();

    if (!accessToken || !pageId) {
      return res.status(400).json({
        success: false,
        message: 'Meta credentials not configured'
      });
    }

    // Get leads from last 24 hours
    const since = new Date();
    since.setDate(since.getDate() - 1);

    const leads = await fetchMetaLeads(accessToken, pageId, formId, since);
    const parsedLeads = leads.map(lead => parseMetaLead(lead));

    res.json({
      success: true,
      message: `Fetched ${parsedLeads.length} leads from last 24 hours`,
      count: parsedLeads.length,
      leads: parsedLeads
    });

  } catch (error) {
    console.error('Error syncing leads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync leads',
      error: error.response?.data?.error?.message || error.message
    });
  }
});

// Get sync status
router.get('/status', verifyToken, isAdmin, async (req, res) => {
  try {
    const { accessToken, pageId, formId } = getMetaConfig();
    const hasCredentials = !!(accessToken && pageId);
    
    res.json({
      success: true,
      configured: hasCredentials,
      pageId: pageId || 'Not configured',
      formId: formId || 'All forms (syncing from all 25 forms)',
      mondayConfigured: !!(process.env.MONDAY_API_TOKEN && process.env.MONDAY_LEADS_BOARD_ID)
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get status',
      error: error.message
    });
  }
});

module.exports = router;
