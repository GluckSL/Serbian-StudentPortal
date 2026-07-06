/**
 * Weekly Schedule Notification Job
 *
 * Runs every Sunday at 09:00 IST (03:30 UTC).
 * Sends the upcoming week's live class timetable (Monday → Sunday) via
 * both WhatsApp and Email to:
 *   • Every active student (their own batch schedule)
 *   • Every active teacher (schedule for all their assigned batches)
 *   • Every admin / sub-admin (full all-batches summary)
 */
'use strict';

const cron = require('node-cron');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const {
  sendWhatsappNotification,
  isWhatsappAutomatedJobsEnabled,
} = require('../services/whatsappCrmService');

const NOTIFICATION_TYPE = 'WEEKLY_TIMETABLE';
const PORTAL_URL =
  process.env.PORTAL_URL || process.env.FRONTEND_URL || 'https://gluckstudentsportal.com';
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_USER || 'noreply@gluckstudentsportal.com';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Glück Global';

// ── Date / time helpers ───────────────────────────────────────────────────────

/**
 * Returns the upcoming week boundaries in UTC:
 *   start = next Monday 00:00:00 local
 *   end   = next Sunday  23:59:59 local
 *
 * Designed to be called on a Sunday so "next Monday" is tomorrow.
 */
function upcomingWeekBoundaries() {
  const now = new Date();
  // getDay() → 0=Sun, 1=Mon … 6=Sat
  // From Sunday (0): +1 day = Monday; from any other day: 8 − day
  const daysUntilMonday = now.getDay() === 0 ? 1 : 8 - now.getDay();

  const start = new Date(now);
  start.setDate(now.getDate() + daysUntilMonday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

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

// ── WhatsApp message builder ──────────────────────────────────────────────────

/**
 * Builds a short single-paragraph WhatsApp message (≤ 400 chars).
 * Shows up to 4 classes inline; truncates the rest.
 */
function buildWhatsappMessage(recipientName, meetings, weekStart, weekEnd) {
  const label = weekLabel(weekStart, weekEnd);

  if (!meetings.length) {
    return (
      `Hi ${recipientName}! No live classes are scheduled for the upcoming week ` +
      `(${label}). Enjoy your week! — Glück Global`
    );
  }

  const MAX_SHOW = 4;
  const shown = meetings.slice(0, MAX_SHOW);
  const more  = meetings.length - MAX_SHOW;

  const classSummary = shown
    .map((m) => `${fmtDateLong(m.startTime)} at ${fmtTime(m.startTime)} — ${m.topic || 'Live Class'}`)
    .join(' | ');

  const suffix = more > 0 ? ` (+${more} more class${more > 1 ? 'es' : ''})` : '';

  return (
    `Hi ${recipientName}! This week on ${label} you have live classes: ` +
    `${classSummary}${suffix}. Join on time and have a great week! — Glück Global`
  );
}

// ── Email HTML builders ───────────────────────────────────────────────────────

/** Shared row builder used by both student/teacher and admin tables. */
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

function buildEmailHtml({ recipientName, batchLabel, meetings, weekStart, weekEnd, includesBatch = false }) {
  const label = weekLabel(weekStart, weekEnd);
  const batchNote = batchLabel
    ? ` — <strong>Batch ${batchLabel}</strong>`
    : '';

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

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Weekly Class Schedule</title></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:40px 16px;">
  <tr><td align="center">
    <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.09);max-width:100%;">

      <!-- ── Header ── -->
      <tr>
        <td style="background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 100%);padding:40px 44px;text-align:center;">
          <div style="font-size:36px;margin-bottom:8px;">📅</div>
          <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:700;letter-spacing:-0.3px;">Weekly Live Class Schedule</h1>
          <p style="color:#bfdbfe;margin:8px 0 0;font-size:14px;font-weight:500;">${label}</p>
        </td>
      </tr>

      <!-- ── Greeting ── -->
      <tr>
        <td style="padding:32px 44px 8px;">
          <p style="margin:0;font-size:16px;color:#0f172a;line-height:1.5;">
            Hi <strong>${recipientName}</strong>,
          </p>
          <p style="margin:12px 0 0;font-size:14px;color:#475569;line-height:1.7;">
            Here is your <strong>live class timetable</strong> for the upcoming week${batchNote}.
            Mark your calendar and make sure to join on time — your teacher will be waiting! 🎓
          </p>
        </td>
      </tr>

      <!-- ── Schedule Table ── -->
      <tr>
        <td style="padding:24px 44px;">
          <table width="100%" cellpadding="0" cellspacing="0"
            style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;border-collapse:collapse;">
            <thead>
              <tr>${theadCells}</tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td>
      </tr>

      <!-- ── Reminder note ── -->
      ${meetings.length ? `
      <tr>
        <td style="padding:0 44px 20px;">
          <div style="background:#eff6ff;border-left:4px solid #2563eb;border-radius:6px;padding:14px 18px;">
            <p style="margin:0;font-size:13px;color:#1e40af;line-height:1.6;">
              💡 <strong>Reminder:</strong> Log in to the portal a few minutes early and make sure your internet
              connection is stable. You will receive a join link closer to class time.
            </p>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 44px 32px;">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="background:#2563eb;border-radius:8px;">
              <a href="${PORTAL_URL}"
                style="display:block;padding:13px 30px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;letter-spacing:0.2px;">
                Open Student Portal →
              </a>
            </td>
          </tr></table>
        </td>
      </tr>` : ''}

      <!-- ── Footer ── -->
      <tr>
        <td style="padding:22px 44px;background:#f8fafc;border-top:1px solid #e2e8f0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6;">
            Glück Global Language School · Automated weekly timetable reminder<br>
            <a href="${PORTAL_URL}" style="color:#2563eb;text-decoration:none;">gluckstudentsportal.com</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Send helpers ──────────────────────────────────────────────────────────────

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
    console.error(`[WeeklyTimetable] ❌ Email failed for ${name} <${to}>:`, err.message);
    return false;
  }
}

async function sendWhatsappMsg(phone, name, message) {
  const raw = (phone || '').toString().trim();
  if (!raw) return false;
  return sendWhatsappNotification({ phone: raw, name, type: NOTIFICATION_TYPE, message });
}

// ── Core processor ────────────────────────────────────────────────────────────

async function processWeeklyScheduleNotifications() {
  const { start: weekStart, end: weekEnd } = upcomingWeekBoundaries();
  const label = weekLabel(weekStart, weekEnd);
  console.log(`[WeeklyTimetable] 🚀 Running for week: ${label}`);

  // 1 ── Fetch all non-cancelled meetings in the upcoming week
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

  // Build batch → meetings map
  const byBatch = {};
  for (const m of allMeetings) {
    (byBatch[m.batch] = byBatch[m.batch] || []).push(m);
  }
  const batchNames = Object.keys(byBatch);
  console.log(
    `[WeeklyTimetable] ${allMeetings.length} meeting(s) across ${batchNames.length} batch(es): ${batchNames.join(', ')}`
  );

  let emailSent = 0, emailFailed = 0, waSent = 0, waFailed = 0;
  const weekSubject = `📅 Your Live Classes This Week (${label})`;
  const waEnabled = isWhatsappAutomatedJobsEnabled();

  // ── 2. Students ─────────────────────────────────────────────────────────────
  const students = await User.find({ role: 'STUDENT', isActive: true })
    .select('name email batch whatsappNumber phoneNumber')
    .lean();

  console.log(`[WeeklyTimetable] Notifying ${students.length} student(s)...`);
  for (const student of students) {
    const meetings = byBatch[student.batch] || [];
    if (!meetings.length) continue; // no classes for their batch this week

    const html = buildEmailHtml({
      recipientName: student.name,
      batchLabel: student.batch,
      meetings,
      weekStart,
      weekEnd,
    });
    const waMsg = buildWhatsappMessage(student.name, meetings, weekStart, weekEnd);

    const phone = student.whatsappNumber || student.phoneNumber || '';

    const [eOk, wOk] = await Promise.all([
      sendEmailNotification({ to: student.email, name: student.name, subject: weekSubject, html }),
      waEnabled ? sendWhatsappMsg(phone, student.name, waMsg) : Promise.resolve(false),
    ]);

    eOk ? emailSent++ : emailFailed++;
    wOk ? waSent++ : waFailed++;
  }

  // ── 3. Teachers ─────────────────────────────────────────────────────────────
  const teachers = await User.find({
    role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
    isActive: true,
  })
    .select('name email assignedBatches whatsappNumber phoneNumber')
    .lean();

  console.log(`[WeeklyTimetable] Notifying ${teachers.length} teacher(s)...`);
  for (const teacher of teachers) {
    const batches = Array.isArray(teacher.assignedBatches) ? teacher.assignedBatches : [];
    const meetings = allMeetings.filter((m) => batches.includes(m.batch));
    if (!meetings.length) continue;

    const batchLabel = batches.filter((b) => byBatch[b]).join(', ');
    const html = buildEmailHtml({
      recipientName: teacher.name,
      batchLabel,
      meetings,
      weekStart,
      weekEnd,
      // Show batch column if teacher handles multiple batches
      includesBatch: batches.filter((b) => byBatch[b]).length > 1,
    });
    const waMsg = buildWhatsappMessage(teacher.name, meetings, weekStart, weekEnd);
    const phone = teacher.whatsappNumber || teacher.phoneNumber || '';

    const [eOk, wOk] = await Promise.all([
      sendEmailNotification({ to: teacher.email, name: teacher.name, subject: weekSubject, html }),
      waEnabled ? sendWhatsappMsg(phone, teacher.name, waMsg) : Promise.resolve(false),
    ]);

    eOk ? emailSent++ : emailFailed++;
    wOk ? waSent++ : waFailed++;
  }

  // ── 4. Admins (full all-batches summary) ─────────────────────────────────────
  const admins = await User.find({
    role: { $in: ['ADMIN', 'SUB_ADMIN'] },
    isActive: true,
  })
    .select('name email whatsappNumber phoneNumber')
    .lean();

  const adminSubject = `📅 All Batches – Weekly Class Schedule (${label})`;
  console.log(`[WeeklyTimetable] Notifying ${admins.length} admin(s)...`);
  for (const admin of admins) {
    const html = buildEmailHtml({
      recipientName: admin.name,
      batchLabel: null,
      meetings: allMeetings,
      weekStart,
      weekEnd,
      includesBatch: true, // admins see all batches with batch column
    });
    const waMsg = buildWhatsappMessage(admin.name, allMeetings, weekStart, weekEnd);
    const phone = admin.whatsappNumber || admin.phoneNumber || '';

    const [eOk, wOk] = await Promise.all([
      sendEmailNotification({ to: admin.email, name: admin.name, subject: adminSubject, html }),
      waEnabled ? sendWhatsappMsg(phone, admin.name, waMsg) : Promise.resolve(false),
    ]);

    eOk ? emailSent++ : emailFailed++;
    wOk ? waSent++ : waFailed++;
  }

  console.log(
    `[WeeklyTimetable] ✅ Complete — ` +
      `Email: ${emailSent} sent / ${emailFailed} failed | ` +
      `WhatsApp: ${waSent} sent / ${waFailed} failed`
  );
}

// ── Cron registration ─────────────────────────────────────────────────────────

function scheduleWeeklyScheduleNotification() {
  // Every Sunday at 09:00 IST (Asia/Colombo = UTC+5:30 → 03:30 UTC)
  cron.schedule('30 3 * * 0', () => {
    processWeeklyScheduleNotifications().catch((err) =>
      console.error('[WeeklyTimetable] ❌ Unhandled job error:', err.message)
    );
  });
  console.log('📅 [WeeklyTimetable] Weekly schedule notifications scheduled (Sundays 09:00 IST)');
}

module.exports = { scheduleWeeklyScheduleNotification, processWeeklyScheduleNotifications };
