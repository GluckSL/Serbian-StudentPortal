// services/recordingAccessRequest.service.js
// Business logic for Platinum recording-access requests.

const RecordingAccessRequest = require('../models/RecordingAccessRequest');
const ZoomRecording = require('../models/ZoomRecording');
const MeetingLink = require('../models/MeetingLink');
const transporter = require('../config/emailConfig');
const { allStudentBatchStringsForContent, normalizeBatch } = require('../utils/effectiveStudentBatch');

const REQUEST_LIMIT = 5;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 30;

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

function formatDateEnGb(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildApprovalPageUrl() {
  const base = (process.env.PORTAL_URL || process.env.CLIENT_URL || '').replace(/\/+$/, '');
  return base ? `${base}/class-recordings/approval-requests` : null;
}

/**
 * Count APPROVED requests at the given level (for admin display).
 */
async function countApprovedForLevel(studentId, level) {
  return RecordingAccessRequest.countDocuments({
    studentId,
    studentLevel: level,
    status: 'APPROVED',
  });
}

/** Count APPROVED + DECLINED — these consume the 5-request lifetime quota. */
async function countDecidedForLevel(studentId, level) {
  return RecordingAccessRequest.countDocuments({
    studentId,
    studentLevel: level,
    status: { $in: ['APPROVED', 'DECLINED'] },
  });
}

async function countPendingForLevel(studentId, level) {
  return RecordingAccessRequest.countDocuments({
    studentId,
    studentLevel: level,
    status: 'PENDING',
  });
}

/**
 * Returns quota info for a student at their current level.
 */
async function getQuota(studentId, level) {
  const [decidedCount, pendingCount, approvedCount] = await Promise.all([
    countDecidedForLevel(studentId, level),
    countPendingForLevel(studentId, level),
    countApprovedForLevel(studentId, level),
  ]);
  const remaining = Math.max(0, REQUEST_LIMIT - decidedCount);
  const slotsAvailable = Math.max(0, REQUEST_LIMIT - decidedCount - pendingCount);
  return {
    level,
    decidedCount,
    pendingCount,
    approvedCount,
    remaining,
    slotsAvailable,
    limit: REQUEST_LIMIT,
  };
}

/**
 * Check whether a ready ZoomRecording exists for the given meetingLinkId.
 */
async function recordingIsReady(meetingLinkId) {
  const exists = await ZoomRecording.exists({
    meetingLinkId,
    status: 'ready',
  });
  return !!exists;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build loose batch $or clauses for MongoDB (faster than loading all meetings). */
function batchMatchOrClause(batchKeys) {
  const seen = new Set();
  const or = [];
  for (const raw of batchKeys) {
    const k = String(raw || '').trim();
    if (!k) continue;
    const norm = normalizeBatch(k);
    if (!seen.has(norm)) {
      seen.add(norm);
      or.push({ batch: { $regex: escapeRegex(k), $options: 'i' } });
    }
  }
  return or.length ? { $or: or } : null;
}

function meetingHasEnded(meeting, nowMs = Date.now()) {
  if (!meeting?.startTime) return false;
  const start = new Date(meeting.startTime).getTime();
  const durationMin = Number(meeting.duration || 0);
  const end = start + durationMin * 60_000;
  if (meeting.status === 'ended' || meeting.status === 'cancelled') return true;
  return nowMs > end;
}

function attendanceForStudent(meeting, studentId, studentEmail) {
  const list = Array.isArray(meeting.attendance) ? meeting.attendance : [];
  const idStr = String(studentId);
  let row = list.find((a) => a?.studentId && String(a.studentId) === idStr);
  if (!row && studentEmail) {
    const em = String(studentEmail).toLowerCase().trim();
    row = list.find((a) => a?.email && String(a.email).toLowerCase().trim() === em);
  }
  if (!row) return 'Missed';
  if (row.attended === true || row.status === 'attended' || row.status === 'late') return 'Attended';
  if (row.status === 'missed' || row.status === 'absent') return 'Missed';
  return 'Not Attended';
}

/**
 * Paginated ended classes for recording requests (only enriches current page).
 */
async function getEligibleClassesPage(student, studentId, page = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const batchKeys = allStudentBatchStringsForContent(student);
  const quota = await getQuota(studentId, student.level);

  if (!batchKeys.length) {
    return {
      classes: [],
      quota,
      pagination: { page: 1, pageSize, total: 0, totalPages: 0 },
    };
  }

  const batchClause = batchMatchOrClause(batchKeys);
  const planIn = [student.subscription, 'ALL'].filter(Boolean);
  const now = new Date();

  const baseMatch = {
    plan: { $in: planIn },
    ...(batchClause || {}),
  };

  const pipeline = [
    { $match: baseMatch },
    {
      $addFields: {
        endTime: {
          $add: [
            '$startTime',
            { $multiply: [{ $ifNull: ['$duration', 0] }, 60000] },
          ],
        },
      },
    },
    {
      $match: {
        $or: [
          { status: { $in: ['ended', 'cancelled'] } },
          { $expr: { $lt: ['$endTime', now] } },
        ],
      },
    },
    { $sort: { startTime: -1 } },
    {
      $facet: {
        meta: [{ $count: 'total' }],
        data: [
          { $skip: (page - 1) * pageSize },
          { $limit: pageSize },
          {
            $lookup: {
              from: 'users',
              localField: 'assignedTeacher',
              foreignField: '_id',
              as: '_teacher',
              pipeline: [{ $project: { name: 1 } }],
            },
          },
          {
            $project: {
              topic: 1,
              batch: 1,
              startTime: 1,
              duration: 1,
              status: 1,
              attendance: 1,
              teacherName: { $arrayElemAt: ['$_teacher.name', 0] },
            },
          },
        ],
      },
    },
  ];

  const [agg] = await MeetingLink.aggregate(pipeline);
  const rows = Array.isArray(agg?.data) ? agg.data : [];
  const total = agg?.meta?.[0]?.total || 0;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const meetingIds = rows.map((m) => m._id);

  const [requests, zoomRecs] = await Promise.all([
    meetingIds.length
      ? RecordingAccessRequest.find({
          studentId,
          meetingLinkId: { $in: meetingIds },
        })
          .select('meetingLinkId status')
          .lean()
      : [],
    meetingIds.length
      ? ZoomRecording.find({
          meetingLinkId: { $in: meetingIds },
          status: 'ready',
        })
          .select('meetingLinkId isPublished')
          .lean()
      : [],
  ]);

  const requestMap = {};
  for (const r of requests) {
    const key = String(r.meetingLinkId);
    const prev = requestMap[key];
    if (!prev || r.status === 'APPROVED' || (r.status === 'PENDING' && prev.status === 'DECLINED')) {
      requestMap[key] = r;
    }
  }
  const recordingMap = {};
  for (const z of zoomRecs) {
    recordingMap[String(z.meetingLinkId)] = z;
  }

  const classes = rows.map((m) => {
    const idStr = String(m._id);
    const req_ = requestMap[idStr];
    const zoomRec = recordingMap[idStr];
    const isAlreadyPublished = zoomRec && zoomRec.isPublished !== false;
    const requestStatus = req_?.status || null;
    const canRequest =
      requestStatus !== 'PENDING' &&
      requestStatus !== 'APPROVED' &&
      quota.remaining > 0 &&
      quota.slotsAvailable > 0;

    return {
      meetingLinkId: m._id,
      topic: m.topic || 'Class',
      batch: m.batch,
      startTime: m.startTime,
      duration: m.duration,
      teacherName: m.teacherName || 'Teacher',
      attendanceStatus: attendanceForStudent(m, studentId, student.email),
      hasRecording: !!zoomRec,
      isAlreadyPublished,
      requestStatus,
      requestId: req_?._id || null,
      canRequest,
      canCancel: requestStatus === 'PENDING' && !!req_?._id,
    };
  });

  return {
    classes,
    quota,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

async function sendNewRequestAdminEmail(request, meeting = {}, quota = {}) {
  const {
    decidedCount = 0,
    pendingCount = 0,
    remaining = REQUEST_LIMIT,
    limit = REQUEST_LIMIT,
  } = quota;

  const studentName = escapeHtml(request.studentName || 'Student');
  const studentEmail = escapeHtml(request.studentEmail || 'N/A');
  const studentBatch = escapeHtml(request.studentBatch || 'N/A');
  const studentLevel = escapeHtml(request.studentLevel || 'N/A');
  const classTopic = escapeHtml(request.classTopic || meeting.topic || 'Class');
  const classBatch = escapeHtml(meeting.batch || request.studentBatch || 'N/A');
  const classDateStr = formatDateEnGb(request.classDate || meeting.startTime);
  const requestedAtStr = formatDateEnGb(request.requestedAt || new Date());
  const recordingReady = request.recordingAvailable ? 'Yes — ready in portal' : 'No — upload/process first';
  const approvalUrl = buildApprovalPageUrl();
  const approvalLink = approvalUrl
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(approvalUrl)}" style="display:inline-block;background:#dc2626;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700;">Review pending requests</a></p>`
    : '';

  try {
    await transporter.sendMail({
      from: `"Glück Global" <${process.env.EMAIL_USER}>`,
      to: LANGUAGE_SCHOOL_EMAIL,
      subject: `[Recording Access] New request — ${request.studentName || 'Student'} — ${request.classTopic || 'Class'}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
          <div style="background:#0f2d52;padding:20px 24px;">
            <h2 style="color:#fff;margin:0;font-size:18px;">New Recording Access Request</h2>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:13px;">A Platinum student has requested access to a class recording. Please review in the portal.</p>
          </div>
          <div style="padding:24px;">
            <h3 style="margin:0 0 12px;font-size:14px;color:#0f172a;">Student</h3>
            <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
              <tr style="background:#f8fafc;">
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;width:38%;">Name</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${studentName}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">Email</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${studentEmail}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">Batch</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${studentBatch}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">CEFR level</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${studentLevel}</td>
              </tr>
            </table>

            <h3 style="margin:0 0 12px;font-size:14px;color:#0f172a;">Class requested</h3>
            <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
              <tr style="background:#f8fafc;">
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;width:38%;">Topic</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${classTopic}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">Class date</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${classDateStr}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">Class batch</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${classBatch}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">Recording in portal</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${recordingReady}</td>
              </tr>
              <tr style="background:#f8fafc;">
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">Requested at</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${requestedAtStr}</td>
              </tr>
            </table>

            <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin:0 0 8px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#991b1b;">Quota at level ${studentLevel}</p>
              <p style="margin:0;font-size:13px;color:#7f1d1d;">
                <strong>${decidedCount}</strong> of <strong>${limit}</strong> reviewed (approved or declined) &nbsp;·&nbsp;
                <strong>${pendingCount}</strong> pending &nbsp;·&nbsp;
                <strong>${remaining}</strong> lifetime slots left
              </p>
              <p style="margin:8px 0 0;font-size:12px;color:#b91c1c;">Pending requests do not count until approved or declined. Students may cancel pending requests.</p>
            </div>

            ${approvalLink}

            <p style="margin:20px 0 0;font-size:12px;color:#64748b;">Glück Global — Class Recordings</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error('[RecordingAccessRequest] Admin notification email failed:', err.message);
  }
}

async function sendDeclineEmail(request, declineReason) {
  const { studentEmail, studentName, classTopic, classDate } = request;
  if (!studentEmail) return;

  const dateStr = classDate
    ? new Date(classDate).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : 'N/A';

  try {
    await transporter.sendMail({
      from: `"Glück Global" <${process.env.EMAIL_USER}>`,
      to: studentEmail,
      subject: `Recording Access Request — ${classTopic || 'Class'} — Glück Global`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.08);">
          <div style="background:#b91c1c;padding:20px 24px;">
            <h2 style="color:#fff;margin:0;font-size:18px;">Recording Access Request — Not Approved</h2>
          </div>
          <div style="padding:24px;">
            <p style="margin:0 0 16px;">Dear <strong>${studentName || 'Student'}</strong>,</p>
            <p style="margin:0 0 16px;">Your recording access request for the following class could not be approved at this time.</p>
            <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
              <tr style="background:#f8fafc;">
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">Class</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${classTopic || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-size:13px;font-weight:700;color:#374151;border:1px solid #e5e7eb;">Date</td>
                <td style="padding:8px 12px;font-size:13px;color:#111827;border:1px solid #e5e7eb;">${dateStr}</td>
              </tr>
            </table>
            ${
              declineReason
                ? `<p style="margin:0 0 16px;background:#fef2f2;border:1px solid #fca5a5;border-radius:6px;padding:12px;color:#7f1d1d;font-size:13px;"><strong>Reason:</strong> ${declineReason}</p>`
                : ''
            }
            <p style="margin:8px 0 0;font-size:13px;">Best regards,<br><strong>Glück Global Pvt Ltd</strong></p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error('[RecordingAccessRequest] Decline email failed:', err.message);
  }
}

async function sendApproveEmail(request) {
  const { studentEmail, studentName, classTopic, classDate } = request;
  if (!studentEmail) return;

  const dateStr = classDate
    ? new Date(classDate).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : 'N/A';

  try {
    await transporter.sendMail({
      from: `"Glück Global" <${process.env.EMAIL_USER}>`,
      to: studentEmail,
      subject: `Recording Access Approved — ${classTopic || 'Class'} — Glück Global`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border-radius:8px;overflow:hidden;">
          <div style="background:#166534;padding:20px 24px;">
            <h2 style="color:#fff;margin:0;font-size:18px;">Recording Access Approved</h2>
          </div>
          <div style="padding:24px;">
            <p style="margin:0 0 16px;">Dear <strong>${studentName || 'Student'}</strong>,</p>
            <p style="margin:0 0 16px;">Your recording access request has been approved. You can watch the recording under <strong>Recorded classes</strong> on My Course.</p>
            <p style="margin:8px 0 0;font-size:13px;">Best regards,<br><strong>Glück Global Pvt Ltd</strong></p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    console.error('[RecordingAccessRequest] Approval email failed:', err.message);
  }
}

module.exports = {
  REQUEST_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  countApprovedForLevel,
  countDecidedForLevel,
  countPendingForLevel,
  getQuota,
  getEligibleClassesPage,
  recordingIsReady,
  sendDeclineEmail,
  sendApproveEmail,
  sendNewRequestAdminEmail,
  LANGUAGE_SCHOOL_EMAIL,
};