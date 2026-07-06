/**
 * Shared weekly timetable notification logic (email + WhatsApp).
 * Used by the Sunday cron job and admin "Share Timetable" action.
 */
'use strict';

const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const {
  sendWhatsappNotification,
  sendManualWhatsappMessage,
  isWhatsappAutomatedJobsEnabled,
} = require('../services/whatsappCrmService');

const NOTIFICATION_TYPE = 'WEEKLY_TIMETABLE';
const PORTAL_URL =
  process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://gluckstudentsportal.com';
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@gluckstudentsportal.com';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Glück Global';

const DATE_FORMAT_OPTS_LONG = {
  timeZone: 'Asia/Colombo',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
};

const DATE_FORMAT_OPTS_SHORT = {
  timeZone: 'Asia/Colombo',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
};

const TIME_FORMAT_OPTS = {
  timeZone: 'Asia/Colombo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
};

function fmtDateLong(d)  { return d.toLocaleDateString('en-IN', DATE_FORMAT_OPTS_LONG); }
function fmtDateShort(d) { return d.toLocaleDateString('en-IN', DATE_FORMAT_OPTS_SHORT); }
function fmtTime(d)      { return d.toLocaleTimeString('en-IN', TIME_FORMAT_OPTS); }
function weekLabel(s, e) { return `${fmtDateShort(s)} – ${fmtDateShort(e)}`; }

/** Monday 00:00 → Sunday 23:59 of the week containing referenceDate. */
function getCalendarWeekBoundaries(referenceDate = new Date()) {
  const now = new Date(referenceDate);
  const day = now.getDay(); // 0=Sun, 1=Mon
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const start = new Date(now);
  start.setDate(now.getDate() + diffToMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/** Next Monday 00:00 → next Sunday 23:59 (used by Sunday cron). */
function getUpcomingWeekBoundaries() {
  const now = new Date();
  const daysUntilMonday = now.getDay() === 0 ? 1 : 8 - now.getDay();

  const start = new Date(now);
  start.setDate(now.getDate() + daysUntilMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function groupMeetingsByBatch(meetings) {
  const byBatch = {};
  for (const m of meetings) {
    const batch = String(m.batch || 'Unknown');
    (byBatch[batch] = byBatch[batch] || []).push(m);
  }
  for (const batch of Object.keys(byBatch)) {
    byBatch[batch].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  }
  return byBatch;
}

function formatClassLine(m) {
  const title = m.topic || 'Live Class';
  const duration = m.duration ? `${m.duration} min` : '';
  const when = `${fmtDateLong(m.startTime)} at ${fmtTime(m.startTime)}`;
  return duration ? `${when} — ${title} — ${duration}` : `${when} — ${title}`;
}

/** One WhatsApp message for a single batch schedule. */
function buildWhatsappBatchScheduleMessage(recipientName, batch, meetings, weekStart, weekEnd) {
  const label = weekLabel(weekStart, weekEnd);
  const firstName = String(recipientName || '').trim().split(/\s+/)[0] || 'there';

  if (!meetings.length) {
    return (
      `Hi ${firstName}, this is your schedule for Batch ${batch} (${label}).\n\n` +
      `No live classes are scheduled this week.\n\n— Glück Global`
    );
  }

  const classLines = meetings.map(formatClassLine).join('\n');

  return (
    `Hi ${firstName}, this is your schedule for Batch ${batch} (${label}):\n\n` +
    `${classLines}\n\n` +
    `Please join on time. — Glück Global`
  );
}

/**
 * Build WhatsApp message(s). Teachers/admins with multiple batches get one message per batch.
 * Students get a single message for their batch.
 */
function buildWhatsappMessages(recipientName, meetings, weekStart, weekEnd, { splitByBatch = false } = {}) {
  if (!meetings.length) {
    return [
      `Hi ${recipientName}, no live classes are scheduled for this week (${weekLabel(weekStart, weekEnd)}). — Glück Global`,
    ];
  }

  const byBatch = groupMeetingsByBatch(meetings);
  const batchKeys = Object.keys(byBatch).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });

  if (!splitByBatch || batchKeys.length <= 1) {
    const batch = batchKeys[0] || '';
    return [buildWhatsappBatchScheduleMessage(recipientName, batch, byBatch[batch] || meetings, weekStart, weekEnd)];
  }

  return batchKeys.map((batch) =>
    buildWhatsappBatchScheduleMessage(recipientName, batch, byBatch[batch], weekStart, weekEnd)
  );
}

/** @deprecated Use buildWhatsappMessages — kept for single-message callers */
function buildWhatsappMessage(recipientName, meetings, weekStart, weekEnd, { includeBatch = true } = {}) {
  const splitByBatch = includeBatch && new Set(meetings.map((m) => m.batch)).size > 1;
  const messages = buildWhatsappMessages(recipientName, meetings, weekStart, weekEnd, { splitByBatch });
  return messages.join('\n\n---\n\n');
}

function buildMeetingRows(meetings, includesBatch = false) {
  if (!meetings.length) {
    return `<tr>
      <td colspan="${includesBatch ? 5 : 4}" style="padding:24px;text-align:center;color:#94a3b8;font-size:14px;">
        No live classes scheduled for this week.
      </td>
    </tr>`;
  }

  return meetings
    .map(
      (m) => `
    <tr>
      ${includesBatch ? `<td style="padding:11px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#475569;font-weight:600;">${m.batch || '–'}</td>` : ''}
      <td style="padding:11px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;">${fmtDateLong(m.startTime)}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#334155;white-space:nowrap;">${fmtTime(m.startTime)}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;font-weight:600;">${m.topic || 'Live Class'}</td>
      <td style="padding:11px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${m.duration ? `${m.duration} min` : '–'}</td>
    </tr>`
    )
    .join('');
}

function buildEmailHtml({
  recipientName,
  batchLabel,
  meetings,
  weekStart,
  weekEnd,
  includesBatch = false,
  recipientRole = 'student',
}) {
  const label = weekLabel(weekStart, weekEnd);
  const batchNote = batchLabel ? ` — <strong>Batch ${batchLabel}</strong>` : '';

  const introLine =
    recipientRole === 'teacher'
      ? `Here is your <strong>live class timetable</strong> for this week${batchNote}. Please be ready to host your classes on time.`
      : recipientRole === 'admin'
        ? `Here is the <strong>full weekly live class timetable</strong> for all batches (${label}).`
        : `Here is your <strong>live class timetable</strong> for this week${batchNote}. Mark your calendar and join on time!`;

  const headerCols = includesBatch
    ? ['Batch', 'Date', 'Time', 'Class Title', 'Duration']
    : ['Date', 'Time', 'Class Title', 'Duration'];

  const theadCells = headerCols
    .map(
      (h) =>
        `<th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;` +
        `color:#64748b;text-transform:uppercase;letter-spacing:0.6px;background:#f8fafc;">${h}</th>`
    )
    .join('');

  const rows = buildMeetingRows(meetings, includesBatch);
  const portalCta =
    recipientRole === 'teacher' ? 'Open Teacher Portal →' : 'Open Student Portal →';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Weekly Class Schedule</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.09);max-width:100%;">
      <tr>
        <td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);padding:40px 44px;text-align:center;">
          <div style="font-size:36px;margin-bottom:8px;">📅</div>
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;">Weekly Live Class Schedule</h1>
          <p style="color:#bfdbfe;margin:8px 0 0;font-size:14px;font-weight:500;">${label}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 44px 8px;">
          <p style="margin:0;font-size:16px;color:#0f172a;">Hi <strong>${recipientName}</strong>,</p>
          <p style="margin:12px 0 0;font-size:14px;color:#475569;line-height:1.7;">${introLine}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 44px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:collapse;">
            <thead><tr>${theadCells}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </td>
      </tr>
      ${meetings.length ? `
      <tr>
        <td style="padding:0 44px 32px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:#2563eb;border-radius:8px;">
              <a href="${PORTAL_URL}" style="display:block;padding:13px 30px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">${portalCta}</a>
            </td>
          </tr></table>
        </td>
      </tr>` : ''}
      <tr>
        <td style="padding:22px 44px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Glück Global Language School · Weekly timetable</p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

async function sendEmailNotification({ to, name, subject, html }) {
  try {
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error(`[WeeklyTimetable] Email failed for ${name} <${to}>:`, err.message);
    return false;
  }
}

async function sendWhatsappAutomated(phone, name, message) {
  const raw = (phone || '').toString().trim();
  if (!raw) return { sent: false, reason: 'no_phone' };
  const ok = await sendWhatsappNotification({ phone: raw, name, type: NOTIFICATION_TYPE, message });
  return { sent: ok, reason: ok ? null : 'send_failed' };
}

async function sendWhatsappAutomatedMultiple(phone, name, messages) {
  const raw = (phone || '').toString().trim();
  if (!raw) return { sent: 0, failed: messages.length, reason: 'no_phone' };

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    const result = await sendWhatsappAutomated(raw, name, message);
    if (result.sent) sent++;
    else failed++;
  }
  return {
    sent,
    failed,
    reason: sent === 0 && messages.length ? 'send_failed' : null,
  };
}

async function sendWhatsappManual(phone, name, message) {
  const raw = (phone || '').toString().trim();
  if (!raw) return { sent: false, reason: 'no_phone' };
  const result = await sendManualWhatsappMessage({ phone_number: raw, message, department: 'Language' });
  return { sent: !!result.ok, reason: result.ok ? null : result.error?.message || 'send_failed' };
}

async function sendWhatsappManualMultiple(phone, name, messages) {
  const raw = (phone || '').toString().trim();
  if (!raw) return { sent: 0, failed: messages.length, reason: 'no_phone' };

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    const result = await sendWhatsappManual(raw, name, message);
    if (result.sent) sent++;
    else failed++;
  }
  return {
    sent,
    failed,
    reason: sent === 0 && messages.length ? 'send_failed' : null,
  };
}

function teacherMeetingsForWeek(allMeetings, teacher) {
  const batches = Array.isArray(teacher.assignedBatches) ? teacher.assignedBatches.map(String) : [];
  const teacherId = String(teacher._id);

  return allMeetings.filter(
    (m) =>
      batches.includes(String(m.batch)) ||
      (m.assignedTeacher && String(m.assignedTeacher) === teacherId)
  );
}

/**
 * Send weekly timetable to one teacher (admin manual share).
 * Uses current calendar week Mon–Sun.
 */
async function shareTeacherWeeklyTimetable(teacherId) {
  const teacher = await User.findOne({
    _id: teacherId,
    role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
    isActive: true,
  })
    .select('name email assignedBatches whatsappNumber phoneNumber')
    .lean();

  if (!teacher) {
    const err = new Error('Teacher not found or inactive');
    err.statusCode = 404;
    throw err;
  }

  const { start: weekStart, end: weekEnd } = getCalendarWeekBoundaries();
  const label = weekLabel(weekStart, weekEnd);

  const allMeetings = await MeetingLink.find({
    startTime: { $gte: weekStart, $lte: weekEnd },
    status: { $ne: 'cancelled' },
  })
    .sort({ startTime: 1 })
    .lean();

  const meetings = teacherMeetingsForWeek(allMeetings, teacher);
  const batches = Array.isArray(teacher.assignedBatches) ? teacher.assignedBatches : [];
  const batchLabel = batches.join(', ');
  const includesBatch = batches.length > 1 || meetings.some((m, i, arr) => arr.findIndex((x) => x.batch === m.batch) !== i);

  const subject = `📅 Your Live Classes This Week (${label})`;
  const html = buildEmailHtml({
    recipientName: teacher.name,
    batchLabel,
    meetings,
    weekStart,
    weekEnd,
    includesBatch: includesBatch || batches.length > 0,
    recipientRole: 'teacher',
  });
  const waMessages = buildWhatsappMessages(teacher.name, meetings, weekStart, weekEnd, { splitByBatch: true });
  const phone = teacher.whatsappNumber || teacher.phoneNumber || '';

  const [emailOk, waResult] = await Promise.all([
    sendEmailNotification({ to: teacher.email, name: teacher.name, subject, html }),
    sendWhatsappManualMultiple(phone, teacher.name, waMessages),
  ]);

  return {
    teacherName: teacher.name,
    teacherEmail: teacher.email,
    weekLabel: label,
    meetingCount: meetings.length,
    emailSent: emailOk,
    whatsappSent: waResult.sent > 0,
    whatsappMessagesSent: waResult.sent,
    whatsappMessagesFailed: waResult.failed,
    whatsappSkippedReason: waResult.reason,
  };
}

module.exports = {
  NOTIFICATION_TYPE,
  getCalendarWeekBoundaries,
  getUpcomingWeekBoundaries,
  buildWhatsappMessage,
  buildWhatsappMessages,
  buildWhatsappBatchScheduleMessage,
  buildEmailHtml,
  sendEmailNotification,
  sendWhatsappAutomated,
  sendWhatsappAutomatedMultiple,
  sendWhatsappManualMultiple,
  teacherMeetingsForWeek,
  shareTeacherWeeklyTimetable,
  weekLabel,
};
