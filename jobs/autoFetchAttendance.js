/**
 * Auto-fetch Zoom attendance 15 minutes after meeting ends.
 * Runs every 5 minutes via node-cron.
 */
const cron = require('node-cron');
const mongoose = require('mongoose');
const MeetingLink = require('../models/MeetingLink');
const zoomService = require('../services/zoomService');
const { syncPendingFlagsFromMeeting } = require('../services/journeyDayAdvance.service');
const { findBestParticipantMatch } = require('../services/zoomParticipantMatch');
const { getJoinLogDataForMeeting } = require('../services/joinLogHelpers');
const { buildAttendanceRowFromMatch, logAttendanceMatchSummary } = require('../services/attendanceMatchHelpers');
const { applyAttendanceStabilityPass } = require('../services/attendanceMatchingSafeguards');

async function fetchAttendanceForMeeting(meeting) {
  try {
    const zoomReport = await zoomService.getMeetingReport(meeting.zoomMeetingId);

    const joinData = await getJoinLogDataForMeeting(meeting._id);
    const joinLogMap = joinData.firstJoinByStudent;
    const joinPresence = joinData.hasJoin;

    const zoomParts = zoomReport.participants || [];
    for (const p of zoomParts) {
      delete p._matched;
      delete p._reserved;
      delete p._priority;
      delete p._matchedByStudent;
    }
    delete zoomParts[Symbol.for('gluck.attendanceClaimMap')];
    delete zoomParts[Symbol.for('gluck.attendanceTraceId')];
    const traceId = new mongoose.Types.ObjectId();
    const claimedParticipants = new Map();

    const attendanceData = meeting.attendees.map((attendee) => {
      const sid = attendee.studentId && attendee.studentId.toString();
      const joinLogJoinedAt = sid ? joinLogMap.get(sid) : undefined;
      const clickedJoin = sid ? joinPresence.has(sid) : false;
      const matchResult = findBestParticipantMatch(attendee, zoomReport.participants, {
        joinLogJoinedAt,
        logContext: { meetingId: meeting._id, studentId: sid },
        meetingDurationSec: (meeting.duration || 60) * 60,
        traceId,
        claimedParticipants,
      });
      return buildAttendanceRowFromMatch(attendee, matchResult, {
        meetingDurationMinutes: meeting.duration || 60,
        clickedJoin,
        traceId,
      });
    });

    applyAttendanceStabilityPass(attendanceData, traceId);

    meeting.attendance = attendanceData;
    meeting.attendanceRecorded = true;
    meeting.attendanceRecordedAt = new Date();
    await meeting.save();

    logAttendanceMatchSummary(attendanceData, meeting._id, traceId);

    try {
      await syncPendingFlagsFromMeeting(meeting);
    } catch (e) {
      console.warn('  ⚠️ journey pending sync:', e.message);
    }

    const attended = attendanceData.filter(a => a.attended).length;
    console.log(`  ✅ ${meeting.topic} — ${attended}/${attendanceData.length} attended`);
    return true;
  } catch (err) {
    // Track retry attempts — stop after 3 failures
    const retries = (meeting.attendanceRetries || 0) + 1;
    meeting.attendanceRetries = retries;

    if (retries >= 3) {
      meeting.attendanceRecorded = true; // Mark as done so we stop retrying
      meeting.attendanceError = err.message;
      console.error(`  ❌ ${meeting.topic} — Giving up after ${retries} attempts: ${err.message}`);
    } else {
      console.error(`  ❌ ${meeting.topic} — Attempt ${retries}/3 failed: ${err.message}`);
    }

    await meeting.save();
    return false;
  }
}

async function autoFetchAttendance() {
  const now = new Date();
  const fifteenMinAgo = new Date(now.getTime() - 15 * 60 * 1000);

  // Find meetings that:
  // 1. Have a startTime set
  // 2. Their end time (startTime + duration) is before 15 min ago
  // 3. Attendance not yet recorded
  // 4. Have attendees
  const meetings = await MeetingLink.find({
    startTime: { $exists: true, $ne: null },
    attendanceRecorded: { $ne: true },
    'attendees.0': { $exists: true }
  }).lean();

  // Filter in JS: endTime <= fifteenMinAgo
  const eligible = meetings.filter(m => {
    const endTime = new Date(m.startTime.getTime() + (m.duration || 60) * 60000);
    return endTime <= fifteenMinAgo;
  });

  if (eligible.length === 0) return;

  console.log(`\n📋 [Auto-Attendance] Found ${eligible.length} meeting(s) to process...`);

  for (const meetingData of eligible) {
    // Re-fetch as a Mongoose document so we can save
    const meeting = await MeetingLink.findById(meetingData._id);
    if (!meeting || meeting.attendanceRecorded) continue;
    await fetchAttendanceForMeeting(meeting);
  }

  console.log('📋 [Auto-Attendance] Done.\n');
}

function scheduleAutoFetchAttendance() {
  // Run every 5 minutes
  cron.schedule('*/5 * * * *', () => {
    autoFetchAttendance().catch(err => {
      console.error('❌ [Auto-Attendance] Job error:', err.message);
    });
  });
  console.log('⏰ Auto-attendance fetch scheduled (every 5 min, 15 min after meeting end)');
}

module.exports = { scheduleAutoFetchAttendance };
