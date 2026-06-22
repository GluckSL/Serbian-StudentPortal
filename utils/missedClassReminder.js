const MeetingLink = require('../models/MeetingLink');
const { allStudentBatchStringsForContent } = require('./effectiveStudentBatch');
const { isContentBlockedForStudent } = require('./journeyContentBlock');

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d = new Date()) {
  const x = startOfLocalDay(d);
  x.setDate(x.getDate() + 1);
  return x;
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function studentAttendanceFromMeeting(meeting, studentId, studentEmail) {
  const sid = studentId ? String(studentId) : '';
  const em = studentEmail ? String(studentEmail).toLowerCase().trim() : '';
  let row = (meeting.attendance || []).find((a) => a && sid && String(a.studentId || '') === sid);
  if (!row && em) {
    row = (meeting.attendance || []).find(
      (a) => a && a.email && String(a.email).toLowerCase().trim() === em
    );
  }
  if (!row) {
    return { attended: false, durationMinutes: 0 };
  }
  let mins = row.durationMinutes;
  if (mins == null && row.duration != null && Number.isFinite(Number(row.duration))) {
    mins = Math.round(Number(row.duration) / 60);
  }
  mins = Number.isFinite(Number(mins)) ? Math.max(0, Number(mins)) : 0;
  const attended =
    row.attended === true || row.status === 'attended' || row.status === 'late';
  return { attended, durationMinutes: mins };
}

function isMeetingMissed(meeting, studentId, studentEmail) {
  const now = new Date();
  const meetingStart = new Date(meeting.startTime);
  const durationMin = Number(meeting.duration) || 60;
  const meetingEnd = new Date(meetingStart.getTime() + durationMin * 60000);
  const hasEnded =
    meeting.status === 'ended' || (meeting.status !== 'cancelled' && now > meetingEnd);
  if (!hasEnded) return false;

  const att = studentAttendanceFromMeeting(meeting, studentId, studentEmail);
  if (att.attended) return false;

  const pct = durationMin > 0 ? (att.durationMinutes / durationMin) * 100 : 0;
  if (pct >= 75) return false;
  if (pct > 0) return false;

  return true;
}

/**
 * Returns true when the student fully missed at least one ended class scheduled today.
 */
async function studentMissedClassToday(student) {
  if (!student || student.role !== 'STUDENT') return false;

  const batchKeys = allStudentBatchStringsForContent(student);
  if (!batchKeys.length) return false;

  const batchOr = batchKeys.map((k) => ({
    batch: new RegExp(`^${escapeRegExp(k)}$`, 'i'),
  }));

  const dayStart = startOfLocalDay();
  const dayEnd = endOfLocalDay();

  const meetings = await MeetingLink.find({
    $and: [
      { plan: { $in: [student.subscription, 'ALL'] } },
      { $or: batchOr },
      { status: { $ne: 'cancelled' } },
      { startTime: { $gte: dayStart, $lt: dayEnd } },
    ],
  })
    .select('startTime duration status courseDay attendance plan batch')
    .lean();

  const studentId = student._id;
  const studentEmail = student.email;

  for (const meeting of meetings) {
    if (isContentBlockedForStudent(student, { courseDay: meeting.courseDay, level: student.level })) {
      continue;
    }
    if (isMeetingMissed(meeting, studentId, studentEmail)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  studentMissedClassToday,
  isMeetingMissed,
  studentAttendanceFromMeeting,
};
