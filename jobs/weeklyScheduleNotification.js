/**
 * Weekly Schedule Notification Job
 *
 * Runs every Sunday at 09:00 IST (03:30 UTC).
 * Sends the upcoming week's live class timetable (Monday → Sunday) via
 * both WhatsApp and Email to students, teachers, and admins.
 */
'use strict';

const cron = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const { isWhatsappAutomatedJobsEnabled } = require('../services/whatsappCrmService');
const {
  getUpcomingWeekBoundaries,
  buildWhatsappMessage,
  buildEmailHtml,
  sendEmailNotification,
  sendWhatsappAutomated,
  teacherMeetingsForWeek,
  weekLabel,
} = require('../services/weeklyTimetableService');

async function processWeeklyScheduleNotifications() {
  const { start: weekStart, end: weekEnd } = getUpcomingWeekBoundaries();
  const label = weekLabel(weekStart, weekEnd);
  console.log(`[WeeklyTimetable] Running for week: ${label}`);

  const allMeetings = await MeetingLink.find({
    startTime: { $gte: weekStart, $lte: weekEnd },
    status: { $ne: 'cancelled' },
  })
    .sort({ startTime: 1 })
    .lean();

  if (!allMeetings.length) {
    console.log('[WeeklyTimetable] No meetings found for upcoming week — notifications skipped.');
    return;
  }

  const byBatch = {};
  for (const m of allMeetings) {
    (byBatch[m.batch] = byBatch[m.batch] || []).push(m);
  }

  let emailSent = 0, emailFailed = 0, waSent = 0, waFailed = 0;
  const weekSubject = `📅 Your Live Classes This Week (${label})`;
  const waEnabled = isWhatsappAutomatedJobsEnabled();

  // Students
  const students = await User.find({ role: 'STUDENT', isActive: true })
    .select('name email batch whatsappNumber phoneNumber')
    .lean();

  for (const student of students) {
    const meetings = byBatch[student.batch] || [];
    if (!meetings.length) continue;

    const html = buildEmailHtml({
      recipientName: student.name,
      batchLabel: student.batch,
      meetings,
      weekStart,
      weekEnd,
      recipientRole: 'student',
    });
    const waMsg = buildWhatsappMessage(student.name, meetings, weekStart, weekEnd);
    const phone = student.whatsappNumber || student.phoneNumber || '';

    const [eOk, wOk] = await Promise.all([
      sendEmailNotification({ to: student.email, name: student.name, subject: weekSubject, html }),
      waEnabled ? sendWhatsappAutomated(phone, student.name, waMsg).then((r) => r.sent) : Promise.resolve(false),
    ]);

    eOk ? emailSent++ : emailFailed++;
    wOk ? waSent++ : waFailed++;
  }

  // Teachers
  const teachers = await User.find({
    role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
    isActive: true,
  })
    .select('name email assignedBatches whatsappNumber phoneNumber')
    .lean();

  for (const teacher of teachers) {
    const meetings = teacherMeetingsForWeek(allMeetings, teacher);
    if (!meetings.length) continue;

    const batches = Array.isArray(teacher.assignedBatches) ? teacher.assignedBatches : [];
    const batchLabel = batches.filter((b) => byBatch[b]).join(', ');
    const html = buildEmailHtml({
      recipientName: teacher.name,
      batchLabel,
      meetings,
      weekStart,
      weekEnd,
      includesBatch: batches.filter((b) => byBatch[b]).length > 1,
      recipientRole: 'teacher',
    });
    const waMsg = buildWhatsappMessage(teacher.name, meetings, weekStart, weekEnd, { includeBatch: true });
    const phone = teacher.whatsappNumber || teacher.phoneNumber || '';

    const [eOk, wOk] = await Promise.all([
      sendEmailNotification({ to: teacher.email, name: teacher.name, subject: weekSubject, html }),
      waEnabled ? sendWhatsappAutomated(phone, teacher.name, waMsg).then((r) => r.sent) : Promise.resolve(false),
    ]);

    eOk ? emailSent++ : emailFailed++;
    wOk ? waSent++ : waFailed++;
  }

  // Admins
  const admins = await User.find({
    role: { $in: ['ADMIN', 'SUB_ADMIN'] },
    isActive: true,
  })
    .select('name email whatsappNumber phoneNumber')
    .lean();

  const adminSubject = `📅 All Batches – Weekly Class Schedule (${label})`;
  for (const admin of admins) {
    const html = buildEmailHtml({
      recipientName: admin.name,
      batchLabel: null,
      meetings: allMeetings,
      weekStart,
      weekEnd,
      includesBatch: true,
      recipientRole: 'admin',
    });
    const waMsg = buildWhatsappMessage(admin.name, allMeetings, weekStart, weekEnd);
    const phone = admin.whatsappNumber || admin.phoneNumber || '';

    const [eOk, wOk] = await Promise.all([
      sendEmailNotification({ to: admin.email, name: admin.name, subject: adminSubject, html }),
      waEnabled ? sendWhatsappAutomated(phone, admin.name, waMsg).then((r) => r.sent) : Promise.resolve(false),
    ]);

    eOk ? emailSent++ : emailFailed++;
    wOk ? waSent++ : waFailed++;
  }

  console.log(
    `[WeeklyTimetable] Complete — Email: ${emailSent}/${emailFailed} | WhatsApp: ${waSent}/${waFailed}`
  );
}

function scheduleWeeklyScheduleNotification() {
  cron.schedule('30 3 * * 0', () => {
    processWeeklyScheduleNotifications().catch((err) =>
      console.error('[WeeklyTimetable] Job error:', err.message)
    );
  });
  console.log('📅 [WeeklyTimetable] Weekly schedule notifications scheduled (Sundays 09:00 IST)');
}

module.exports = { scheduleWeeklyScheduleNotification, processWeeklyScheduleNotifications };
