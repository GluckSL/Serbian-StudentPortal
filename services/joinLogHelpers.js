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

module.exports = { getJoinLogDataForMeeting, getFirstJoinAtByStudentMap };
