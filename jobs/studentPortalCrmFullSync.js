const cron = require('node-cron');
const { getOrCreateSettings } = require('../services/studentPortalCrmWebhook');
const { runFullSync } = require('../services/studentPortalCrmSync');
const CrmStudentPortalSettings = require('../models/CrmStudentPortalSettings');

let scheduledTask = null;
let boundExpression = null;

async function runFullSyncAndPersist() {
  try {
    const result = await runFullSync();
    await CrmStudentPortalSettings.updateOne(
      { key: 'default' },
      { $set: { lastFullSyncAt: new Date(), lastFullSyncResult: result } }
    );
    console.log('[StudentPortalCRM] Full sync cron completed', result?.totals);
  } catch (e) {
    console.error('[StudentPortalCRM] Full sync cron error:', e.message);
    try {
      await CrmStudentPortalSettings.updateOne(
        { key: 'default' },
        { $set: { lastDispatchError: `cron_full_sync: ${e.message}`.slice(0, 2000) } }
      );
    } catch (_) {}
  }
}

async function reloadStudentPortalCron() {
  let doc;
  try {
    doc = await getOrCreateSettings();
  } catch (e) {
    console.error('[StudentPortalCRM] reload cron — settings:', e.message);
    return;
  }

  const expr = (doc.cronExpression || '0 2 * * *').trim();

  if (!doc.cronEnabled) {
    if (scheduledTask) {
      scheduledTask.stop();
      scheduledTask = null;
      boundExpression = null;
    }
    return;
  }

  if (!cron.validate(expr)) {
    console.warn('[StudentPortalCRM] Invalid cron expression, not scheduling:', expr);
    return;
  }

  if (scheduledTask && boundExpression === expr) {
    return;
  }

  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    boundExpression = null;
  }

  boundExpression = expr;
  scheduledTask = cron.schedule(expr, () => {
    runFullSyncAndPersist();
  });
  console.log(`[StudentPortalCRM] Scheduled full sync: "${expr}"`);
}

/**
 * Call on server start; re-run reloadStudentPortalCron() after settings PUT or on an interval.
 */
function scheduleStudentPortalCrmFullSync() {
  reloadStudentPortalCron().catch((e) => console.error('[StudentPortalCRM] initial cron:', e.message));
  setInterval(() => {
    reloadStudentPortalCron().catch((e) => console.error('[StudentPortalCRM] cron reload:', e.message));
  }, 60 * 1000);
}

module.exports = {
  scheduleStudentPortalCrmFullSync,
  reloadStudentPortalCron,
  runFullSyncAndPersist
};
