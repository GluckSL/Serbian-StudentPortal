// jobs/metaToMondaySync.js
const cron = require('node-cron');
const { fetchMetaLeads, parseMetaLead } = require('../services/metaLeadsService');
const { addLeadToMonday, checkLeadExists } = require('../services/mondayService');

/**
 * Sync Meta leads to Monday.com
 */
async function syncMetaLeadsToMonday() {
  console.log('🔄 Starting Meta to Monday.com sync...');
  
  try {
    const metaAccessToken = process.env.META_ACCESS_TOKEN;
    const metaPageId = process.env.META_PAGE_ID;
    const metaFormId = process.env.META_FORM_ID && process.env.META_FORM_ID.trim() !== '' && process.env.META_FORM_ID !== 'your_lead_form_id_here' 
      ? process.env.META_FORM_ID 
      : null; // null means fetch from all forms
    const mondayApiToken = process.env.MONDAY_API_TOKEN;
    const mondayBoardId = process.env.MONDAY_LEADS_BOARD_ID;

    // Validate environment variables
    if (!metaAccessToken || !metaPageId || !mondayApiToken || !mondayBoardId) {
      console.error('❌ Missing required environment variables for Meta/Monday sync');
      return;
    }

    // Fetch leads from last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    const formInfo = metaFormId ? `form ${metaFormId}` : 'all forms';
    console.log(`📥 Fetching Meta leads from ${formInfo} since ${yesterday.toISOString()}...`);
    const rawLeads = await fetchMetaLeads(metaAccessToken, metaPageId, metaFormId, yesterday);
    
    console.log(`✅ Found ${rawLeads.length} leads from Meta`);

    if (rawLeads.length === 0) {
      console.log('ℹ️ No new leads to sync');
      return;
    }

    let addedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // Process each lead
    for (const rawLead of rawLeads) {
      try {
        const parsedLead = parseMetaLead(rawLead);
        
        // Skip if no email
        if (!parsedLead.email) {
          console.log(`⚠️ Skipping lead ${parsedLead.metaLeadId} - no email`);
          skippedCount++;
          continue;
        }

        // Check if lead already exists in Monday
        const exists = await checkLeadExists(mondayApiToken, mondayBoardId, parsedLead.email);
        
        if (exists) {
          console.log(`⏭️ Lead ${parsedLead.email} already exists in Monday.com`);
          skippedCount++;
          continue;
        }

        // Add lead to Monday.com
        const result = await addLeadToMonday(mondayApiToken, mondayBoardId, parsedLead);
        console.log(`✅ Added lead: ${parsedLead.name} (${parsedLead.email}) - Monday ID: ${result.id}`);
        addedCount++;

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`❌ Error processing lead:`, error.message);
        errorCount++;
      }
    }

    console.log(`
🎉 Meta to Monday.com sync completed!
   ✅ Added: ${addedCount}
   ⏭️ Skipped: ${skippedCount}
   ❌ Errors: ${errorCount}
    `);
  } catch (error) {
    console.error('❌ Fatal error in Meta to Monday sync:', error);
  }
}

/**
 * Schedule the sync job
 * Runs daily at 11:50 PM CET (22:50 UTC in winter, 21:50 UTC in summer)
 * Using 22:50 UTC as default (CET winter time)
 */
function scheduleMetaToMondaySync() {
  // Cron format: minute hour day month dayOfWeek
  // 50 22 * * * = Every day at 22:50 UTC (11:50 PM CET in winter)
  // Note: Adjust to 21:50 for CEST (summer time) if needed
  
  cron.schedule('50 22 * * *', async () => {
    console.log('⏰ Scheduled Meta to Monday sync triggered at', new Date().toISOString());
    await syncMetaLeadsToMonday();
  }, {
    timezone: "Europe/Berlin" // CET/CEST timezone
  });

  console.log('✅ Meta to Monday.com sync scheduled for 11:50 PM CET daily');
}

// Export functions
module.exports = {
  syncMetaLeadsToMonday,
  scheduleMetaToMondaySync
};
