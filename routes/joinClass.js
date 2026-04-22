// routes/joinClass.js — authenticated student join → JoinLog + Zoom web client with portal display name

const express = require('express');
const mongoose = require('mongoose');
const { verifyToken } = require('../middleware/auth');
const MeetingLink = require('../models/MeetingLink');
const User = require('../models/User');
const JoinLog = require('../models/JoinLog');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');

const router = express.Router();

const DISPLAY_NAME_MAX = 80;

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

    const zoomId = normalizeZoomNumericId(meeting.zoomMeetingId);
    if (!zoomId) {
      return res.status(400).json({ success: false, message: 'Meeting has no Zoom meeting id' });
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

    let displayName = String(student.name || req.user.name || 'Student').trim();
    if (displayName.length > DISPLAY_NAME_MAX) {
      displayName = displayName.slice(0, DISPLAY_NAME_MAX);
    }

    const now = new Date();
    await JoinLog.findOneAndUpdate(
      { meetingId: meeting._id, studentId: student._id },
      {
        $set: { lastJoinedAt: now },
        $inc: { joinCount: 1 },
        $setOnInsert: {
          joinedAt: now,
          meetingId: meeting._id,
          studentId: student._id,
        },
      },
      { upsert: true, new: true }
    );

    let zoomUrl = `https://zoom.us/wc/${zoomId}/join?uname=${encodeURIComponent(displayName)}`;
    if (meeting.zoomPassword) {
      zoomUrl += `&pwd=${encodeURIComponent(meeting.zoomPassword)}`;
    }

    return res.redirect(302, zoomUrl);
  } catch (err) {
    console.error('join-class error:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to start join' });
  }
});

module.exports = router;
