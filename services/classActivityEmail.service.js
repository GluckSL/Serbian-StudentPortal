/**
 * Email alerts when students submit class doubts or upload answer media.
 * Notifies the assigned teacher and languageschool@gluckglobal.com.
 */

const MeetingLink = require('../models/MeetingLink');
const transporter = require('../config/emailConfig');

const LANGUAGE_SCHOOL_EMAIL =
  process.env.LANGUAGE_SCHOOL_EMAIL ||
  process.env.SALES_TEAM_EMAIL ||
  'languageschool@gluckglobal.com';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatClassDateTime(startTime, timeZone = 'Asia/Colombo') {
  if (!startTime) return 'N/A';
  const d = new Date(startTime);
  return d.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

function teacherPortalClassesUrl() {
  const base = (
    process.env.TEACHER_PORTAL_URL ||
    process.env.PORTAL_URL ||
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    ''
  ).replace(/\/+$/, '');
  return base ? `${base}/teacher-dashboard/my-classes` : null;
}

async function loadMeetingWithTeacher(meetingId) {
  return MeetingLink.findById(meetingId)
    .populate('assignedTeacher', 'name email')
    .populate('createdBy', 'name email')
    .lean();
}

function resolveTeacherEmail(meeting) {
  return (
    meeting?.assignedTeacher?.email ||
    meeting?.createdBy?.email ||
    ''
  ).trim();
}

function resolveTeacherName(meeting) {
  return (
    meeting?.assignedTeacher?.name ||
    meeting?.createdBy?.name ||
    'Teacher'
  );
}

function buildRecipients(teacherEmail) {
  const recipients = new Set();
  const normalizedTeacher = (teacherEmail || '').trim().toLowerCase();
  if (normalizedTeacher) recipients.add(normalizedTeacher);
  recipients.add(LANGUAGE_SCHOOL_EMAIL.toLowerCase());
  return [...recipients];
}

function wrapEmailHtml({ title, bodyHtml }) {
  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6; background:#f9fafb; padding:20px;">
      <div style="max-width:600px; margin:0 auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <div style="background:#000e89; padding:16px 20px;">
          <h2 style="color:#fff; margin:0; font-size:18px;">${escapeHtml(title)}</h2>
        </div>
        <div style="padding:20px;">
          ${bodyHtml}
          <p style="margin:20px 0 0; font-size:13px; color:#6b7280;">Glück Global Language School</p>
        </div>
      </div>
    </div>
  `;
}

function classInfoBlock(meeting) {
  const topic = escapeHtml(meeting.topic || 'Class');
  const batch = escapeHtml(meeting.batch || '—');
  const plan = escapeHtml(meeting.plan || '—');
  const when = escapeHtml(formatClassDateTime(meeting.startTime, meeting.timezone));
  return `
    <div style="background:#f3f4f6; border-radius:8px; padding:14px; margin:12px 0;">
      <p style="margin:0 0 6px;"><strong>Class:</strong> ${topic}</p>
      <p style="margin:0 0 6px;"><strong>Batch / Plan:</strong> ${batch} — ${plan}</p>
      <p style="margin:0;"><strong>Scheduled:</strong> ${when}</p>
    </div>
  `;
}

/**
 * Notify teacher + language school when a student uploads answer media.
 */
async function notifyNewSubmission(meetingId, submission, student) {
  try {
    const meeting = await loadMeetingWithTeacher(meetingId);
    if (!meeting) return;

    const teacherEmail = resolveTeacherEmail(meeting);
    const teacherName = escapeHtml(resolveTeacherName(meeting));
    const studentName = escapeHtml(student?.name || 'Student');
    const studentEmail = escapeHtml(student?.email || '—');
    const fileName = escapeHtml(submission?.originalName || submission?.fileName || 'Uploaded file');
    const caption = submission?.caption
      ? `<p style="margin:8px 0 0;"><strong>Caption:</strong> ${escapeHtml(submission.caption)}</p>`
      : '';
    const portalLink = teacherPortalClassesUrl();
    const linkHtml = portalLink
      ? `<p style="margin:12px 0 0;"><a href="${portalLink}" style="color:#000e89;">Open My Classes in the teacher portal</a></p>`
      : '';

    const bodyHtml = `
      <p style="margin:0 0 10px;">Hello <strong>${teacherName}</strong>,</p>
      <p style="margin:0 0 10px;">A student has uploaded an answer file for your class.</p>
      ${classInfoBlock(meeting)}
      <p style="margin:0 0 6px;"><strong>Student:</strong> ${studentName} (${studentEmail})</p>
      <p style="margin:0 0 6px;"><strong>File:</strong> ${fileName}</p>
      ${caption}
      ${linkHtml}
    `;

    if (!transporter || !process.env.EMAIL_USER) {
      console.warn('[classActivityEmail] Email transporter not configured; skipping submission alert');
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: buildRecipients(teacherEmail).join(', '),
      subject: `[Class Submission] ${meeting.topic || 'Class'} — ${student?.name || 'Student'}`,
      html: wrapEmailHtml({
        title: 'New student answer upload',
        bodyHtml,
      }),
    });
  } catch (err) {
    console.error('[classActivityEmail] notifyNewSubmission failed:', err.message);
  }
}

/**
 * Notify teacher + language school when a student asks a doubt.
 */
async function notifyNewDoubt(meetingId, doubt, student) {
  try {
    const meeting = await loadMeetingWithTeacher(meetingId);
    if (!meeting) return;

    const teacherEmail = resolveTeacherEmail(meeting);
    const teacherName = escapeHtml(resolveTeacherName(meeting));
    const studentName = escapeHtml(student?.name || 'Student');
    const studentEmail = escapeHtml(student?.email || '—');
    const doubtTitle = escapeHtml(doubt?.title || 'Doubt');
    const visibility = doubt?.visibility === 'private' ? 'Private' : 'Public';
    const explanation = doubt?.explanation
      ? `<p style="margin:8px 0 0;"><strong>Details:</strong><br/>${escapeHtml(doubt.explanation).replace(/\r?\n/g, '<br/>')}</p>`
      : '';
    const portalLink = teacherPortalClassesUrl();
    const linkHtml = portalLink
      ? `<p style="margin:12px 0 0;"><a href="${portalLink}" style="color:#000e89;">Open My Classes in the teacher portal</a></p>`
      : '';

    const bodyHtml = `
      <p style="margin:0 0 10px;">Hello <strong>${teacherName}</strong>,</p>
      <p style="margin:0 0 10px;">A student has submitted a doubt for your class.</p>
      ${classInfoBlock(meeting)}
      <p style="margin:0 0 6px;"><strong>Student:</strong> ${studentName} (${studentEmail})</p>
      <p style="margin:0 0 6px;"><strong>Question:</strong> ${doubtTitle}</p>
      <p style="margin:0 0 6px;"><strong>Visibility:</strong> ${visibility}</p>
      ${explanation}
      ${linkHtml}
    `;

    if (!transporter || !process.env.EMAIL_USER) {
      console.warn('[classActivityEmail] Email transporter not configured; skipping doubt alert');
      return;
    }

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: buildRecipients(teacherEmail).join(', '),
      subject: `[Class Doubt] ${meeting.topic || 'Class'} — ${student?.name || 'Student'}`,
      html: wrapEmailHtml({
        title: 'New student doubt',
        bodyHtml,
      }),
    });
  } catch (err) {
    console.error('[classActivityEmail] notifyNewDoubt failed:', err.message);
  }
}

module.exports = {
  notifyNewSubmission,
  notifyNewDoubt,
  LANGUAGE_SCHOOL_EMAIL,
};
