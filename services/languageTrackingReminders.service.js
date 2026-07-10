'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const { buildJourneyDayReminderEmail, buildJourneyWeekReminderEmail } = require('../utils/emailTemplates');
const { journeyWeekFromDay, weekDayRange } = require('../utils/oldBatchDgWeekAccess');

const MAX_PER_REQUEST = 50;

function resolveBatchForCompletion(student) {
  if (student.batch) return String(student.batch);
  const { goBatchForStudent } = require('../utils/goSilverTrack');
  if (student.goStatus === 'GO' && student.subscription === 'SILVER') return goBatchForStudent(student);
  return '';
}

async function getIncompleteTasksForStudent(student, dayOverride) {
  const { computeJourneyDayCompletion } = require('./journeyDayCompletion.service');
  const sid = student._id;
  const batchForCompletion = resolveBatchForCompletion(student);
  const day = Number.isFinite(Number(dayOverride)) && Number(dayOverride) >= 1
    ? Math.floor(Number(dayOverride))
    : (student.currentCourseDay || 1);

  const completion = await computeJourneyDayCompletion(sid, batchForCompletion, day, {
    includeRecordings: false,
    includeDg: true,
    studentLevel: student.level || '',
    studentPlan: student.subscription || '',
    goStatus: student.goStatus || '',
  });

  const classBreakdown = completion.breakdown?.classes || { done: 0, total: 0 };
  const incompleteTasks = (completion.incompleteTasks || []).filter((t) => t.kind !== 'class');

  return {
    day,
    incompleteTasks,
    doneTasks: completion.doneTasks - (classBreakdown.done || 0),
    totalTasks: completion.totalTasks - (classBreakdown.total || 0),
  };
}

/**
 * Send journey-day reminder emails listing only incomplete tasks for each student's day.
 * @param {string[]} studentIds
 * @param {number} [dayOverride] — when set, reminders refer to this journey day (not currentCourseDay)
 * @returns {Promise<{ results: object[], sent: number, skipped: number, failed: number }>}
 */
async function sendJourneyReminders(studentIds, dayOverride) {
  const ids = [...new Set((studentIds || []).map(String).filter(Boolean))];
  if (!ids.length) {
    return { results: [], sent: 0, skipped: 0, failed: 0 };
  }

  const loginUrl = (process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://portal.serbia.gluckglobal.com').replace(/\/$/, '');
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
      dayData = await getIncompleteTasksForStudent(student, dayOverride);
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
      currentCourseDay: student.currentCourseDay,
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

async function getIncompleteTasksForWeek(student) {
  const currentCourseDay = student.currentCourseDay || 1;
  const week = journeyWeekFromDay(currentCourseDay);
  const { start, end } = weekDayRange(week);

  const daysWithTasks = [];
  let totalIncomplete = 0;

  for (let day = start; day <= Math.min(end, currentCourseDay); day += 1) {
    const dayData = await getIncompleteTasksForStudent(student, day);
    if (dayData.incompleteTasks.length) {
      daysWithTasks.push({
        day,
        incompleteTasks: dayData.incompleteTasks,
        doneTasks: dayData.doneTasks,
        totalTasks: dayData.totalTasks,
      });
      totalIncomplete += dayData.incompleteTasks.length;
    }
  }

  return {
    week,
    weekStartDay: start,
    weekEndDay: end,
    daysWithTasks,
    totalIncomplete,
  };
}

/**
 * Send journey-week reminder emails listing incomplete tasks across the current week.
 * @param {string[]} studentIds
 * @returns {Promise<{ results: object[], sent: number, skipped: number, failed: number }>}
 */
async function sendJourneyWeekReminders(studentIds) {
  const ids = [...new Set((studentIds || []).map(String).filter(Boolean))];
  if (!ids.length) {
    return { results: [], sent: 0, skipped: 0, failed: 0 };
  }

  const loginUrl = (process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://portal.serbia.gluckglobal.com').replace(/\/$/, '');
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

    let weekData;
    try {
      weekData = await getIncompleteTasksForWeek(student);
    } catch (err) {
      console.error('languageTrackingReminders week completion', rawId, err.message);
      results.push({ studentId: rawId, ok: false, reason: 'completion_error', name: student.name });
      failed += 1;
      continue;
    }

    const { week, weekStartDay, weekEndDay, daysWithTasks, totalIncomplete } = weekData;
    if (!daysWithTasks.length) {
      results.push({
        studentId: rawId,
        ok: false,
        reason: 'all_complete',
        name: student.name,
        week,
      });
      skipped += 1;
      continue;
    }

    const mail = buildJourneyWeekReminderEmail({
      name: student.name,
      week,
      weekStartDay,
      weekEndDay,
      currentCourseDay: student.currentCourseDay,
      daysWithTasks,
      totalIncomplete,
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
        week,
        incompleteCount: totalIncomplete,
      });
      sent += 1;
    } catch (err) {
      console.error('languageTrackingReminders week sendMail', rawId, err.message);
      results.push({ studentId: rawId, ok: false, reason: 'send_failed', name: student.name });
      failed += 1;
    }
  }

  return { results, sent, skipped, failed };
}

module.exports = {
  sendJourneyReminders,
  sendJourneyWeekReminders,
  MAX_PER_REQUEST,
};
