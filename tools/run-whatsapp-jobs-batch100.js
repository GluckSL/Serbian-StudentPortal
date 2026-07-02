#!/usr/bin/env node
/**
 * Run all WhatsApp cron job processors once.
 *
 * WARNING: This processes ALL batches/students in the database — not batch 100 only.
 * For safe batch-100 testing use: npm run test:whatsapp-batch100
 *
 * Usage: node tools/run-whatsapp-jobs-batch100.js --confirm-all-batches
 */
'use strict';

require('dotenv').config();

if (!process.argv.includes('--confirm-all-batches')) {
  console.error(
    'Aborted: this script runs WhatsApp jobs for ALL students, not batch 100 only.\n' +
      'For batch 100 tests use: npm run test:whatsapp-batch100\n' +
      'To run all batches anyway, pass: --confirm-all-batches'
  );
  process.exit(1);
}

process.env.WHATSAPP_AUTOMATED_JOBS_ENABLED = 'true';

const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Running WhatsApp job processors for batch 100 test account...\n');

  const jobs = [
    ['Class reminders', () => require('../jobs/whatsapp/classReminder').processClassReminders()],
    ['Absence alerts', () => require('../jobs/whatsapp/absenceAlert').processAbsenceAlerts()],
    ['Missed activities', () => require('../jobs/whatsapp/missedActivities').processMissedActivitiesAndAbsences()],
    ['Weekly reports', () => require('../jobs/whatsapp/weeklyReport').processWeeklyReports()],
    ['Consecutive absence', () => require('../jobs/whatsapp/consecutiveAbsence').processConsecutiveAbsences()],
    ['Payment overdue', () => require('../jobs/whatsapp/paymentOverdueReminder').processPaymentOverdueReminders()],
    ['Daily task reminder', () => require('../jobs/dailyTaskReminder').processDailyTaskReminders()],
  ];

  for (const [name, fn] of jobs) {
    if (typeof fn !== 'function') {
      console.log(`⏭  ${name}: export not found, skipped`);
      continue;
    }
    console.log(`▶  ${name}...`);
    try {
      await fn();
      console.log(`✅ ${name} done\n`);
    } catch (err) {
      console.error(`❌ ${name} error:`, err.message, '\n');
    }
  }

  await mongoose.disconnect();
  console.log('All job processors finished.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
