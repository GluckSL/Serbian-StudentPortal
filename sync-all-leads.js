// sync-all-leads.js
// Script to sync ALL Meta leads from last 30 days to Monday.com board

require('dotenv').config();
const { fetchMetaLeads, parseMetaLead } = require('./services/metaLeadsService');
const { addLeadToMonday, checkLeadExists } = require('./services/mondayService');

async function syncAllLeads() {
  try {
    console.log('🚀 Starting sync of ALL Meta leads to Monday.com...\n');

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

    // Fetch leads from last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    console.log(`📅 Fetching leads from last 30 days (since ${thirtyDaysAgo.toLocaleDateString()})`);
    console.log('');

    // Fetch leads from Meta
    console.log('🔍 Fetching leads from Meta Lead Ads...');
    const leads = await fetchMetaLeads(
      META_ACCESS_TOKEN,
      META_PAGE_ID,
      META_FORM_ID,
      thirtyDaysAgo
    );

    console.log(`✅ Found ${leads.length} leads from last 30 days`);
    console.log('');

    if (leads.length === 0) {
      console.log('ℹ️  No leads found. Nothing to sync.');
      return;
    }

    // Display leads summary
    console.log('📊 Leads Summary:');
    const leadsByDate = {};
    leads.forEach(lead => {
      const date = new Date(lead.created_time).toLocaleDateString();
      if (!leadsByDate[date]) {
        leadsByDate[date] = 0;
      }
      leadsByDate[date]++;
    });
    
    Object.keys(leadsByDate).sort((a, b) => new Date(b) - new Date(a)).forEach(date => {
      console.log(`   ${date}: ${leadsByDate[date]} leads`);
    });
    console.log('');

    // Sync leads to Monday.com
    console.log('📤 Syncing leads to Monday.com...');
    console.log('');
    
    let syncedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      const parsedLead = parseMetaLead(lead);
      const progress = `[${i + 1}/${leads.length}]`;
      
      try {
        // Check if lead already exists (by email or Meta Lead ID)
        let exists = false;
        
        if (parsedLead.email) {
          exists = await checkLeadExists(MONDAY_API_TOKEN, MONDAY_BOARD_ID, parsedLead.email);
        }
        
        if (exists) {
          console.log(`   ${progress} ⏭️  Skipped: ${parsedLead.name || 'No Name'} (${parsedLead.email || 'No Email'}) - Already exists`);
          skippedCount++;
          continue;
        }

        // Add lead to Monday.com
        const result = await addLeadToMonday(MONDAY_API_TOKEN, MONDAY_BOARD_ID, parsedLead);
        console.log(`   ${progress} ✅ Synced: ${parsedLead.name || 'No Name'} (${parsedLead.email || 'No Email'}) - Monday ID: ${result.id}`);
        syncedCount++;

        // Add small delay to avoid rate limiting (Monday.com has rate limits)
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        console.error(`   ${progress} ❌ Error syncing ${parsedLead.name || 'No Name'}: ${error.message}`);
        errorCount++;
        
        // Add delay even on error
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    console.log('');
    console.log('✨ Sync Complete!');
    console.log('═'.repeat(60));
    console.log(`   📊 Total leads found: ${leads.length}`);
    console.log(`   ✅ Successfully synced: ${syncedCount}`);
    console.log(`   ⏭️  Skipped (duplicates): ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);
    console.log('═'.repeat(60));
    console.log('');

    if (syncedCount > 0) {
      console.log('🎉 Great! Check your Monday.com board to see the new leads!');
      console.log(`   Board URL: https://gluck-global.monday.com/boards/${MONDAY_BOARD_ID}`);
    }

  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run the sync
syncAllLeads();
