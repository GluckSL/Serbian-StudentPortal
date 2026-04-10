/**
 * Journey day advance: student must attend the live class for their current journey day.
 * Eligibility is stored as pendingJourneyDayAdvance; currentCourseDay increments at local midnight (cron).
 */

const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');

function normalizeCourseDay(d) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(200, Math.max(1, n));
}

/**
 * After attendance is saved on a meeting, mark students who are on that journey day and attended.
 */
async function syncPendingFlagsFromMeeting(meetingDoc) {
  if (!meetingDoc || meetingDoc.status === 'cancelled') return;
  const courseDay = meetingDoc.courseDay;
  if (courseDay == null || !Number.isFinite(Number(courseDay))) return;
  const batch = meetingDoc.batch;
  if (!batch) return;
  const day = normalizeCourseDay(courseDay);
  const attendance = meetingDoc.attendance || [];
  for (const att of attendance) {
    if (!att.studentId || !att.attended) continue;
    await tryMarkStudentPending(String(att.studentId), batch, day);
  }
}

async function tryMarkStudentPending(studentId, meetingBatch, meetingCourseDay) {
  const student = await User.findById(studentId)
    .select('role batch currentCourseDay pendingJourneyDayAdvance')
    .lean();
  if (!student || student.role !== 'STUDENT') return;
  if (String(student.batch || '') !== String(meetingBatch)) return;
  const currentDay = normalizeCourseDay(student.currentCourseDay);
  if (meetingCourseDay !== currentDay) return;
  if (student.pendingJourneyDayAdvance) return;
  await User.updateOne(
    { _id: studentId },
    {
      $set: {
        pendingJourneyDayAdvance: true,
        pendingJourneyDayAdvanceForDay: currentDay
      }
    }
  );
}

/**
 * Ensure pending flag matches Zoom attendance (e.g. after page load / delayed sync).
 * Only when at least one live class exists for this batch + day (otherwise no class gate).
 */
async function recomputePendingForStudent(studentId) {
  const student = await User.findById(studentId)
    .select('role batch currentCourseDay pendingJourneyDayAdvance')
    .lean();
  if (!student || student.role !== 'STUDENT' || !student.batch) return;
  const currentDay = normalizeCourseDay(student.currentCourseDay);
  const meetings = await MeetingLink.find({
    batch: student.batch,
    courseDay: currentDay,
    status: { $ne: 'cancelled' }
  })
    .select('attendance')
    .lean();
  if (meetings.length === 0) return;
  const attended = meetings.some((m) =>
    (m.attendance || []).some(
      (a) => String(a.studentId) === String(studentId) && a.attended === true
    )
  );
  if (!attended) return;
  if (student.pendingJourneyDayAdvance) return;
  await User.updateOne(
    { _id: studentId },
    {
      $set: {
        pendingJourneyDayAdvance: true,
        pendingJourneyDayAdvanceForDay: currentDay
      }
    }
  );
}

/**
 * At configured local midnight: advance students who have pending eligibility.
 * Clears stale pending if admin changed currentCourseDay away from pendingJourneyDayAdvanceForDay.
 */
async function applyJourneyDayRollovers() {
  const students = await User.find({
    role: 'STUDENT',
    pendingJourneyDayAdvance: true
  })
    .select('currentCourseDay pendingJourneyDayAdvanceForDay')
    .lean();

  let advanced = 0;
  let cleared = 0;

  for (const s of students) {
    const cur = normalizeCourseDay(s.currentCourseDay);
    const forDay = s.pendingJourneyDayAdvanceForDay != null
      ? normalizeCourseDay(s.pendingJourneyDayAdvanceForDay)
      : null;

    if (forDay != null && forDay !== cur) {
      await User.updateOne(
        { _id: s._id },
        {
          $set: {
            pendingJourneyDayAdvance: false,
            pendingJourneyDayAdvanceForDay: null
          }
        }
      );
      cleared++;
      continue;
    }

    const next = Math.min(200, cur + 1);
    await User.updateOne(
      { _id: s._id },
      {
        $set: {
          currentCourseDay: next,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        }
      }
    );
    advanced++;
  }

  if (advanced || cleared) {
    console.log(
      `📅 [Journey rollover] Advanced ${advanced} student(s); cleared stale pending ${cleared}.`
    );
  }
}

module.exports = {
  syncPendingFlagsFromMeeting,
  recomputePendingForStudent,
  applyJourneyDayRollovers,
  normalizeCourseDay
};
