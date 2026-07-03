// routes/joinClass.js — authenticated student join → JoinLog + Zoom app-first URL with web fallback

const express = require('express');
const mongoose = require('mongoose');
const { verifyToken } = require('../middleware/auth');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const JoinLog = require('../models/JoinLog');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');
const { sanitizeDisplayName, DISPLAY_NAME_MAX } = require('../utils/studentDisplayName');
const {
  buildZoomAppUrl,
  buildZoomUniversalUrl,
  buildZoomWebUrl,
  resolveMeetingJoinPwd,
} = require('../utils/zoomJoinUrls');
const { ensureZoomMeetingLive } = require('../services/zoomMeetingLifecycle.service');

const router = express.Router();

// Re-verify a Zoom link at most once per this window on join (avoids hammering
// the Zoom API when a whole class clicks "Join" within a few seconds).
const JOIN_ZOOM_CHECK_THROTTLE_MS = 3 * 60 * 1000;

/** SPA sends Bearer token; return JSON so Angular can open Zoom (top-level navigation cannot send Authorization). */
function wantsJoinClassJsonResponse(req) {
  const accept = (req.get('accept') || '').toLowerCase();
  if (accept.includes('application/json')) return true;
  const xrw = (req.get('x-requested-with') || '').toLowerCase();
  return xrw === 'xmlhttprequest';
}

function normalizeZoomNumericId(zoomMeetingId) {
  return String(zoomMeetingId || '').replace(/\D/g, '');
}

/**
 * Same access rules as GET /api/zoom/student-meetings join eligibility.
 */
function studentMayJoinMeeting(student, meeting) {
  const batchKeys = allStudentBatchStringsForContent(student);
  if (!batchKeys.length) return { ok: false, reason: 'No batch on account' };

  const planOk = meeting.plan === 'ALL' || meeting.plan === student.subscription;
  if (!planOk) return { ok: false, reason: 'Plan not allowed for this class' };

  const batchMatch = batchKeys.some((k) => {
    const re = new RegExp(`^${String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    return re.test(String(meeting.batch || ''));
  });
  if (!batchMatch) return { ok: false, reason: 'Batch does not match this class' };

  const studentDay =
    student.currentCourseDay != null && Number.isFinite(Number(student.currentCourseDay))
      ? Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay))))
      : 1;

  const rawCd = meeting.courseDay;
  if (rawCd != null && Number.isFinite(Number(rawCd)) && Number(rawCd) > studentDay) {
    return { ok: false, reason: 'This class is not unlocked on your journey day yet' };
  }

  const now = new Date();
  const meetingStart = new Date(meeting.startTime);
  const meetingEnd = new Date(meetingStart.getTime() + (meeting.duration || 60) * 60000);

  let currentStatus = meeting.status;
  if (now >= meetingStart && now <= meetingEnd && meeting.status === 'scheduled') {
    currentStatus = 'ongoing';
  } else if (now > meetingEnd) {
    currentStatus = 'ended';
  }

  if (currentStatus === 'ended') {
    return { ok: false, reason: 'Meeting has ended' };
  }

  const canJoinWindow =
    currentStatus === 'ongoing' ||
    (currentStatus !== 'ended' && now >= new Date(meetingStart.getTime() - 10 * 60000));

  if (!canJoinWindow) {
    return { ok: false, reason: 'Join is only available from 10 minutes before start until the class ends' };
  }

  return { ok: true };
}

/**
 * GET /api/join-class/:meetingId
 * Redirects to Zoom web client with `uname` pre-filled from the User record (not the JWT).
 */
router.get('/join-class/:meetingId', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'STUDENT') {
      return res.status(403).json({ success: false, message: 'Only students can use this join link.' });
    }

    const { meetingId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ success: false, message: 'Invalid meeting id' });
    }

    const meeting = await MeetingLink.findById(meetingId);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    const student = await User.findById(req.user.id).select(
      'name email role batch subscription currentCourseDay goStatus'
    );
    if (!student || student.role !== 'STUDENT') {
      return res.status(403).json({ success: false, message: 'Student profile not found' });
    }

    const access = studentMayJoinMeeting(student, meeting);
    if (!access.ok) {
      return res.status(403).json({ success: false, message: access.reason });
    }

    // Auto-heal: if the Zoom meeting has expired / been deleted on Zoom's side,
    // regenerate it now so the student never sees "Invalid meeting ID".
    // Throttled + best-effort: a transient Zoom error must not block the join.
    try {
      await ensureZoomMeetingLive(meeting, { throttleMs: JOIN_ZOOM_CHECK_THROTTLE_MS });
    } catch (healErr) {
      console.warn('join-class link check failed (continuing):', healErr.message);
    }

    const zoomId = normalizeZoomNumericId(meeting.zoomMeetingId);
    if (!zoomId) {
      return res.status(400).json({ success: false, message: 'Meeting has no Zoom meeting id' });
    }

    const rawName = String(student.name || req.user.name || 'Student');
    const displayName = sanitizeDisplayName(rawName, DISPLAY_NAME_MAX);

    const now = new Date();

    const ua = req.get('user-agent') || '';
    const clientIp = req.get('x-forwarded-for')?.split(',')[0]?.trim() || req.ip || 'unknown';
    const isMobileDevice = /Android|iPhone|iPad/i.test(ua);
    const browser = /WhatsApp/i.test(ua) ? 'WhatsApp'
      : /Instagram/i.test(ua) ? 'Instagram'
      : /FBAN|FBAV/i.test(ua) ? 'Facebook'
      : /Telegram/i.test(ua) ? 'Telegram'
      : 'other';

    // Check for recent join (reconnect detection) BEFORE upsert so we have the old timestamp.
    const prevLog = await JoinLog.findOne({ meetingId: meeting._id, studentId: student._id })
      .select('lastJoinedAt joinCount')
      .lean();

    const TWO_MIN_MS = 2 * 60 * 1000;
    const isReconnect = !!(
      prevLog &&
      prevLog.lastJoinedAt &&
      now.getTime() - new Date(prevLog.lastJoinedAt).getTime() < TWO_MIN_MS
    );

    console.log('JOIN_CLICK', {
      studentId: String(student._id),
      meetingId: String(meeting._id),
      displayName,
      ip: clientIp,
      ua: ua.slice(0, 120),
      deviceType: isMobileDevice ? 'mobile' : 'desktop',
      browser,
      isReconnect,
      ts: now.toISOString(),
    });

    if (isReconnect) {
      console.warn('JOIN_RECONNECT', {
        studentId: String(student._id),
        meetingId: String(meeting._id),
        ip: clientIp,
        ua: ua.slice(0, 120),
        prevJoinAt: prevLog.lastJoinedAt,
        gapMs: now.getTime() - new Date(prevLog.lastJoinedAt).getTime(),
        totalJoinCount: (prevLog.joinCount || 0) + 1,
        ts: now.toISOString(),
      });
    }

    await JoinLog.findOneAndUpdate(
      { meetingId: meeting._id, studentId: student._id },
      {
        $set: { lastJoinedAt: now, lastZoomDisplayName: displayName },
        $inc: { joinCount: 1 },
        $setOnInsert: {
          joinedAt: now,
          meetingId: meeting._id,
          studentId: student._id,
        },
      },
      { upsert: true, new: true }
    );

    const pwd = resolveMeetingJoinPwd(meeting);
    const zoomAppUrl = buildZoomAppUrl(zoomId, pwd, displayName);
    const zoomUniversalUrl = buildZoomUniversalUrl(zoomId, pwd, displayName);
    const zoomWebUrl = buildZoomWebUrl(zoomId, pwd, displayName);

    if (wantsJoinClassJsonResponse(req)) {
      // Prefer universal (opens Zoom app); redirectUrl kept for older clients.
      return res.json({
        success: true,
        displayName,
        zoomAppUrl,
        zoomUniversalUrl,
        zoomWebUrl,
        redirectUrl: zoomUniversalUrl,
      });
    }
    return res.redirect(302, zoomUniversalUrl);
  } catch (err) {
    console.error('join-class error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to start join' });
  }
});

module.exports = router;
