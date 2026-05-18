// routes/zoom.js

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const zoomService = require('../services/zoomService');
const MeetingLink = require('../models/MeetingLink');
const JoinLog = require('../models/JoinLog');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const { findBestParticipantMatch } = require('../services/zoomParticipantMatch');
const { scheduleDispatchEvent, sanitizeMeetingLink } = require('../services/studentPortalCrmWebhook');
const { allStudentBatchStringsForContent } = require('../utils/effectiveStudentBatch');
const { buildJoinClassProxyUrl } = require('../utils/joinClassUrl');
const { resolveMeetingJoinPwd } = require('../utils/zoomJoinUrls');
const { getJoinLogDataForMeeting, getPortalJoinsForMeeting } = require('../services/joinLogHelpers');
const { buildAttendanceRowFromMatch, logAttendanceMatchSummary } = require('../services/attendanceMatchHelpers');
const { applyAttendanceStabilityPass } = require('../services/attendanceMatchingSafeguards');
const { attendanceDebug, attendanceWarn, attendanceDebugEnabled } = require('../utils/attendanceDebug');
const {
  createMeetingLinkFromSlot,
  buildHostAvailability
} = require('../services/zoomMeetingLifecycle.service');

/**
 * Build an attendance row for a manual override.
 *
 * @param {object} opts
 * @param {object}  opts.attendee
 * @param {object|null} opts.existingRow  - Current saved row (may be null).
 * @param {number}  opts.meetingDuration  - Meeting duration in minutes.
 * @param {boolean} opts.joinLogPresent   - True if a JoinLog click exists for this student.
 * @param {'single'|'all'} opts.mode
 * @param {object|null} opts.participant  - Matching Zoom participant (may be null).
 * @param {'attended'|'absent'} [opts.status='attended']
 *   Pass 'absent' to explicitly mark the student absent while preserving the record.
 *   Defaults to 'attended' so all existing callers are unaffected.
 */
function buildManualAttendanceRecord({ attendee, existingRow, meetingDuration, joinLogPresent, mode, participant, status = 'attended' }) {
  const isAbsent = status === 'absent';
  const safeDuration = Number.isFinite(Number(meetingDuration)) ? Number(meetingDuration) : 0;
  const fallbackName = attendee?.name || existingRow?.name || '';
  const fallbackEmail = attendee?.email || existingRow?.email || '';

  // For absent overrides, duration/percent are zero; for present, use meeting duration or participant data.
  const normalizedDurationMinutes = isAbsent ? 0 : (
    safeDuration > 0
      ? safeDuration
      : (Number.isFinite(Number(participant?.durationMinutes)) ? Math.max(0, Number(participant.durationMinutes)) : 0)
  );
  const normalizedDurationSeconds = isAbsent ? 0 : (
    normalizedDurationMinutes > 0
      ? Math.round(normalizedDurationMinutes * 60)
      : (Number.isFinite(Number(participant?.duration)) ? Math.max(0, Number(participant.duration)) : 0)
  );
  const attendancePercent = isAbsent ? 0 : (
    safeDuration > 0
      ? Math.min(100, Math.round((normalizedDurationMinutes / safeDuration) * 100))
      : 100
  );

  const matchMethodLabel = mode === 'all' ? 'manual_mark_all' : 'manual_mark';
  const debugSummary = isAbsent
    ? (mode === 'all' ? 'Manually marked absent (mark all)' : 'Manually marked absent')
    : (mode === 'all' ? 'Manually marked attended (mark all)' : 'Manually marked attended');

  return {
    studentId: attendee.studentId,
    name: fallbackName,
    email: fallbackEmail,
    attended: !isAbsent,
    confidence: 100,
    finalConfidence: 100,
    confidenceLevel: 'high',
    matchMethod: matchMethodLabel,
    zoomName: isAbsent ? (existingRow?.zoomName || null) : (participant?.name || existingRow?.zoomName || null),
    zoomEmail: isAbsent ? (existingRow?.zoomEmail || null) : (participant?.email || existingRow?.zoomEmail || null),
    joinTime: isAbsent ? (existingRow?.joinTime || null) : (participant?.joinTime || existingRow?.joinTime || null),
    leaveTime: isAbsent ? (existingRow?.leaveTime || null) : (participant?.leaveTime || existingRow?.leaveTime || null),
    duration: normalizedDurationSeconds,
    durationMinutes: normalizedDurationMinutes,
    attendancePercent,
    status: isAbsent ? 'absent' : 'attended',
    needsReview: false,
    clickedJoin: !!joinLogPresent,
    appearedInZoom: isAbsent ? false : !!(participant?.name || participant?.joinTime || existingRow?.appearedInZoom),
    mismatchReason: null,
    debugSummary,
    debug: {
      portalName: fallbackName,
      zoomName: isAbsent ? (existingRow?.zoomName || null) : (participant?.name || existingRow?.zoomName || null),
      matchMethod: matchMethodLabel,
    },
  };
}

/**
 * Create a Zoom meeting with selected students
 * POST /api/zoom/create-meeting
 */
router.post('/create-meeting', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const {
      batch,
      plan,
      topic,
      startTime,
      startTimes,
      scheduleMode,
      duration,
      timezone,
      agenda,
      studentIds, // Array of student IDs
      teacherId,  // Teacher assigned to the class
      zoomHostEmail, // Zoom host email from the Zoom API
      courseDay,   // Optional: day in the 200-day journey
      courseDaysByStart // Optional: map of slot -> courseDay
    } = req.body;

    const requestedStartTimes = (Array.isArray(startTimes) && startTimes.length > 0)
      ? startTimes
      : (startTime ? [startTime] : []);
    const normalizedStartTimes = [...new Set(requestedStartTimes)]
      .filter((t) => typeof t === 'string' && t.length >= 16)
      .sort();

    const parseCourseDayValue = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const n = parseInt(String(value), 10);
      if (!Number.isFinite(n)) return null;
      return Math.min(200, Math.max(1, n));
    };
    const fallbackCourseDay = parseCourseDayValue(courseDay);
    const normalizedCourseDaysByStart = {};
    if (courseDaysByStart && typeof courseDaysByStart === 'object' && !Array.isArray(courseDaysByStart)) {
      for (const [rawSlot, rawCourseDay] of Object.entries(courseDaysByStart)) {
        if (typeof rawSlot !== 'string' || rawSlot.length < 16) continue;
        const slotKey = rawSlot.substring(0, 16);
        normalizedCourseDaysByStart[slotKey] = parseCourseDayValue(rawCourseDay);
      }
    }

    console.log('📝 Creating Zoom meeting(s) for batch:', batch);
    console.log('📅 Schedule mode:', scheduleMode || 'single');
    console.log('🕒 Start slots:', normalizedStartTimes);
    console.log('👥 Selected students:', studentIds);

    // Validate required fields
    if (!batch || !plan || !topic || normalizedStartTimes.length === 0 || !studentIds || studentIds.length === 0 || !teacherId || !zoomHostEmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: batch, plan, topic, startTime/startTimes, studentIds, teacherId, and zoomHostEmail are required'
      });
    }

    // Get the assigned teacher
    const teacher = await User.findById(teacherId).select('email name role');
    if (!teacher || (teacher.role !== 'TEACHER' && teacher.role !== 'TEACHER_ADMIN')) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    console.log('👨‍🏫 Teacher:', teacher.name, '— Zoom Host:', zoomHostEmail);

    // Find students by IDs
    let students = [];
    if (studentIds[0] && typeof studentIds[0] === 'object' && studentIds[0]._id) {
      students = studentIds;
    } else {
      students = await User.find({
        _id: { $in: studentIds },
        role: 'STUDENT'
      }).select('name email batch level subscription');
    }

    if (students.length === 0) {
      return res.status(404).json({ success: false, message: 'No students found with the provided IDs' });
    }

    console.log(`✅ Found ${students.length} students`);
    const createdMeetings = [];
    const failedSchedules = [];

    for (const slotStartTime of normalizedStartTimes) {
      try {
        const slotCourseDay = Object.prototype.hasOwnProperty.call(normalizedCourseDaysByStart, slotStartTime)
          ? normalizedCourseDaysByStart[slotStartTime]
          : fallbackCourseDay;

        const result = await createMeetingLinkFromSlot({
          createdByUserId: req.user.id,
          batch,
          plan,
          topic,
          agenda: agenda || `German Language Class - Batch ${batch}`,
          slotStartTime,
          duration: duration || 60,
          timezone: timezone || 'Asia/Kolkata',
          zoomHostEmail,
          teacherId,
          students,
          courseDay: slotCourseDay
        });

        if (!result.ok) {
          failedSchedules.push({
            startTime: result.startTime,
            message: result.message,
            ...(result.conflicts ? { conflicts: result.conflicts } : {})
          });
          continue;
        }

        createdMeetings.push(result.createdMeetingSummary);
      } catch (slotError) {
        failedSchedules.push({
          startTime: slotStartTime,
          message: slotError.message || 'Failed to create meeting for this slot'
        });
      }
    }

    if (createdMeetings.length === 0) {
      return res.status(409).json({
        success: false,
        message: 'Could not create any meetings for the selected schedule.',
        failedSchedules
      });
    }

    const primaryMeeting = createdMeetings[0];

    res.status(201).json({
      success: true,
      message: `Created ${createdMeetings.length} meeting(s) successfully` +
        (failedSchedules.length ? `, ${failedSchedules.length} failed.` : '.'),
      data: {
        ...primaryMeeting,
        meetings: createdMeetings
      },
      summary: {
        requestedCount: normalizedStartTimes.length,
        createdCount: createdMeetings.length,
        failedCount: failedSchedules.length,
        failedSchedules
      },
      emailStatus: {
        deferred: true,
        message:
          'Reminder emails are sent about 10 minutes before each class starts with instructions to join via the student portal.',
        attempted: 0,
        successful: 0,
        failed: 0,
        allSent: false,
        partialFailure: false,
        totalFailure: false,
        failedStudents: [],
        errors: []
      }
    });

  } catch (error) {
    console.error('❌ Error creating Zoom meeting:', error);
    const status = error.statusCode || 500;
    const response = {
      success: false,
      message: error.message || 'Failed to create Zoom meeting',
      error: error.toString()
    };
    if (error.conflicts) {
      response.conflicts = error.conflicts;
    }
    res.status(status).json(response);
  }
});

const {
  generateJourneySchedules,
  validateSchedulePayload,
  previewJourneyWithConflicts,
  collectSlotConflicts
} = require('../services/journeyMeetingGenerator.service');

const MAX_BULK_CHUNK = 25;

/**
 * Preview generated journey slots + conflict strings (no Zoom calls).
 * POST /api/zoom/preview-bulk-journey-meetings
 */
router.post('/preview-bulk-journey-meetings', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const body = req.body || {};
    const {
      batch,
      plan,
      topic,
      teacherId,
      zoomHostEmail,
      studentIds,
      duration,
      weekdaysSun0,
      startClock,
      startingJourneyDay,
      targetJourneyDay
    } = body;

    const v = validateSchedulePayload(
      {
        batch,
        plan,
        topic,
        teacherId,
        zoomHostEmail,
        studentIds,
        duration,
        startingJourneyDay,
        targetJourneyDay
      },
      { allowEmptyStudents: true }
    );
    if (!v.ok) {
      return res.status(400).json({ success: false, message: v.errors.join('; ') });
    }

    const preview = await previewJourneyWithConflicts({
      batch,
      plan,
      topic,
      teacherId,
      zoomHostEmail,
      studentIds,
      durationMinutes: Number(duration) || 120,
      weekdaysSun0,
      startClock,
      startingJourneyDay,
      targetJourneyDay
    });

    const teachingHours = (preview.schedules.length * (Number(duration) || 120)) / 60;

    return res.json({
      success: true,
      data: {
        schedules: preview.schedules,
        warnings: preview.allWarnings,
        blockingErrors: preview.blockingErrors,
        totalMeetings: preview.schedules.length,
        totalTeachingHours: Math.round(teachingHours * 100) / 100
      }
    });
  } catch (err) {
    console.error('preview-bulk-journey-meetings', err);
    res.status(500).json({ success: false, message: err.message || 'Preview failed' });
  }
});

/**
 * Create many journey-scheduled meetings (chunked). Reuses createMeetingLinkFromSlot.
 * POST /api/zoom/create-bulk-journey-meetings
 */
router.post('/create-bulk-journey-meetings', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const body = req.body || {};
    const {
      batch,
      plan,
      topic,
      agenda,
      teacherId,
      zoomHostEmail,
      timezone,
      duration,
      studentIds,
      bulkScheduleId,
      schedules,
      regenerateFromParams,
      weekdaysSun0,
      startClock,
      startingJourneyDay,
      targetJourneyDay
    } = body;

    const v = validateSchedulePayload({
      batch,
      plan,
      topic,
      teacherId,
      zoomHostEmail,
      studentIds,
      duration,
      startingJourneyDay,
      targetJourneyDay
    });
    if (!v.ok) {
      return res.status(400).json({ success: false, message: v.errors.join('; ') });
    }

    if (!bulkScheduleId || typeof bulkScheduleId !== 'string') {
      return res.status(400).json({ success: false, message: 'bulkScheduleId is required' });
    }

    let rows = Array.isArray(schedules) ? schedules : [];
    if (regenerateFromParams && weekdaysSun0 && startClock) {
      const gen = generateJourneySchedules({
        weekdaysSun0,
        startClock,
        startingJourneyDay,
        targetJourneyDay,
        durationMinutes: Number(duration) || 120
      });
      rows = gen.schedules;
    }

    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'No schedules in this chunk' });
    }
    if (rows.length > MAX_BULK_CHUNK) {
      return res.status(400).json({
        success: false,
        message: `At most ${MAX_BULK_CHUNK} meetings per request`
      });
    }

    const teacher = await User.findById(teacherId).select('email name role');
    if (!teacher || (teacher.role !== 'TEACHER' && teacher.role !== 'TEACHER_ADMIN')) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    let students = [];
    if (studentIds[0] && typeof studentIds[0] === 'object' && studentIds[0]._id) {
      students = studentIds;
    } else {
      students = await User.find({
        _id: { $in: studentIds },
        role: 'STUDENT'
      }).select('name email batch level subscription medium');
    }
    if (students.length === 0) {
      return res.status(404).json({ success: false, message: 'No students found with the provided IDs' });
    }

    const createdMeetings = [];
    const failedSchedules = [];
    const dur = Number(duration) || 120;
    const tz = timezone || 'Asia/Kolkata';
    const agendaText = agenda || `German Language Class - Batch ${batch}`;

    for (const row of rows) {
      const slotStart = typeof row.startTime === 'string' && row.startTime.length >= 16
        ? row.startTime.substring(0, 16)
        : null;
      const courseDayRaw = row.journeyDay != null ? row.journeyDay : row.courseDay;
      const n = parseInt(String(courseDayRaw), 10);
      const slotCourseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;

      if (!slotStart || slotCourseDay == null) {
        failedSchedules.push({
          startTime: row.startTime,
          message: 'Invalid startTime or journeyDay'
        });
        continue;
      }

      const blockers = await collectSlotConflicts({
        batch,
        teacherId,
        zoomHostEmail,
        studentIds: students.map((s) => s._id),
        slotStartTime16: slotStart,
        durationMinutes: dur,
        courseDay: slotCourseDay
      });
      const hard = blockers.filter((b) =>
        b.includes('Zoom host busy') || b.includes('Teacher overlap') || b.includes('Student overlap') || b.includes('Duplicate future')
      );
      if (hard.length) {
        failedSchedules.push({
          startTime: slotStart,
          message: hard.join(' | ')
        });
        continue;
      }

      const meta = {};
      if (row.moduleId) meta.moduleId = row.moduleId;
      if (row.aiAgentId) meta.aiAgentId = row.aiAgentId;
      if (row.notes) meta.notes = String(row.notes).slice(0, 2000);
      const journeyBulkMeta = Object.keys(meta).length ? meta : undefined;

      try {
        const result = await createMeetingLinkFromSlot({
          createdByUserId: req.user.id,
          batch,
          plan,
          topic,
          agenda: agendaText,
          slotStartTime: slotStart,
          duration: dur,
          timezone: tz,
          zoomHostEmail,
          teacherId,
          students,
          courseDay: slotCourseDay,
          bulkScheduleId,
          journeyBulkMeta
        });

        if (!result.ok) {
          failedSchedules.push({
            startTime: result.startTime,
            message: result.message,
            ...(result.conflicts ? { conflicts: result.conflicts } : {})
          });
          continue;
        }
        createdMeetings.push({
          ...result.createdMeetingSummary,
          journeyDay: slotCourseDay
        });
      } catch (slotErr) {
        failedSchedules.push({
          startTime: slotStart,
          message: slotErr.message || 'Failed to create meeting'
        });
      }
    }

    return res.status(createdMeetings.length ? 201 : 409).json({
      success: createdMeetings.length > 0,
      message:
        createdMeetings.length > 0
          ? `Created ${createdMeetings.length} meeting(s) in this chunk`
          : 'No meetings created in this chunk',
      data: { meetings: createdMeetings },
      summary: {
        createdCount: createdMeetings.length,
        failedCount: failedSchedules.length,
        failedSchedules
      }
    });
  } catch (err) {
    console.error('create-bulk-journey-meetings', err);
    res.status(500).json({ success: false, message: err.message || 'Bulk create failed' });
  }
});

/**
 * Get all meetings for teacher or admin
 * GET /api/zoom/meetings
 * - Teachers see only their own meetings
 * - Admins see all meetings from all teachers
 */
function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** YYYY-MM-DD for a calendar day in Asia/Kolkata */
function istYmdFromDate(d) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function istMidnightUtcMsFromYmd(ymd) {
  return new Date(`${ymd}T00:00:00.000+05:30`).getTime();
}

/**
 * Time-based lifecycle for meeting list tabs (matches Angular meetings-list `getMeetingStatus` / `effectiveTabStatus`).
 */
function lifecycleExprClause(lifecycle) {
  const durationMs = { $multiply: [{ $toLong: { $ifNull: ['$duration', 0] } }, 60000] };
  const endTime = { $add: ['$startTime', durationMs] };
  if (lifecycle === 'scheduled') {
    return {
      $expr: {
        $and: [
          { $ne: [{ $ifNull: ['$status', ''] }, 'cancelled'] },
          { $ne: ['$startTime', null] },
          { $lt: ['$$NOW', '$startTime'] }
        ]
      }
    };
  }
  if (lifecycle === 'ongoing') {
    return {
      $expr: {
        $and: [
          { $ne: [{ $ifNull: ['$status', ''] }, 'cancelled'] },
          { $ne: ['$startTime', null] },
          { $gte: ['$$NOW', '$startTime'] },
          { $lte: ['$$NOW', endTime] }
        ]
      }
    };
  }
  if (lifecycle === 'ended') {
    return {
      $expr: {
        $or: [
          { $eq: [{ $ifNull: ['$status', ''] }, 'cancelled'] },
          { $eq: ['$startTime', null] },
          { $gt: ['$$NOW', endTime] }
        ]
      }
    };
  }
  return null;
}

function mergeAndClauses(baseClauses, extraClause) {
  if (!extraClause) return baseClauses.length ? { $and: baseClauses } : {};
  if (!baseClauses.length) return { $and: [extraClause] };
  return { $and: [...baseClauses, extraClause] };
}

router.get('/meetings', verifyToken, async (req, res) => {
  try {
    const { status, batch, date } = req.query;
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 150);
    const skip = (pageNum - 1) * pageSize;
    const userId = req.user.id || req.user.userId || req.user._id;

    // Get user to check role
    const user = await User.findById(userId).select('role');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // Build with $and so batch / date clauses never break the teacher $or scope
    const andClauses = [];

    if (user.role === 'TEACHER' || user.role === 'TEACHER_ADMIN') {
      andClauses.push({
        $or: [
          { createdBy: userId },
          { assignedTeacher: userId }
        ]
      });
    }

    if (status) andClauses.push({ status });

    // Batch: match string or number (legacy / CRM data sometimes stores numeric batch)
    if (batch !== undefined && batch !== null && String(batch).trim() !== '') {
      const b = String(batch).trim();
      const asNum = Number(b);
      if (Number.isFinite(asNum) && String(asNum) === b) {
        andClauses.push({ $or: [{ batch: b }, { batch: asNum }] });
      } else {
        andClauses.push({ batch: b });
      }
    }

    if (req.query.plan) andClauses.push({ plan: req.query.plan });

    // ── Reports filters (range / teacher / search) — applied before pagination ──
    const teacherNameParam = String(req.query.teacherName || '').trim();
    if (
      teacherNameParam &&
      teacherNameParam.toLowerCase() !== 'all' &&
      (user.role === 'ADMIN' || user.role === 'TEACHER_ADMIN')
    ) {
      const teacherDocs = await User.find({
        name: teacherNameParam,
        role: { $in: ['TEACHER', 'TEACHER_ADMIN'] }
      })
        .select('_id')
        .lean();
      const tids = teacherDocs.map((t) => t._id);
      if (!tids.length) {
        andClauses.push({ _id: { $in: [] } });
      } else {
        andClauses.push({
          $or: [{ assignedTeacher: { $in: tids } }, { createdBy: { $in: tids } }]
        });
      }
    }

    const searchRaw = String(req.query.search || '').trim();
    if (searchRaw) {
      const rx = new RegExp(escapeRegex(searchRaw), 'i');
      const teacherHits = await User.find({
        role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
        name: rx
      })
        .select('_id')
        .lean();
      const searchTeacherIds = teacherHits.map((u) => u._id);
      const searchOr = [{ topic: rx }, { agenda: rx }];
      if (searchTeacherIds.length) {
        searchOr.push({ assignedTeacher: { $in: searchTeacherIds } });
        searchOr.push({ createdBy: { $in: searchTeacherIds } });
      }
      searchOr.push({
        $expr: {
          $regexMatch: {
            input: { $toString: '$batch' },
            regex: escapeRegex(searchRaw),
            options: 'i'
          }
        }
      });
      andClauses.push({ $or: searchOr });
    }

    // Calendar day in India (IST) — [dayStart, nextDayStart) avoids end-of-day ms bugs
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date).trim())) {
      const ymd = String(date).trim();
      const dayStartColombo = new Date(`${ymd}T00:00:00.000+05:30`);
      const nextDayStart = new Date(dayStartColombo.getTime() + 24 * 60 * 60 * 1000);
      andClauses.push({
        startTime: { $gte: dayStartColombo, $lt: nextDayStart }
      });
    }

    const datePreset = String(req.query.datePreset || '').trim().toLowerCase();
    const df = String(req.query.dateFrom || '').trim();
    const dt = String(req.query.dateTo || '').trim();

    if (!date && datePreset && datePreset !== 'all') {
      const now = new Date();
      if (datePreset === 'today') {
        const ymd = istYmdFromDate(now);
        const start = new Date(`${ymd}T00:00:00.000+05:30`);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        andClauses.push({ startTime: { $gte: start, $lt: end } });
      } else if (datePreset === 'week') {
        const todayStart = istMidnightUtcMsFromYmd(istYmdFromDate(now));
        const weekAgo = todayStart - 7 * 24 * 60 * 60 * 1000;
        andClauses.push({ startTime: { $gte: new Date(weekAgo), $lte: now } });
      } else if (datePreset === 'month') {
        const todayStart = istMidnightUtcMsFromYmd(istYmdFromDate(now));
        const monthAgo = todayStart - 30 * 24 * 60 * 60 * 1000;
        andClauses.push({ startTime: { $gte: new Date(monthAgo), $lte: now } });
      } else if (datePreset === 'custom') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(df)) {
          const start = new Date(`${df}T00:00:00.000+05:30`);
          andClauses.push({ startTime: { $gte: start } });
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
          const end = new Date(`${dt}T23:59:59.999+05:30`);
          andClauses.push({ startTime: { $lte: end } });
        }
      }
    }

    if (String(req.query.completed).toLowerCase() === 'true') {
      andClauses.push({
        $expr: {
          $lt: [
            {
              $dateAdd: {
                startDate: '$startTime',
                unit: 'minute',
                amount: { $ifNull: ['$duration', 0] }
              }
            },
            '$$NOW'
          ]
        }
      });
    }

    const coreAndClauses = [...andClauses];

    const lifecycleRaw = String(req.query.lifecycle || '').trim().toLowerCase();
    const lifecycle = ['scheduled', 'ongoing', 'ended'].includes(lifecycleRaw) ? lifecycleRaw : null;
    const includeTabCounts = String(req.query.includeTabCounts || '').toLowerCase() === 'true';

    if (lifecycle) {
      const lc = lifecycleExprClause(lifecycle);
      if (lc) andClauses.push(lc);
    }

    const query = andClauses.length ? { $and: andClauses } : {};

    // Single calendar-day filter: chronological within the day.
    // Scheduled / ongoing lists: soonest first (next class on page 1).
    // Ended + legacy queries (no lifecycle): most recent first.
    const sortRaw = String(req.query.sort || '').trim().toLowerCase();
    let sortOrder = -1;
    if (date) {
      sortOrder = 1;
    } else if (lifecycle === 'scheduled' || lifecycle === 'ongoing') {
      sortOrder = 1;
    } else if (sortRaw === 'asc' || sortRaw === 'start_asc') {
      sortOrder = 1;
    } else if (sortRaw === 'desc' || sortRaw === 'start_desc') {
      sortOrder = -1;
    }
    const totalCount = await MeetingLink.countDocuments(query);

    const summaryAgg = await MeetingLink.aggregate([
      { $match: query },
      {
        $addFields: {
          totalStudents: { $size: { $ifNull: ['$attendees', []] } },
          attendedCount: {
            $size: {
              $filter: {
                input: { $ifNull: ['$attendance', []] },
                as: 'a',
                cond: { $eq: ['$$a.attended', true] }
              }
            }
          }
        }
      },
      {
        $addFields: {
          attendanceRate: {
            $cond: [
              { $gt: ['$totalStudents', 0] },
              { $multiply: [{ $divide: ['$attendedCount', '$totalStudents'] }, 100] },
              0
            ]
          }
        }
      },
      {
        $group: {
          _id: null,
          meetingCount: { $sum: 1 },
          sumStudentSlots: { $sum: '$totalStudents' },
          sumDuration: { $sum: { $ifNull: ['$duration', 0] } },
          sumRates: { $sum: '$attendanceRate' }
        }
      },
      {
        $project: {
          _id: 0,
          totalMeetings: '$meetingCount',
          totalStudents: '$sumStudentSlots',
          totalDurationMinutes: '$sumDuration',
          avgAttendance: {
            $cond: [
              { $gt: ['$meetingCount', 0] },
              { $round: [{ $divide: ['$sumRates', '$meetingCount'] }, 0] },
              0
            ]
          }
        }
      }
    ]);

    const summaryRow = summaryAgg[0] || {
      totalMeetings: 0,
      totalStudents: 0,
      avgAttendance: 0,
      totalDurationMinutes: 0
    };

    const meetings = await MeetingLink.find(query)
      .populate('createdBy', 'name email role')
      .populate('assignedTeacher', 'name email')
      .populate('attendees.studentId', 'name email batch level subscription')
      .sort({ startTime: sortOrder })
      .skip(skip)
      .limit(pageSize);

    const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);

    let tabCounts;
    let availableBatches;
    if (includeTabCounts) {
      const batchOnlyClauses = [];
      if (user.role === 'TEACHER' || user.role === 'TEACHER_ADMIN') {
        batchOnlyClauses.push({
          $or: [{ createdBy: userId }, { assignedTeacher: userId }]
        });
      }
      const batchQuery = batchOnlyClauses.length ? { $and: batchOnlyClauses } : {};
      const [cScheduled, cOngoing, cEnded, rawBatches] = await Promise.all([
        MeetingLink.countDocuments(mergeAndClauses(coreAndClauses, lifecycleExprClause('scheduled'))),
        MeetingLink.countDocuments(mergeAndClauses(coreAndClauses, lifecycleExprClause('ongoing'))),
        MeetingLink.countDocuments(mergeAndClauses(coreAndClauses, lifecycleExprClause('ended'))),
        MeetingLink.distinct('batch', batchQuery)
      ]);
      tabCounts = { scheduled: cScheduled, ongoing: cOngoing, ended: cEnded };
      availableBatches = [...new Set(rawBatches.map((b) => String(b || '').trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const payload = {
      success: true,
      count: meetings.length,
      totalCount,
      pagination: {
        page: pageNum,
        limit: pageSize,
        totalItems: totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1
      },
      summary: summaryRow,
      data: meetings,
      userRole: user.role
    };
    if (tabCounts) payload.tabCounts = tabCounts;
    if (availableBatches) payload.availableBatches = availableBatches;
    res.status(200).json(payload);

  } catch (error) {
    console.error('❌ Error fetching meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meetings'
    });
  }
});

/**
 * Get single meeting details
 * GET /api/zoom/meeting/:id
 */
router.get('/meeting/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const meeting = await MeetingLink.findById(id)
      .populate('createdBy', 'name email')
      .populate('assignedTeacher', 'name email')
      .populate('attendees.studentId', 'name email batch level subscription studentStatus');

    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Calculate meeting status
    const now = new Date();
    const meetingStart = new Date(meeting.startTime);
    const meetingEnd = new Date(meetingStart.getTime() + meeting.duration * 60000);

    let currentStatus = meeting.status;
    if (now >= meetingStart && now <= meetingEnd && meeting.status === 'scheduled') {
      currentStatus = 'ongoing';
    } else if (now > meetingEnd && meeting.status !== 'ended') {
      currentStatus = 'ended';
    }

    const payload = {
      ...meeting.toObject(),
      currentStatus,
      isOngoing: currentStatus === 'ongoing',
      hasEnded: currentStatus === 'ended',
      canJoin: now >= new Date(meetingStart.getTime() - 10 * 60000), // Can join 10 min before
      timeUntilStart: meetingStart - now,
      attendeesCount: meeting.attendees.length,
      attendedCount: meeting.attendance?.filter(a => a.attended).length || 0
    };

    if (req.user.role === 'STUDENT') {
      payload.joinUrl = buildJoinClassProxyUrl(req, meeting._id);
    }

    res.status(200).json({
      success: true,
      data: payload
    });

  } catch (error) {
    console.error('❌ Error fetching meeting details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting details'
    });
  }
});

/**
 * Get meetings for a specific student
 * GET /api/zoom/student-meetings
 * Returns all meetings where the logged-in student is an attendee
 */
router.get('/student-meetings', verifyToken, async (req, res) => {
  try {
    const studentId = req.user.id;

    const student = await User.findById(studentId)
    .select('batch subscription currentCourseDay email goStatus');

    if(!student) {
      return res.status(404).json({
        success: false,
        message: 'Student not found'
      });
    }

    const studentDay = (student.currentCourseDay != null && Number.isFinite(Number(student.currentCourseDay)))
      ? Math.min(200, Math.max(1, Math.floor(Number(student.currentCourseDay))))
      : 1;

    const batchKeys = allStudentBatchStringsForContent(student);
    let meetings = [];
    if (batchKeys.length) {
      const batchOr = batchKeys.map((k) => ({
        batch: new RegExp(`^${String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
      }));
      meetings = await MeetingLink.find({
        $and: [
          { plan: { $in: [student.subscription, 'ALL'] } },
          { $or: batchOr }
        ]
      })
        .populate('createdBy', 'name email')
        .populate('assignedTeacher', 'name email')
        .sort({ startTime: -1 });
    }

    /** Pull saved attendance row for this student (same data as teacher/admin attendance report). */
    function studentAttendanceFromMeeting(meetingDoc, sid, studentEmail) {
      const list = Array.isArray(meetingDoc.attendance) ? meetingDoc.attendance : [];
      const idStr = sid.toString();
      let row = list.find(
        (a) => a && a.studentId && a.studentId.toString() === idStr
      );
      if (!row && studentEmail) {
        const em = String(studentEmail).toLowerCase().trim();
        row = list.find(
          (a) => a && a.email && String(a.email).toLowerCase().trim() === em
        );
      }
      if (!row) {
        return {
          attended: false,
          durationMinutes: 0,
          attendanceRowStatus: null
        };
      }
      let mins = row.durationMinutes;
      if (mins == null && row.duration != null && Number.isFinite(Number(row.duration))) {
        mins = Math.round(Number(row.duration) / 60);
      }
      mins = Number.isFinite(Number(mins)) ? Math.max(0, Number(mins)) : 0;
      const attended =
        row.attended === true ||
        row.status === 'attended' ||
        row.status === 'late';
      return {
        attended,
        durationMinutes: mins,
        attendanceRowStatus: row.status || null
      };
    }

    // Calculate meeting status for each meeting
    const now = new Date();
    const meetingsWithStatus = meetings.map(meeting => {
      const meetingStart = new Date(meeting.startTime);
      const meetingEnd = new Date(meetingStart.getTime() + meeting.duration * 60000);
      const rawCd = meeting.courseDay;
      const journeyLocked =
        rawCd != null &&
        Number.isFinite(Number(rawCd)) &&
        Number(rawCd) > studentDay;

      let currentStatus = meeting.status;
      let canJoin = false;
      let timeUntilStart = meetingStart - now;

      if (now >= meetingStart && now <= meetingEnd && meeting.status === 'scheduled') {
        currentStatus = 'ongoing';
      } else if (now > meetingEnd) {
        currentStatus = 'ended';
      }

      if (!journeyLocked) {
        if (currentStatus === 'ongoing') {
          canJoin = true;
        } else if (currentStatus !== 'ended' && now >= new Date(meetingStart.getTime() - 10 * 60000)) {
          canJoin = true;
        }
      }

      // Authenticated join redirect (injects portal display name + JoinLog); do not expose raw Zoom joinUrl to students
      const joinUrl = buildJoinClassProxyUrl(req, meeting._id);

      const att = studentAttendanceFromMeeting(meeting, studentId, student.email);

      return {
        _id: meeting._id,
        topic: meeting.topic,
        batch: meeting.batch,
        plan: meeting.plan,
        startTime: meeting.startTime,
        duration: meeting.duration,
        courseDay: meeting.courseDay != null ? meeting.courseDay : null,
        journeyLocked,
        attended: att.attended,
        durationMinutes: att.durationMinutes,
        attendedDurationMinutes: att.durationMinutes,
        attendanceStatus: att.attendanceRowStatus,
        teacher: {
          name: meeting.assignedTeacher?.name || meeting.createdBy?.name || 'Unknown',
          email: meeting.assignedTeacher?.email || meeting.createdBy?.email || ''
        },
        joinUrl,
        password: resolveMeetingJoinPwd(meeting),
        status: meeting.status,
        currentStatus: currentStatus,
        canJoin: canJoin,
        isOngoing: currentStatus === 'ongoing',
        hasEnded: currentStatus === 'ended',
        timeUntilStart: timeUntilStart,
        agenda: meeting.agenda,
        isPersonalUrl: false
      };
    });

    res.status(200).json({
      success: true,
      count: meetingsWithStatus.length,
      data: meetingsWithStatus
    });

  } catch (error) {
    console.error('❌ Error fetching student meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meetings'
    });
  }
});

/**
 * Get students by batch for selection
 * GET /api/zoom/students/:batch
 */
router.get('/students/:batch', verifyToken, async (req, res) => {
  try {
    const { batch } = req.params;

    const students = await User.find({
      role: 'STUDENT',
      batch: batch,
      isActive: true
    })
    .select('name email batch level subscription studentStatus')
    .sort({ name: 1 });

    res.status(200).json({
      success: true,
      count: students.length,
      data: students
    });

  } catch (error) {
    console.error('❌ Error fetching students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

/**
 * Get all students (for multi-batch selection)
 * GET /api/zoom/students
 */
router.get('/students', verifyToken, async (req, res) => {
  try {
    const { batch, level, subscription } = req.query;
    
    const query = {
      role: 'STUDENT',
      isActive: true
    };

    if (batch) query.batch = batch;
    if (level) query.level = level;
    if (subscription) query.subscription = subscription;

    const students = await User.find(query)
      .select('name email batch level subscription studentStatus')
      .sort({ batch: 1, name: 1 });

    res.status(200).json({
      success: true,
      count: students.length,
      data: students
    });

  } catch (error) {
    console.error('❌ Error fetching students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
});

/**
 * Update meeting (add/remove attendees)
 * PUT /api/zoom/meeting/:id/attendees
 */
router.put('/meeting/:id/attendees', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { addStudentIds, removeStudentIds } = req.body;

    const meeting = await MeetingLink.findById(id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Add new students
    if (addStudentIds && addStudentIds.length > 0) {
      const newStudents = await User.find({
        _id: { $in: addStudentIds },
        role: 'STUDENT'
      }).select('name email');

      const attendees = newStudents.map(student => ({
        email: student.email,
        name: student.name
      }));

      // No registration needed — students use the shared join URL
      newStudents.forEach(student => {
        meeting.attendees.push({
          studentId: student._id,
          name: student.name,
          email: student.email,
          joinUrl: meeting.joinUrl
        });
      });

      // If the ~10 min reminder already went out, notify new students immediately; otherwise cron includes them
      if (meeting.reminderEmailSent) {
        try {
          const transporter = require('../config/emailConfig');
          const { sendInvitationEmailsToAttendees } = require('../services/zoomInvitationEmail');
          const onlyAttendees = newStudents.map((s) => ({
            name: s.name,
            email: s.email,
            joinUrl: meeting.joinUrl
          }));
          console.log(`📧 Sending portal join reminders to ${newStudents.length} newly added students (reminder already sent)...`);
          await sendInvitationEmailsToAttendees(meeting, transporter, {
            onlyAttendees,
            subject: '🎓 Class reminder — join via portal (Glück Global)',
            introParagraph:
              'You have been added to this class. It is starting soon — join through the student portal using the steps below (no join link is sent by email).'
          });
        } catch (emailError) {
          console.error('⚠️ Error sending emails to new attendees (non-critical):', emailError.message);
        }
      }
    }

    // Remove students
    if (removeStudentIds && removeStudentIds.length > 0) {
      meeting.attendees = meeting.attendees.filter(
        attendee => !removeStudentIds.includes(attendee.studentId.toString())
      );
    }

    await meeting.save();

    res.status(200).json({
      success: true,
      message: 'Attendees updated successfully',
      data: meeting
    });

  } catch (error) {
    console.error('❌ Error updating attendees:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update attendees'
    });
  }
});

/**
 * Update meeting details (topic, time, duration, agenda, etc.)
 * PUT /api/zoom/meeting/:id
 */
router.put('/meeting/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      topic,
      startTime,
      duration,
      timezone,
      agenda,
      settings,
      courseDay
    } = req.body;

    // Find meeting in database
    const meeting = await MeetingLink.findById(id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check if user has permission to edit this meeting
    const user = await User.findById(req.user.id).select('role');
    const isOwnerOrAssigned = meeting.createdBy.toString() === req.user.id ||
      (meeting.assignedTeacher && meeting.assignedTeacher.toString() === req.user.id);
    if ((user.role === 'TEACHER' || user.role === 'TEACHER_ADMIN') && !isOwnerOrAssigned) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit meetings assigned to you'
      });
    }

    const prevStartMs = meeting.startTime ? new Date(meeting.startTime).getTime() : null;

    // Prepare update data for Zoom
    const zoomUpdateData = {};
    
    if (topic) zoomUpdateData.topic = topic;
    if (startTime) zoomUpdateData.start_time = startTime;
    if (duration) zoomUpdateData.duration = duration;
    if (timezone) zoomUpdateData.timezone = timezone;
    if (agenda) zoomUpdateData.agenda = agenda;
    if (settings) zoomUpdateData.settings = {
      ...settings,
      // Ensure registration settings remain correct
      approval_type: 0,
      registration_type: 1,
      waiting_room: false,
      registrants_email_notification: false,
      registrants_confirmation_email: false
    };

    // Update meeting in Zoom
    if (Object.keys(zoomUpdateData).length > 0) {
      console.log('📝 Updating Zoom meeting:', meeting.zoomMeetingId);
      await zoomService.updateMeeting(meeting.zoomMeetingId, zoomUpdateData);
    }

    // Update meeting in database
    if (topic) meeting.topic = topic;
    if (startTime) {
      const nextStartMs = new Date(startTime).getTime();
      meeting.startTime = new Date(startTime);
      if (prevStartMs !== nextStartMs) {
        meeting.reminderEmailSent = false;
        meeting.reminderEmailSentAt = undefined;
      }
    }
    if (duration) meeting.duration = duration;
    if (timezone) meeting.timezone = timezone;
    if (agenda) meeting.agenda = agenda;
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'courseDay')) {
      if (courseDay === null || courseDay === '') {
        meeting.courseDay = null;
      } else {
        const n = parseInt(String(courseDay), 10);
        meeting.courseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
      }
    }

    await meeting.save();

    // ✅ UPDATE TIMETABLE if time changed
    if (startTime) {
      try {
        const TimeTable = require('../models/TimeTable');
        const newMeetingDate = new Date(startTime);
        
        // Get new day of week
        const newDayOfWeek = newMeetingDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          timeZone: 'Asia/Kolkata' 
        }).toLowerCase();
        
        // Get new time
        const newMeetingTime = newMeetingDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kolkata'
        });

        // Calculate new end time
        const newEndDate = new Date(newMeetingDate.getTime() + (duration || meeting.duration) * 60000);
        const newEndTime = newEndDate.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: 'Asia/Kolkata'
        });

        console.log('🔄 Updating timetable for meeting time change:', {
          batch: meeting.batch,
          newDayOfWeek,
          newTime: `${newMeetingTime} - ${newEndTime}`
        });

        // Find timetable that covers the new date
        let timetable = await TimeTable.findOne({
          batch: meeting.batch,
          plan: meeting.plan,
          weekStartDate: { $lte: newMeetingDate },
          weekEndDate: { $gte: newMeetingDate }
        });

        if (timetable) {
          // Remove from old slot (find by zoomMeetingId)
          const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
          for (const day of days) {
            if (timetable[day] && Array.isArray(timetable[day])) {
              const slotIndex = timetable[day].findIndex(slot => 
                slot.zoomMeetingId === meeting.zoomMeetingId
              );
              if (slotIndex !== -1) {
                // Remove from old day
                timetable[day].splice(slotIndex, 1);
                break;
              }
            }
          }

          // Add to new day/time
          if (!timetable[newDayOfWeek]) {
            timetable[newDayOfWeek] = [];
          }

          timetable[newDayOfWeek].push({
            start: newMeetingTime,
            end: newEndTime,
            classStatus: 'Scheduled',
            zoomMeetingId: meeting.zoomMeetingId,
            zoomJoinUrl: meeting.joinUrl,
            zoomPassword: meeting.zoomPassword,
            meetingLinked: true
          });

          await timetable.save();
          console.log('✅ Timetable updated for meeting time change');
        }
      } catch (timetableError) {
        console.error('⚠️ Error updating timetable (non-critical):', timetableError.message);
      }
    }

    scheduleDispatchEvent({
      event: 'REMINDER_UPDATED',
      entity: { ...sanitizeMeetingLink(meeting), type: 'MeetingLink' },
      metaOverrides: { syncMode: 'live' }
    });

    res.status(200).json({
      success: true,
      message: 'Meeting updated successfully',
      data: meeting
    });

  } catch (error) {
    console.error('❌ Error updating meeting:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update meeting'
    });
  }
});

/**
 * Bulk update scheduled meetings (metadata + attendees)
 * POST /api/zoom/meetings/bulk-update
 *
 * Body: { meetingIds, updates: { duration?, topic?, agenda?, courseDay?, assignedTeacher?, startTime?, startClockTime? },
 *         attendeeUpdates: { addStudentIds?, removeStudentIds? } }
 *
 * startClockTime (HH:mm, IST): keeps each meeting's date and applies the new wall-clock time.
 */
function applyClockTimeToMeetingDate(existingStart, clockHHmm) {
  const cur = new Date(existingStart);
  if (Number.isNaN(cur.getTime())) {
    throw new Error('Invalid existing start time');
  }
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(cur);
  const [hh, mm] = String(clockHHmm).trim().split(':');
  const iso = `${datePart}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00+05:30`;
  const next = new Date(iso);
  if (Number.isNaN(next.getTime())) {
    throw new Error('Invalid start clock time');
  }
  return next.toISOString();
}

router.post('/meetings/bulk-update', verifyToken, async (req, res) => {
  try {
    const { meetingIds, updates = {}, attendeeUpdates = {} } = req.body;

    if (!Array.isArray(meetingIds) || meetingIds.length === 0) {
      return res.status(400).json({ success: false, message: 'meetingIds must be a non-empty array' });
    }

    if (updates.startClockTime && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(String(updates.startClockTime).trim())) {
      return res.status(400).json({ success: false, message: 'Invalid startClockTime (use HH:mm)' });
    }

    const validIds = meetingIds.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));
    if (validIds.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid meeting IDs provided' });
    }

    const requestingUser = await User.findById(req.user.id).select('role');
    const isAdminUser = requestingUser.role === 'ADMIN' || requestingUser.role === 'SUB_ADMIN';

    // Pre-load students to add (done once, reused per meeting)
    const { addStudentIds = [], removeStudentIds = [] } = attendeeUpdates;
    let studentsToAdd = [];
    if (addStudentIds.length > 0) {
      studentsToAdd = await User.find({
        _id: { $in: addStudentIds },
        role: 'STUDENT'
      }).select('name email');
    }

    // Pre-validate assignedTeacher if supplied
    let newTeacher = null;
    if (updates.assignedTeacher) {
      newTeacher = await User.findById(updates.assignedTeacher).select('name email role');
      if (!newTeacher || !['TEACHER', 'TEACHER_ADMIN'].includes(newTeacher.role)) {
        return res.status(400).json({ success: false, message: 'Invalid assignedTeacher ID' });
      }
    }

    const results = [];
    const CHUNK = 10;

    for (let i = 0; i < validIds.length; i += CHUNK) {
      const chunk = validIds.slice(i, i + CHUNK);

      await Promise.all(chunk.map(async (meetingId) => {
        try {
          const meeting = await MeetingLink.findById(meetingId);
          if (!meeting) {
            results.push({ meetingId, success: false, message: 'Meeting not found' });
            return;
          }

          // Status guard — only scheduled meetings
          if (meeting.status !== 'scheduled') {
            results.push({ meetingId, success: false, message: `Cannot edit a meeting with status "${meeting.status}"` });
            return;
          }

          // Permission guard for teachers
          if (!isAdminUser) {
            const isOwner = meeting.createdBy && meeting.createdBy.toString() === req.user.id;
            const isAssigned = meeting.assignedTeacher && meeting.assignedTeacher.toString() === req.user.id;
            if (!isOwner && !isAssigned) {
              results.push({ meetingId, success: false, message: 'Permission denied for this meeting' });
              return;
            }
          }

          // ---- Metadata updates ----
          const { duration, topic, agenda, courseDay, startTime, startClockTime } = updates;
          const zoomUpdateData = {};
          const prevStartMs = meeting.startTime ? new Date(meeting.startTime).getTime() : null;

          let effectiveStartTime = null;
          if (startClockTime) {
            if (!meeting.startTime) {
              results.push({ meetingId, success: false, message: 'Meeting has no start time to update' });
              return;
            }
            try {
              effectiveStartTime = applyClockTimeToMeetingDate(meeting.startTime, startClockTime);
            } catch (clockErr) {
              results.push({ meetingId, success: false, message: clockErr.message || 'Invalid start clock time' });
              return;
            }
          } else if (startTime) {
            effectiveStartTime = startTime;
          }

          if (topic) { zoomUpdateData.topic = topic; meeting.topic = topic; }
          if (duration) { zoomUpdateData.duration = duration; meeting.duration = duration; }
          if (agenda !== undefined && agenda !== null) { zoomUpdateData.agenda = agenda; meeting.agenda = agenda; }
          if (effectiveStartTime) {
            zoomUpdateData.start_time = effectiveStartTime;
            const nextStartMs = new Date(effectiveStartTime).getTime();
            meeting.startTime = new Date(effectiveStartTime);
            if (prevStartMs !== nextStartMs) {
              meeting.reminderEmailSent = false;
              meeting.reminderEmailSentAt = undefined;
            }
          }
          if (Object.prototype.hasOwnProperty.call(updates, 'courseDay')) {
            if (courseDay === null || courseDay === '') {
              meeting.courseDay = null;
            } else {
              const n = parseInt(String(courseDay), 10);
              meeting.courseDay = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : null;
            }
          }
          if (newTeacher) {
            meeting.assignedTeacher = newTeacher._id;
          }

          // Sync Zoom if anything changed
          if (Object.keys(zoomUpdateData).length > 0) {
            try {
              await zoomService.updateMeeting(meeting.zoomMeetingId, zoomUpdateData);
            } catch (zoomErr) {
              results.push({ meetingId, success: false, message: `Zoom update failed: ${zoomErr.message}` });
              return;
            }
          }

          await meeting.save();

          // Update timetable end-time slot when start time (or duration) changes
          if (effectiveStartTime || duration) {
            try {
              const TimeTable = require('../models/TimeTable');
              const refDate = effectiveStartTime ? new Date(effectiveStartTime) : new Date(meeting.startTime);
              const dayOfWeek = refDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).toLowerCase();
              const slotStart = refDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
              const endDate = new Date(refDate.getTime() + (duration || meeting.duration) * 60000);
              const slotEnd = endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

              const timetable = await TimeTable.findOne({
                batch: meeting.batch,
                plan: meeting.plan,
                weekStartDate: { $lte: refDate },
                weekEndDate: { $gte: refDate }
              });

              if (timetable) {
                const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                for (const day of days) {
                  if (!Array.isArray(timetable[day])) continue;
                  const slotIdx = timetable[day].findIndex((s) => s.zoomMeetingId === meeting.zoomMeetingId);
                  if (slotIdx !== -1) {
                    if (effectiveStartTime) {
                      // Move to new day
                      timetable[day].splice(slotIdx, 1);
                      if (!timetable[dayOfWeek]) timetable[dayOfWeek] = [];
                      timetable[dayOfWeek].push({ start: slotStart, end: slotEnd, classStatus: 'Scheduled', zoomMeetingId: meeting.zoomMeetingId, zoomJoinUrl: meeting.joinUrl, zoomPassword: meeting.zoomPassword, meetingLinked: true });
                    } else {
                      // Only end time changed (duration update)
                      timetable[day][slotIdx].end = slotEnd;
                    }
                    await timetable.save();
                    break;
                  }
                }
              }
            } catch (ttErr) {
              // Non-critical — log and continue
              console.error(`⚠️ Timetable update failed for meeting ${meetingId}:`, ttErr.message);
            }
          }

          // ---- Attendee updates ----
          if (studentsToAdd.length > 0) {
            const existingIds = new Set(meeting.attendees.map((a) => a.studentId.toString()));
            const genuinelyNew = studentsToAdd.filter((s) => !existingIds.has(s._id.toString()));
            genuinelyNew.forEach((student) => {
              meeting.attendees.push({ studentId: student._id, name: student.name, email: student.email, joinUrl: meeting.joinUrl });
            });

            if (genuinelyNew.length > 0) {
              await meeting.save();
              // Send invite emails if the 10-min reminder already went out
              if (meeting.reminderEmailSent) {
                try {
                  const transporter = require('../config/emailConfig');
                  const { sendInvitationEmailsToAttendees } = require('../services/zoomInvitationEmail');
                  await sendInvitationEmailsToAttendees(meeting, transporter, {
                    onlyAttendees: genuinelyNew.map((s) => ({ name: s.name, email: s.email, joinUrl: meeting.joinUrl })),
                    subject: '🎓 Class reminder — join via portal (Glück Global)',
                    introParagraph: 'You have been added to this class. It is starting soon — join through the student portal using the steps below.'
                  });
                } catch (emailErr) {
                  console.error(`⚠️ Email failed for new attendees on meeting ${meetingId}:`, emailErr.message);
                }
              }
            }
          }

          if (removeStudentIds.length > 0) {
            meeting.attendees = meeting.attendees.filter((a) => !removeStudentIds.includes(a.studentId.toString()));
            await meeting.save();
          }

          // CRM webhook
          scheduleDispatchEvent({
            event: 'REMINDER_UPDATED',
            entity: { ...sanitizeMeetingLink(meeting), type: 'MeetingLink' },
            metaOverrides: { syncMode: 'live' }
          });

          results.push({ meetingId, success: true });
        } catch (perMeetingErr) {
          console.error(`❌ Bulk update error for meeting ${meetingId}:`, perMeetingErr.message);
          results.push({ meetingId, success: false, message: perMeetingErr.message || 'Unexpected error' });
        }
      }));
    }

    const updatedCount = results.filter((r) => r.success).length;
    const failedCount = results.length - updatedCount;

    res.status(200).json({
      success: true,
      summary: { total: results.length, updated: updatedCount, failed: failedCount },
      results
    });
  } catch (error) {
    console.error('❌ Error in bulk-update meetings:', error);
    res.status(500).json({ success: false, message: error.message || 'Bulk update failed' });
  }
});

/**
 * Delete Zoom meeting
 * DELETE /api/zoom/meeting/:id
 */
router.delete('/meeting/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    const meeting = await MeetingLink.findById(id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // ✅ UNLINK FROM TIMETABLE: Remove Zoom meeting info from timetable slot
    try {
      const TimeTable = require('../models/TimeTable');
      const meetingDate = new Date(meeting.startTime);
      
      // Get day of week
      const dayOfWeek = meetingDate.toLocaleDateString('en-US', { 
        weekday: 'long', 
        timeZone: 'Asia/Kolkata' 
      }).toLowerCase();

      console.log('🔍 Unlinking meeting from timetable:', {
        batch: meeting.batch,
        dayOfWeek,
        zoomMeetingId: meeting.zoomMeetingId
      });

      // Find timetable that covers this date
      const timetable = await TimeTable.findOne({
        batch: meeting.batch,
        weekStartDate: { $lte: meetingDate },
        weekEndDate: { $gte: meetingDate }
      });

      if (timetable) {
        const daySlots = timetable[dayOfWeek];
        
        if (daySlots && Array.isArray(daySlots)) {
          // Find slot with this Zoom meeting ID
          const slotIndex = daySlots.findIndex(slot => 
            slot.zoomMeetingId === meeting.zoomMeetingId
          );

          if (slotIndex !== -1) {
            // Remove Zoom meeting info from slot
            timetable[dayOfWeek][slotIndex].zoomMeetingId = undefined;
            timetable[dayOfWeek][slotIndex].zoomJoinUrl = undefined;
            timetable[dayOfWeek][slotIndex].zoomPassword = undefined;
            timetable[dayOfWeek][slotIndex].meetingLinked = false;
            
            await timetable.save();
            console.log('✅ Timetable slot unlinked from Zoom meeting');
          }
        }
      }
    } catch (unlinkError) {
      console.error('⚠️ Error unlinking from timetable (non-critical):', unlinkError.message);
      // Don't fail the meeting deletion if timetable unlinking fails
    }

    // ✅ SEND CANCELLATION EMAILS TO STUDENTS
    try {
      const transporter = require('../config/emailConfig');
      
      // Populate student details if not already populated
      const meetingWithStudents = await MeetingLink.findById(id)
        .populate('attendees.studentId', 'name email');
      
      const students = meetingWithStudents.attendees
        .filter(a => a.studentId) // Only students with valid IDs
        .map(a => ({
          name: a.studentId.name || a.name,
          email: a.studentId.email || a.email
        }));

      if (students.length > 0) {
        console.log(`📧 Sending cancellation emails to ${students.length} students...`);
        
        for (const student of students) {
          try {
            const mailOptions = {
              from: process.env.EMAIL_USER,
              to: student.email,
              subject: '❗ Meeting Cancelled - Glück Global',
              html: `
                <div style="font-family: Arial, sans-serif; text-align:center; background:#f9f9f9; padding:20px;">
                  <div style="max-width:600px; margin:auto; background:#fff; padding:20px; border-radius:8px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                    
                    <div style="background:#dc3545; border-radius:8px; padding:20px;">
                      <h2 style="color:white; margin:0;">⚠️ Meeting Cancelled</h2>
                    </div>

                    <p style="margin-top:20px;">Hello <strong>${student.name}</strong>,</p>
                    
                    <p>We regret to inform you that the following Zoom meeting has been <strong>cancelled</strong>:</p>

                    <div style="background:#f5f5f5; padding:15px; border-radius:8px; margin:20px 0; border-left:4px solid #dc3545;">
                      <h3 style="color:#dc3545; margin:0 0 10px 0;">${meeting.topic}</h3>
                      <p style="margin:5px 0;"><strong>📅 Date:</strong> ${new Date(meeting.startTime).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric',
                        timeZone: 'Asia/Kolkata'
                      })}</p>
                      <p style="margin:5px 0;"><strong>🕐 Time:</strong> ${new Date(meeting.startTime).toLocaleTimeString('en-US', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        timeZone: 'Asia/Kolkata'
                      })}</p>
                      <p style="margin:5px 0;"><strong>👥 Batch:</strong> ${meeting.batch}</p>
                    </div>

                    <div style="background:#fff3cd; border:1px solid #ffc107; padding:15px; border-radius:6px; margin:20px 0;">
                      <p style="margin:0; color:#856404;">
                        <strong>📢 Important:</strong> This meeting has been cancelled due to unforeseen circumstances. 
                        We apologize for any inconvenience this may cause.
                      </p>
                    </div>

                    <p style="margin-top:20px;">
                      Please check your timetable for the next scheduled class. 
                      If you have any questions, please contact your teacher.
                    </p>

                    <p style="margin-top:30px; color:#666; font-size:13px;">
                      Regular classes will continue as per the normal schedule.
                    </p>

                    <hr style="border:none; border-top:1px solid #ddd; margin:30px 0;">

                    <p style="font-size:13px; color:#888;">
                      Best regards,<br>
                      <strong>Glück Global Pvt Ltd</strong><br>
                      German Language Learning Platform
                    </p>
                  </div>
                </div>
              `
            };

            await transporter.sendMail(mailOptions);
            console.log(`✅ Cancellation email sent to ${student.name} (${student.email})`);
          } catch (emailError) {
            console.error(`❌ Failed to send cancellation email to ${student.email}:`, emailError.message);
          }
        }

        console.log(`✅ Cancellation emails sent to ${students.length} students`);
      }
    } catch (emailError) {
      console.error('⚠️ Error sending cancellation emails (non-critical):', emailError.message);
    }

    // Delete from Zoom
    if (meeting.zoomMeetingId) {
      await zoomService.deleteMeeting(meeting.zoomMeetingId);
    }

    scheduleDispatchEvent({
      event: 'REMINDER_DELETED',
      entity: { ...sanitizeMeetingLink(meeting), type: 'MeetingLink' },
      metaOverrides: { syncMode: 'live' }
    });

    // Delete from database
    await MeetingLink.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Meeting deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete meeting'
    });
  }
});

/**
 * Get meeting participants for attendance
 * GET /api/zoom/meeting/:meetingId/participants
 */
router.get('/meeting/:meetingId/participants', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    const participants = await zoomService.getMeetingParticipants(meetingId);

    res.status(200).json({
      success: true,
      count: participants.length,
      data: participants
    });

  } catch (error) {
    console.error('❌ Error fetching participants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch participants'
    });
  }
});

/**
 * Get detailed meeting report with attendance
 * GET /api/zoom/meeting/:meetingId/report
 */
router.get('/meeting/:meetingId/report', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    const report = await zoomService.getMeetingReport(meetingId);

    res.status(200).json(report);

  } catch (error) {
    console.error('❌ Error fetching meeting report:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch meeting report'
    });
  }
});

/**
 * Get attendance for a specific meeting from database
 * GET /api/zoom/meeting/:id/attendance
 */
router.get('/meeting/:id/attendance', verifyToken, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const { id } = req.params;

    const meeting = await MeetingLink.findById(id);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }

    // Check if meeting has ended
    const now = new Date();
    const meetingEndTime = new Date(meeting.startTime.getTime() + meeting.duration * 60000);
    
    if (now < meetingEndTime) {
      return res.status(400).json({
        success: false,
        message: 'Meeting has not ended yet. Attendance data will be available after the meeting ends.'
      });
    }

    // Fetch attendance from Zoom
    let zoomReport;
    try {
      console.log('🔍 Fetching Zoom report for meeting:', meeting.zoomMeetingId);
      zoomReport = await zoomService.getMeetingReport(meeting.zoomMeetingId, {
        meetingUuid: meeting.zoomMeetingUuid,
        expectedStartTime: meeting.startTime
      });
      console.log('✅ Zoom report received:', {
        success: zoomReport.success,
        participantCount: zoomReport.participants?.length || 0,
        meetingDuration: zoomReport.meeting?.duration || 'unknown'
      });
    } catch (error) {
      console.error('❌ Failed to get Zoom report:', error.message);
      return res.status(400).json({
        success: false,
        message: 'Attendance data not yet available. Please try again in a few minutes after the meeting ends.'
      });
    }

    // Enhanced matching with confidence scores
    console.log('🔍 Starting enhanced matching...');
    console.log('📊 Meeting attendees:', meeting.attendees.length);
    console.log('📊 Zoom participants:', zoomReport.participants?.length || 0);
    
    if (zoomReport.participants) {
      console.log('👥 Sample Zoom participant:', zoomReport.participants[0]);
    }
    if (meeting.attendees.length > 0) {
      console.log('👥 Sample meeting attendee:', meeting.attendees[0]);
    }

    const joinData = await getJoinLogDataForMeeting(meeting._id);
    const joinLogMap = joinData.firstJoinByStudent;
    const joinPresence = joinData.hasJoin;
    const portalJoins = await getPortalJoinsForMeeting(meeting._id, meeting.attendees);

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

    // Preserve teacher/admin manual Zoom↔student links across reloads (GET used to overwrite these every time)
    const manualByStudentId = new Map();
    for (const row of meeting.attendance || []) {
      if (
        row &&
        row.studentId &&
        ['manual_map', 'manual_mark', 'manual_mark_all'].includes(row.matchMethod)
      ) {
        manualByStudentId.set(row.studentId.toString(), row);
      }
    }

    const attendanceData = meeting.attendees.map(attendee => {
      const sid = attendee.studentId && attendee.studentId.toString();
      const manualRow = sid ? manualByStudentId.get(sid) : null;
      if (manualRow) {
        const m = manualRow.toObject ? manualRow.toObject() : { ...manualRow };
        const clickedJoin = sid ? joinPresence.has(sid) : false;
        const fc = m.confidence != null ? m.confidence : 100;
        return {
          studentId: attendee.studentId,
          name: attendee.name,
          email: attendee.email,
          attended: m.attended !== undefined ? m.attended : false,
          confidence: fc,
          finalConfidence: fc,
          confidenceLevel: fc >= 85 ? 'high' : fc >= 65 ? 'medium' : 'low',
          matchMethod: 'manual_map',
          zoomName: m.zoomName || null,
          zoomEmail: m.zoomEmail || null,
          joinTime: m.joinTime || null,
          leaveTime: m.leaveTime || null,
          duration: m.duration != null ? m.duration : 0,
          durationMinutes: m.durationMinutes != null ? m.durationMinutes : 0,
          attendancePercent: m.attendancePercent != null ? m.attendancePercent : 0,
          status: m.status || 'absent',
          needsReview: !!m.needsReview,
          clickedJoin,
          appearedInZoom: !!(m.zoomName || m.joinTime || m.duration),
          mismatchReason: null,
          debugSummary: 'Manual map by admin',
          debug: {
            portalName: attendee.name,
            zoomName: m.zoomName || null,
            matchMethod: 'manual_map',
            traceId: String(traceId),
          },
        };
      }

      const joinLogJoinedAt = sid ? joinLogMap.get(sid) : undefined;
      const clickedJoin = sid ? joinPresence.has(sid) : false;
      const matchResult = findBestParticipantMatch(attendee, zoomReport.participants, {
        joinLogJoinedAt,
        logContext: { meetingId: meeting._id, studentId: sid },
        meetingDurationSec: (meeting.duration || 60) * 60,
        traceId,
        claimedParticipants,
      });
      const participantDuration = matchResult.match?.durationMinutes || 0;
      const meetingDuration = meeting.duration || 60;
      const attendancePercent = meetingDuration > 0 ? (participantDuration / meetingDuration) * 100 : 0;
      const meetsThreshold = !!matchResult.match && attendancePercent >= 70;

      if (attendanceDebugEnabled()) {
        attendanceDebug('ATTENDANCE_MATCH', {
          participantName: matchResult.match?.name ?? null,
          participantEmail: matchResult.match?.email ?? null,
          matchedStudent: matchResult.match ? attendee.name : null,
          confidence: matchResult.finalConfidence ?? matchResult.confidence,
          duration: participantDuration,
          method: matchResult.method,
          studentId: sid,
          traceId: String(traceId),
        });
      }

      if (!matchResult.match) {
        attendanceWarn('Attendance match failed', {
          studentId: sid,
          attendeeName: attendee.name,
          attendeeEmail: attendee.email,
          method: matchResult.method,
          debugSummary: matchResult.debugSummary,
          mismatchReason: matchResult.mismatchReason,
          traceId: String(traceId),
        });
      }

      return buildAttendanceRowFromMatch(attendee, matchResult, {
        meetingDurationMinutes: meetingDuration,
        clickedJoin,
        traceId,
      });
    });

    applyAttendanceStabilityPass(attendanceData, traceId);

    // Calculate matching statistics
    const matchingStats = {
      emailMatches: attendanceData.filter(a => a.matchMethod === 'email').length,
      exactNameMatches: attendanceData.filter(a => a.matchMethod === 'exact_name').length,
      exactTrimNameMatches: attendanceData.filter(a => a.matchMethod === 'exact_trim_name').length,
      sanitizedNameMatches: attendanceData.filter(a => a.matchMethod === 'sanitized_name').length,
      partialNameMatches: attendanceData.filter(a => a.matchMethod === 'partial_name').length,
      fuzzyMatches: attendanceData.filter(a => a.matchMethod === 'fuzzy_name').length,
      manualReviewRequired: attendanceData.filter(a => a.needsReview).length,
      highConfidenceMatches: attendanceData.filter(a => a.confidence >= 80).length
    };

    // Update meeting with attendance data
    meeting.attendance = attendanceData;
    meeting.attendanceRecorded = true;
    meeting.attendanceRecordedAt = new Date();
    await meeting.save();

    logAttendanceMatchSummary(attendanceData, meeting._id, traceId);

    try {
      const { syncPendingFlagsFromMeeting } = require('../services/journeyDayAdvance.service');
      await syncPendingFlagsFromMeeting(meeting);
    } catch (e) {
      console.warn('journey pending sync (manual attendance):', e.message);
    }

    // Invalidate Student Log daily-summary cache so student-side analytics
    // rebuild from corrected MeetingLink.attendance on next fetch.
    try {
      const ActivityDailySummary = require('../models/ActivityDailySummary');
      const ActivityDailySummaryBounds = require('../models/ActivityDailySummaryBounds');
      const batchValue = String(meeting.batch || '').trim();
      const batchKeys = ['__all__'];
      if (batchValue) batchKeys.push(batchValue);

      await Promise.all([
        ActivityDailySummary.deleteMany({ batchKey: { $in: batchKeys } }),
        ActivityDailySummaryBounds.deleteMany({ batchKey: { $in: batchKeys } })
      ]);
    } catch (e) {
      console.warn('daily-summary cache invalidation skipped:', e.message);
    }

    const normAttendStr = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
    const allParticipants = (zoomReport.participants || []).map(p => ({
      name: p.name || '',
      email: p.email || '',
      joinTime: p.joinTime || null,
      leaveTime: p.leaveTime || null,
      duration: p.duration || 0,
      durationMinutes: p.durationMinutes || 0,
      sessionCount: p.sessionCount || 1,
      isMapped: attendanceData.some(a =>
        (a.zoomEmail && p.email && normAttendStr(a.zoomEmail) === normAttendStr(p.email)) ||
        (a.zoomName && p.name && normAttendStr(a.zoomName) === normAttendStr(p.name))
      ),
      mappedTo: (() => {
        const mapped = attendanceData.find(a =>
          (a.zoomEmail && p.email && normAttendStr(a.zoomEmail) === normAttendStr(p.email)) ||
          (a.zoomName && p.name && normAttendStr(a.zoomName) === normAttendStr(p.name))
        );
        return mapped ? { name: mapped.name, email: mapped.email } : null;
      })()
    }));

    res.status(200).json({
      success: true,
      data: {
        meetingId: meeting._id,
        zoomMeetingId: meeting.zoomMeetingId,
        topic: meeting.topic,
        startTime: meeting.startTime,
        duration: meeting.duration,
        totalStudents: meeting.attendees.length,
        attendedCount: attendanceData.filter(a => a.attended).length,
        absentCount: attendanceData.filter(a => !a.attended).length,
        attendance: attendanceData,
        allParticipants: allParticipants,
        portalJoins,
        matchingStats: matchingStats,
        summary: zoomReport.summary
      }
    });

  } catch (error) {
    console.error('❌ Error fetching attendance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch attendance data'
    });
  }
});

/**
 * Manually map a Zoom participant to a batch student
 * POST /api/zoom/meeting/:id/attendance/map-participant
 */
router.post('/meeting/:id/attendance/map-participant', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { participantName, participantEmail, studentEmail } = req.body;

    if (!studentEmail) {
      return res.status(400).json({ success: false, message: 'Student email is required' });
    }

    const meeting = await MeetingLink.findById(id);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    const attendee = meeting.attendees.find(a => a.email.toLowerCase() === studentEmail.toLowerCase());
    if (!attendee) {
      return res.status(404).json({ success: false, message: 'Student not found in this batch/meeting. Check the email and try again.' });
    }

    let zoomReport;
    try {
      zoomReport = await zoomService.getMeetingReport(meeting.zoomMeetingId, {
        meetingUuid: meeting.zoomMeetingUuid,
        expectedStartTime: meeting.startTime
      });
    } catch (error) {
      return res.status(400).json({ success: false, message: 'Could not fetch Zoom data' });
    }

    const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
    const participant = (zoomReport.participants || []).find(p =>
      (participantEmail && p.email && norm(p.email) === norm(participantEmail)) ||
      (participantName && p.name && norm(p.name) === norm(participantName))
    );

    if (!participant) {
      return res.status(404).json({
        success: false,
        message: 'Zoom participant not found. Try again with the exact Zoom display name, or refresh the page in case the report updated.'
      });
    }

    const meetingDuration = meeting.duration || 60;
    const participantDuration = participant.durationMinutes || 0;
    const attendancePercent = meetingDuration > 0 ? (participantDuration / meetingDuration) * 100 : 0;
    const meetsThreshold = attendancePercent >= 70;

    const existingIdx = meeting.attendance.findIndex(
      a => a.studentId && a.studentId.toString() === attendee.studentId.toString()
    );

    const joinLogRow = await JoinLog.findOne({
      meetingId: meeting._id,
      studentId: attendee.studentId,
    })
      .select('_id')
      .lean();

    const mappedRecord = {
      studentId: attendee.studentId,
      name: attendee.name,
      email: attendee.email,
      attended: meetsThreshold,
      confidence: 100,
      finalConfidence: 100,
      confidenceLevel: 'high',
      matchMethod: 'manual_map',
      zoomName: participant.name,
      zoomEmail: participant.email || '',
      joinTime: participant.joinTime || null,
      leaveTime: participant.leaveTime || null,
      duration: participant.duration || 0,
      durationMinutes: participantDuration,
      attendancePercent: Math.round(attendancePercent),
      status: meetsThreshold ? 'attended' : 'late',
      needsReview: false,
      clickedJoin: !!joinLogRow,
      appearedInZoom: true,
      mismatchReason: null,
      debugSummary: 'Manual map by admin',
      debug: {
        portalName: attendee.name,
        zoomName: participant.name,
        matchMethod: 'manual_map',
      },
    };

    if (existingIdx >= 0) {
      meeting.attendance[existingIdx] = mappedRecord;
    } else {
      meeting.attendance.push(mappedRecord);
    }

    meeting.attendanceRecordedAt = new Date();
    await meeting.save();

    try {
      const { syncPendingFlagsFromMeeting } = require('../services/journeyDayAdvance.service');
      await syncPendingFlagsFromMeeting(meeting);
    } catch (e) {
      console.warn('journey pending sync (map-participant):', e.message);
    }

    res.status(200).json({
      success: true,
      message: `Successfully mapped "${participant.name}" to student "${attendee.name}" (${attendee.email})`,
      data: mappedRecord
    });

  } catch (error) {
    console.error('Error mapping participant:', error);
    res.status(500).json({ success: false, message: 'Failed to map participant' });
  }
});

/**
 * Manually mark one student as attended or absent.
 * POST /api/zoom/meeting/:id/attendance/manual-mark
 *
 * Body:
 *   studentId      {string}  – Mongo ObjectId of the student (or studentEmail below).
 *   studentEmail   {string}  – Student email (alternative to studentId).
 *   status         {'attended'|'absent'} – Defaults to 'attended' for backward compatibility.
 */
router.post('/meeting/:id/attendance/manual-mark', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const { studentId, studentEmail, status } = req.body || {};
    const resolvedStatus = status === 'absent' ? 'absent' : 'attended';

    if (!studentId && !studentEmail) {
      return res.status(400).json({
        success: false,
        message: 'studentId or studentEmail is required'
      });
    }

    const meeting = await MeetingLink.findById(id);
    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    const normalizedEmail = String(studentEmail || '').trim().toLowerCase();
    const attendee = meeting.attendees.find((a) =>
      (studentId && a.studentId && a.studentId.toString() === String(studentId)) ||
      (normalizedEmail && String(a.email || '').trim().toLowerCase() === normalizedEmail)
    );

    if (!attendee) {
      return res.status(404).json({
        success: false,
        message: 'Student not found in this meeting'
      });
    }

    const existingIdx = (meeting.attendance || []).findIndex(
      (a) => a.studentId && a.studentId.toString() === attendee.studentId.toString()
    );
    const existingRow = existingIdx >= 0 ? meeting.attendance[existingIdx] : null;

    const joinLogRow = await JoinLog.findOne({
      meetingId: meeting._id,
      studentId: attendee.studentId,
    })
      .select('_id')
      .lean();

    let participant = null;
    try {
      const zoomReport = await zoomService.getMeetingReport(meeting.zoomMeetingId, {
        meetingUuid: meeting.zoomMeetingUuid,
        expectedStartTime: meeting.startTime
      });
      const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
      participant = (zoomReport.participants || []).find((p) =>
        (p.email && attendee.email && norm(p.email) === norm(attendee.email)) ||
        (p.name && attendee.name && norm(p.name) === norm(attendee.name))
      ) || null;
    } catch (error) {
      participant = null;
    }

    const markedRecord = buildManualAttendanceRecord({
      attendee,
      existingRow: existingRow ? (existingRow.toObject ? existingRow.toObject() : existingRow) : null,
      meetingDuration: meeting.duration || 60,
      joinLogPresent: !!joinLogRow,
      mode: 'single',
      participant,
      status: resolvedStatus,
    });

    if (existingIdx >= 0) {
      meeting.attendance[existingIdx] = markedRecord;
    } else {
      meeting.attendance.push(markedRecord);
    }

    meeting.attendanceRecorded = true;
    meeting.attendanceRecordedAt = new Date();
    await meeting.save();

    try {
      const { syncPendingFlagsFromMeeting } = require('../services/journeyDayAdvance.service');
      await syncPendingFlagsFromMeeting(meeting);
    } catch (e) {
      console.warn('journey pending sync (manual-mark):', e.message);
    }

    res.status(200).json({
      success: true,
      message: `${attendee.name} marked as ${resolvedStatus}`,
      data: markedRecord
    });
  } catch (error) {
    console.error('Error manually marking attendance:', error);
    res.status(500).json({ success: false, message: 'Failed to mark attendance' });
  }
});

/**
 * Manually mark all students as attended
 * POST /api/zoom/meeting/:id/attendance/manual-mark-all
 */
router.post('/meeting/:id/attendance/manual-mark-all', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { id } = req.params;
    const meeting = await MeetingLink.findById(id);

    if (!meeting) {
      return res.status(404).json({ success: false, message: 'Meeting not found' });
    }

    const existingByStudent = new Map();
    for (const row of meeting.attendance || []) {
      if (row && row.studentId) {
        existingByStudent.set(row.studentId.toString(), row.toObject ? row.toObject() : row);
      }
    }

    const joinLogs = await JoinLog.find({ meetingId: meeting._id })
      .select('studentId')
      .lean();
    const joinLogStudentIds = new Set(joinLogs.map((j) => String(j.studentId)));

    let participants = [];
    try {
      const zoomReport = await zoomService.getMeetingReport(meeting.zoomMeetingId, {
        meetingUuid: meeting.zoomMeetingUuid,
        expectedStartTime: meeting.startTime
      });
      participants = Array.isArray(zoomReport.participants) ? zoomReport.participants : [];
    } catch (error) {
      participants = [];
    }

    const norm = (s) => (s == null ? '' : String(s)).trim().toLowerCase();
    const attendanceRows = meeting.attendees.map((attendee) => {
      const existingRow = existingByStudent.get(attendee.studentId.toString()) || null;
      const participant = participants.find((p) =>
        (p.email && attendee.email && norm(p.email) === norm(attendee.email)) ||
        (p.name && attendee.name && norm(p.name) === norm(attendee.name))
      ) || null;

      return buildManualAttendanceRecord({
        attendee,
        existingRow,
        meetingDuration: meeting.duration || 60,
        joinLogPresent: joinLogStudentIds.has(String(attendee.studentId)),
        mode: 'all',
        participant
      });
    });

    meeting.attendance = attendanceRows;
    meeting.attendanceRecorded = true;
    meeting.attendanceRecordedAt = new Date();
    await meeting.save();

    try {
      const { syncPendingFlagsFromMeeting } = require('../services/journeyDayAdvance.service');
      await syncPendingFlagsFromMeeting(meeting);
    } catch (e) {
      console.warn('journey pending sync (manual-mark-all):', e.message);
    }

    res.status(200).json({
      success: true,
      message: `Marked all ${attendanceRows.length} students as attended`,
      data: {
        totalMarked: attendanceRows.length
      }
    });
  } catch (error) {
    console.error('Error marking all attendance:', error);
    res.status(500).json({ success: false, message: 'Failed to mark all attendance' });
  }
});

/**
 * Get participant engagement metrics (camera/mic usage)
 * GET /api/zoom/meeting/:meetingId/engagement
 */
router.get('/meeting/:meetingId/engagement', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    console.log('📊 Fetching engagement data for meeting:', meetingId);

    const engagementData = await zoomService.getParticipantEngagement(meetingId);

    res.status(200).json({
      success: true,
      count: engagementData.length,
      data: engagementData,
      summary: {
        totalParticipants: engagementData.length,
        averageCameraOnTime: Math.round(
          engagementData.reduce((sum, p) => sum + (p.engagement?.cameraOnMinutes || 0), 0) / engagementData.length
        ),
        averageMicOnTime: Math.round(
          engagementData.reduce((sum, p) => sum + (p.engagement?.micOnMinutes || 0), 0) / engagementData.length
        ),
        averageCameraOnPercentage: Math.round(
          engagementData.reduce((sum, p) => sum + (p.engagement?.cameraOnPercentage || 0), 0) / engagementData.length
        )
      }
    });

  } catch (error) {
    console.error('❌ Error fetching engagement data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch engagement data'
    });
  }
});

/**
 * Get STUDENT engagement metrics only (excludes teachers/hosts)
 * GET /api/zoom/meeting/:meetingId/engagement/students
 */
router.get('/meeting/:meetingId/engagement/students', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    console.log('📊 Fetching STUDENT engagement data for meeting:', meetingId);

    const engagementData = await zoomService.getParticipantEngagement(meetingId);

    // Identify registered students
    let studentData;
    
    if (meeting && meeting.attendees && meeting.attendees.length > 0) {
      // Filter by registered student emails
      const studentEmails = meeting.attendees.map(a => a.email.toLowerCase());
      studentData = engagementData.filter(p => 
        p.email && studentEmails.includes(p.email.toLowerCase())
      );
    } else {
      // Fallback: Exclude hosts and co-hosts
      studentData = engagementData.filter(p => {
        const email = p.email?.toLowerCase() || '';
        const name = p.name?.toLowerCase() || '';
        
        // Exclude if email contains teacher/admin/host keywords
        const isTeacher = email.includes('teacher') || 
                         email.includes('admin') || 
                         email.includes('gluckglobal.com') ||
                         name.includes('host') ||
                         name.includes('teacher');
        
        return !isTeacher;
      });
    }

    res.status(200).json({
      success: true,
      count: studentData.length,
      data: studentData,
      summary: {
        totalStudents: studentData.length,
        averageCameraOnTime: studentData.length > 0 ? Math.round(
          studentData.reduce((sum, p) => sum + (p.engagement?.cameraOnMinutes || 0), 0) / studentData.length
        ) : 0,
        averageMicOnTime: studentData.length > 0 ? Math.round(
          studentData.reduce((sum, p) => sum + (p.engagement?.micOnMinutes || 0), 0) / studentData.length
        ) : 0,
        averageCameraOnPercentage: studentData.length > 0 ? Math.round(
          studentData.reduce((sum, p) => sum + (p.engagement?.cameraOnPercentage || 0), 0) / studentData.length
        ) : 0
      }
    });

  } catch (error) {
    console.error('❌ Error fetching student engagement data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch student engagement data'
    });
  }
});

/**
 * Get TEACHER/HOST engagement metrics only
 * GET /api/zoom/meeting/:meetingId/engagement/teacher
 */
router.get('/meeting/:meetingId/engagement/teacher', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;

    console.log('📊 Fetching TEACHER engagement data for meeting:', meetingId);

    // Get meeting from database to identify the teacher
    const meeting = await MeetingLink.findOne({ zoomMeetingId: meetingId })
      .populate('createdBy', 'name email');
    const engagementData = await zoomService.getParticipantEngagement(meetingId);
    
    let teacherData;
    
    if (meeting && meeting.hostEmail) {
      // Find by host email
      teacherData = engagementData.find(p => 
        p.email?.toLowerCase() === meeting.hostEmail.toLowerCase()
      );
    } else if (meeting && meeting.createdBy) {
      // Find by creator email
      teacherData = engagementData.find(p => 
        p.email?.toLowerCase() === meeting.createdBy.email.toLowerCase()
      );
    } else {
      // Fallback: Find hosts/co-hosts or teacher emails
      teacherData = engagementData.find(p => {
        const email = p.email?.toLowerCase() || '';
        const name = p.name?.toLowerCase() || '';
        
        return email.includes('teacher') || 
               email.includes('admin') || 
               email.includes('gluckglobal.com') ||
               name.includes('host') ||
               name.includes('teacher');
      });
    }

    if (!teacherData) {
      return res.status(404).json({
        success: false,
        message: 'Teacher/host data not found in meeting'
      });
    }

    res.status(200).json({
      success: true,
      data: teacherData,
      summary: {
        name: teacherData.name,
        email: teacherData.email,
        cameraOnTime: teacherData.engagement?.cameraOnMinutes || 0,
        cameraOnPercentage: teacherData.engagement?.cameraOnPercentage || 0,
        micOnTime: teacherData.engagement?.micOnMinutes || 0,
        micOnPercentage: teacherData.engagement?.micOnPercentage || 0,
        totalDuration: teacherData.durationMinutes || 0
      }
    });

  } catch (error) {
    console.error('❌ Error fetching teacher engagement data:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch teacher engagement data'
    });
  }
});

// ═══ EXTERNAL MEETING IMPORT ═══

/**
 * GET /api/zoom/available-hosts - Get Zoom hosts with busy status for a time slot
 */
router.get('/available-hosts', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { startTime, duration, startTimes: startTimesRaw } = req.query;
    const durationMin = Number(duration);

    if (!duration || !Number.isFinite(durationMin) || durationMin <= 0) {
      return res.status(400).json({ success: false, message: 'duration is required' });
    }

    const slotInputs = [];
    if (startTimesRaw) {
      try {
        const parsed = JSON.parse(String(startTimesRaw));
        if (Array.isArray(parsed)) {
          slotInputs.push(...parsed.map(String));
        }
      } catch {
        /* ignore malformed JSON */
      }
    }
    if (startTime) {
      slotInputs.unshift(String(startTime));
    }
    const uniqueSlots = [...new Set(slotInputs.filter(Boolean))];
    if (uniqueSlots.length === 0) {
      return res.status(400).json({ success: false, message: 'startTime or startTimes is required' });
    }

    const windows = uniqueSlots.map((slot) => {
      const meetingStart = new Date(slot);
      if (Number.isNaN(meetingStart.getTime())) {
        return null;
      }
      return {
        start: meetingStart,
        end: new Date(meetingStart.getTime() + durationMin * 60000)
      };
    }).filter(Boolean);

    if (windows.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid startTime value(s)' });
    }

    const users = await zoomService.getZoomUsers();
    const hosts = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: `${u.first_name} ${u.last_name}`.trim()
    }));

    const data = await buildHostAvailability(hosts, windows);

    res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching available hosts:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch available hosts' });
  }
});

/**
 * GET /api/zoom/external/hosts - List all Zoom users on the master account
 */
router.get('/external/hosts', verifyToken, async (req, res) => {
  try {
    const users = await zoomService.getZoomUsers();
    res.json({ success: true, hosts: users.map(u => ({ id: u.id, email: u.email, name: u.first_name + ' ' + u.last_name })) });
  } catch (error) {
    console.error('Error fetching Zoom hosts:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch Zoom hosts' });
  }
});

/**
 * GET /api/zoom/external/meetings/:hostEmail - List past meetings for a host
 */
router.get('/external/meetings/:hostEmail', verifyToken, async (req, res) => {
  try {
    const { from, to } = req.query;
    const meetings = await zoomService.getUserPastMeetings(req.params.hostEmail, from, to);

    // Check which ones are already linked in our system
    const zoomIds = meetings.map(m => String(m.id));
    const linked = await MeetingLink.find({ zoomMeetingId: { $in: zoomIds } }).select('zoomMeetingId').lean();
    const linkedSet = new Set(linked.map(l => l.zoomMeetingId));

    const enriched = meetings.map(m => ({
      ...m,
      linkedInPortal: linkedSet.has(String(m.id))
    }));

    res.json({ success: true, meetings: enriched });
  } catch (error) {
    console.error('Error fetching past meetings:', error.message);
    res.status(500).json({ success: false, message: 'Failed to fetch past meetings' });
  }
});

/**
 * POST /api/zoom/external/link - Link an external meeting to a batch and fetch attendance
 */
router.post('/external/link', verifyToken, async (req, res) => {
  try {
    const { zoomMeetingId, batch, plan, topic } = req.body;
    if (!zoomMeetingId || !batch) {
      return res.status(400).json({ success: false, message: 'zoomMeetingId and batch are required' });
    }

    // Check if already linked
    const existing = await MeetingLink.findOne({ zoomMeetingId: String(zoomMeetingId) });
    if (existing) {
      return res.status(400).json({ success: false, message: 'This meeting is already linked in the system' });
    }

    // Get meeting report from Zoom
    const report = await zoomService.getMeetingReport(String(zoomMeetingId));

    // Get students in the batch
    const studentFilter = { role: 'STUDENT', batch, studentStatus: { $in: ['ONGOING', 'UNCERTAIN'] } };
    if (plan) studentFilter.subscription = plan;
    const students = await User.find(studentFilter).select('name email').lean();

    const reportParts = report.participants || [];
    for (const p of reportParts) {
      delete p._matched;
      delete p._reserved;
      delete p._priority;
      delete p._matchedByStudent;
    }
    delete reportParts[Symbol.for('gluck.attendanceClaimMap')];
    delete reportParts[Symbol.for('gluck.attendanceTraceId')];
    const externalTraceId = new mongoose.Types.ObjectId();
    const externalClaimed = new Map();

    // Match participants to students
    const attendanceData = students.map((student) => {
      const attendee = { studentId: student._id, name: student.name, email: student.email };
      const matchResult = findBestParticipantMatch(attendee, report.participants, {
        meetingDurationSec: (report.meeting?.duration || 60) * 60,
        traceId: externalTraceId,
        claimedParticipants: externalClaimed,
        logContext: { studentId: student._id && student._id.toString() },
      });
      return buildAttendanceRowFromMatch(attendee, matchResult, {
        meetingDurationMinutes: report.meeting?.duration || 60,
        clickedJoin: false,
        traceId: externalTraceId,
      });
    });

    applyAttendanceStabilityPass(attendanceData, externalTraceId);

    // Save as a MeetingLink
    const meetingLink = new MeetingLink({
      batch,
      plan: plan || 'PLATINUM',
      platform: 'Zoom',
      link: '',
      topic: topic || report.meeting?.topic || 'External Meeting',
      startTime: report.meeting?.startTime ? new Date(report.meeting.startTime) : new Date(),
      duration: report.meeting?.duration || 60,
      zoomMeetingId: String(zoomMeetingId),
      zoomMeetingUuid: report.meeting?.uuid ? String(report.meeting.uuid) : undefined,
      hostEmail: report.meeting?.hostId || '',
      createdBy: req.user.id,
      attendees: students.map(s => ({ studentId: s._id, name: s.name, email: s.email, joinUrl: '' })),
      attendance: attendanceData,
      attendanceRecorded: true,
      attendanceRecordedAt: new Date(),
      status: 'ended'
    });

    await meetingLink.save();

    const attended = attendanceData.filter(a => a.attended).length;

    res.json({
      success: true,
      message: `Meeting linked. ${attended}/${students.length} students marked as attended.`,
      data: {
        meetingId: meetingLink._id,
        topic: meetingLink.topic,
        attended,
        total: students.length,
        attendance: attendanceData
      }
    });
  } catch (error) {
    console.error('Error linking external meeting:', error.message);
    res.status(500).json({ success: false, message: error.message || 'Failed to link meeting' });
  }
});

/**
 * GET /api/zoom/teachers - Get all teachers for admin meeting creation
 */
router.get('/teachers', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const teachers = await User.find({
      role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
      isActive: true
    }).select('name email assignedBatches medium').sort({ name: 1 });

    res.json({ success: true, data: teachers });
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch teachers' });
  }
});

/**
 * POST /api/zoom/enforce-private-chat-off
 * One-time (or periodic) admin action: disable private chat at the Zoom
 * account level AND for every individual licensed host.
 * Run this once after deployment to close the gap for existing host accounts.
 */
router.post('/enforce-private-chat-off', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const results = await zoomService.disablePrivateChatForAllUsers();
    const failed = results.filter(r => !r.success);
    res.json({
      success: true,
      message: `Private chat enforcement complete. ${results.length - failed.length}/${results.length} targets updated.`,
      results,
      ...(failed.length ? { warnings: failed } : {})
    });
  } catch (error) {
    console.error('Error enforcing private chat off:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
