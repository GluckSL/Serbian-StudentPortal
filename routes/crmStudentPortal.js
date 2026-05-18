const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const CrmStudentPortalSettings = require('../models/CrmStudentPortalSettings');
const User = require('../models/User');
const {
  ALL_EVENT_KEYS,
  defaultEnabledEvents,
  getOrCreateSettings,
  resolveWebhookUrl,
  dispatchEvent,
  sanitizeUserDoc
} = require('../services/studentPortalCrmWebhook');
const { runSyncKind, runFullSync } = require('../services/studentPortalCrmSync');
const { reloadStudentPortalCron } = require('../jobs/studentPortalCrmFullSync');
const { mergePortalBatchNames } = require('../utils/portalBatchPresets');

const ADMIN_ROLES = ['ADMIN', 'TEACHER_ADMIN'];

function normalizeFilter(value) {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => String(item || '').trim())
      .filter((item) => item && item.toLowerCase() !== 'all');
    return cleaned.length ? cleaned : null;
  }
  if (value === undefined || value === null) return null;
  const asText = String(value).trim();
  if (!asText || asText.toLowerCase() === 'all') return null;
  return [asText];
}

function safeWebhookPreview(url) {
  if (!url) return { configured: false, host: '' };
  try {
    const u = new URL(url);
    return { configured: true, host: u.host };
  } catch {
    return { configured: true, host: '(invalid URL)' };
  }
}

router.get('/settings', verifyToken, checkRole(ADMIN_ROLES), async (req, res) => {
  try {
    const doc = await getOrCreateSettings();
    const effectiveUrl = resolveWebhookUrl(doc);
    const preview = safeWebhookPreview(effectiveUrl);
    res.json({
      success: true,
      data: {
        webhookUrlOverride: doc.webhookUrlOverride || '',
        envHasUrl: !!(process.env.STUDENT_PORTAL_CRM_WEBHOOK_URL || '').trim(),
        effectiveWebhook: preview,
        metaDefaults: doc.metaDefaults || {},
        enabledEvents: { ...defaultEnabledEvents(), ...(doc.enabledEvents || {}) },
        cronEnabled: !!doc.cronEnabled,
        cronExpression: doc.cronExpression || '0 2 * * *',
        lastFullSyncAt: doc.lastFullSyncAt,
        lastFullSyncResult: doc.lastFullSyncResult,
        lastDispatchError: doc.lastDispatchError || '',
        lastDispatchAt: doc.lastDispatchAt,
        lastDispatchSuccessAt: doc.lastDispatchSuccessAt,
        allEventKeys: ALL_EVENT_KEYS
      }
    });
  } catch (err) {
    console.error('crmStudentPortal GET settings:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/settings', verifyToken, checkRole(ADMIN_ROLES), async (req, res) => {
  try {
    const {
      webhookUrlOverride,
      metaDefaults,
      enabledEvents,
      cronEnabled,
      cronExpression
    } = req.body || {};

    const doc = await getOrCreateSettings();

    if (typeof webhookUrlOverride === 'string') {
      doc.webhookUrlOverride = webhookUrlOverride.trim();
    }
    if (metaDefaults && typeof metaDefaults === 'object') {
      doc.metaDefaults = {
        remainderFrom: String(metaDefaults.remainderFrom ?? doc.metaDefaults?.remainderFrom ?? ''),
        participate: String(metaDefaults.participate ?? doc.metaDefaults?.participate ?? ''),
        feedbackForm: String(metaDefaults.feedbackForm ?? doc.metaDefaults?.feedbackForm ?? '')
      };
    }
    if (enabledEvents && typeof enabledEvents === 'object') {
      const merged = { ...defaultEnabledEvents(), ...doc.enabledEvents, ...enabledEvents };
      for (const k of ALL_EVENT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(merged, k)) {
          doc.enabledEvents[k] = !!merged[k];
        }
      }
      doc.markModified('enabledEvents');
    }
    if (typeof cronEnabled === 'boolean') {
      doc.cronEnabled = cronEnabled;
    }
    if (typeof cronExpression === 'string' && cronExpression.trim()) {
      const cron = require('node-cron');
      if (!cron.validate(cronExpression.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid cron expression'
        });
      }
      doc.cronExpression = cronExpression.trim();
    }

    await doc.save();
    reloadStudentPortalCron().catch(() => {});
    const effectiveUrl = resolveWebhookUrl(doc);
    res.json({
      success: true,
      data: {
        webhookUrlOverride: doc.webhookUrlOverride || '',
        effectiveWebhook: safeWebhookPreview(effectiveUrl),
        metaDefaults: doc.metaDefaults,
        enabledEvents: { ...defaultEnabledEvents(), ...(doc.enabledEvents || {}) },
        cronEnabled: doc.cronEnabled,
        cronExpression: doc.cronExpression
      }
    });
  } catch (err) {
    console.error('crmStudentPortal PUT settings:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/sync/:kind', verifyToken, checkRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { kind } = req.params;
    if (!['students', 'teachers', 'reminders', 'feedback'].includes(kind)) {
      return res.status(400).json({ success: false, message: 'Invalid sync kind' });
    }
    const result = await runSyncKind(kind);
    res.json({ success: true, result });
  } catch (err) {
    console.error('crmStudentPortal sync:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/sync/run-now', verifyToken, checkRole(ADMIN_ROLES), async (req, res) => {
  try {
    const result = await runFullSync();
    await CrmStudentPortalSettings.updateOne(
      { key: 'default' },
      { $set: { lastFullSyncAt: new Date(), lastFullSyncResult: result } }
    );
    res.json({ success: true, result });
  } catch (err) {
    console.error('crmStudentPortal full sync:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/manual-announcement/options', verifyToken, checkRole(ADMIN_ROLES), async (req, res) => {
  try {
    const [batches, statuses, levels, services, qualifications, streams] = await Promise.all([
      User.distinct('batch', { role: 'STUDENT', batch: { $nin: [null, ''] } }),
      User.distinct('studentStatus', { role: 'STUDENT', studentStatus: { $nin: [null, ''] } }),
      User.distinct('level', { role: 'STUDENT', level: { $nin: [null, ''] } }),
      User.distinct('servicesOpted', { role: 'STUDENT', servicesOpted: { $nin: [null, ''] } }),
      User.distinct('qualifications', { role: 'STUDENT', qualifications: { $nin: [null, ''] } }),
      User.distinct('stream', { role: 'STUDENT', stream: { $nin: [null, ''] } })
    ]);

    const sortAsc = (arr) => arr.map((v) => String(v)).sort((a, b) => a.localeCompare(b));

    res.json({
      success: true,
      data: {
        batches: mergePortalBatchNames(sortAsc(batches)),
        statuses: sortAsc(statuses),
        levels: sortAsc(levels),
        services: sortAsc(services),
        qualifications: sortAsc(qualifications),
        streams: sortAsc(streams)
      }
    });
  } catch (err) {
    console.error('crmStudentPortal GET manual-announcement/options:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/manual-announcement/trigger', verifyToken, checkRole(ADMIN_ROLES), async (req, res) => {
  try {
    const {
      campaignName,
      deliveryMode = 'instant',
      scheduleAt,
      messageTemplate = '',
      messageBody = '',
      filters = {}
    } = req.body || {};

    const cleanCampaign = String(campaignName || '').trim();
    const cleanBody = String(messageBody || '').trim();
    const cleanTemplate = String(messageTemplate || '').trim();
    if (!cleanCampaign) {
      return res.status(400).json({ success: false, message: 'campaignName is required' });
    }
    if (!cleanBody && !cleanTemplate) {
      return res.status(400).json({ success: false, message: 'messageBody or messageTemplate is required' });
    }

    const mode = String(deliveryMode || 'instant').toLowerCase();
    if (!['instant', 'schedule'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'deliveryMode must be instant or schedule' });
    }

    let normalizedScheduleAt = null;
    if (mode === 'schedule') {
      if (!scheduleAt) {
        return res.status(400).json({ success: false, message: 'scheduleAt is required for schedule mode' });
      }
      const dt = new Date(scheduleAt);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ success: false, message: 'scheduleAt must be a valid datetime' });
      }
      normalizedScheduleAt = dt.toISOString();
    }

    const mongoQuery = { role: 'STUDENT' };
    const batchFilter = normalizeFilter(filters.batch);
    const statusFilter = normalizeFilter(filters.status);
    const levelFilter = normalizeFilter(filters.level);
    const serviceFilter = normalizeFilter(filters.service);
    const qualificationFilter = normalizeFilter(filters.qualification);
    const streamFilter = normalizeFilter(filters.stream);

    if (batchFilter) mongoQuery.batch = { $in: batchFilter };
    if (statusFilter) mongoQuery.studentStatus = { $in: statusFilter };
    if (levelFilter) mongoQuery.level = { $in: levelFilter };
    if (serviceFilter) mongoQuery.servicesOpted = { $in: serviceFilter };
    if (qualificationFilter) mongoQuery.qualifications = { $in: qualificationFilter };
    if (streamFilter) mongoQuery.stream = { $in: streamFilter };

    const students = await User.find(mongoQuery)
      .select('_id name email regNo batch studentStatus level servicesOpted qualifications stream whatsappNumber phoneNumber')
      .lean();

    if (!students.length) {
      return res.json({
        success: true,
        result: {
          campaignName: cleanCampaign,
          deliveryMode: mode,
          scheduleAt: normalizedScheduleAt,
          totalMatched: 0,
          attempted: 0,
          sent: 0,
          skipped: 0,
          errors: 0
        }
      });
    }

    let sent = 0;
    let skipped = 0;
    let errors = 0;
    const failedRecipients = [];

    for (const student of students) {
      const eventResult = await dispatchEvent({
        event: 'MANUAL_ANNOUNCEMENT_TRIGGER',
        entity: {
          ...sanitizeUserDoc(student),
          type: 'User',
          targetChannel: 'whatsapp'
        },
        metaOverrides: {
          campaignName: cleanCampaign,
          deliveryMode: mode,
          scheduleAt: normalizedScheduleAt,
          messageTemplate: cleanTemplate,
          messageBody: cleanBody,
          filtersApplied: {
            batch: batchFilter || ['all'],
            status: statusFilter || ['all'],
            level: levelFilter || ['all'],
            service: serviceFilter || ['all'],
            qualification: qualificationFilter || ['all'],
            stream: streamFilter || ['all']
          },
          triggeredBy: req.user?.id || null,
          triggerType: 'manual-announcement'
        }
      });

      if (eventResult.ok && !eventResult.skipped) {
        sent += 1;
      } else if (eventResult.skipped) {
        skipped += 1;
      } else {
        errors += 1;
        failedRecipients.push({
          userId: student._id,
          name: student.name,
          reason: eventResult.error || eventResult.reason || 'unknown'
        });
      }
    }

    res.json({
      success: true,
      result: {
        campaignName: cleanCampaign,
        deliveryMode: mode,
        scheduleAt: normalizedScheduleAt,
        totalMatched: students.length,
        attempted: students.length,
        sent,
        skipped,
        errors,
        failedRecipients: failedRecipients.slice(0, 20)
      }
    });
  } catch (err) {
    console.error('crmStudentPortal POST manual-announcement/trigger:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
