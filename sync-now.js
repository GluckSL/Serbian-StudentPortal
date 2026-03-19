// sync-now.js - Manual sync trigger
require('dotenv').config();
const { syncMetaLeadsToMonday } = require('./jobs/metaToMondaySync');

console.log('🚀 Starting manual Meta to Monday.com sync...\n');
console.log('📋 Configuration:');
console.log(`   Meta Page ID: ${process.env.META_PAGE_ID}`);
console.log(`   Monday Leads Board ID: ${process.env.MONDAY_LEADS_BOARD_ID}`);
console.log(`   Meta Token: ${process.env.META_ACCESS_TOKEN ? 'Configured ✅' : 'Missing ❌'}`);
console.log(`   Monday Token: ${process.env.MONDAY_API_TOKEN ? 'Configured ✅' : 'Missing ❌'}`);
console.log(`   Form ID: ${process.env.META_FORM_ID || 'All forms (syncing from all 25 forms)'}\n`);

syncMetaLeadsToMonday()
  .then(() => {
    console.log('\n✅ Manual sync completed successfully!');
    console.log('📊 Check your Monday.com board: https://monday.com/boards/5026323056');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Manual sync failed:', error.message);
    if (error.response?.data) {
      console.error('API Error:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  });
