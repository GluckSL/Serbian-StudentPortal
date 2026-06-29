/**
 * Journey day advance at local midnight (cron):
 * - Non-strict batches: every student’s journey day increments by 1 (capped at 200).
 * - Strict batches: increments only if the student completed enough of that day’s tasks
 *   (modules + exercises + live classes) per BatchConfig.strictJourneyThresholdPercent.
 * pendingJourneyDayAdvance is written on live attendance for Silver students only (midnight UI).
 * Platinum students advance immediately when live attendance is recorded.
 */

const User = require('../models/User');
const SilverGoUnlockCache = require('../models/SilverGoUnlockCache');
const MeetingLink = require('../models/MeetingLink');
const BatchConfig = require('../models/BatchConfig');
const { allStudentBatchStringsForContent, batchesAlign } = require('../utils/effectiveStudentBatch');
const {
  computeJourneyDayCompletion,
  meetsStrictThreshold
} = require('./journeyDayCompletion.service');
const { withJourneyLevelInSet } = require('./journeyLevelSync.service');
const { shouldSkipStudentRollover } = require('../utils/journeyPause');
const {
  silverGoCompletionOptions,
  allPriorJourneyDaysComplete
} = require('../utils/silverGoSequentialUnlock');
const { SILVER_GO_STUDENT_SELECT } = require('../utils/goSilverTrack');
const { isLearningEnabled } = require('../utils/batchType');

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
    .select(SILVER_GO_STUDENT_SELECT)
    .lean();
  if (!student || student.role !== 'STUDENT') return { advanced: false };
  if (!isSilverGoStudent(student)) return { advanced: false };

  const keys = allStudentBatchStringsForContent(student);
  if (!keys.length) return { advanced: false };

  const currentDay = normalizeCourseDay(student.currentCourseDay);
  if (currentDay >= 200) return { advanced: false };

  const priorOk = await allPriorJourneyDaysComplete(studentId, student, currentDay);
  if (!priorOk) return { advanced: false };

  const completion = await computeJourneyDayCompletion(
    studentId,
    keys,
    currentDay,
    silverGoCompletionOptions(student)
  );

  if (!completion.complete) return { advanced: false };

  const nextDay = Math.min(200, currentDay + 1);
  const result = await User.updateOne(
    { _id: studentId, role: 'STUDENT', currentCourseDay: currentDay },
    {
      $set: withJourneyLevelInSet(
        nextDay,
        {
          currentCourseDay: nextDay,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        },
        { student }
      )
    }
  );

  if (result.modifiedCount) {
    await SilverGoUnlockCache.deleteOne({ studentId });
    console.log(`🚀 [Instant Advance] Silver GO student ${studentId}: Day ${currentDay} → ${nextDay}`);
    return { advanced: true, previousDay: currentDay, newDay: nextDay };
  }
  return { advanced: false };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const { clampJourneyDayForBatch, clampStandardJourneyDay, computeJourneyDayFromBatchConfig } = require('../utils/journeyDay');

function normalizeCourseDay(d, trialDayEnabled = false) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n)) return trialDayEnabled ? 0 : 1;
  return clampJourneyDayForBatch(n, 200, trialDayEnabled);
}

function isSilverGoStudent(student) {
  return String(student?.goStatus || '').toUpperCase() === 'GO' &&
    String(student?.subscription || '').toUpperCase() === 'SILVER';
}

function isSilverSubscriptionStudent(student) {
  return String(student?.subscription || '').toUpperCase() === 'SILVER';
}

/**
 * Platinum (non-Silver-GO) students: advance immediately after live class attendance.
 * Respects batch strictJourneyRule when enabled (live class credited toward threshold).
 */
async function checkAndInstantlyAdvancePlatinumStudent(studentId, meetingBatch, meetingCourseDay, meetingDoc = null) {
  const student = await User.findById(studentId)
    .select(SILVER_GO_STUDENT_SELECT)
    .lean();
  if (!student || student.role !== 'STUDENT') return { advanced: false };
  if (isSilverSubscriptionStudent(student)) return { advanced: false };

  const keys = allStudentBatchStringsForContent(student);
  if (!keys.length || !keys.some((k) => batchesAlign(k, meetingBatch))) return { advanced: false };

  const currentDay = normalizeCourseDay(student.currentCourseDay);
  if (meetingCourseDay !== currentDay) return { advanced: false };
  if (currentDay >= 200) return { advanced: false };

  const { primaryGoBatchFromKeys } = require('../utils/goSilverTrack');
  const primary = primaryGoBatchFromKeys(keys) || keys[0];
  const cfgDoc = primary
    ? await BatchConfig.findOne({ batchName: new RegExp(`^${escapeRegExp(primary)}$`, 'i') }).lean()
    : null;

  let allowAdvance = true;
  if (cfgDoc && cfgDoc.strictJourneyRule) {
    const meetingId = meetingDoc?._id;
    const comp = await computeJourneyDayCompletion(studentId, keys, currentDay, {
      creditMeetings: meetingId ? [meetingId] : []
    });
    allowAdvance = meetsStrictThreshold(comp, cfgDoc);
  }

  if (!allowAdvance) return { advanced: false };

  const nextDay = Math.min(200, currentDay + 1);
  const result = await User.updateOne(
    { _id: studentId, role: 'STUDENT', currentCourseDay: currentDay },
    {
      $set: withJourneyLevelInSet(
        nextDay,
        {
          currentCourseDay: nextDay,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        },
        { student }
      )
    }
  );

  if (result.modifiedCount) {
    console.log(`🚀 [Instant Advance] Platinum student ${studentId}: Day ${currentDay} → ${nextDay}`);
    return { advanced: true, previousDay: currentDay, newDay: nextDay };
  }
  return { advanced: false };
}

/**
 * After attendance is saved on a meeting, advance Platinum students immediately;
 * mark Silver students pending for midnight rollover UI.
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
    const studentId = String(att.studentId);
    const adv = await checkAndInstantlyAdvancePlatinumStudent(studentId, batch, day, meetingDoc);
    if (adv.advanced) continue;
    await tryMarkStudentPending(studentId, batch, day);
  }
}

async function tryMarkStudentPending(studentId, meetingBatch, meetingCourseDay) {
  const student = await User.findById(studentId)
    .select(SILVER_GO_STUDENT_SELECT)
    .lean();
  if (!student || student.role !== 'STUDENT') return;
  if (!isSilverSubscriptionStudent(student)) return;
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
 * Catch-up for Platinum students: advance if live attendance was recorded while offline.
 */
async function reconcilePlatinumAdvanceFromAttendance(studentId) {
  const student = await User.findById(studentId)
    .select(SILVER_GO_STUDENT_SELECT)
    .lean();
  if (!student || student.role !== 'STUDENT') return;
  if (isSilverSubscriptionStudent(student)) return;

  if (student.pendingJourneyDayAdvance) {
    await User.updateOne(
      { _id: studentId },
      { $set: { pendingJourneyDayAdvance: false, pendingJourneyDayAdvanceForDay: null } }
    );
  }

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
    .select('batch attendance')
    .lean();

  for (const meeting of meetings) {
    const attended = (meeting.attendance || []).some(
      (a) => String(a.studentId) === String(studentId) && a.attended === true
    );
    if (!attended) continue;
    const adv = await checkAndInstantlyAdvancePlatinumStudent(
      studentId,
      meeting.batch,
      currentDay,
      meeting
    );
    if (adv.advanced) return;
  }
}

/**
 * Ensure pending flag matches Zoom attendance (e.g. after page load / delayed sync).
 * Only when at least one live class exists for this batch + day (otherwise no class gate).
 * Silver students only.
 */
async function recomputePendingForStudent(studentId) {
  const student = await User.findById(studentId)
    .select(SILVER_GO_STUDENT_SELECT)
    .lean();
  if (!student || student.role !== 'STUDENT') return;
  if (!isSilverSubscriptionStudent(student)) return;
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
    .select(SILVER_GO_STUDENT_SELECT)
    .lean();

  // Compute "today" in the rollover timezone so batchStartDate calendar-day calculations
  // use the IST date (not UTC, which is still the previous day at midnight IST).
  const ROLLOVER_TZ = process.env.JOURNEY_ROLLOVER_TZ || 'Asia/Colombo';
  const todayStrInTz = new Date().toLocaleDateString('en-CA', { timeZone: ROLLOVER_TZ }); // "YYYY-MM-DD"
  const rolloverNow = new Date(todayStrInTz + 'T00:00:00Z');

  const configCache = new Map();
  async function batchConfigForStudent(student) {
    const keys = allStudentBatchStringsForContent(student);
    const { primaryGoBatchFromKeys } = require('../utils/goSilverTrack');
    const primary = primaryGoBatchFromKeys(keys) || keys[0];
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
  let skippedNoConfig = 0;

  for (const s of students) {
    try {
      const cfg = await batchConfigForStudent(s);
      if (shouldSkipStudentRollover(cfg)) {
        continue;
      }
      if (!cfg) {
        skippedNoConfig++;
        if (!s.batch) {
          console.warn(`⚠️ [Journey rollover] Student ${s._id} (${s.name || 'unknown'}) has no batch field — skipping rollover. Set a batch on this student or assign them to an active batch config.`);
        }
        if (s.pendingJourneyDayAdvance) {
          await User.updateOne(
            { _id: s._id },
            { $set: { pendingJourneyDayAdvance: false, pendingJourneyDayAdvanceForDay: null } }
          );
          clearedPending++;
        }
        continue;
      }

      const trialEnabled = !!cfg.trialDayEnabled;
      const cur = normalizeCourseDay(s.currentCourseDay, trialEnabled);
      const maxDay = cfg.journeyLength != null ? Math.min(200, Math.max(1, cfg.journeyLength)) : 200;
      // Use rolloverNow (today in rollover TZ as UTC midnight) so the batch calendar day
      // is calculated against the IST date, not UTC (which is still "yesterday" at midnight IST).
      const calendarDay = cfg.batchStartDate ? computeJourneyDayFromBatchConfig(cfg, rolloverNow) : null;

      if (cur >= maxDay) {
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
        const completion = await computeJourneyDayCompletion(
          s._id,
          keys,
          cur,
          silverGoStrict
            ? silverGoCompletionOptions(s)
            : {
                includeRecordings: false,
                includeDg: isLearningEnabled(cfg.batchType),
                batchType: cfg.batchType,
                includeLearningModules: true,
                studentLevel: s.level,
                studentPlan: s.subscription,
                goStatus: s.goStatus,
                subscription: s.subscription
              }
        );
        if (silverGoStrict) {
          const priorOk = await allPriorJourneyDaysComplete(s._id, s, cur);
          shouldAdvance = priorOk && !!completion.complete;
        } else {
          shouldAdvance = meetsStrictThreshold(completion, cfg);
        }
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

      let next;
      if (calendarDay != null && !strictForStudent) {
        if (calendarDay <= cur) continue;
        next = Math.min(maxDay, calendarDay);
      } else if (calendarDay != null && strictForStudent) {
        next = Math.min(maxDay, cur + 1, calendarDay);
        if (next <= cur) continue;
      } else {
        next = Math.min(maxDay, cur + 1);
      }
      if (next === cur) continue;

      await User.updateOne(
        { _id: s._id },
        {
          $set: withJourneyLevelInSet(
            next,
            {
              currentCourseDay: next,
              pendingJourneyDayAdvance: false,
              pendingJourneyDayAdvanceForDay: null
            },
            { student: s }
          )
        }
      );
      await SilverGoUnlockCache.deleteOne({ studentId: s._id });
      advanced++;
    } catch (err) {
      console.error(`⚠️ [Journey rollover] Error processing student ${s._id} (${s.name || 'unknown'}): ${err.message}`);
    }
  }

  console.log(
    `📅 [Journey rollover] Advanced ${advanced}; held (strict) ${heldStrict}; cleared pending ${clearedPending}; skipped (no config) ${skippedNoConfig}.`
  );
}

module.exports = {
  syncPendingFlagsFromMeeting,
  recomputePendingForStudent,
  reconcilePlatinumAdvanceFromAttendance,
  applyJourneyDayRollovers,
  normalizeCourseDay,
  markPendingAdvanceForStudentDay,
  checkAndInstantlyAdvanceSilverGoStudent,
  checkAndInstantlyAdvancePlatinumStudent
};
