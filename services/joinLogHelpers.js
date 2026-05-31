// services/joinLogHelpers.js

const JoinLog = require('../models/JoinLog');

/**
 * @param {import('mongoose').Types.ObjectId|string} meetingObjectId
 * @returns {Promise<{ firstJoinByStudent: Map<string, Date>, hasJoin: Set<string> }>}
 */
async function getJoinLogDataForMeeting(meetingObjectId) {
  const logs = await JoinLog.find({ meetingId: meetingObjectId })
    .select('studentId joinedAt')
    .sort({ joinedAt: 1 })
    .lean();

  const firstJoinByStudent = new Map();
  const hasJoin = new Set();
  for (const row of logs) {
    const sid = row.studentId && row.studentId.toString();
    if (!sid) continue;
    hasJoin.add(sid);
    if (!firstJoinByStudent.has(sid)) {
      firstJoinByStudent.set(sid, row.joinedAt);
    }
  }
  return { firstJoinByStudent: firstJoinByStudent, hasJoin };
}

/** @returns {Promise<Map<string, Date>>} studentId -> first portal join time */
async function getFirstJoinAtByStudentMap(meetingObjectId) {
  const { firstJoinByStudent } = await getJoinLogDataForMeeting(meetingObjectId);
  return firstJoinByStudent;
}

/**
 * Portal "Join class" clicks for attendance UI (informational; not used for Zoom mapping).
 * @param {import('mongoose').Types.ObjectId|string} meetingObjectId
 * @param {object[]} [attendees] - MeetingLink.attendees (name/email lookup)
 */
async function getPortalJoinsForMeeting(meetingObjectId, attendees = []) {
  const logs = await JoinLog.find({ meetingId: meetingObjectId })
    .select('studentId joinedAt lastJoinedAt joinCount lastZoomDisplayName')
    .sort({ joinedAt: 1 })
    .lean();

  const attendeeByStudentId = new Map();
  for (const a of attendees || []) {
    const sid = a.studentId && a.studentId.toString();
    if (sid) attendeeByStudentId.set(sid, a);
  }

  return logs.map((log) => {
    const sid = log.studentId && log.studentId.toString();
    const attendee = sid ? attendeeByStudentId.get(sid) : null;
    return {
      studentId: log.studentId,
      name: attendee?.name || 'Unknown',
      email: attendee?.email || '',
      joinedAt: log.joinedAt,
      lastJoinedAt: log.lastJoinedAt || log.joinedAt,
      joinCount: Number(log.joinCount) || 1,
      zoomDisplayName: log.lastZoomDisplayName || '',
    };
  });
}

module.exports = {
  getJoinLogDataForMeeting,
  getFirstJoinAtByStudentMap,
  getPortalJoinsForMeeting,
};
