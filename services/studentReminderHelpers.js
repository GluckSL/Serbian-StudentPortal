/**
 * Shared helpers for the automated student reminder jobs
 * (live-class join, daily-task, payment-overdue).
 *
 * Keeps individual job files thin by centralising:
 *  - phone resolution
 *  - portal URL
 *  - today's date key in Asia/Colombo
 *  - per-student per-day dedup via CronJobLog
 */
'use strict';

const CronJobLog = require('../models/CronJobLog');

const TZ = 'Asia/Colombo';

/** Returns whatsappNumber if present, otherwise phoneNumber. */
function resolveStudentPhone(user) {
  return (user && (user.whatsappNumber || user.phoneNumber)) || '';
}

/** Normalised portal base URL (no trailing slash). */
function portalLoginUrl() {
  return `${(process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '')}/login`;
}

/**
 * Today's calendar date as YYYY-MM-DD in Asia/Colombo.
 * Uses Intl.DateTimeFormat so it works regardless of the server's local timezone.
 */
function todayKeyColombo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Check whether a per-student daily reminder was already sent today.
 * jobPrefix: e.g. 'dailyTaskReminder' or 'paymentOverdueReminder'
 */
async function wasReminderSentToday(jobPrefix, studentId) {
  const key = `${jobPrefix}:${String(studentId)}:${todayKeyColombo()}`;
  const log = await CronJobLog.findOne({ jobName: key }).lean();
  return Boolean(log);
}

/**
 * Record that a per-student daily reminder was sent today.
 */
async function markReminderSentToday(jobPrefix, studentId) {
  const key = `${jobPrefix}:${String(studentId)}:${todayKeyColombo()}`;
  const now = new Date();
  await CronJobLog.findOneAndUpdate(
    { jobName: key },
    { $set: { lastRunDate: todayKeyColombo(), lastRunAt: now }, $inc: { runCount: 1 } },
    { upsert: true }
  );
}

module.exports = {
  resolveStudentPhone,
  portalLoginUrl,
  todayKeyColombo,
  wasReminderSentToday,
  markReminderSentToday,
};
