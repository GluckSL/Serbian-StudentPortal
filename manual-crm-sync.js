// manual-crm-sync.js
// Run this once to update ALL existing PLATINUM+Ongoing students from Monday CRM
// Usage: node manual-crm-sync.js
// Add --dry-run to preview changes without writing to DB

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('./models/User');

const DRY_RUN = process.argv.includes('--dry-run');

async function fetchAllBoardItems() {
  const BOARD_ID = process.env.MONDAY_BOARD_ID;
  let allItems = [];
  let cursor = null;
  let hasMore = true;

  while (hasMore) {
    const query = cursor
      ? `query ($boardId: [ID!], $cursor: String!) {
          boards(ids: $boardId) {
            items_page(limit: 500, cursor: $cursor) {
              cursor
              items { id name column_values { id text } }
            }
          }
        }`
      : `query ($boardId: [ID!]) {
          boards(ids: $boardId) {
            items_page(limit: 500) {
              cursor
              items { id name column_values { id text } }
            }
          }
        }`;

    const variables = cursor ? { boardId: [BOARD_ID], cursor } : { boardId: [BOARD_ID] };

    const response = await axios.post(
      'https://api.monday.com/v2',
      { query, variables },
      { headers: { Authorization: process.env.MONDAY_API_TOKEN, 'Content-Type': 'application/json' } }
    );

    const page = response.data.data.boards[0].items_page;
    allItems = allItems.concat(page.items);
    cursor = page.cursor;
    hasMore = !!cursor;
  }

  return allItems;
}

function parseItem(item) {
  const get = id => item.column_values.find(c => c.id === id)?.text || '';
  const parseDate = str => str ? new Date(str) : null;

  const email = get('text_mkw3spks').trim().toLowerCase();
  const packageOpted = get('color_mm02jfyb').toUpperCase().trim();
  const currentStatus = get('color_mm019dcv').toUpperCase().trim();

  if (!email || packageOpted !== 'PLATINUM' || currentStatus !== 'ONGOING') {
    return null;
  }

  return {
    email,
    updateData: {
      name: item.name,
      phoneNumber: get('text_mkw2wpvr'),
      whatsappNumber: get('phone_mkv0a5mm'),
      address: get('text_mkv080k2'),
      age: get('text_mkw38wse') ? parseInt(get('text_mkw38wse')) : null,
      qualifications: get('text_mkw32n6r'),
      servicesOpted: get('dropdown_mkw0txee') || get('color_mm023vmt') || get('text_mkwz1j6q'),
      subscription: packageOpted,
      languageLevelOpted: get('color_mm02c95'),
      batch: get('dropdown_mkxx6cfp'),
      studentStatus: currentStatus,
      level: get('dropdown_mkzshj5a').toUpperCase().trim(),
      otherLanguageKnown: get('dropdown_mkzsadkp'),
      medium: get('dropdown_mkw09h9j') ? [get('dropdown_mkw09h9j')] : [],
      leadSource: get('dropdown_mm0d9jrv'),
      servicesOpted: get('dropdown_mkw0txee'),
      stream: get('text_mkwtq4fq'),
      teacherIncharge: get('dropdown_mkw72gz4'),
      reasonForWithdrawing: get('text_mkzz24qx'),
      languageExamStatus: get('color_mkw7syb'),
      candidateStatus: get('text_mkzzjdv1'),
      examRemark: get('text_mkzzbgz1'),
      enrollmentDate: parseDate(get('date_mkw7wejn')),
      batchStartedOn: parseDate(get('date_mkxkba8t')),
      dateWithdrew: parseDate(get('date_mkzzgvxv')),
      examPassedDate: parseDate(get('date_mkw7zwjh')),
      examScores: {
        reading: get('numeric_mkzz97be') ? parseFloat(get('numeric_mkzz97be')) : null,
        listening: get('numeric_mkzz8sr4') ? parseFloat(get('numeric_mkzz8sr4')) : null,
        writing: get('numeric_mkzz2bzg') ? parseFloat(get('numeric_mkzz2bzg')) : null,
        speaking: get('numeric_mkzz8q32') ? parseFloat(get('numeric_mkzz8q32')) : null
      },
      courseStartDates: {
        A1StartDate: parseDate(get('date_mm1dceqs')),
        A2StartDate: parseDate(get('date_mm1dwzc8')),
        B1StartDate: parseDate(get('date_mm1d7az3')),
        B2StartDate: parseDate(get('date_mm1dbv8e'))
      },
      courseCompletionDates: {
        A1CompletionDate: parseDate(get('date_mkzt1xj')),
        A2CompletionDate: parseDate(get('date_mkztk1pn')),
        B1CompletionDate: parseDate(get('date_mkztxce7')),
        B2CompletionDate: parseDate(get('date_mkztwdfn'))
      },
      updatedAt: new Date()
    }
  };
}

async function run() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/Updated-Gluck-Portal';
  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB');

  if (DRY_RUN) console.log('\n🔍 DRY RUN MODE — no changes will be written\n');

  console.log('📡 Fetching items from Monday board...');
  const allItems = await fetchAllBoardItems();
  console.log(`📋 Total items on board: ${allItems.length}`);

  let updated = 0, skipped = 0, errors = 0;

  for (const item of allItems) {
    try {
      const parsed = parseItem(item);
      if (!parsed) { skipped++; continue; }

      const { email, updateData } = parsed;
      const existingUser = await User.findOne({ email });

      if (!existingUser) {
        skipped++;
        continue; // New users will be handled by tonight's cron job
      }

      if (DRY_RUN) {
        console.log(`  [DRY] Would update: ${existingUser.name} (${email})`);
        updated++;
        continue;
      }

      await User.updateOne({ email }, { $set: updateData });
      console.log(`  ✅ Updated: ${existingUser.name} (${email})`);
      updated++;
    } catch (err) {
      console.error(`  ❌ Error on "${item.name}": ${err.message}`);
      errors++;
    }
  }

  console.log(`\n📊 Sync complete:`);
  console.log(`   Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);

  await mongoose.disconnect();
  console.log('🔌 Disconnected from MongoDB');
  process.exit(0);
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
