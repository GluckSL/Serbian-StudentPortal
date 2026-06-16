// services/journeyCrossBatchRecordingAccess.service.js
// Self pace journey access logic:
// - Admin maps recordings to journey days.
// - Admin activates batches at the self-pace page.
// - Student unlocks mapped recordings only after attending their own batch class on that day.

const JourneyCrossBatchRecordingRule = require('../models/JourneyCrossBatchRecordingRule');
const MeetingLink = require('../models/MeetingLink');
const ClassRecording = require('../models/ClassRecording');
const ZoomRecording = require('../models/ZoomRecording');
const { allStudentBatchStringsForContent, batchesAlign } = require('../utils/effectiveStudentBatch');
const { isContentBlockedForStudent } = require('../utils/journeyContentBlock');

// ─── Attendance helpers ───────────────────────────────────────────────────────

/**
 * True when a single MeetingLink attendance row counts as "attended".
 * Mirrors the logic in routes/classRecordings.js student-feed (~556–564) and
 * routes/studentProgress.js overview.
 */
function attendanceRowCountsAsAttended(row) {
  if (!row) return false;
  if (row.attended === true) return true;
  if (row.status === 'attended' || row.status === 'late') return true;
  if (Number(row.attendancePercent || 0) >= 75) return true;
  return false;
}

function normalizeRuleTargetBatches(rule) {
  const out = [];
  const seen = new Set();
  const add = (v) => {
    const t = String(v || '').trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  if (Array.isArray(rule?.targetBatches)) {
    for (const b of rule.targetBatches) add(b);
  }
  // Legacy fallback
  add(rule?.studentBatch);
  return out;
}

/**
 * Returns true when `studentId` attended at least one live class meeting
 * belonging to `studentBatch` on `courseDay`.
 *
 * @param {string|ObjectId} studentId
 * @param {string} studentBatch  - e.g. "Batch 36" or "36"
 * @param {number} courseDay     - e.g. 13
 */
async function studentAttendedOwnBatchJourneyDay(studentId, studentBatch, courseDay) {
  if (!studentId || !studentBatch || !courseDay) return false;

  // Fetch all non-cancelled meetings for this batch + day
  const meetings = await MeetingLink.find({
    courseDay: Number(courseDay),
    status: { $ne: 'cancelled' },
  })
    .select('batch attendance')
    .lean();

  const sid = String(studentId);

  for (const m of meetings) {
    if (!batchesAlign(studentBatch, m.batch)) continue;
    const row = Array.isArray(m.attendance)
      ? m.attendance.find((a) => String(a?.studentId || '') === sid)
      : null;
    if (attendanceRowCountsAsAttended(row)) return true;
  }

  return false;
}

// ─── Rule helpers ─────────────────────────────────────────────────────────────

/**
 * Returns active cross-batch rules that apply to this student.
 * Returns an array of { courseDay, sourceBatch } objects.
 */
async function getActiveRulesForStudentBatch(student) {
  const batchKeys = allStudentBatchStringsForContent(student);
  if (!batchKeys.length) return [];

  const allActive = await JourneyCrossBatchRecordingRule.find({ active: true })
    .select('studentBatch targetBatches courseDay mappedManualRecordingIds mappedZoomMeetingLinkIds sourceBatch journeyTitle')
    .lean();

  return allActive.filter((rule) => {
    const targets = normalizeRuleTargetBatches(rule);
    return targets.some((tb) => batchKeys.some((k) => batchesAlign(k, tb)));
  });
}

// ─── Plan helper (mirrors recordingContentAccess.js / classRecordings.js) ────

function allowedRecordingPlansForStudent(student) {
  const sub = String(student?.subscription || '').toUpperCase();
  if (String(student?.goStatus || '') === 'GO' && sub === 'SILVER') {
    return ['SILVER', 'ALL', 'PLATINUM'];
  }
  return [sub, 'ALL'].filter(Boolean);
}

// ─── Per-recording access checks ─────────────────────────────────────────────

/**
 * Returns true if `student` should access a manual ClassRecording via a cross-batch rule.
 * All normal content gates (level, plan, published, active, journeyContentBlock) still apply.
 *
 * @param {object} recording  - lean ClassRecording doc
 * @param {object} student    - lean User doc (needs batch, level, subscription, goStatus, currentCourseDay, blockedJourneyLevels, journeyAccessEnabled)
 * @param {Array}  rules      - pre-loaded rules from getActiveRulesForStudentBatch(student)
 */
async function canAccessManualViaCrossBatch(recording, student, rules) {
  if (!recording?.active) return false;
  if (recording.isPublished === false) return false;
  if (!student) return false;
  if (student.journeyAccessEnabled === false) return false;

  const recCourseDay = recording.courseDay != null ? Number(recording.courseDay) : null;
  if (!recCourseDay) return false;

  // Level + plan gates (same as canUserAccessManualRecording)
  if (recording.level && student.level && recording.level !== student.level) return false;
  const recPlan = String(recording.plan || 'ALL').toUpperCase();
  if (recPlan !== 'ALL') {
    const allowed = allowedRecordingPlansForStudent(student).map((p) => String(p).toUpperCase());
    if (!allowed.includes(recPlan)) return false;
  }

  if (isContentBlockedForStudent(student, { courseDay: recording.courseDay, level: recording.level })) {
    return false;
  }

  const studentBatchKeys = allStudentBatchStringsForContent(student);

  // New behavior: mapped manual recording IDs for this day + target batches
  const matchingRule = rules.find((rule) => {
    if (rule.courseDay !== recCourseDay) return false;
    const targets = normalizeRuleTargetBatches(rule);
    const studentBatchMatches = targets.some((tb) => studentBatchKeys.some((k) => batchesAlign(k, tb)));
    if (!studentBatchMatches) return false;
    const mappedManual = Array.isArray(rule.mappedManualRecordingIds) ? rule.mappedManualRecordingIds : [];
    if (mappedManual.some((id) => String(id) === String(recording._id))) return true;

    // Legacy fallback: source batch rule
    if (rule.sourceBatch && Array.isArray(recording.batches)) {
      return recording.batches.some((rb) => batchesAlign(rb, rule.sourceBatch));
    }
    return false;
  });

  if (!matchingRule) return false;

  // Check that student attended their own batch's class for this day
  return studentAttendedOwnBatchJourneyDay(
    student._id,
    student.batch || '',
    recCourseDay
  );
}

/**
 * Returns true if `student` should access a Zoom recording via a cross-batch rule.
 *
 * @param {object} zoomRecording  - lean ZoomRecording doc
 * @param {object} meetingLink    - lean MeetingLink doc (batch, courseDay, status)
 * @param {object} student        - lean User doc
 * @param {Array}  rules          - pre-loaded rules
 */
async function canAccessZoomViaCrossBatch(zoomRecording, meetingLink, student, rules) {
  if (!zoomRecording || zoomRecording.status !== 'ready') return false;
  if (zoomRecording.isPublished === false) return false;
  if (!student || !meetingLink) return false;
  if (student.journeyAccessEnabled === false) return false;

  const srcCourseDay = meetingLink.courseDay != null ? Number(meetingLink.courseDay) : null;
  if (!srcCourseDay) return false;

  if (isContentBlockedForStudent(student, { courseDay: meetingLink.courseDay, level: meetingLink.level })) {
    return false;
  }

  const studentBatchKeys = allStudentBatchStringsForContent(student);

  const meetingLinkId = meetingLink?._id ? String(meetingLink._id) : String(zoomRecording?.meetingLinkId || '');
  const matchingRule = rules.find((rule) => {
    if (rule.courseDay !== srcCourseDay) return false;
    const targets = normalizeRuleTargetBatches(rule);
    const studentBatchMatches = targets.some((tb) => studentBatchKeys.some((k) => batchesAlign(k, tb)));
    if (!studentBatchMatches) return false;
    const mappedZoom = Array.isArray(rule.mappedZoomMeetingLinkIds) ? rule.mappedZoomMeetingLinkIds : [];
    if (mappedZoom.some((id) => String(id) === meetingLinkId)) return true;

    // Legacy fallback: source batch rule
    if (rule.sourceBatch) return batchesAlign(meetingLink.batch, rule.sourceBatch);
    return false;
  });

  if (!matchingRule) return false;

  return studentAttendedOwnBatchJourneyDay(
    student._id,
    student.batch || '',
    srcCourseDay
  );
}

// ─── Feed helpers ─────────────────────────────────────────────────────────────

/**
 * Returns { courseDays: Set<number>, rulesByDay: Map<number, rule[]> }
 * for all days where student passes the attendance gate.
 * Used to batch attendance lookups in the student-feed.
 */
async function getAttendedCrossBatchDays(student, rules) {
  const attended = new Set();
  const rulesByDay = new Map();

  const uniqueDays = [...new Set(rules.map((r) => r.courseDay))];
  const studentBatch = student.batch || '';
  if (!studentBatch || !uniqueDays.length) return { attended, rulesByDay };

  // Fetch all relevant meetings in a single query
  const meetings = await MeetingLink.find({
    courseDay: { $in: uniqueDays },
    status: { $ne: 'cancelled' },
  })
    .select('batch courseDay attendance')
    .lean();

  const sid = String(student._id);

  for (const m of meetings) {
    if (!batchesAlign(studentBatch, m.batch)) continue;
    const day = Number(m.courseDay);
    const row = Array.isArray(m.attendance)
      ? m.attendance.find((a) => String(a?.studentId || '') === sid)
      : null;
    if (attendanceRowCountsAsAttended(row)) {
      attended.add(day);
    }
  }

  for (const rule of rules) {
    if (!attended.has(rule.courseDay)) continue;
    if (!rulesByDay.has(rule.courseDay)) rulesByDay.set(rule.courseDay, []);
    rulesByDay.get(rule.courseDay).push(rule);
  }

  return { attended, rulesByDay };
}

/**
 * Loads all cross-batch manual + zoom recordings that this student can access,
 * as additional items to merge into the student-feed.
 *
 * Returns objects shaped like student-feed items, with extra fields:
 *   accessSource: 'cross_batch', sharedFromBatch: '35', sharedFromCourseDay: 13
 *
 * Already-accessible recordings (normal batch access) are de-duped by the caller.
 */
async function listCrossBatchRecordingsForStudent(student) {
  const rules = await getActiveRulesForStudentBatch(student);
  if (!rules.length) return { manualItems: [], zoomItems: [] };

  const { attended, rulesByDay } = await getAttendedCrossBatchDays(student, rules);
  if (!attended.size) return { manualItems: [], zoomItems: [] };

    const allowedPlans = allowedRecordingPlansForStudent(student).map((p) => String(p).toUpperCase());
  const studentLevel = String(student.level || 'A1').toUpperCase();

  const manualItems = [];
  const zoomItems = [];
  const seenManual = new Set();
  const seenZoom = new Set();

  // ── Phase 1: Collect all IDs across all days ────────────────────────────────
  const allManualIds = [];
  const allZoomMeetingIds = [];
  const manualIdsByDay = new Map();
  const zoomIdsByDay = new Map();

  for (const [day, dayRules] of rulesByDay) {
    const manualIds = [];
    const zoomIds = [];
    for (const rule of dayRules) {
      if (Array.isArray(rule.mappedManualRecordingIds)) {
        for (const id of rule.mappedManualRecordingIds) manualIds.push(String(id));
      }
      if (Array.isArray(rule.mappedZoomMeetingLinkIds)) {
        for (const id of rule.mappedZoomMeetingLinkIds) zoomIds.push(String(id));
      }
    }
    if (manualIds.length) {
      const u = [...new Set(manualIds)];
      manualIdsByDay.set(day, new Set(u));
      for (const id of u) allManualIds.push(id);
    }
    if (zoomIds.length) {
      const u = [...new Set(zoomIds)];
      zoomIdsByDay.set(day, new Set(u));
      for (const id of u) allZoomMeetingIds.push(id);
    }
  }

  // ── Phase 2: Batch fetch all manual recordings ──────────────────────────────
  const manualRecsById = new Map();
  if (allManualIds.length) {
    const uniqueManualIds = [...new Set(allManualIds)];
    const recs = await ClassRecording.find({
      _id: { $in: uniqueManualIds },
      active: true,
      isPublished: { $ne: false },
    })
      .populate('uploadedBy', 'name')
      .lean();
    for (const r of recs) manualRecsById.set(String(r._id), r);
  }

  // ── Phase 3: Auto-publish all zoom recordings ───────────────────────────────
  if (allZoomMeetingIds.length) {
    const uniqueZoomIds = [...new Set(allZoomMeetingIds)];
    for (const meetingId of uniqueZoomIds) {
      try {
        await autoPublishZoomRecordingIfSelfPaceMapped(meetingId);
      } catch (pubErr) {
        console.warn('[self-pace] auto-publish before feed merge:', pubErr.message);
      }
    }
  }

  // ── Phase 4: Batch fetch all meeting links ──────────────────────────────────
  const meetingLinksById = new Map();
  const meetingDayByLinkId = new Map();
  if (allZoomMeetingIds.length) {
    const uniqueZoomIds = [...new Set(allZoomMeetingIds)];
    const meetings = await MeetingLink.find({
      _id: { $in: uniqueZoomIds },
      status: { $ne: 'cancelled' },
    })
      .select('_id topic batch startTime duration status assignedTeacher courseDay')
      .populate('assignedTeacher', 'name')
      .lean();
    for (const m of meetings) {
      const mid = String(m._id);
      meetingLinksById.set(mid, m);
      for (const [day, daySet] of zoomIdsByDay) {
        if (daySet.has(mid)) {
          meetingDayByLinkId.set(mid, day);
          break;
        }
      }
    }
  }

  // ── Phase 5: Batch fetch all zoom recordings ────────────────────────────────
  const zoomRecsByMeetingId = new Map();
  if (allZoomMeetingIds.length) {
    const uniqueZoomIds = [...new Set(allZoomMeetingIds)];
    const recs = await ZoomRecording.find({
      meetingLinkId: { $in: uniqueZoomIds },
      status: 'ready',
      isPublished: true,
    }).select('meetingLinkId duration createdAt').lean();
    for (const z of recs) zoomRecsByMeetingId.set(String(z.meetingLinkId), z);
  }

  // ── Phase 6: Build items per day using cached collections ───────────────────
  for (const [day, dayRules] of rulesByDay) {
    // ── Manual recordings for this day ───────────────────────────────────────
    const dayManualIds = manualIdsByDay.get(day);
    if (dayManualIds) {
      for (const id of dayManualIds) {
        if (seenManual.has(id)) continue;
        const rec = manualRecsById.get(id);
        if (!rec) continue;
        if (isContentBlockedForStudent(student, { courseDay: day, level: rec.level })) continue;
        if (rec.level && rec.level !== studentLevel) continue;
        const recPlan = String(rec.plan || 'ALL').toUpperCase();
        if (recPlan !== 'ALL' && !allowedPlans.includes(recPlan)) continue;
        seenManual.add(id);
        manualItems.push({
          type: 'manual',
          id: String(rec._id),
          title: rec.title,
          description: rec.description || '',
          date: rec.createdAt,
          duration: Number.isFinite(Number(rec.duration)) ? Number(rec.duration) : null,
          batch: (rec.batches || []).join(', '),
          teacherName: rec.uploadedBy?.name || 'Teacher',
          attempted: null,
          attendanceStatus: 'N/A',
          videoUrl: rec.videoUrl,
          level: rec.level,
          plan: rec.plan,
          uploadedBy: rec.uploadedBy?.name,
          manualSourceType: rec.sourceType || 'URL',
          manualStatus: rec.status || 'ready',
          manualErrorMessage: rec.errorMessage || null,
          courseDay: day,
          watchedSeconds: 0,
          accessRequestStatus: null,
          canPlay: true,
          accessSource: 'self_pace',
          sharedFromBatch: '',
          sharedFromCourseDay: day,
        });
      }
    }

    // ── Zoom recordings for this day ─────────────────────────────────────────
    const dayZoomIds = zoomIdsByDay.get(day);
    if (dayZoomIds) {
      for (const meetingId of dayZoomIds) {
        if (seenZoom.has(meetingId)) continue;
        const meeting = meetingLinksById.get(meetingId);
        if (!meeting) continue;
        const zoomRec = zoomRecsByMeetingId.get(meetingId);
        if (!zoomRec) continue;
        if (isContentBlockedForStudent(student, { courseDay: day })) continue;
        seenZoom.add(meetingId);
        zoomItems.push({
          type: 'zoom',
          id: meetingId,
          title: meeting.topic || 'Class Recording',
          description: '',
          date: meeting.startTime || zoomRec.createdAt,
          duration: Number.isFinite(Number(zoomRec.duration))
            ? Number(zoomRec.duration)
            : Number.isFinite(Number(meeting.duration)) ? Number(meeting.duration) * 60 : null,
          batch: meeting.batch || '',
          teacherName: meeting.assignedTeacher?.name || 'Teacher',
          attempted: meeting.status === 'ended',
          attendanceStatus: 'N/A',
          meetingLinkId: meetingId,
          courseDay: day,
          watchedSeconds: 0,
          accessRequestStatus: null,
          canPlay: true,
          accessSource: 'self_pace',
          sharedFromBatch: '',
          sharedFromCourseDay: day,
        });
      }
    }
  }

  return { manualItems, zoomItems };
}

// ─── Admin preview helper ─────────────────────────────────────────────────────

/**
 * For the admin preview panel: given a journey, return:
 *  - eligible students (attended / absent)
 *  - mapped recordings
 */
async function previewRule(rule) {
  const User = require('../models/User');

  const targetBatches = normalizeRuleTargetBatches(rule);
  const allStudents = await User.find({ role: 'STUDENT' })
    .select('_id name regNo email batch goStatus subscription')
    .lean();
  const students = allStudents.filter((s) => {
    const keys = allStudentBatchStringsForContent(s);
    return targetBatches.some((tb) => keys.some((k) => batchesAlign(k, tb)));
  });

  // Meetings on that day for the student batch(es)
  const studentBatchMeetings = await MeetingLink.find({
    courseDay: rule.courseDay,
    status: { $ne: 'cancelled' },
  })
    .select('batch attendance')
    .lean();

  const eligibleStudents = students.map((s) => {
    const sid = String(s._id);
    let attended = false;
    for (const m of studentBatchMeetings) {
      const sKeys = allStudentBatchStringsForContent(s);
      if (!sKeys.some((k) => batchesAlign(k, m.batch))) continue;
      const row = Array.isArray(m.attendance)
        ? m.attendance.find((a) => String(a?.studentId || '') === sid)
        : null;
      if (attendanceRowCountsAsAttended(row)) { attended = true; break; }
    }
    return { _id: s._id, name: s.name, regNo: s.regNo, email: s.email, attended };
  });

  // Mapped recordings (new behavior)
  const mappedManualIds = (rule.mappedManualRecordingIds || []).map((id) => String(id));
  const mappedZoomIds = (rule.mappedZoomMeetingLinkIds || []).map((id) => String(id));

  const sourceManualRecordings = mappedManualIds.length
    ? await ClassRecording.find({ _id: { $in: mappedManualIds } })
      .select('title batches level plan isPublished status courseDay')
      .lean()
    : [];

  const sourceMeetings = mappedZoomIds.length
    ? await MeetingLink.find({ _id: { $in: mappedZoomIds } })
      .select('_id topic batch startTime')
      .lean()
    : [];
  const sourceZoomRecordings = [];
  for (const m of sourceMeetings) {
    const zr = await ZoomRecording.findOne({ meetingLinkId: m._id, status: 'ready' })
      .select('isPublished status duration')
      .lean();
    sourceZoomRecordings.push({
      meetingLinkId: String(m._id),
      topic: m.topic || 'Class Recording',
      startTime: m.startTime,
      isPublished: zr?.isPublished ?? false,
      status: zr?.status || 'missing',
    });
  }

  return {
    eligibleStudents,
    attendedCount: eligibleStudents.filter((s) => s.attended).length,
    totalStudents: eligibleStudents.length,
    sourceZoomRecordings,
    sourceManualRecordings,
  };
}

/**
 * True when a Zoom class is mapped to any active self-pace journey day.
 * Used to auto-publish recordings so students see them without manual admin publish.
 */
async function isZoomMeetingMappedToSelfPace(meetingLinkId) {
  if (!meetingLinkId) return false;

  const mappedInRule = await JourneyCrossBatchRecordingRule.exists({
    active: true,
    mappedZoomMeetingLinkIds: meetingLinkId,
  });
  if (mappedInRule) return true;

  const SelfPaceJourneyDay = require('../models/SelfPaceJourneyDay');
  const mappedInDay = await SelfPaceJourneyDay.exists({
    active: true,
    recordingType: 'zoom',
    meetingLinkId,
  });
  return !!mappedInDay;
}

/**
 * Publish a ready Zoom recording when it is mapped to self-pace content.
 * @returns {Promise<boolean>} true when publish state was updated
 */
async function autoPublishZoomRecordingIfSelfPaceMapped(meetingLinkId) {
  if (!meetingLinkId) return false;
  if (!(await isZoomMeetingMappedToSelfPace(meetingLinkId))) return false;

  const result = await ZoomRecording.updateOne(
    { meetingLinkId, status: 'ready', isPublished: { $ne: true } },
    { $set: { isPublished: true, publishedAt: new Date() } }
  );
  return (result.modifiedCount || 0) > 0;
}

module.exports = {
  attendanceRowCountsAsAttended,
  studentAttendedOwnBatchJourneyDay,
  getActiveRulesForStudentBatch,
  canAccessManualViaCrossBatch,
  canAccessZoomViaCrossBatch,
  getAttendedCrossBatchDays,
  listCrossBatchRecordingsForStudent,
  previewRule,
  isZoomMeetingMappedToSelfPace,
  autoPublishZoomRecordingIfSelfPaceMapped,
};
