// sync-yesterday-leads.js
// Script to sync yesterday's Meta leads to Monday.com board

require('dotenv').config();
const { fetchMetaLeads, parseMetaLead } = require('./services/metaLeadsService');
const { addLeadToMonday, checkLeadExists } = require('./services/mondayService');

async function syncYesterdayLeads() {
  try {
    console.log('🚀 Starting sync of yesterday\'s Meta leads to Monday.com...\n');

    // Get configuration from environment
    const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
    const META_PAGE_ID = process.env.META_PAGE_ID;
    const META_FORM_ID = process.env.META_FORM_ID || ''; // Empty = all forms
    const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
    const MONDAY_BOARD_ID = process.env.MONDAY_LEADS_BOARD_ID;

    // Validate configuration
    if (!META_ACCESS_TOKEN || !META_PAGE_ID || !MONDAY_API_TOKEN || !MONDAY_BOARD_ID) {
      throw new Error('Missing required environment variables. Check your .env file.');
    }

    console.log('📋 Configuration:');
    console.log(`   Meta Page ID: ${META_PAGE_ID}`);
    console.log(`   Meta Form ID: ${META_FORM_ID || 'ALL FORMS'}`);
    console.log(`   Monday Board ID: ${MONDAY_BOARD_ID}`);
    console.log('');

    // Calculate yesterday's date range
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0); // Start of yesterday

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Start of today

    console.log(`📅 Fetching leads from: ${yesterday.toLocaleDateString()} (yesterday)`);
    console.log('');

    // Fetch leads from Meta
    console.log('🔍 Fetching leads from Meta Lead Ads...');
    const leads = await fetchMetaLeads(
      META_ACCESS_TOKEN,
      META_PAGE_ID,
      META_FORM_ID,
      yesterday
    );

    // Filter leads to only include yesterday's leads (not today's)
    const yesterdayLeads = leads.filter(lead => {
      const leadDate = new Date(lead.created_time);
      return leadDate >= yesterday && leadDate < today;
    });

    console.log(`✅ Found ${yesterdayLeads.length} leads from yesterday`);
    console.log('');

    if (yesterdayLeads.length === 0) {
      console.log('ℹ️  No leads found for yesterday. Nothing to sync.');
      return;
    }

    // Display leads summary
    console.log('📊 Leads Summary:');
    yesterdayLeads.forEach((lead, index) => {
      const parsed = parseMetaLead(lead);
      console.log(`   ${index + 1}. ${parsed.name || 'No Name'} - ${parsed.email || 'No Email'} - ${parsed.phone || 'No Phone'}`);
      console.log(`      Form: ${parsed.formName}`);
      console.log(`      Created: ${new Date(lead.created_time).toLocaleString()}`);
    });
    console.log('');

    // Sync leads to Monday.com
    console.log('📤 Syncing leads to Monday.com...');
    let syncedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const lead of yesterdayLeads) {
      const parsedLead = parseMetaLead(lead);
      
      try {
        // Check if lead already exists (by email)
        if (parsedLead.email) {
          const exists = await checkLeadExists(MONDAY_API_TOKEN, MONDAY_BOARD_ID, parsedLead.email);
          
          if (exists) {
            console.log(`   ⏭️  Skipped: ${parsedLead.name || 'No Name'} (${parsedLead.email}) - Already exists`);
            skippedCount++;
            continue;
          }
        }

        // Add lead to Monday.com
        const result = await addLeadToMonday(MONDAY_API_TOKEN, MONDAY_BOARD_ID, parsedLead);
        console.log(`   ✅ Synced: ${parsedLead.name || 'No Name'} (${parsedLead.email || 'No Email'}) - ID: ${result.id}`);
        syncedCount++;

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`   ❌ Error syncing ${parsedLead.name || 'No Name'}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('');
    console.log('✨ Sync Complete!');
    console.log(`   Total leads found: ${yesterdayLeads.length}`);
    console.log(`   Successfully synced: ${syncedCount}`);
    console.log(`   Skipped (duplicates): ${skippedCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log('');

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the sync
syncYesterdayLeads();
