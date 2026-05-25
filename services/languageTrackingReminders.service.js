'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const { buildJourneyDayReminderEmail } = require('../utils/emailTemplates');

const MAX_PER_REQUEST = 50;

function resolveBatchForCompletion(student) {
  if (student.batch) return String(student.batch);
  if (student.goStatus === 'GO' && student.subscription === 'SILVER') return 'GO-SILVER';
  return '';
}

async function getIncompleteTasksForStudent(student) {
  const { computeJourneyDayCompletion } = require('./journeyDayCompletion.service');
  const sid = student._id;
  const batchForCompletion = resolveBatchForCompletion(student);
  const day = student.currentCourseDay || 1;

  const completion = await computeJourneyDayCompletion(sid, batchForCompletion, day, {
    includeRecordings: false,
    includeDg: true,
    studentLevel: student.level || '',
    studentPlan: student.subscription || '',
    goStatus: student.goStatus || '',
  });

  return {
    day,
    incompleteTasks: completion.incompleteTasks || [],
    doneTasks: completion.doneTasks,
    totalTasks: completion.totalTasks,
  };
}

/**
 * Send journey-day reminder emails listing only incomplete tasks for each student's current day.
 * @param {string[]} studentIds
 * @returns {Promise<{ results: object[], sent: number, skipped: number, failed: number }>}
 */
async function sendJourneyReminders(studentIds) {
  const ids = [...new Set((studentIds || []).map(String).filter(Boolean))];
  if (!ids.length) {
    return { results: [], sent: 0, skipped: 0, failed: 0 };
  }

  const loginUrl = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');
  const from = process.env.EMAIL_USER;
  const results = [];
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const rawId of ids) {
    if (!mongoose.Types.ObjectId.isValid(rawId)) {
      results.push({ studentId: rawId, ok: false, reason: 'invalid_id' });
      failed += 1;
      continue;
    }

    const student = await User.findById(rawId)
      .select('_id name email batch level subscription goStatus currentCourseDay')
      .lean();

    if (!student) {
      results.push({ studentId: rawId, ok: false, reason: 'not_found' });
      failed += 1;
      continue;
    }

    if (!student.email) {
      results.push({ studentId: rawId, ok: false, reason: 'no_email', name: student.name });
      skipped += 1;
      continue;
    }

    let dayData;
    try {
      dayData = await getIncompleteTasksForStudent(student);
    } catch (err) {
      console.error('languageTrackingReminders completion', rawId, err.message);
      results.push({ studentId: rawId, ok: false, reason: 'completion_error', name: student.name });
      failed += 1;
      continue;
    }

    const { day, incompleteTasks } = dayData;
    if (!incompleteTasks.length) {
      results.push({
        studentId: rawId,
        ok: false,
        reason: 'all_complete',
        name: student.name,
        day,
      });
      skipped += 1;
      continue;
    }

    const mail = buildJourneyDayReminderEmail({
      name: student.name,
      day,
      incompleteTasks,
      doneTasks: dayData.doneTasks,
      totalTasks: dayData.totalTasks,
      loginUrl,
    });

    try {
      await transporter.sendMail({
        from,
        to: student.email,
        subject: mail.subject,
        html: mail.html,
      });
      results.push({
        studentId: rawId,
        ok: true,
        name: student.name,
        email: student.email,
        day,
        incompleteCount: incompleteTasks.length,
      });
      sent += 1;
    } catch (err) {
      console.error('languageTrackingReminders sendMail', rawId, err.message);
      results.push({ studentId: rawId, ok: false, reason: 'send_failed', name: student.name });
      failed += 1;
    }
  }

  return { results, sent, skipped, failed };
}

module.exports = {
  sendJourneyReminders,
  MAX_PER_REQUEST,
};
