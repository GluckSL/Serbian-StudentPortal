const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { verifyToken, verifyMediaToken, checkRole } = require('../middleware/auth');
const ClassRecording = require('../models/ClassRecording');
const RecordingView = require('../models/RecordingView');
const ZoomRecording = require('../models/ZoomRecording');
const ZoomRecordingView = require('../models/ZoomRecordingView');
const MeetingLink = require('../models/MeetingLink');
const ZoomWebhookAudit = require('../models/ZoomWebhookAudit');
const User = require('../models/User');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand, HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client, R2_BUCKET, R2_CONFIG_OK, r2ConfigIssues } = require('../config/r2');
const { backfillZoomRecordings, getBackfillStatus } = require('../services/zoomRecordingBackfillService');
const { processManualRecordingUpload, processManualRecordingFromR2 } = require('../services/recordingProcessor');
const manualRecordingUpload = require('../config/manualRecordingUpload');
const { allStudentBatchStringsForContent, batchesAlign } = require('../utils/effectiveStudentBatch');
const { markPendingAdvanceForStudentDay, checkAndInstantlyAdvanceSilverGoStudent } = require('../services/journeyDayAdvance.service');
const BatchConfig = require('../models/BatchConfig');
const {
  computeJourneyDayCompletion,
  meetsStrictThreshold
} = require('../services/journeyDayCompletion.service');
const { getJourneyAccessForStudent } = require('../utils/studentJourneyAccess');
const { withJourneyLevelInSet } = require('../services/journeyLevelSync.service');
const { mergePortalBatchNames } = require('../utils/portalBatchPresets');
const RecordingAccessRequest = require('../models/RecordingAccessRequest');

/** Returns true when a student has an APPROVED recording-access grant for a class. */
async function hasApprovedGrant(studentId, meetingLinkId) {
  if (!studentId || !meetingLinkId) return false;
  return !!(await RecordingAccessRequest.exists({
    studentId,
    meetingLinkId,
    status: 'APPROVED',
  }));
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Staff who manage or preview class recordings (includes sub-admins with tab access). */
function isClassRecordingStaff(role) {
  return ['ADMIN', 'TEACHER_ADMIN', 'TEACHER', 'SUB_ADMIN'].includes(role);
}

// R2 presigned GetObject URLs embedded in HLS segment lines. Browsers keep one
// playlist; every segment line shares the same signature expiry. Must cover long
// classes (e.g. 2h) and pauses; SigV4 max is 7 days — we default to that cap.
const MAX_PRESIGNED_SECONDS = 7 * 24 * 60 * 60; // 604800 — practical S3/R2 limit
const _signedExpiry = parseInt(
  process.env.R2_HLS_SIGNED_URL_EXPIRY_SECONDS || String(MAX_PRESIGNED_SECONDS),
  10
);
let SIGNED_URL_EXPIRY_SECONDS = !Number.isFinite(_signedExpiry) || _signedExpiry < 300
  ? MAX_PRESIGNED_SECONDS
  : Math.min(_signedExpiry, MAX_PRESIGNED_SECONDS);
// 1h (3600) and similar values match “failure around 55–60 min” — VOD must use long-lived segment URLs.
const MIN_VOD_PRESIGN_SEC = 2 * 60 * 60; // 2h floor for multi-hour class replays
if (SIGNED_URL_EXPIRY_SECONDS < MIN_VOD_PRESIGN_SEC) {
  console.warn(
    `[classRecordings] R2 HLS presign is ${SIGNED_URL_EXPIRY_SECONDS}s (R2_HLS_SIGNED_URL_EXPIRY_SECONDS) — ` +
      `too short; segment URLs expire mid-playback. Using ${MAX_PRESIGNED_SECONDS}s.`
  );
  SIGNED_URL_EXPIRY_SECONDS = MAX_PRESIGNED_SECONDS;
}

// ── In-memory HLS playlist cache ──────────────────────────────────────────────
// Stores rewritten m3u8 (with presigned segment URLs) per recording key.
// TTL stays below presigned lifetime so we never serve a cache past URL expiry.
const _hlsCache = new Map(); // cacheKey → { content: string, expiresAt: number }
const HLS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h; presigned segments valid 7d

function getHlsCached(cacheKey) {
  const entry = _hlsCache.get(cacheKey);
  if (!entry || Date.now() >= entry.expiresAt) {
    _hlsCache.delete(cacheKey);
    return null;
  }
  return entry.content;
}

function setHlsCached(cacheKey, content) {
  _hlsCache.set(cacheKey, { content, expiresAt: Date.now() + HLS_CACHE_TTL_MS });
}

/** Drain an AWS SDK v3 stream body into a UTF-8 string. */
async function streamToString(body) {
  const chunks = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Fetch the raw HLS playlist from R2, then replace every `.ts` line with
 * a presigned R2 URL (SIGNED_URL_EXPIRY_SECONDS; must cover full watch time).
 * The browser (or hls.js) can then fetch segments directly from R2,
 * bypassing the Express server entirely — zero extra backend load during playback.
 */
async function buildSignedHlsPlaylist(hlsKey) {
  if (!R2_CONFIG_OK) {
    throw new Error(`R2 is not configured: ${r2ConfigIssues.join(', ')}`);
  }
  const { GetObjectCommand: GetObj } = require('@aws-sdk/client-s3');

  // Fetch raw m3u8 text from R2
  const obj = await r2Client.send(new GetObj({ Bucket: R2_BUCKET, Key: hlsKey }));
  const raw = await streamToString(obj.Body);

  // The HLS directory prefix (everything before /playlist.m3u8)
  const hlsDir = hlsKey.substring(0, hlsKey.lastIndexOf('/'));

  // Replace each segment filename line with a presigned URL
  const lines = raw.split('\n');
  const signed = await Promise.all(
    lines.map(async (line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.endsWith('.ts')) {
        const segKey = `${hlsDir}/${trimmed}`;
        const cmd = new GetObjectCommand({ Bucket: R2_BUCKET, Key: segKey });
        return getSignedUrl(r2Client, cmd, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
      }
      return line;
    })
  );

  return signed.join('\n');
}

/** Plans a student may see for manual ClassRecording rows (GO-Silver journey uploads are sometimes tagged PLATINUM). */
function allowedRecordingPlansForStudent(student) {
  const sub = String(student?.subscription || '').toUpperCase();
  if (String(student?.goStatus || '') === 'GO' && sub === 'SILVER') {
    return ['SILVER', 'ALL', 'PLATINUM'];
  }
  return [sub, 'ALL'].filter(Boolean);
}

function isSilverGoStudent(student) {
  return String(student?.goStatus || '').toUpperCase() === 'GO' &&
    String(student?.subscription || '').toUpperCase() === 'SILVER';
}

function normalizedStudentCourseDay(student) {
  const v = student && student.currentCourseDay;
  if (v != null && v !== undefined && Number.isFinite(Number(v))) {
    return Math.min(200, Math.max(1, Math.floor(Number(v))));
  }
  return 1;
}

/** ClassRecording or MeetingLink: available when courseDay is unset or <= student's journey day. */
function journeyCourseDayUnlockedForStudent(doc, student) {
  const studentDay = normalizedStudentCourseDay(student);
  const raw = doc && doc.courseDay;
  if (raw == null || raw === undefined) return true;
  const cd = Number(raw);
  if (!Number.isFinite(cd)) return true;
  return cd <= studentDay;
}

function canUserAccessManualRecording(recording, student) {
  if (!recording?.active) return false;
  if (recording.isPublished === false) return false;
  if (!student) return false;
  if (student.journeyAccessEnabled === false) return false;
  const batchKeys = allStudentBatchStringsForContent(student);
  const inBatch = batchKeys.length > 0 && Array.isArray(recording.batches) &&
    recording.batches.some((b) => batchKeys.some((k) => batchesAlign(k, b)));
  if (!inBatch) return false;
  if (!journeyCourseDayUnlockedForStudent(recording, student)) return false;
  if (recording.level && student.level && recording.level !== student.level) return false;
  const recPlan = String(recording.plan || 'ALL').toUpperCase();
  if (!recPlan || recPlan === 'ALL') return true;
  const allowed = allowedRecordingPlansForStudent(student).map((p) => String(p).toUpperCase());
  return allowed.includes(recPlan);
}

function normalizeZoomAccessSettings(zoomRecording, meetingLink) {
  const accessBatches = Array.isArray(zoomRecording?.accessBatches)
    ? zoomRecording.accessBatches.map((b) => String(b).trim()).filter(Boolean)
    : [];
  const batches = accessBatches.length
    ? accessBatches
    : (meetingLink?.batch ? [String(meetingLink.batch)] : []);
  const level = zoomRecording?.accessLevel ? String(zoomRecording.accessLevel).toUpperCase() : null;
  const plan = String(zoomRecording?.accessPlan || 'ALL').toUpperCase();
  return { batches, level, plan };
}

function canUserAccessZoomRecording(zoomRecording, meetingLink, student) {
  if (!zoomRecording || zoomRecording.isPublished === false) return false;
  if (!student || !meetingLink) return false;
  if (student.journeyAccessEnabled === false) return false;
  if (!journeyCourseDayUnlockedForStudent(meetingLink, student)) return false;

  const { batches, level, plan } = normalizeZoomAccessSettings(zoomRecording, meetingLink);
  const studentBatchKeys = allStudentBatchStringsForContent(student);
  const inBatch = studentBatchKeys.length > 0 &&
    batches.length > 0 &&
    batches.some((b) => studentBatchKeys.some((k) => batchesAlign(k, b)));
  if (!inBatch) return false;

  if (level && student.level && String(student.level).toUpperCase() !== level) return false;
  if (!plan || plan === 'ALL') return true;

  const allowed = allowedRecordingPlansForStudent(student).map((p) => String(p).toUpperCase());
  return allowed.includes(plan);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/class-recordings — Teacher/Admin: all recordings; Student: filtered
router.get('/', verifyToken, async (req, res) => {
  try {
    const { role } = req.user;

    if (isClassRecordingStaff(role)) {
      const recordings = await ClassRecording.find({ active: true })
        .populate('uploadedBy', 'name')
        .sort({ createdAt: -1 }).lean();
      return res.json({ success: true, recordings });
    }

    // STUDENT — filter by their batch, level, plan, journey day
    const student = await User.findById(req.user.id)
      .select('batch level subscription goStatus currentCourseDay').lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
    if (!journeyAccess.enabled) {
      return res.json({ success: true, recordings: [] });
    }

    const studentLevel = String(student.level || 'A1').toUpperCase();
    const baseFilter = {
      active: true,
      isPublished: { $ne: false },
      level: studentLevel,
      plan: { $in: allowedRecordingPlansForStudent(student) }
    };

    const recordings = await ClassRecording.find(baseFilter)
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 }).lean();

    const batchKeys = allStudentBatchStringsForContent(student);
    // Match legacy User.batch and GO-SILVER tags (Silver GO often has both).
    const filteredRecordings = batchKeys.length
      ? recordings.filter(
          (r) =>
            Array.isArray(r.batches) &&
            r.batches.some((b) => batchKeys.some((k) => batchesAlign(k, b))) &&
            journeyCourseDayUnlockedForStudent(r, student)
        )
      : [];
    let watchedSecondsByRecording = new Map();
    if (filteredRecordings.length) {
      const recIds = filteredRecordings.map((r) => r._id).filter(Boolean);
      if (recIds.length) {
        const watchAgg = await RecordingView.aggregate([
          {
            $match: {
              student: new mongoose.Types.ObjectId(String(req.user.id)),
              recording: { $in: recIds },
              watchDuration: { $gt: 0 }
            }
          },
          {
            $group: {
              _id: '$recording',
              maxWatchSeconds: { $max: '$watchDuration' }
            }
          }
        ]);
        watchedSecondsByRecording = new Map(
          watchAgg.map((row) => [
            String(row._id),
            Math.max(0, Math.round(Number(row?.maxWatchSeconds || 0)))
          ])
        );
      }
    }

    const daySet = new Set(
      filteredRecordings
        .map((r) => Number(r?.courseDay))
        .filter((d) => Number.isFinite(d) && d >= 1 && d <= 200)
    );
    let meetingsForDuration = [];
    if (batchKeys.length && daySet.size) {
      const batchOr = batchKeys.map((k) => ({ batch: new RegExp(`^${escapeRegex(k)}$`, 'i') }));
      meetingsForDuration = await MeetingLink.find({
        $or: batchOr,
        courseDay: { $in: Array.from(daySet) },
        status: { $ne: 'cancelled' }
      })
        .select('batch courseDay duration')
        .lean();
    }
    const enrichedRecordings = filteredRecordings.map((r) => {
      let durationSec = Number.isFinite(Number(r.duration)) ? Number(r.duration) : null;
      if (!durationSec || durationSec <= 0) {
        const recDay = Number(r?.courseDay);
        if (Number.isFinite(recDay) && recDay >= 1 && recDay <= 200) {
          const recBatches = Array.isArray(r?.batches) ? r.batches : [];
          const match = meetingsForDuration.find((m) =>
            Number(m?.courseDay) === recDay &&
            Number(m?.duration) > 0 &&
            recBatches.some((rb) => batchesAlign(rb, m?.batch))
          );
          if (match && Number(match.duration) > 0) {
            durationSec = Math.round(Number(match.duration) * 60);
          }
        }
      }
      return {
        ...r,
        duration: durationSec,
        watchedSeconds: watchedSecondsByRecording.get(String(r._id)) ?? 0
      };
    });

    res.json({ success: true, recordings: enrichedRecordings });
  } catch (error) {
    console.error('Error fetching class recordings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/student-feed
 * Paginated merged manual + Zoom recordings for students (journey day desc, then date).
 * Query: page (default 1), limit (default 7), search, filter (all|attended|not_attended|date_newest|date_oldest), courseDay
 */
router.get('/student-feed', verifyToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    if (isClassRecordingStaff(role)) {
      return res.status(403).json({ success: false, message: 'Students only.' });
    }

    const student = await User.findById(userId)
      .select('batch level subscription goStatus currentCourseDay').lean();
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
    if (!journeyAccess.enabled) {
      return res.json({
        success: true,
        recordings: [],
        total: 0,
        page: 1,
        limit: 7,
        totalPages: 1
      });
    }

    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 7));
    const search = String(req.query.search || '').trim().toLowerCase();
    const filter = String(req.query.filter || 'all').trim().toLowerCase();
    const courseDayParam = req.query.courseDay;
    const courseDayFilter =
      courseDayParam != null && Number.isFinite(Number(courseDayParam))
        ? Math.min(200, Math.max(1, Math.floor(Number(courseDayParam))))
        : null;

    const studentLevel = String(student.level || 'A1').toUpperCase();
    const batchKeys = allStudentBatchStringsForContent(student);

    const manualBase = await ClassRecording.find({
      active: true,
      isPublished: { $ne: false },
      level: studentLevel,
      plan: { $in: allowedRecordingPlansForStudent(student) }
    })
      .populate('uploadedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const manualFiltered = batchKeys.length
      ? manualBase.filter(
          (r) =>
            Array.isArray(r.batches) &&
            r.batches.some((b) => batchKeys.some((k) => batchesAlign(k, b))) &&
            journeyCourseDayUnlockedForStudent(r, student)
        )
      : [];

    let watchedSecondsByRecording = new Map();
    if (manualFiltered.length) {
      const recIds = manualFiltered.map((r) => r._id).filter(Boolean);
      const watchAgg = await RecordingView.aggregate([
        {
          $match: {
            student: new mongoose.Types.ObjectId(String(userId)),
            recording: { $in: recIds },
            watchDuration: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: '$recording',
            maxWatchSeconds: { $max: '$watchDuration' }
          }
        }
      ]);
      watchedSecondsByRecording = new Map(
        watchAgg.map((row) => [
          String(row._id),
          Math.max(0, Math.round(Number(row?.maxWatchSeconds || 0)))
        ])
      );
    }

    const manualItems = manualFiltered.map((r) => ({
      type: 'manual',
      id: String(r._id),
      title: r.title,
      description: r.description || '',
      date: r.createdAt,
      duration: Number.isFinite(Number(r.duration)) ? Number(r.duration) : null,
      batch: (r.batches || []).join(', '),
      teacherName: r.uploadedBy?.name || 'Teacher',
      attempted: null,
      attendanceStatus: 'N/A',
      videoUrl: r.videoUrl,
      level: r.level,
      plan: r.plan,
      uploadedBy: r.uploadedBy?.name,
      manualSourceType: r.sourceType || 'URL',
      manualStatus: r.status || 'ready',
      manualErrorMessage: r.errorMessage || null,
      courseDay: r.courseDay != null && Number.isFinite(Number(r.courseDay)) ? Number(r.courseDay) : null,
      watchedSeconds: watchedSecondsByRecording.get(String(r._id)) ?? 0
    }));

    const zoomRecordings = await ZoomRecording.find({
      status: 'ready',
      isPublished: { $ne: false }
    })
      .select('meetingLinkId r2Key duration status createdAt isPublished accessBatches accessLevel accessPlan')
      .lean();

    const approvedGrants = await RecordingAccessRequest.find({
      studentId: userId,
      status: 'APPROVED'
    }).select('meetingLinkId').lean();
    const grantedMeetingLinkIds = approvedGrants.map((g) => String(g.meetingLinkId));
    const grantedSet = new Set(grantedMeetingLinkIds);

    if (grantedMeetingLinkIds.length) {
      const grantedRecs = await ZoomRecording.find({
        meetingLinkId: { $in: grantedMeetingLinkIds },
        status: 'ready',
        isPublished: false
      })
        .select('meetingLinkId r2Key duration status createdAt isPublished accessBatches accessLevel accessPlan')
        .lean();
      const existingIds = new Set(zoomRecordings.map((z) => String(z.meetingLinkId)));
      for (const gr of grantedRecs) {
        if (!existingIds.has(String(gr.meetingLinkId))) zoomRecordings.push(gr);
      }
    }

    const accessRequests = await RecordingAccessRequest.find({
      studentId: userId,
      status: { $in: ['PENDING', 'APPROVED', 'DECLINED'] },
    })
      .select('meetingLinkId status classTopic classDate studentBatch requestedAt')
      .lean();

    const requestStatusPriority = { APPROVED: 3, PENDING: 2, DECLINED: 1 };
    const requestStatusByMeeting = new Map();
    for (const ar of accessRequests) {
      const mid = String(ar.meetingLinkId);
      const prev = requestStatusByMeeting.get(mid);
      const nextPri = requestStatusPriority[ar.status] || 0;
      const prevPri = prev ? (requestStatusPriority[prev] || 0) : 0;
      if (!prev || nextPri > prevPri) requestStatusByMeeting.set(mid, ar.status);
    }

    const zoomRecByMeeting = new Map();
    for (const z of zoomRecordings) {
      zoomRecByMeeting.set(String(z.meetingLinkId), z);
    }
    if (accessRequests.length) {
      const requestMeetingIds = accessRequests.map((a) => a.meetingLinkId);
      const requestZoomRecs = await ZoomRecording.find({
        meetingLinkId: { $in: requestMeetingIds },
        status: 'ready',
      })
        .select('meetingLinkId r2Key duration status createdAt isPublished')
        .lean();
      for (const z of requestZoomRecs) {
        const mid = String(z.meetingLinkId);
        if (!zoomRecByMeeting.has(mid)) zoomRecByMeeting.set(mid, z);
      }
    }

    let zoomItems = [];
    if (zoomRecordings.length) {
      const meetingLinkIds = zoomRecordings.map((z) => z.meetingLinkId);
      const meetingLinks = await MeetingLink.find({ _id: { $in: meetingLinkIds } })
        .select('_id topic batch startTime duration status attendance assignedTeacher courseDay')
        .populate('assignedTeacher', 'name')
        .lean();
      const watchedByMeeting = new Map();
      const watchAgg = await ZoomRecordingView.aggregate([
        {
          $match: {
            student: new mongoose.Types.ObjectId(String(userId)),
            meetingLinkId: { $in: meetingLinkIds },
            watchDuration: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: '$meetingLinkId',
            maxWatchSeconds: { $max: '$watchDuration' }
          }
        }
      ]);
      for (const row of watchAgg) {
        watchedByMeeting.set(String(row._id), Math.max(0, Math.round(Number(row?.maxWatchSeconds || 0) / 60)));
      }
      const meetingMap = {};
      meetingLinks.forEach((m) => { meetingMap[String(m._id)] = m; });

      zoomItems = zoomRecordings
        .filter((rec) => {
          const meeting = meetingMap[String(rec.meetingLinkId)];
          if (!meeting) return false;
          if (grantedSet.has(String(rec.meetingLinkId))) return true;
          return canUserAccessZoomRecording(rec, meeting, student);
        })
        .map((rec) => {
          const meeting = meetingMap[String(rec.meetingLinkId)] || {};
          const startTime = meeting.startTime ? new Date(meeting.startTime) : null;
          const durationMinutes = Number(meeting.duration || 0);
          const computedEnd = startTime && durationMinutes > 0
            ? new Date(startTime.getTime() + durationMinutes * 60 * 1000)
            : null;
          const attempted = meeting.status === 'ended' || (computedEnd ? Date.now() >= computedEnd.getTime() : false);
          const myAttendance = Array.isArray(meeting.attendance)
            ? meeting.attendance.find((a) => String(a?.studentId || '') === String(userId))
            : null;
          const attendanceStatus = myAttendance
            ? (
                myAttendance.attended === true ||
                myAttendance.status === 'attended' ||
                Number(myAttendance.attendancePercent || 0) >= 75
                  ? 'Attended'
                  : (attempted ? 'Not Attended' : 'Pending')
              )
            : (attempted ? 'Not Attempted' : 'Pending');

          return {
            type: 'zoom',
            id: String(rec.meetingLinkId),
            title: meeting.topic || 'Class Recording',
            description: '',
            date: meeting.startTime || rec.createdAt,
            duration: Number.isFinite(Number(rec.duration))
              ? Number(rec.duration)
              : (Number.isFinite(Number(meeting.duration)) ? Number(meeting.duration) * 60 : null),
            batch: normalizeZoomAccessSettings(rec, meeting).batches.join(', '),
            teacherName: meeting.assignedTeacher?.name || 'Teacher',
            attempted: typeof attempted === 'boolean' ? attempted : null,
            attendanceStatus,
            meetingLinkId: String(rec.meetingLinkId),
            courseDay: meeting.courseDay != null ? meeting.courseDay : null,
            watchedSeconds: (watchedByMeeting.get(String(rec.meetingLinkId)) ?? 0) * 60
          };
        });
    }

    let merged = [...manualItems, ...zoomItems];

    merged = merged.map((r) => {
      if (r.type !== 'zoom') {
        return { ...r, accessRequestStatus: null, canPlay: true };
      }
      const mid = String(r.meetingLinkId || r.id);
      const reqSt = requestStatusByMeeting.get(mid);
      if (reqSt === 'PENDING') {
        return { ...r, accessRequestStatus: 'PENDING', canPlay: false };
      }
      if (reqSt === 'DECLINED') {
        return { ...r, accessRequestStatus: 'DECLINED', canPlay: false };
      }
      if (reqSt === 'APPROVED') {
        const zoomRec = zoomRecByMeeting.get(mid);
        return {
          ...r,
          accessRequestStatus: 'APPROVED',
          canPlay: !!(zoomRec && zoomRec.status === 'ready'),
        };
      }
      return { ...r, accessRequestStatus: null, canPlay: true };
    });

    const mergedZoomIds = new Set(
      merged.filter((r) => r.type === 'zoom').map((r) => String(r.meetingLinkId || r.id))
    );
    const missingRequests = accessRequests.filter(
      (ar) => !mergedZoomIds.has(String(ar.meetingLinkId))
    );

    if (missingRequests.length) {
      const missingIds = missingRequests.map((ar) => ar.meetingLinkId);
      const extraMeetings = await MeetingLink.find({ _id: { $in: missingIds } })
        .select('_id topic batch startTime duration assignedTeacher courseDay')
        .populate('assignedTeacher', 'name')
        .lean();
      const extraMeetingMap = {};
      extraMeetings.forEach((m) => { extraMeetingMap[String(m._id)] = m; });

      for (const ar of missingRequests) {
        const mid = String(ar.meetingLinkId);
        const meeting = extraMeetingMap[mid] || {};
        const zoomRec = zoomRecByMeeting.get(mid);
        merged.push({
          type: 'zoom',
          id: mid,
          title: ar.classTopic || meeting.topic || 'Class',
          description: '',
          date: ar.classDate || meeting.startTime || ar.requestedAt,
          duration: Number.isFinite(Number(zoomRec?.duration))
            ? Number(zoomRec.duration)
            : (Number.isFinite(Number(meeting.duration)) ? Number(meeting.duration) * 60 : null),
          batch: meeting.batch || ar.studentBatch || '',
          teacherName: meeting.assignedTeacher?.name || 'Teacher',
          attempted: true,
          attendanceStatus: 'N/A',
          meetingLinkId: mid,
          courseDay: meeting.courseDay != null ? meeting.courseDay : null,
          watchedSeconds: 0,
          accessRequestStatus: ar.status,
          canPlay:
            ar.status === 'APPROVED' && !!(zoomRec && zoomRec.status === 'ready'),
        });
      }
    }

    if (courseDayFilter != null) {
      merged = merged.filter((r) => Number(r.courseDay) === courseDayFilter);
    }

    if (search) {
      merged = merged.filter(
        (r) =>
          String(r.title || '').toLowerCase().includes(search) ||
          String(r.description || '').toLowerCase().includes(search) ||
          String(r.batch || '').toLowerCase().includes(search)
      );
    }

    const attendanceNorm = (r) => String(r.attendanceStatus || '').trim().toLowerCase();
    if (filter === 'attended') {
      merged = merged.filter((r) => attendanceNorm(r) === 'attended');
    } else if (filter === 'not_attended') {
      merged = merged.filter((r) => {
        const a = attendanceNorm(r);
        return a !== 'attended' && a !== 'n/a' && a !== '';
      });
    }

    const sortByDateOldest = filter === 'date_oldest';
    merged.sort((a, b) => {
      const dayA = Number.isFinite(Number(a.courseDay)) ? Number(a.courseDay) : -1;
      const dayB = Number.isFinite(Number(b.courseDay)) ? Number(b.courseDay) : -1;
      if (dayA !== dayB) return dayB - dayA;
      const tA = new Date(a.date).getTime();
      const tB = new Date(b.date).getTime();
      return sortByDateOldest ? tA - tB : tB - tA;
    });

    const total = merged.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const skip = (page - 1) * limit;
    const recordings = merged.slice(skip, skip + limit);

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.json({
      success: true,
      recordings,
      total,
      page,
      limit,
      totalPages,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching student recording feed:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

const ADMIN_READY_MEDIA_OR = [
  { videoUrl: { $exists: true, $nin: [null, ''] } },
  { hlsKey: { $exists: true, $nin: [null, ''] } },
];

const ADMIN_READY_ZOOM_MEDIA_OR = [
  { r2Key: { $exists: true, $nin: [null, ''] } },
  { hlsKey: { $exists: true, $nin: [null, ''] } },
];

function adminReadyManualQuery() {
  return {
    active: true,
    status: 'ready',
    $or: ADMIN_READY_MEDIA_OR,
  };
}

function adminReadyZoomQuery() {
  return {
    status: 'ready',
    $or: ADMIN_READY_ZOOM_MEDIA_OR,
  };
}

function mapZoomRecordingToAdminItem(z, meeting) {
  const access = normalizeZoomAccessSettings(z, meeting);
  return {
    _id: `zoom-${z.meetingLinkId.toString()}`,
    recordingType: 'ZOOM',
    source: 'ZOOM_AUTO',
    title: meeting?.topic || 'Zoom Class Recording',
    description: '',
    videoUrl: '',
    level: access.level || '',
    plan: access.plan || 'ALL',
    batches: access.batches,
    uploadedBy: { _id: null, name: 'Zoom Webhook' },
    active: true,
    createdAt: z.createdAt,
    meetingLinkId: z.meetingLinkId,
    zoomMeetingId: z.zoomMeetingId || null,
    assignedTeacherId: meeting?.assignedTeacher?._id || null,
    status: z.status,
    isPublished: z.isPublished !== false,
    publishedAt: z.publishedAt || null,
    r2Key: z.r2Key,
    hlsKey: z.hlsKey || null,
    duration: z.duration,
    classDate: meeting?.startTime || z.createdAt,
    classDuration: meeting?.duration || null,
    courseDay: meeting?.courseDay != null ? meeting.courseDay : null,
  };
}

function mapManualRecordingToAdminItem(m) {
  return {
    ...m,
    recordingType: 'MANUAL',
    source: 'MANUAL_UPLOAD',
    status: m.status || 'ready',
    isPublished: m.isPublished !== false,
    publishedAt: m.publishedAt || (m.isPublished !== false ? m.createdAt : null),
    duration: m.duration ?? null,
    classDate: m.createdAt,
    classDuration: null,
    meetingLinkId: null,
    zoomMeetingId: null,
    r2Key: null,
    sourceType: m.sourceType || 'URL',
    hlsKey: m.hlsKey || null,
  };
}

/** Batch labels for admin list filter (Zoom: accessBatches, else meeting.batch). */
function adminRecordingBatchLabels(zoomRow, meeting) {
  const accessBatches = Array.isArray(zoomRow?.accessBatches)
    ? zoomRow.accessBatches.map((b) => String(b).trim()).filter(Boolean)
    : [];
  if (accessBatches.length) return accessBatches;
  const meetingBatch = meeting?.batch ? String(meeting.batch).trim() : '';
  return meetingBatch ? [meetingBatch] : [];
}

function matchesAdminBatchFilter(batchFilter, batchLabels) {
  if (!batchFilter || batchFilter === 'ALL') return true;
  if (!Array.isArray(batchLabels) || !batchLabels.length) return false;
  return batchLabels.some((b) => batchesAlign(batchFilter, b));
}

function normalizeZoomMeetingIdForSearch(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildLooseZoomMeetingIdSearchRegex(zoomMeetingId) {
  const digits = normalizeZoomMeetingIdForSearch(zoomMeetingId);
  if (digits.length < 8) return null;
  return new RegExp(`^\\D*${digits.split('').join('\\D*')}\\D*$`);
}

function buildZoomMeetingIdSearchOr(search) {
  const raw = String(search || '').trim();
  if (!raw) return [];
  const clauses = [{ zoomMeetingId: raw }];
  const digits = normalizeZoomMeetingIdForSearch(raw);
  if (digits && digits !== raw) clauses.push({ zoomMeetingId: digits });
  const loose = buildLooseZoomMeetingIdSearchRegex(raw);
  if (loose) clauses.push({ zoomMeetingId: { $regex: loose } });
  return clauses;
}

/** Processing/failed Zoom rows visible when admin searches (not in default ready list). */
async function buildAdminInProgressZoomRefs(filters = {}) {
  const { level, batch, search } = filters;
  const rawSearch = String(search || '').trim();
  if (!rawSearch) return [];

  const searchRe = new RegExp(rawSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const zoomIdOr = buildZoomMeetingIdSearchOr(rawSearch);

  const zoomRows = zoomIdOr.length
    ? await ZoomRecording.find({
      status: { $in: ['processing', 'failed'] },
      $or: zoomIdOr,
    })
      .select('meetingLinkId zoomMeetingId createdAt accessBatches accessLevel status')
      .lean()
    : [];

  const topicMeetings = await MeetingLink.find({
    $or: [{ topic: searchRe }, ...(zoomIdOr.length ? zoomIdOr : [])],
  })
    .select('_id topic batch startTime')
    .lean();

  const meetingIdsFromTopic = topicMeetings.map((m) => m._id);
  const extraZoom = meetingIdsFromTopic.length
    ? await ZoomRecording.find({
      meetingLinkId: { $in: meetingIdsFromTopic },
      status: { $in: ['processing', 'failed'] },
    })
      .select('meetingLinkId zoomMeetingId createdAt accessBatches accessLevel status')
      .lean()
    : [];

  const byMeetingLink = new Map();
  [...zoomRows, ...extraZoom].forEach((z) => {
    byMeetingLink.set(z.meetingLinkId.toString(), z);
  });

  const meetingMap = {};
  topicMeetings.forEach((m) => { meetingMap[m._id.toString()] = m; });

  const missingMeetingIds = [...byMeetingLink.keys()].filter((id) => !meetingMap[id]);
  if (missingMeetingIds.length) {
    const extraMeetings = await MeetingLink.find({ _id: { $in: missingMeetingIds } })
      .select('_id topic batch startTime')
      .lean();
    extraMeetings.forEach((m) => { meetingMap[m._id.toString()] = m; });
  }

  const refs = [];
  for (const z of byMeetingLink.values()) {
    const meeting = meetingMap[z.meetingLinkId.toString()];
    if (!meeting) continue;
    if (level && level !== 'ALL' && z.accessLevel && z.accessLevel !== level) continue;
    if (!matchesAdminBatchFilter(batch, adminRecordingBatchLabels(z, meeting))) continue;
    refs.push({
      kind: 'zoom',
      id: z.meetingLinkId,
      sortAt: meeting.startTime || z.createdAt,
      title: meeting.topic || '',
      description: '',
      zoomMeetingId: z.zoomMeetingId || '',
      inProgress: true,
    });
  }
  return refs;
}

/** Lightweight rows for sort/filter before hydrating a page of full records. */
async function buildAdminRecordingRefs(filters = {}) {
  const { level, batch, search } = filters;
  const searchRe = search
    ? new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    : null;

  const manualQuery = { ...adminReadyManualQuery() };
  if (level && level !== 'ALL') manualQuery.level = level;
  if (searchRe) {
    manualQuery.$and = manualQuery.$and || [];
    manualQuery.$and.push({
      $or: [
        { title: searchRe },
        { description: searchRe },
      ],
    });
  }

  const zoomQuery = { ...adminReadyZoomQuery() };
  if (level && level !== 'ALL') zoomQuery.accessLevel = level;
  if (searchRe) {
    zoomQuery.$and = zoomQuery.$and || [];
    zoomQuery.$and.push({
      $or: [{ zoomMeetingId: searchRe }],
    });
  }

  const [manualRows, zoomRows] = await Promise.all([
    ClassRecording.find(manualQuery)
      .select('_id title description level batches plan createdAt')
      .lean(),
    ZoomRecording.find(zoomQuery)
      .select('meetingLinkId zoomMeetingId createdAt accessBatches accessLevel')
      .lean(),
  ]);

  const meetingIds = zoomRows.map((z) => z.meetingLinkId);
  const meetings = meetingIds.length
    ? await MeetingLink.find({ _id: { $in: meetingIds } })
      .select('_id topic batch startTime')
      .lean()
    : [];
  const meetingMap = {};
  meetings.forEach((m) => { meetingMap[m._id.toString()] = m; });

  const refs = [];

  manualRows.forEach((m) => {
    const manualBatches = Array.isArray(m.batches)
      ? m.batches.map((b) => String(b).trim()).filter(Boolean)
      : [];
    if (!matchesAdminBatchFilter(batch, manualBatches)) return;
    refs.push({
      kind: 'manual',
      id: m._id,
      sortAt: m.createdAt,
      title: m.title || '',
      description: m.description || '',
      zoomMeetingId: '',
    });
  });

  zoomRows.forEach((z) => {
    const meeting = meetingMap[z.meetingLinkId.toString()] || {};
    if (searchRe) {
      const topic = String(meeting.topic || '');
      const mid = String(z.zoomMeetingId || '');
      if (!searchRe.test(topic) && !searchRe.test(mid)) return;
    }
    if (!matchesAdminBatchFilter(batch, adminRecordingBatchLabels(z, meeting))) return;
    refs.push({
      kind: 'zoom',
      id: z.meetingLinkId,
      sortAt: meeting.startTime || z.createdAt,
      title: meeting.topic || '',
      description: '',
      zoomMeetingId: z.zoomMeetingId || '',
    });
  });

  if (search) {
    const inProgressRefs = await buildAdminInProgressZoomRefs(filters);
    const existingZoomIds = new Set(
      refs.filter((r) => r.kind === 'zoom').map((r) => String(r.id))
    );
    inProgressRefs.forEach((ref) => {
      if (!existingZoomIds.has(String(ref.id))) refs.push(ref);
    });
  }

  refs.sort((a, b) => new Date(b.sortAt) - new Date(a.sortAt));
  return refs;
}

async function hydrateAdminRecordingRefs(refs) {
  if (!refs.length) return [];

  const manualIds = refs.filter((r) => r.kind === 'manual').map((r) => r.id);
  const zoomMeetingIds = refs.filter((r) => r.kind === 'zoom').map((r) => r.id);

  const [manualDocs, zoomDocs] = await Promise.all([
    manualIds.length
      ? ClassRecording.find({ _id: { $in: manualIds } }).populate('uploadedBy', 'name').lean()
      : [],
    zoomMeetingIds.length
      ? ZoomRecording.find({ meetingLinkId: { $in: zoomMeetingIds } })
        .select('meetingLinkId r2Key hlsKey duration status createdAt zoomMeetingId isPublished publishedAt accessBatches accessLevel accessPlan')
        .lean()
      : [],
  ]);

  const manualMap = {};
  manualDocs.forEach((m) => { manualMap[m._id.toString()] = m; });

  const meetingLinks = zoomMeetingIds.length
    ? await MeetingLink.find({ _id: { $in: zoomMeetingIds } })
      .select('_id topic batch startTime duration assignedTeacher courseDay')
      .populate('assignedTeacher', 'name')
      .lean()
    : [];
  const meetingMap = {};
  meetingLinks.forEach((m) => { meetingMap[m._id.toString()] = m; });

  const zoomMap = {};
  zoomDocs.forEach((z) => { zoomMap[z.meetingLinkId.toString()] = z; });

  return refs.map((ref) => {
    if (ref.kind === 'manual') {
      const m = manualMap[ref.id.toString()];
      return m ? mapManualRecordingToAdminItem(m) : null;
    }
    const z = zoomMap[ref.id.toString()];
    if (!z) return null;
    const meeting = meetingMap[ref.id.toString()] || {};
    return mapZoomRecordingToAdminItem(z, meeting);
  }).filter(Boolean);
}

async function fetchAllAdminRecordings(filters = {}) {
  const refs = await buildAdminRecordingRefs(filters);
  return hydrateAdminRecordingRefs(refs);
}

// GET /api/class-recordings/admin/all — Admin/Teacher: combined manual + zoom recordings
// Query: page, limit (optional — when set, returns one page + total). level, batch, search filters.
router.get('/admin/all', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const filters = {
      level: req.query.level ? String(req.query.level) : 'ALL',
      batch: req.query.batch ? String(req.query.batch) : 'ALL',
      search: req.query.search ? String(req.query.search).trim() : '',
    };

    const hasPagination = req.query.page != null || req.query.limit != null;

    if (!hasPagination) {
      const recordings = await fetchAllAdminRecordings(filters);
      return res.json({ success: true, recordings });
    }

    const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit), 10) || 15));
    const refs = await buildAdminRecordingRefs(filters);
    const total = refs.length;
    const skip = (page - 1) * limit;
    const pageRefs = refs.slice(skip, skip + limit);
    const recordings = await hydrateAdminRecordingRefs(pageRefs);

    const [readyManualCount, readyZoomCount] = await Promise.all([
      ClassRecording.countDocuments(adminReadyManualQuery()),
      ZoomRecording.countDocuments(adminReadyZoomQuery()),
    ]);

    res.json({
      success: true,
      recordings,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        readyTotal: readyManualCount + readyZoomCount,
        readyManual: readyManualCount,
        readyZoom: readyZoomCount,
      },
    });
  } catch (error) {
    console.error('Error fetching combined admin recordings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/batches — Get unique batch values for dropdown
router.get('/batches', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const students = await User.find({ role: 'STUDENT' })
      .select('batch goStatus subscription')
      .lean();

    const seen = new Set();
    const batches = [];
    for (const student of students) {
      for (const batch of allStudentBatchStringsForContent(student)) {
        const normalized = String(batch || '').trim().toLowerCase();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        batches.push(String(batch).trim());
      }
    }

    const merged = mergePortalBatchNames(batches);
    res.json({ success: true, batches: merged });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/analytics/summary — Admin: view counts + total watch time per recording
router.get('/analytics/summary', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const summary = await RecordingView.aggregate([
      { $group: {
        _id: '$recording',
        totalViews: { $sum: 1 },
        uniqueStudents: { $addToSet: '$student' },
        totalWatchTime: { $sum: '$watchDuration' },
        avgWatchTime: { $avg: '$watchDuration' }
      }},
      { $project: {
        _id: 1, totalViews: 1, totalWatchTime: 1, avgWatchTime: 1,
        uniqueStudentCount: { $size: '$uniqueStudents' }
      }}
    ]);
    const map = {};
    summary.forEach(s => { map[s._id.toString()] = s; });
    res.json({ success: true, summary: map });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings — Create recording (Teacher/Admin)
router.post('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { title, description, videoUrl, batches, level, plan, courseDay } = req.body;
    if (!title || !videoUrl || !level || !batches || batches.length === 0) {
      return res.status(400).json({ success: false, message: 'Title, video URL, level, and at least one batch are required' });
    }
    let normalizedCourseDay = null;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseDay')) {
      if (courseDay !== null && courseDay !== '') {
        const n = parseInt(String(courseDay), 10);
        normalizedCourseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
      }
    }

    const recording = await ClassRecording.create({
      title, description, videoUrl, batches, level,
      plan: plan || 'ALL',
      courseDay: normalizedCourseDay,
      sourceType: 'URL',
      status: 'ready',
      uploadedBy: req.user.id
    });

    console.log(`✅ Class recording created: "${title}" by ${req.user.id}`);
    res.json({ success: true, recording });
  } catch (error) {
    console.error('Error creating class recording:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings/upload — Upload MP4, convert to HLS, store in R2
router.post('/upload', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), (req, res) => {
  manualRecordingUpload.single('video')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message || 'Upload failed.' });
    }

    try {
      if (!R2_CONFIG_OK) {
        return res.status(503).json({
          success: false,
          message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
        });
      }

      const { title, description = '', level, plan = 'ALL', courseDay } = req.body || {};
      const rawBatches = req.body?.batches;
      const batches = Array.isArray(rawBatches)
        ? rawBatches
        : String(rawBatches || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean);

      if (!title || !level || !batches.length) {
        return res.status(400).json({
          success: false,
          message: 'Title, level, and at least one batch are required.',
        });
      }
      if (!req.file?.path) {
        return res.status(400).json({ success: false, message: 'Video file is required.' });
      }
      let normalizedCourseDay = null;
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseDay')) {
        if (courseDay !== null && courseDay !== '') {
          const n = parseInt(String(courseDay), 10);
          normalizedCourseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
        }
      }

      const recording = await ClassRecording.create({
        title: String(title).trim(),
        description: String(description || '').trim(),
        videoUrl: '',
        batches,
        level: String(level),
        plan: String(plan || 'ALL'),
        sourceType: 'HLS_UPLOAD',
        status: 'processing',
        courseDay: normalizedCourseDay,
        hlsKey: null,
        errorMessage: null,
        uploadedBy: req.user.id,
        isPublished: false,
        publishedAt: null,
      });

      // Immediate response; conversion runs in background.
      res.status(202).json({
        success: true,
        message: 'Upload received. HLS conversion started in background.',
        recordingId: recording._id,
      });

      processManualRecordingUpload(String(recording._id), req.file.path)
        .then(async (result) => {
          if (result?.success && result.hlsKey) {
            await ClassRecording.findByIdAndUpdate(recording._id, {
              status: 'ready',
              hlsKey: result.hlsKey,
              duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : null,
              errorMessage: null,
            });
            return;
          }
          await ClassRecording.findByIdAndUpdate(recording._id, {
            status: 'failed',
            errorMessage: result?.error || 'Conversion failed',
          });
        })
        .catch(async (err) => {
          await ClassRecording.findByIdAndUpdate(recording._id, {
            status: 'failed',
            errorMessage: err.message || 'Conversion failed',
          });
        });
    } catch (error) {
      console.error('Error creating uploaded recording:', error);
      return res.status(500).json({ success: false, message: error.message });
    }
  });
});

/**
 * POST /api/class-recordings/upload/prepare
 *
 * Step 1 of the fast-upload flow: create the ClassRecording DB record and return
 * a short-lived presigned R2 PUT URL so the browser can upload the raw video
 * file directly to R2 (bypassing the Node.js server entirely).
 * Body: { title, description, level, plan, batches, courseDay, filename, contentType }
 * Returns: { recordingId, uploadUrl, r2RawKey }
 */
router.post('/upload/prepare', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    if (!R2_CONFIG_OK) {
      return res.status(503).json({
        success: false,
        message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
      });
    }

    const { title, description = '', level, plan = 'ALL', courseDay, filename, contentType } = req.body || {};
    const rawBatches = req.body?.batches;
    const batches = Array.isArray(rawBatches)
      ? rawBatches
      : String(rawBatches || '').split(',').map((v) => v.trim()).filter(Boolean);

    if (!title || !level || !batches.length || !filename || !contentType) {
      return res.status(400).json({
        success: false,
        message: 'title, level, batches, filename, and contentType are required.',
      });
    }

    let normalizedCourseDay = null;
    if (courseDay !== null && courseDay !== '' && courseDay !== undefined) {
      const n = parseInt(String(courseDay), 10);
      normalizedCourseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
    }

    const recording = await ClassRecording.create({
      title: String(title).trim(),
      description: String(description || '').trim(),
      videoUrl: '',
      batches,
      level: String(level),
      plan: String(plan || 'ALL'),
      sourceType: 'HLS_UPLOAD',
      status: 'processing',
      courseDay: normalizedCourseDay,
      hlsKey: null,
      errorMessage: null,
      uploadedBy: req.user.id,
      isPublished: false,
      publishedAt: null,
    });

    const safeFilename = String(filename)
      .replace(/[^\w.\-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const r2RawKey = `uploads/raw/${recording._id}/${safeFilename}`;

    const putCommand = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2RawKey,
      ContentType: String(contentType),
    });
    const uploadUrl = await getSignedUrl(r2Client, putCommand, { expiresIn: 3600 });

    console.log(`[ManualUpload] Prepared direct upload: recordingId=${recording._id} key=${r2RawKey}`);
    return res.json({ success: true, recordingId: recording._id, uploadUrl, r2RawKey });
  } catch (error) {
    console.error('Error preparing direct upload:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/class-recordings/:id/start-processing
 *
 * Step 3 of the fast-upload flow: called after the browser has finished uploading
 * the raw video directly to R2.  Kicks off the FFmpeg → HLS → R2 pipeline.
 * Body: { r2RawKey }
 */
router.post('/:id/start-processing', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { id } = req.params;
    const { r2RawKey } = req.body || {};

    if (!r2RawKey) {
      return res.status(400).json({ success: false, message: 'r2RawKey is required.' });
    }

    const recording = await ClassRecording.findById(id);
    if (!recording) {
      return res.status(404).json({ success: false, message: 'Recording not found.' });
    }
    if (recording.status !== 'processing') {
      return res.status(400).json({ success: false, message: `Recording is already ${recording.status}.` });
    }

    res.status(202).json({ success: true, message: 'Processing started in background.' });

    processManualRecordingFromR2(String(id), r2RawKey)
      .then(async (result) => {
        if (result?.success && result.hlsKey) {
          await ClassRecording.findByIdAndUpdate(id, {
            status: 'ready',
            hlsKey: result.hlsKey,
            duration: Number.isFinite(Number(result.duration)) ? Number(result.duration) : null,
            errorMessage: null,
          });
          return;
        }
        await ClassRecording.findByIdAndUpdate(id, {
          status: 'failed',
          errorMessage: result?.error || 'Conversion failed',
        });
      })
      .catch(async (err) => {
        await ClassRecording.findByIdAndUpdate(id, {
          status: 'failed',
          errorMessage: err.message || 'Conversion failed',
        });
      });
  } catch (error) {
    console.error('Error starting processing:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/class-recordings/manual/publish
 *
 * Toggle student visibility for manually uploaded / URL class recordings.
 * Body: { recordingIds: string[], isPublished: boolean }
 */
router.post('/manual/publish', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { recordingIds, isPublished } = req.body || {};
    if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'recordingIds array is required.' });
    }

    const publishState = Boolean(isPublished);
    const result = await ClassRecording.updateMany(
      { _id: { $in: recordingIds }, status: 'ready', active: true },
      {
        $set: {
          isPublished: publishState,
          publishedAt: publishState ? new Date() : null,
        },
      }
    );

    return res.json({
      success: true,
      message: publishState ? 'Recording(s) visible to students.' : 'Recording(s) hidden from students.',
      matched: result.matchedCount || 0,
      modified: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('Error updating manual publish state:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/:id — Update recording (Teacher/Admin)
router.put('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { title, description, videoUrl, batches, level, plan, courseDay, addBatch, isPublished } = req.body || {};
    const existing = await ClassRecording.findById(req.params.id).lean();
    if (!existing) return res.status(404).json({ success: false, message: 'Recording not found' });

    const updatePayload = {};
    if (title !== undefined) updatePayload.title = title;
    if (description !== undefined) updatePayload.description = description;
    if (level !== undefined) updatePayload.level = level;
    if (plan !== undefined) updatePayload.plan = plan;
    if (existing.sourceType !== 'HLS_UPLOAD' && videoUrl !== undefined) {
      updatePayload.videoUrl = videoUrl;
    }
    if (Array.isArray(batches)) {
      updatePayload.batches = batches.map((b) => String(b).trim()).filter(Boolean);
    } else if (addBatch !== undefined && addBatch !== null && String(addBatch).trim() !== '') {
      const tag = String(addBatch).trim();
      updatePayload.batches = Array.from(new Set([...(existing.batches || []).map(String), tag]));
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseDay')) {
      if (courseDay === null || courseDay === '') {
        updatePayload.courseDay = null;
      } else {
        const n = parseInt(String(courseDay), 10);
        updatePayload.courseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'isPublished')) {
      const pub = Boolean(isPublished);
      updatePayload.isPublished = pub;
      updatePayload.publishedAt = pub ? (existing.publishedAt || new Date()) : null;
    }

    const recording = await ClassRecording.findByIdAndUpdate(
      req.params.id,
      { $set: updatePayload },
      { new: true, runValidators: true }
    );
    res.json({ success: true, recording });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/:id/upload-status — Poll status for manual uploaded recordings
router.get('/:id/upload-status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const recording = await ClassRecording.findById(req.params.id)
      .select('_id sourceType status errorMessage hlsKey createdAt')
      .lean();

    if (!recording) {
      return res.status(404).json({ success: false, message: 'Recording not found.' });
    }

    res.json({
      success: true,
      recordingId: recording._id,
      sourceType: recording.sourceType || 'URL',
      status: recording.status || 'ready',
      errorMessage: recording.errorMessage || null,
      hlsReady: Boolean(recording.hlsKey),
      createdAt: recording.createdAt,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/:id/hls/playlist — signed playlist for manual uploaded recordings
router.get('/:id/hls/playlist', verifyMediaToken, async (req, res) => {
  try {
    if (!R2_CONFIG_OK) {
      return res.status(503).json({
        success: false,
        message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
      });
    }

    const recording = await ClassRecording.findById(req.params.id)
      .select('active sourceType status hlsKey level plan batches isPublished courseDay')
      .lean();
    if (!recording || !recording.active) {
      return res.status(404).json({ success: false, message: 'Recording not found.' });
    }
    if (recording.sourceType !== 'HLS_UPLOAD' || !recording.hlsKey) {
      return res.status(404).json({ success: false, message: 'HLS recording not found for this item.' });
    }
    if (recording.status === 'processing') {
      return res.status(202).json({ success: false, message: 'Recording is still being processed.' });
    }
    if (recording.status !== 'ready') {
      return res.status(500).json({ success: false, message: recording.errorMessage || 'Recording is not available.' });
    }

    if (!isClassRecordingStaff(req.user.role)) {
      const student = await User.findById(req.user.id).select('batch level subscription goStatus currentCourseDay').lean();
      if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
      const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
      if (!journeyAccess.enabled) {
        return res.status(403).json({ success: false, message: 'Journey content is not enabled for your batch yet.' });
      }
      student.journeyAccessEnabled = journeyAccess.enabled;
      if (!canUserAccessManualRecording(recording, student)) {
        return res.status(403).json({ success: false, message: 'This recording is not available for your profile.' });
      }
    }

    const cacheKey = `manual:${String(req.params.id)}`;
    const cached = getHlsCached(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(cached);
    }

    const playlist = await buildSignedHlsPlaylist(recording.hlsKey);
    setHlsCached(cacheKey, playlist);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(playlist);
  } catch (error) {
    console.error('Error serving manual HLS playlist:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/class-recordings/:id — Soft delete (Teacher/Admin)
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const recording = await ClassRecording.findByIdAndUpdate(
      req.params.id, { active: false }, { new: true }
    );
    if (!recording) return res.status(404).json({ success: false, message: 'Recording not found' });
    res.json({ success: true, message: 'Recording deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings/:id/view — Student starts watching (creates view session)
router.post('/:id/view', verifyToken, async (req, res) => {
  try {
    const recording = await ClassRecording.findById(req.params.id).lean();
    if (!recording || !recording.active) {
      return res.status(404).json({ success: false, message: 'Recording not found.' });
    }
    if (!isClassRecordingStaff(req.user.role)) {
      const student = await User.findById(req.user.id).select('batch level subscription goStatus currentCourseDay').lean();
      if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
      const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
      if (!journeyAccess.enabled) {
        return res.status(403).json({ success: false, message: 'Journey content is not enabled for your batch yet.' });
      }
      student.journeyAccessEnabled = journeyAccess.enabled;
      if (!canUserAccessManualRecording(recording, student)) {
        return res.status(403).json({ success: false, message: 'This recording is not available for your profile.' });
      }
    }
    const view = await RecordingView.create({
      recording: req.params.id,
      student: req.user.id,
      watchDuration: 0
    });
    res.json({ success: true, viewId: view._id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/view/:viewId — Update watch duration (called periodically)
router.put('/view/:viewId', verifyToken, async (req, res) => {
  try {
    const watchDurationSec = Math.max(0, Number(req.body?.watchDuration || 0));
    const view = await RecordingView.findByIdAndUpdate(
      req.params.viewId,
      { watchDuration: watchDurationSec, lastUpdatedAt: new Date() },
      { new: true, select: 'recording student watchDuration' }
    );

    let journeyAdvanced = false;
    let newCourseDay = null;
    let previousCourseDay = null;

    if (view?.recording && view?.student && !isClassRecordingStaff(req.user?.role)) {
      try {
        const recording = await ClassRecording.findById(view.recording)
          .select('active courseDay duration batches level plan')
          .lean();
        const studentLean = await User.findById(view.student)
          .select('batch goStatus subscription level currentCourseDay')
          .lean();
        const isSilverGo = isSilverGoStudent(studentLean);
        const recDurationSec = Number(recording?.duration || 0);
        const watchRatio = isSilverGo ? 0.9 : 0.75;
        const watchedEnough = recDurationSec > 0 && watchDurationSec >= Math.ceil(recDurationSec * watchRatio);

        if (recording?.active && watchedEnough) {
          const advResult = await checkAndInstantlyAdvanceSilverGoStudent(String(view.student));
          if (advResult.advanced) {
            journeyAdvanced = true;
            previousCourseDay = advResult.previousDay;
            newCourseDay = advResult.newDay;
          }
        }
      } catch (advErr) {
        console.error('[Instant Advance] manual recording view check failed (non-critical):', advErr.message);
      }
    }

    res.json({ success: true, journeyAdvanced, ...(journeyAdvanced ? { previousCourseDay, newCourseDay } : {}) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/:id/duration — Persist manual recording duration (seconds)
router.put('/:id/duration', verifyToken, async (req, res) => {
  try {
    const raw = Number(req.body?.duration);
    const duration = Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : 0;
    if (duration <= 0) {
      return res.status(400).json({ success: false, message: 'duration must be a positive number of seconds.' });
    }

    const recording = await ClassRecording.findById(req.params.id)
      .select('active sourceType status hlsKey level plan batches isPublished courseDay duration')
      .lean();
    if (!recording || !recording.active) {
      return res.status(404).json({ success: false, message: 'Recording not found.' });
    }

    if (!isClassRecordingStaff(req.user.role)) {
      const student = await User.findById(req.user.id).select('batch level subscription goStatus currentCourseDay').lean();
      if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
      const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
      if (!journeyAccess.enabled) {
        return res.status(403).json({ success: false, message: 'Journey content is not enabled for your batch yet.' });
      }
      student.journeyAccessEnabled = journeyAccess.enabled;
      if (!canUserAccessManualRecording(recording, student)) {
        return res.status(403).json({ success: false, message: 'This recording is not available for your profile.' });
      }
    }

    const current = Number(recording.duration || 0);
    const next = duration > current ? duration : current;
    await ClassRecording.updateOne({ _id: req.params.id }, { $set: { duration: next } });
    return res.json({ success: true, duration: next });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/:id/views — Admin: get all views for a recording
router.get('/:id/views', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const views = await RecordingView.find({ recording: req.params.id })
      .populate('student', 'name email batch level')
      .sort({ startedAt: -1 }).lean();
    res.json({ success: true, views });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/class-recordings/zoom/:meetingLinkId/view — Student starts watching a Zoom recording
router.post('/zoom/:meetingLinkId/view', verifyToken, async (req, res) => {
  try {
    const { meetingLinkId } = req.params;
    const { role, id: userId } = req.user;
    if (!isClassRecordingStaff(role)) {
      const [meetingLink, zoomRecording, student] = await Promise.all([
        MeetingLink.findById(meetingLinkId).select('batch courseDay').lean(),
        ZoomRecording.findOne({ meetingLinkId }).select('accessBatches accessLevel accessPlan isPublished').lean(),
        User.findById(userId).select('batch goStatus subscription currentCourseDay').lean(),
      ]);
      if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
      const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
      if (!journeyAccess.enabled) {
        return res.status(403).json({
          success: false,
          message: 'Journey content is not enabled for your batch yet.',
        });
      }
      student.journeyAccessEnabled = journeyAccess.enabled;
      const granted = await hasApprovedGrant(userId, meetingLinkId);
      if (!granted && !canUserAccessZoomRecording(zoomRecording, meetingLink, student)) {
        return res.status(403).json({
          success: false,
          message: 'This recording is not available for your profile.',
        });
      }
    }
    const view = await ZoomRecordingView.create({
      meetingLinkId,
      student: req.user.id,
      watchDuration: 0,
    });
    res.json({ success: true, viewId: view._id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/class-recordings/zoom/view/:viewId — Update Zoom watch duration
router.put('/zoom/view/:viewId', verifyToken, async (req, res) => {
  try {
    const watchDurationSec = Math.max(0, Number(req.body?.watchDuration || 0));
    const view = await ZoomRecordingView.findByIdAndUpdate(req.params.viewId, {
      watchDuration: watchDurationSec,
      lastUpdatedAt: new Date(),
    }, {
      new: true,
      select: 'meetingLinkId student watchDuration'
    });

    if (view?.meetingLinkId && view?.student) {
      const [meeting, zoomRec] = await Promise.all([
        MeetingLink.findById(view.meetingLinkId).select('batch courseDay duration status').lean(),
        ZoomRecording.findOne({ meetingLinkId: view.meetingLinkId }).select('duration').lean()
      ]);

      const recordingDurationSec = Number(
        zoomRec?.duration != null
          ? zoomRec.duration
          : (meeting?.duration != null ? Number(meeting.duration) * 60 : 0)
      );
      const day = Number(meeting?.courseDay);
      const studentLean = await User.findById(view.student)
        .select('batch goStatus subscription level currentCourseDay')
        .lean();
      const isSilverGo = isSilverGoStudent(studentLean);
      const completionWatchRatio = isSilverGo ? 0.9 : 0.75;
      const isEligibleGate =
        !!meeting &&
        meeting.status !== 'cancelled' &&
        Number.isFinite(day) &&
        day >= 1 &&
        Number.isFinite(recordingDurationSec) &&
        recordingDurationSec > 0 &&
        watchDurationSec >= Math.ceil(recordingDurationSec * completionWatchRatio);

      if (isEligibleGate) {
        const dayInt = Math.floor(day);
        const nextDay = Math.min(200, dayInt + 1);
        const batchKeys = studentLean ? allStudentBatchStringsForContent(studentLean) : [];
        const primary = batchKeys.includes('GO-SILVER') ? 'GO-SILVER' : batchKeys[0];
        const cfgDoc = primary
          ? await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(primary)}$`, 'i') }).lean()
          : null;

        let allowInstantAdvance = true;
        if (isSilverGo) {
          const comp = await computeJourneyDayCompletion(view.student, batchKeys, dayInt, {
            creditMeetings: meeting?._id ? [meeting._id] : [],
            includeRecordings: true,
            includeDg: true,
            includeLearningModules: false,
            studentLevel: studentLean?.level,
            studentPlan: studentLean?.subscription,
            goStatus: studentLean?.goStatus,
            subscription: studentLean?.subscription
          });
          allowInstantAdvance = !!comp.complete;
        } else if (cfgDoc && cfgDoc.strictJourneyRule) {
          const comp = await computeJourneyDayCompletion(view.student, batchKeys, dayInt, {
            creditMeetings: meeting?._id ? [meeting._id] : []
          });
          allowInstantAdvance = meetsStrictThreshold(comp, cfgDoc);
        }

        if (allowInstantAdvance) {
          const advancedNow = await User.updateOne(
            { _id: view.student, role: 'STUDENT', currentCourseDay: dayInt },
            {
              $set: withJourneyLevelInSet(
                nextDay,
                {
                  currentCourseDay: nextDay,
                  pendingJourneyDayAdvance: false,
                  pendingJourneyDayAdvanceForDay: null
                },
                { student: studentLean }
              )
            }
          );
          if (advancedNow?.modifiedCount) {
            console.log(`🚀 [Instant Advance] Zoom recording Silver GO student ${view.student}: Day ${dayInt} → ${nextDay}`);
            return res.json({ success: true, journeyAdvanced: true, previousCourseDay: dayInt, newCourseDay: nextDay });
          } else {
            await markPendingAdvanceForStudentDay(String(view.student), String(meeting.batch || ''), dayInt);
          }
        }
      }
    }

    res.json({ success: true, journeyAdvanced: false });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/class-recordings/zoom/:meetingLinkId/views — Admin analytics for one Zoom recording
router.get('/zoom/:meetingLinkId/views', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { meetingLinkId } = req.params;

    const [meeting, zoomRec, zoomViews] = await Promise.all([
      MeetingLink.findById(meetingLinkId).select('batch').lean(),
      ZoomRecording.findOne({ meetingLinkId }).select('r2Key accessBatches accessLevel accessPlan').lean(),
      ZoomRecordingView.find({ meetingLinkId })
        .populate('student', 'name email batch level')
        .sort({ startedAt: -1 })
        .lean(),
    ]);

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found.' });
    }

    const watchMap = {};
    for (const v of zoomViews) {
      const sid = v?.student?._id ? String(v.student._id) : null;
      if (!sid) continue;
      if (!watchMap[sid]) watchMap[sid] = [];
      watchMap[sid].push(v);
    }

    const allStudents = await User.find({ role: 'STUDENT' })
      .select('name email batch level goStatus subscription')
      .lean();

    const access = normalizeZoomAccessSettings(zoomRec, meeting);
    const batchStudents = allStudents.filter((s) => {
      const keys = allStudentBatchStringsForContent(s);
      if (!keys.length || !access.batches.length) return false;
      const inBatch = access.batches.some((b) => keys.some((k) => batchesAlign(k, b)));
      if (!inBatch) return false;
      if (access.level && s.level && String(s.level).toUpperCase() !== access.level) return false;
      if (!access.plan || access.plan === 'ALL') return true;
      const allowed = allowedRecordingPlansForStudent(s).map((p) => String(p).toUpperCase());
      return allowed.includes(access.plan);
    });

    const rows = [];
    for (const student of batchStudents) {
      const sid = String(student._id);
      const sessions = watchMap[sid] || [];
      if (!sessions.length) {
        rows.push({
          student: {
            name: student.name || 'Unknown',
            email: student.email || '',
            batch: student.batch || '',
            level: student.level || '',
          },
          watchDuration: 0,
          startedAt: null,
          lastUpdatedAt: null,
          viewed: false,
        });
        continue;
      }

      const latest = sessions[0];
      rows.push({
        student: {
          name: student.name || 'Unknown',
          email: student.email || '',
          batch: student.batch || '',
          level: student.level || '',
        },
        watchDuration: Number(latest.watchDuration || 0),
        startedAt: latest.startedAt || null,
        lastUpdatedAt: latest.lastUpdatedAt || null,
        viewed: true,
      });
    }

    let videoSizeBytes = 0;
    if (zoomRec?.r2Key) {
      try {
        const head = await r2Client.send(new HeadObjectCommand({
          Bucket: R2_BUCKET,
          Key: zoomRec.r2Key,
        }));
        videoSizeBytes = Number(head.ContentLength || 0);
      } catch (e) {
        videoSizeBytes = 0;
      }
    }

    const watchedCount = rows.filter((r) => r.viewed).length;
    const totalWatchSeconds = rows.reduce((sum, r) => sum + Number(r.watchDuration || 0), 0);

    return res.json({
      success: true,
      views: rows,
      summary: {
        totalStudents: rows.length,
        watchedCount,
        notWatchedCount: rows.length - watchedCount,
        totalWatchSeconds,
        videoSizeBytes,
      },
    });
  } catch (error) {
    console.error('Error fetching zoom recording views:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ---------------------------------------------------------------------------
// Zoom Auto-Recorded Sessions (ingested via webhook → R2)
// ---------------------------------------------------------------------------

/**
 * GET /api/class-recordings/zoom/my-batch
 *
 * Returns the list of all READY Zoom recordings for the authenticated student's batch.
 * - Students see only recordings from classes belonging to their own batch.
 * - Admins/Teachers see all recordings (with optional ?batch= filter).
 * Results are sorted by class start date descending (newest first).
 */
router.get('/zoom/my-batch', verifyToken, async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    const isStaff = isClassRecordingStaff(role);
    const student = isStaff
      ? null
      : await User.findById(userId).select('batch level subscription goStatus currentCourseDay').lean();
    if (!isStaff && !student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    if (!isStaff) {
      const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
      if (!journeyAccess.enabled) {
        return res.json({ success: true, recordings: [] });
      }
      student.journeyAccessEnabled = journeyAccess.enabled;
    }

    const query = isStaff
      ? { status: 'ready' }
      : { status: 'ready', isPublished: { $ne: false } };
    const zoomRecordings = await ZoomRecording.find(query)
      .select('meetingLinkId r2Key duration status createdAt isPublished accessBatches accessLevel accessPlan')
      .lean();

    // Also include unpublished recordings where student has an approved grant
    let grantedMeetingLinkIds = [];
    if (!isStaff) {
      const approvedGrants = await RecordingAccessRequest.find({
        studentId: userId,
        status: 'APPROVED',
      }).select('meetingLinkId').lean();
      grantedMeetingLinkIds = approvedGrants.map((g) => String(g.meetingLinkId));

      if (grantedMeetingLinkIds.length) {
        const grantedRecs = await ZoomRecording.find({
          meetingLinkId: { $in: grantedMeetingLinkIds },
          status: 'ready',
          isPublished: false,
        })
          .select('meetingLinkId r2Key duration status createdAt isPublished accessBatches accessLevel accessPlan')
          .lean();
        // Merge without duplicates (don't add if already in published list)
        const existingIds = new Set(zoomRecordings.map((z) => String(z.meetingLinkId)));
        for (const gr of grantedRecs) {
          if (!existingIds.has(String(gr.meetingLinkId))) {
            zoomRecordings.push(gr);
          }
        }
      }
    }

    if (!zoomRecordings.length) return res.json({ success: true, recordings: [] });

    const meetingLinkIds = zoomRecordings.map((z) => z.meetingLinkId);
    const meetingLinks = await MeetingLink.find({ _id: { $in: meetingLinkIds } })
      .select('_id topic batch startTime duration status attendance assignedTeacher courseDay')
      .populate('assignedTeacher', 'name')
      .lean();
    const watchedByMeeting = new Map();
    if (!isStaff && meetingLinkIds.length) {
      const watchAgg = await ZoomRecordingView.aggregate([
        {
          $match: {
            student: new mongoose.Types.ObjectId(String(userId)),
            meetingLinkId: { $in: meetingLinkIds },
            watchDuration: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: '$meetingLinkId',
            maxWatchSeconds: { $max: '$watchDuration' }
          }
        }
      ]);
      for (const row of watchAgg) {
        const mins = Math.max(0, Math.round(Number(row?.maxWatchSeconds || 0) / 60));
        watchedByMeeting.set(String(row._id), mins);
      }
    }
    const meetingMap = {};
    meetingLinks.forEach((m) => { meetingMap[String(m._id)] = m; });

    const grantedSet = new Set(grantedMeetingLinkIds);
    const batchQuery = req.query.batch ? String(req.query.batch).trim() : '';
    const recordings = zoomRecordings
      .filter((rec) => {
        const meeting = meetingMap[String(rec.meetingLinkId)];
        if (!meeting) return false;
        if (!isStaff) {
          // Approved-grant recordings bypass the standard publish/batch/level checks
          if (grantedSet.has(String(rec.meetingLinkId))) return true;
          return canUserAccessZoomRecording(rec, meeting, student);
        }
        if (!batchQuery) return true;
        const access = normalizeZoomAccessSettings(rec, meeting);
        return access.batches.some((b) => batchesAlign(batchQuery, b));
      })
      .map((rec) => {
        const meeting = meetingMap[String(rec.meetingLinkId)] || {};
        const access = normalizeZoomAccessSettings(rec, meeting);
        const startTime = meeting.startTime ? new Date(meeting.startTime) : null;
        const durationMinutes = Number(meeting.duration || 0);
        const computedEnd = startTime && durationMinutes > 0
          ? new Date(startTime.getTime() + durationMinutes * 60 * 1000)
          : null;
        const attempted = meeting.status === 'ended' || (computedEnd ? Date.now() >= computedEnd.getTime() : false);
        const myAttendance = Array.isArray(meeting.attendance)
          ? meeting.attendance.find((a) => String(a?.studentId || '') === String(userId))
          : null;
        const attendanceStatus = myAttendance
          ? (
              myAttendance.attended === true ||
              myAttendance.status === 'attended' ||
              Number(myAttendance.attendancePercent || 0) >= 75
                ? 'Attended'
                : (attempted ? 'Not Attended' : 'Pending')
            )
          : (attempted ? 'Not Attempted' : 'Pending');

        return {
          meetingLinkId: rec.meetingLinkId,
          r2Key: rec.r2Key,
          duration: rec.duration,
          status: rec.status,
          createdAt: rec.createdAt,
          isPublished: rec.isPublished !== false,
          topic: meeting.topic || 'Class Recording',
          batch: access.batches.join(', '),
          batches: access.batches,
          level: access.level,
          plan: access.plan,
          teacherName: meeting.assignedTeacher?.name || 'Teacher',
          attempted,
          attendanceStatus,
          watchedMinutes: watchedByMeeting.get(String(rec.meetingLinkId)) ?? 0,
          classDate: meeting.startTime || rec.createdAt,
          meetingDuration: meeting.duration || null,
          courseDay: meeting.courseDay != null ? meeting.courseDay : null,
        };
      })
      .sort((a, b) => new Date(b.classDate) - new Date(a.classDate));

    res.json({ success: true, recordings });
  } catch (error) {
    console.error('Error fetching batch recordings:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/class-recordings/zoom/backfill
 *
 * Admin tool to backfill past class recordings from Zoom for existing MeetingLink records.
 * This is for historical data recovery. Future classes should still flow automatically
 * through the recording.completed webhook.
 *
 * Body (all optional):
 *  - batch: "35"
 *  - limit: 200
 *  - includeFailed: true
 *  - force: false
 *  - meetingIds: ["81190533282", "81221622942"] or "81190533282,81221622942"
 */
/**
 * POST /api/class-recordings/zoom/backfill
 *
 * Starts a backfill in the background and responds 202 immediately so
 * Cloudflare's proxy timeout is never hit. Poll GET /zoom/backfill/status
 * to track progress.
 */
router.post('/zoom/backfill', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  const {
    batch = null,
    limit = 100,
    includeFailed = true,
    force = false,
    meetingIds = [],
  } = req.body || {};

  const status = getBackfillStatus();
  if (status.running) {
    return res.status(409).json({
      success: false,
      message: 'A backfill is already running. Poll GET /api/class-recordings/zoom/backfill/status for updates.',
      startedAt: status.startedAt,
      params: status.params,
    });
  }

  // Respond immediately — scanning + downloading can take minutes.
  res.status(202).json({
    success: true,
    message: 'Backfill started in background. Poll GET /api/class-recordings/zoom/backfill/status for results.',
    params: { batch, limit, includeFailed, force, meetingIds },
  });

  // Fire-and-forget: runs entirely outside the HTTP request lifecycle.
  backfillZoomRecordings({ batch, limit, includeFailed, force, meetingIds }).catch((err) => {
    console.error('❌ Backfill top-level error:', err.message);
  });
});

/**
 * GET /api/class-recordings/zoom/backfill/status
 *
 * Returns the state of the most recently triggered backfill job.
 * Use this to poll after calling POST /zoom/backfill.
 */
router.get('/zoom/backfill/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), (req, res) => {
  const status = getBackfillStatus();
  res.json({ success: true, ...status });
});

/**
 * POST /api/class-recordings/zoom/publish
 *
 * Toggle Zoom recording visibility for students.
 * Body:
 *  - meetingLinkIds: string[]
 *  - isPublished: boolean
 */
router.post('/zoom/publish', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { meetingLinkIds, isPublished } = req.body || {};
    if (!Array.isArray(meetingLinkIds) || meetingLinkIds.length === 0) {
      return res.status(400).json({ success: false, message: 'meetingLinkIds array is required.' });
    }

    const publishState = Boolean(isPublished);
    // Only ready recordings are eligible for student visibility toggling.
    const result = await ZoomRecording.updateMany(
      { meetingLinkId: { $in: meetingLinkIds }, status: 'ready' },
      {
        $set: {
          isPublished: publishState,
          publishedAt: publishState ? new Date() : null,
        },
      }
    );

    return res.json({
      success: true,
      message: publishState ? 'Recording(s) visible to students.' : 'Recording(s) hidden from students.',
      matched: result.matchedCount || 0,
      modified: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('Error updating Zoom publish state:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/class-recordings/manual/publish
 *
 * Toggle manual (uploaded / URL) class recording visibility for students.
 * Body:
 *  - recordingIds: string[]
 *  - isPublished: boolean
 */
router.post('/manual/publish', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { recordingIds, isPublished } = req.body || {};
    if (!Array.isArray(recordingIds) || recordingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'recordingIds array is required.' });
    }

    const publishState = Boolean(isPublished);
    const ids = [...new Set(recordingIds.map((id) => String(id).trim()).filter(Boolean))].filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );
    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'No valid recording IDs.' });
    }

    const result = await ClassRecording.updateMany(
      { _id: { $in: ids }, active: true, status: 'ready' },
      {
        $set: {
          isPublished: publishState,
          publishedAt: publishState ? new Date() : null,
        },
      }
    );

    return res.json({
      success: true,
      message: publishState ? 'Recording(s) visible to students.' : 'Recording(s) hidden from students.',
      matched: result.matchedCount || 0,
      modified: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('Error updating manual publish state:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /api/class-recordings/zoom/:meetingLinkId/meta
 *
 * Edit metadata of a Zoom class recording (title/topic, teacher, batch).
 */
router.put('/zoom/:meetingLinkId/meta', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { meetingLinkId } = req.params;
    const { title, batch, batches, level, plan, teacherId, courseDay } = req.body || {};

    const meeting = await MeetingLink.findById(meetingLinkId);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found.' });
    }

    if (typeof title === 'string' && title.trim()) {
      meeting.topic = title.trim();
    }
    const nextBatches = Array.isArray(batches)
      ? batches.map((b) => String(b).trim()).filter(Boolean)
      : (typeof batch === 'string' && batch.trim() ? [batch.trim()] : []);

    if (nextBatches.length === 1) {
      meeting.batch = nextBatches[0];
    } else if (typeof batch === 'string' && batch.trim()) {
      meeting.batch = batch.trim();
    }
    if (teacherId) {
      const teacher = await User.findById(teacherId).select('_id role').lean();
      if (!teacher || !['TEACHER', 'TEACHER_ADMIN', 'ADMIN'].includes(teacher.role)) {
        return res.status(400).json({ success: false, message: 'Invalid teacher selected.' });
      }
      meeting.assignedTeacher = teacher._id;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseDay')) {
      if (courseDay === null || courseDay === '') {
        meeting.courseDay = null;
      } else {
        const n = parseInt(String(courseDay), 10);
        meeting.courseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
      }
    }

    await meeting.save();
    const zoomSet = {
      ...(nextBatches.length ? { accessBatches: Array.from(new Set(nextBatches)) } : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'level')
        ? { accessLevel: level ? String(level).toUpperCase() : null }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'plan')
        ? { accessPlan: String(plan || 'ALL').toUpperCase() }
        : {}),
    };
    if (Object.keys(zoomSet).length > 0) {
      await ZoomRecording.updateOne({ meetingLinkId }, { $set: zoomSet });
    }
    return res.json({ success: true, message: 'Zoom recording details updated.' });
  } catch (error) {
    console.error('Error updating zoom recording metadata:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /api/class-recordings/zoom/:meetingLinkId
 *
 * Remove a Zoom auto-recording entry for a class.
 */
router.delete('/zoom/:meetingLinkId', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const { meetingLinkId } = req.params;
    const removed = await ZoomRecording.findOneAndDelete({ meetingLinkId });
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Zoom recording not found.' });
    }
    await ZoomRecordingView.deleteMany({ meetingLinkId });
    return res.json({ success: true, message: 'Zoom recording deleted successfully.' });
  } catch (error) {
    console.error('Error deleting zoom recording:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/class-recordings/zoom/publish
 *
 * Publish/unpublish selected Zoom recordings for student visibility.
 * Body:
 *  - meetingLinkIds: string[]
 *  - isPublished: boolean (default true)
 */
router.post('/zoom/publish', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { meetingLinkIds, isPublished = true } = req.body || {};
    if (!Array.isArray(meetingLinkIds) || meetingLinkIds.length === 0) {
      return res.status(400).json({ success: false, message: 'meetingLinkIds array is required.' });
    }

    const update = {
      isPublished: Boolean(isPublished),
      publishedAt: isPublished ? new Date() : null,
      publishedBy: isPublished ? req.user.id : null,
    };

    const result = await ZoomRecording.updateMany(
      { meetingLinkId: { $in: meetingLinkIds } },
      { $set: update }
    );

    return res.json({
      success: true,
      message: isPublished ? 'Recordings published successfully.' : 'Recordings unpublished successfully.',
      matched: result.matchedCount || 0,
      modified: result.modifiedCount || 0,
    });
  } catch (error) {
    console.error('Error publishing zoom recordings:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/debug/status
 *
 * Temporary admin/teacher debug endpoint to inspect ingestion status by batch.
 * Query params:
 *  - batch (optional): filter to one batch
 *  - limit (optional, default 200): max rows
 */
router.get('/zoom/debug/status', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 500));
    const batch = req.query.batch ? String(req.query.batch) : null;
    const meetingFilter = batch ? { batch } : {};

    const meetingLinks = await MeetingLink.find(meetingFilter)
      .select('_id batch topic startTime duration createdAt')
      .sort({ startTime: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    if (!meetingLinks.length) {
      return res.json({ success: true, total: 0, summary: {}, rows: [] });
    }

    const meetingIds = meetingLinks.map((m) => m._id);
    const zoomRows = await ZoomRecording.find({ meetingLinkId: { $in: meetingIds } })
      .select('meetingLinkId zoomMeetingId status isPublished r2Key duration errorMessage createdAt updatedAt')
      .lean();

    const zoomByMeetingId = {};
    zoomRows.forEach((z) => {
      zoomByMeetingId[z.meetingLinkId.toString()] = z;
    });

    const rows = meetingLinks.map((meeting) => {
      const zoom = zoomByMeetingId[meeting._id.toString()];
      return {
        meetingLinkId: meeting._id,
        batch: meeting.batch || '',
        topic: meeting.topic || 'Class',
        classDate: meeting.startTime || meeting.createdAt,
        meetingDuration: meeting.duration || null,
        zoomMeetingId: zoom?.zoomMeetingId || null,
        status: zoom?.status || 'missing',
        isPublished: zoom?.isPublished !== false,
        r2Key: zoom?.r2Key || null,
        recordingDuration: zoom?.duration || null,
        errorMessage: zoom?.errorMessage || null,
        recordingCreatedAt: zoom?.createdAt || null,
        recordingUpdatedAt: zoom?.updatedAt || null,
      };
    });

    const summary = rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      total: rows.length,
      summary,
      rows,
    });
  } catch (error) {
    console.error('Error fetching zoom debug status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/webhook-audit
 *
 * Admin/teacher endpoint to inspect recent webhook ingress + processing outcomes.
 * Query params:
 *  - limit (default 100, max 500)
 *  - status (optional)
 *  - eventType (optional)
 */
router.get('/zoom/webhook-audit', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    if (req.query.eventType) filter.eventType = String(req.query.eventType);

    const rows = await ZoomWebhookAudit.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const summary = rows.reduce((acc, row) => {
      acc[row.status] = (acc[row.status] || 0) + 1;
      return acc;
    }, {});

    res.json({ success: true, total: rows.length, summary, rows });
  } catch (error) {
    console.error('Error fetching webhook audit logs:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/:meetingLinkId/hls/playlist
 *
 * Serves the HLS master playlist (.m3u8) with every segment line replaced by
 * a short-lived presigned R2 URL.  Once the client has this playlist, it fetches
 * segments directly from R2 — the Express server is NOT involved during playback.
 *
 * The playlist is cached in-memory (see HLS_CACHE_TTL_MS) so repeated seeks / refreshes
 * don't re-sign hundreds of URLs on every request. Presigned segment TTL is much longer.
 *
 * Access control is identical to the MP4 signed-URL endpoint.
 */
router.get('/zoom/:meetingLinkId/hls/playlist', verifyMediaToken, async (req, res) => {
  try {
    if (!R2_CONFIG_OK) {
      return res.status(503).json({
        success: false,
        message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
      });
    }

    const { meetingLinkId } = req.params;
    const { role, id: userId } = req.user;

    const zoomRecording = await ZoomRecording.findOne({ meetingLinkId })
      .select('hlsKey status isPublished accessBatches accessLevel accessPlan').lean();

    if (!zoomRecording || !zoomRecording.hlsKey) {
      return res.status(404).json({ success: false, message: 'HLS recording not found for this class.' });
    }
    if (zoomRecording.status === 'processing') {
      return res.status(202).json({ success: false, message: 'Recording is still being processed.' });
    }
    if (zoomRecording.status !== 'ready') {
      return res.status(500).json({ success: false, message: 'Recording is not available.' });
    }

    // Student access control — standard batch/publish rules or approved grant
    if (!isClassRecordingStaff(role)) {
      const [meetingLink, student] = await Promise.all([
        MeetingLink.findById(meetingLinkId).select('batch courseDay').lean(),
        User.findById(userId).select('batch level goStatus subscription currentCourseDay').lean(),
      ]);
      if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
      const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
      if (!journeyAccess.enabled) {
        return res.status(403).json({
          success: false,
          message: 'Journey content is not enabled for your batch yet.',
        });
      }
      student.journeyAccessEnabled = journeyAccess.enabled;
      const granted = await hasApprovedGrant(userId, meetingLinkId);
      if (!granted && !canUserAccessZoomRecording(zoomRecording, meetingLink, student)) {
        return res.status(403).json({
          success: false,
          message: 'This recording is not available for your profile.',
        });
      }
    }

    // Serve from cache when possible
    const cacheKey = `zoom:${String(meetingLinkId)}`;
    const cached = getHlsCached(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(cached);
    }

    // Build and cache the signed playlist
    const playlist = await buildSignedHlsPlaylist(zoomRecording.hlsKey);
    setHlsCached(cacheKey, playlist);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(playlist);

  } catch (error) {
    console.error('Error serving HLS playlist:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/:meetingLinkId
 *
 * Returns an R2 presigned URL for the recording of a given class (see SIGNED_URL_EXPIRY_SECONDS).
 * For HLS recordings (hlsKey set) it also returns hlsMode:true so the client
 * knows to use the /hls/playlist endpoint instead of the MP4 URL.
 * Access rules:
 *  - ADMIN / TEACHER_ADMIN / TEACHER / SUB_ADMIN: always allowed
 *  - STUDENT: must belong to the same batch as the MeetingLink (attended or not)
 */
router.get('/zoom/:meetingLinkId', verifyToken, async (req, res) => {
  try {
    if (!R2_CONFIG_OK) {
      return res.status(503).json({
        success: false,
        message: `R2 is not configured: ${r2ConfigIssues.join(', ')}`,
      });
    }

    const { meetingLinkId } = req.params;
    const { role, id: userId } = req.user;

    // 1. Load the ZoomRecording
    const zoomRecording = await ZoomRecording.findOne({ meetingLinkId }).lean();
    if (!zoomRecording) {
      return res.status(404).json({ success: false, message: 'No recording found for this class.' });
    }

    if (zoomRecording.status === 'processing') {
      return res.status(202).json({ success: false, message: 'Recording is still being processed. Please try again shortly.' });
    }

    if (zoomRecording.status === 'failed') {
      return res.status(500).json({ success: false, message: 'Recording processing failed. Please contact support.' });
    }

    // 2. Authorisation check for students — batch-based + published only, or approved grant
    if (!isClassRecordingStaff(role)) {
      const [meetingLink, student] = await Promise.all([
        MeetingLink.findById(meetingLinkId).select('batch courseDay').lean(),
        User.findById(userId).select('batch level goStatus subscription currentCourseDay').lean(),
      ]);
      if (!student) return res.status(404).json({ success: false, message: 'Student not found.' });
      if (!meetingLink) {
        return res.status(404).json({ success: false, message: 'Class not found.' });
      }
      const journeyAccess = await getJourneyAccessForStudent({ ...student, role: 'STUDENT' });
      if (!journeyAccess.enabled) {
        return res.status(403).json({
          success: false,
          message: 'Journey content is not enabled for your batch yet.',
        });
      }
      student.journeyAccessEnabled = journeyAccess.enabled;
      const granted = await hasApprovedGrant(userId, meetingLinkId);
      if (!granted && !canUserAccessZoomRecording(zoomRecording, meetingLink, student)) {
        return res.status(403).json({
          success: false,
          message: 'This recording is not available for your profile.',
        });
      }
    }

    // 3. For HLS recordings — no MP4 presigned URL needed; client uses /hls/playlist endpoint.
    //    For legacy MP4 recordings (hlsKey absent, r2Key present) — generate presigned URL.
    const hlsMode = !!zoomRecording.hlsKey;
    let signedUrl = null;

    if (!hlsMode && zoomRecording.r2Key) {
      const command = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: zoomRecording.r2Key,
      });
      signedUrl = await getSignedUrl(r2Client, command, { expiresIn: SIGNED_URL_EXPIRY_SECONDS });
    }

    if (!hlsMode && !signedUrl) {
      return res.status(500).json({
        success: false,
        message: 'Recording is missing both hlsKey and r2Key.',
      });
    }

    res.json({
      success: true,
      hlsMode,                                  // true → use /hls/playlist endpoint
      signedUrl,                                // null for HLS recordings; MP4 URL for legacy
      duration: zoomRecording.duration,
      createdAt: zoomRecording.createdAt,
      isPublished: zoomRecording.isPublished !== false,
      r2Key: zoomRecording.r2Key,
    });
  } catch (error) {
    console.error('Error generating recording signed URL:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/class-recordings/zoom/:meetingLinkId/status
 * Returns processing status without generating a signed URL.
 * Useful for polling from the frontend while a recording is being processed.
 */
router.get('/zoom/:meetingLinkId/status', verifyToken, async (req, res) => {
  try {
    const { meetingLinkId } = req.params;

    const zoomRecording = await ZoomRecording.findOne({ meetingLinkId })
      .select('status duration createdAt errorMessage').lean();

    if (!zoomRecording) {
      return res.status(404).json({ success: false, message: 'No recording found.' });
    }

    res.json({ success: true, status: zoomRecording.status, duration: zoomRecording.duration, createdAt: zoomRecording.createdAt });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
