/**
 * Daily Sales Dashboard → Google Chat
 * Fires every day at 7:00 PM IST (Asia/Colombo).
 *
 * 1. Fetches the latest CRM enrollment board (all pages)
 * 2. Mirrors students into sales_students so overview data stays current
 * 3. Builds counsellor buckets from that same fetch and posts snapshot to SalesChat
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

async function runSalesDashboardChatReport() {
  console.log('[SalesDashboardChatReport] Running daily job…');
  let crmRows = null;

  try {
    crmRows = await refreshCrmEnrollmentData();
  } catch (err) {
    console.error('[SalesDashboardChatReport] CRM fetch/sync failed:', err.message);
  }

  try {
    console.log('[SalesDashboardChatReport] Step 2 — building dashboard & sending to Google Chat…');
    const result = await sendSalesDashboardToChat(
      crmRows?.length ? { crmRows } : {}
    );
    console.log('[SalesDashboardChatReport]', result.message);
    return result;
  } catch (err) {
    console.error('[SalesDashboardChatReport] Send failed:', err.message);
    throw err;
  }
}

function scheduleSalesDashboardChatReport() {
  // 7:00 PM every day, Asia/Colombo
  cron.schedule('0 19 * * *', () => {
    runSalesDashboardChatReport().catch((err) =>
      console.error('[SalesDashboardChatReport] Job error:', err.message)
    );
  }, { timezone: TZ });
  console.log('[SalesDashboardChatReport] Scheduled — daily 7:00 PM IST (CRM fetch → sync → chat snapshot)');
}

module.exports = {
  scheduleSalesDashboardChatReport,
  runSalesDashboardChatReport,
  refreshCrmEnrollmentData,
};
