/**
 * Daily Sales Dashboard → Google Chat
 * Fires every day at 10:00 AM and 6:00 PM IST (Asia/Colombo).
 *
 * Each run:
 * 1. Fetches the latest CRM enrollment board (all pages) — fresh data
 * 2. Mirrors students into sales_students so overview data stays current
 * 3. Builds counsellor green/amber/red buckets and posts snapshot image to SalesChat
 */

const cron = require('node-cron');
const { fetchAllCrmRecords } = require('../services/crmPortalCompare');
const { fetchAndCommitFromCrm } = require('../modules/krish-dashboard/backend/services/salesCrmFetchService');
const { sendSalesDashboardToChat } = require('../services/crmSalesChatNotify');

const TZ = 'Asia/Colombo';
const CRON_USER = 'sales-dashboard-cron';

async function refreshCrmEnrollmentData() {
  console.log('[SalesDashboardChatReport] Step 1 — fetching latest CRM enrollments…');
  const crmRows = await fetchAllCrmRecords('enrollment', { simple: {}, advanced: null });
  console.log(
    `[SalesDashboardChatReport] CRM fetch complete — ${crmRows.length} enrollment record(s)`
  );

  const sync = await fetchAndCommitFromCrm(CRON_USER, { crmRows });
  console.log(
    `[SalesDashboardChatReport] CRM sync complete — imported ${sync.imported}, updated ${sync.updated}, removed ${sync.removed || 0}, overview ${sync.overviewTotal ?? '—'}`
  );

  return crmRows;
}

async function runSalesDashboardChatReport(label, reportPeriod) {
  console.log(`[SalesDashboardChatReport] Running ${label} job (${reportPeriod})…`);
  let crmRows = null;

  try {
    crmRows = await refreshCrmEnrollmentData();
  } catch (err) {
    console.error('[SalesDashboardChatReport] CRM fetch/sync failed:', err.message);
  }

  try {
    console.log('[SalesDashboardChatReport] Step 2 — building dashboard & sending to Google Chat…');
    const result = await sendSalesDashboardToChat({
      ...(crmRows?.length ? { crmRows } : {}),
      reportPeriod,
    });
    console.log('[SalesDashboardChatReport]', result.message);
    return result;
  } catch (err) {
    console.error('[SalesDashboardChatReport] Send failed:', err.message);
    throw err;
  }
}

function scheduleSalesDashboardChatReport() {
  // 10:00 AM every day, Asia/Colombo
  cron.schedule('0 10 * * *', () => {
    runSalesDashboardChatReport('10:00 AM', 'morning').catch((err) =>
      console.error('[SalesDashboardChatReport] 10 AM job error:', err.message)
    );
  }, { timezone: TZ });

  // 6:00 PM every day, Asia/Colombo — week including today
  cron.schedule('0 18 * * *', () => {
    runSalesDashboardChatReport('6:00 PM', 'evening').catch((err) =>
      console.error('[SalesDashboardChatReport] 6 PM job error:', err.message)
    );
  }, { timezone: TZ });

  console.log('[SalesDashboardChatReport] Scheduled — 10:00 AM (week excl. today) & 6:00 PM (week incl. today)');
}

module.exports = {
  scheduleSalesDashboardChatReport,
  runSalesDashboardChatReport,
  refreshCrmEnrollmentData,
};
