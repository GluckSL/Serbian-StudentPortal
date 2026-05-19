/**
 * Journey day advance at local midnight (cron):
 * - Non-strict batches: every student’s journey day increments by 1 (capped at 200).
 * - Strict batches: increments only if the student completed enough of that day’s tasks
 *   (modules + exercises + live classes) per BatchConfig.strictJourneyThresholdPercent.
 * pendingJourneyDayAdvance is still written on live attendance for UI; rollover clears it when advancing.
 */

const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');
const BatchConfig = require('../models/BatchConfig');
const { allStudentBatchStringsForContent, batchesAlign } = require('../utils/effectiveStudentBatch');
const {
  computeJourneyDayCompletion,
  meetsStrictThreshold
} = require('./journeyDayCompletion.service');

/**
 * Check if a Silver GO student has completed all tasks for their current journey day
 * and, if so, instantly advance them to the next day without waiting for midnight.
 *
 * Safe to call from any completion endpoint (exercise submit, DG session complete,
 * module complete, recording watch). No-ops for non-Silver-GO students.
 *
 * @param {string|import('mongoose').Types.ObjectId} studentId
 * @returns {Promise<{ advanced: boolean, previousDay?: number, newDay?: number }>}
 */
async function checkAndInstantlyAdvanceSilverGoStudent(studentId) {
  const student = await User.findById(studentId)
    .select('role batch goStatus subscription level currentCourseDay')
    .lean();
  if (!student || student.role !== 'STUDENT') return { advanced: false };
  if (!isSilverGoStudent(student)) return { advanced: false };

  const keys = allStudentBatchStringsForContent(student);
  if (!keys.length) return { advanced: false };

  const currentDay = normalizeCourseDay(student.currentCourseDay);
  if (currentDay >= 200) return { advanced: false };

  const completion = await computeJourneyDayCompletion(studentId, keys, currentDay, {
    includeRecordings: true,
    includeDg: true,
    includeLearningModules: false,
    studentLevel: student.level,
    studentPlan: student.subscription,
    goStatus: student.goStatus,
    subscription: student.subscription
  });

  if (!completion.complete) return { advanced: false };

  const nextDay = Math.min(200, currentDay + 1);
  const result = await User.updateOne(
    { _id: studentId, role: 'STUDENT', currentCourseDay: currentDay },
    {
      $set: {
        currentCourseDay: nextDay,
        pendingJourneyDayAdvance: false,
        pendingJourneyDayAdvanceForDay: null
      }
    }
  );

  if (result.modifiedCount) {
    console.log(`🚀 [Instant Advance] Silver GO student ${studentId}: Day ${currentDay} → ${nextDay}`);
    return { advanced: true, previousDay: currentDay, newDay: nextDay };
  }
  return { advanced: false };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeCourseDay(d) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(200, Math.max(1, n));
}

function isSilverGoStudent(student) {
  return String(student?.goStatus || '').toUpperCase() === 'GO' &&
    String(student?.subscription || '').toUpperCase() === 'SILVER';
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
    .select('role batch goStatus subscription currentCourseDay pendingJourneyDayAdvance')
    .lean();
  if (!student || student.role !== 'STUDENT') return;
  const keys = allStudentBatchStringsForContent(student);
  if (!keys.length || !keys.some((k) => batchesAlign(k, meetingBatch))) return;
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
 * Mark a student as pending day-advance for the provided batch/day gate.
 * Useful when completion comes from recordings, not just live attendance.
 */
async function markPendingAdvanceForStudentDay(studentId, batchName, courseDay) {
  if (!studentId || !batchName || courseDay == null || !Number.isFinite(Number(courseDay))) return;
  await tryMarkStudentPending(String(studentId), String(batchName), normalizeCourseDay(courseDay));
}

/**
 * Ensure pending flag matches Zoom attendance (e.g. after page load / delayed sync).
 * Only when at least one live class exists for this batch + day (otherwise no class gate).
 */
async function recomputePendingForStudent(studentId) {
  const student = await User.findById(studentId)
    .select('role batch goStatus subscription currentCourseDay pendingJourneyDayAdvance')
    .lean();
  if (!student || student.role !== 'STUDENT') return;
  const keys = allStudentBatchStringsForContent(student);
  if (!keys.length) return;
  const currentDay = normalizeCourseDay(student.currentCourseDay);
  const batchOr = keys.map((k) => ({
    batch: new RegExp(`^${String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  }));
  const meetings = await MeetingLink.find({
    $or: batchOr,
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
 * At configured local midnight: advance each student based on batch strict rule.
 * Clears stale pending flags when not advancing.
 */
async function applyJourneyDayRollovers() {
  const students = await User.find({ role: 'STUDENT' })
    .select('batch goStatus subscription level currentCourseDay pendingJourneyDayAdvance pendingJourneyDayAdvanceForDay')
    .lean();

  const configCache = new Map();
  async function batchConfigForStudent(student) {
    const keys = allStudentBatchStringsForContent(student);
    const primary = keys.includes('GO-SILVER') ? 'GO-SILVER' : keys[0];
    if (!primary) return null;
    if (configCache.has(primary)) return configCache.get(primary);
    const doc = await BatchConfig.findOne({
      batchName: new RegExp(`^${escapeRegExp(primary)}$`, 'i')
    }).lean();
    const cfg = doc || {
      batchName: primary,
      journeyLength: 200,
      strictJourneyRule: false,
      strictJourneyThresholdPercent: 100
    };
    configCache.set(primary, cfg);
    return cfg;
  }

  let advanced = 0;
  let clearedPending = 0;
  let heldStrict = 0;

  for (const s of students) {
    const cfg = await batchConfigForStudent(s);
    const cur = normalizeCourseDay(s.currentCourseDay);
    const maxDay = cfg?.journeyLength != null ? Math.min(200, Math.max(1, cfg.journeyLength)) : 200;

    if (!cfg || cur >= maxDay) {
      if (s.pendingJourneyDayAdvance) {
        await User.updateOne(
          { _id: s._id },
          { $set: { pendingJourneyDayAdvance: false, pendingJourneyDayAdvanceForDay: null } }
        );
        clearedPending++;
      }
      continue;
    }

    const forDay =
      s.pendingJourneyDayAdvanceForDay != null ? normalizeCourseDay(s.pendingJourneyDayAdvanceForDay) : null;
    if (forDay != null && forDay !== cur) {
      await User.updateOne(
        { _id: s._id },
        { $set: { pendingJourneyDayAdvance: false, pendingJourneyDayAdvanceForDay: null } }
      );
      clearedPending++;
    }

    const silverGoStrict = isSilverGoStudent(s);
    const strictForStudent = !!cfg.strictJourneyRule || silverGoStrict;
    let shouldAdvance = false;
    if (!strictForStudent) {
      shouldAdvance = true;
    } else {
      const keys = allStudentBatchStringsForContent(s);
      const completion = await computeJourneyDayCompletion(s._id, keys, cur, {
        includeRecordings: isSilverGoStudent(s),
        includeDg: isSilverGoStudent(s),
        includeLearningModules: !isSilverGoStudent(s),
        studentLevel: s.level,
        studentPlan: s.subscription,
        goStatus: s.goStatus,
        subscription: s.subscription
      });
      shouldAdvance = silverGoStrict
        ? !!completion.complete
        : meetsStrictThreshold(completion, cfg);
    }

    if (!shouldAdvance) {
      if (s.pendingJourneyDayAdvance) {
        await User.updateOne(
          { _id: s._id },
          { $set: { pendingJourneyDayAdvance: false, pendingJourneyDayAdvanceForDay: null } }
        );
        clearedPending++;
      }
      heldStrict++;
      continue;
    }

    const next = Math.min(maxDay, cur + 1);
    if (next === cur) continue;

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

  if (advanced || clearedPending || heldStrict) {
    console.log(
      `📅 [Journey rollover] Advanced ${advanced} student(s); held (strict) ${heldStrict}; cleared pending ${clearedPending}.`
    );
  }
}

module.exports = {
  syncPendingFlagsFromMeeting,
  recomputePendingForStudent,
  applyJourneyDayRollovers,
  normalizeCourseDay,
  markPendingAdvanceForStudentDay,
  checkAndInstantlyAdvanceSilverGoStudent
};
