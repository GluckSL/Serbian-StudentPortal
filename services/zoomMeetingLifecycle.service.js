/**
 * Shared Zoom meeting creation: MeetingLink persistence, CRM reminder dispatch,
 * and TimeTable auto-link — extracted from routes/zoom.js for reuse by bulk journey flow.
 */

const MeetingLink = require('../models/MeetingLink');
const zoomService = require('./zoomService');
const { scheduleDispatchEvent, sanitizeMeetingLink } = require('./studentPortalCrmWebhook');
const { extractZoomPwdFromJoinUrl } = require('../utils/zoomJoinUrls');

/**
 * Find a non-cancelled meeting on the same Zoom host that overlaps [meetingStart, meetingEnd).
 * @param {string} zoomHostEmail
 * @param {Date} meetingStart
 * @param {Date} meetingEnd
 * @returns {Promise<object|null>}
 */
/** Active portal meetings that block scheduling (excludes cancelled and ended). */
const ACTIVE_MEETING_STATUSES = ['scheduled', 'started'];

function overlapWindowQuery(meetingStart, meetingEnd, hostEmail = null) {
  const query = {
    status: { $in: ACTIVE_MEETING_STATUSES },
    startTime: { $lt: meetingEnd },
    $expr: {
      $gt: [
        {
          $add: [
            '$startTime',
            { $multiply: [{ $ifNull: ['$duration', 60] }, 60000] }
          ]
        },
        meetingStart
      ]
    }
  };
  if (hostEmail) {
    query.hostEmail = hostEmail;
  }
  return query;
}

async function findZoomHostOverlap(zoomHostEmail, meetingStart, meetingEnd) {
  return MeetingLink.findOne(overlapWindowQuery(meetingStart, meetingEnd, zoomHostEmail)).lean();
}

/**
 * List portal meetings overlapping a time window (any host).
 * @returns {Promise<Array<{ _id, hostEmail, topic, startTime, duration, batch }>>}
 */
async function findOverlappingMeetings(meetingStart, meetingEnd) {
  return MeetingLink.find(overlapWindowQuery(meetingStart, meetingEnd))
    .select('hostEmail topic startTime duration batch')
    .sort({ startTime: 1 })
    .lean();
}

/**
 * Zoom hosts with busy flag and portal conflict details for one or more slots.
 * @param {Array<{ start: Date, end: Date }>} windows
 * @param {Array<{ id: string, email: string, name: string }>} hosts
 */
async function buildHostAvailability(hosts, windows) {
  const conflictsByEmail = new Map();

  for (const { start, end } of windows) {
    const overlapping = await findOverlappingMeetings(start, end);
    for (const m of overlapping) {
      const email = String(m.hostEmail || '').trim().toLowerCase();
      if (!email) continue;
      if (!conflictsByEmail.has(email)) {
        conflictsByEmail.set(email, []);
      }
      const list = conflictsByEmail.get(email);
      const id = String(m._id);
      if (!list.some((c) => c.meetingId === id)) {
        list.push({
          meetingId: id,
          topic: m.topic || 'Untitled class',
          startTime: m.startTime,
          duration: m.duration || 60,
          batch: m.batch || ''
        });
      }
    }
  }

  return hosts.map((h) => {
    const email = h.email.toLowerCase();
    const conflicts = conflictsByEmail.get(email) || [];
    return {
      ...h,
      isBusy: conflicts.length > 0,
      conflicts
    };
  });
}

/**
 * Link or update TimeTable row for a Zoom meeting (IST calendar semantics).
 * Mirrors the non-critical try/catch block in POST /create-meeting.
 */
async function linkMeetingToTimetable({
  meeting,
  batch,
  plan,
  teacherId,
  students
}) {
  const TimeTable = require('../models/TimeTable');
  const meetingDate = new Date(meeting.startTime);
  const dayOfWeek = meetingDate.toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'Asia/Kolkata'
  }).toLowerCase();
  const meetingTime = meetingDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata'
  });
  const endDate = new Date(meetingDate.getTime() + meeting.duration * 60000);
  const endTime = endDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata'
  });

  let timetable = await TimeTable.findOne({
    batch: batch,
    plan: plan,
    weekStartDate: { $lte: meetingDate },
    weekEndDate: { $gte: meetingDate }
  });

  if (!timetable) {
    const dayOfWeekNum = meetingDate.getDay();
    const daysToMonday = dayOfWeekNum === 0 ? -6 : 1 - dayOfWeekNum;

    const weekStartDate = new Date(meetingDate);
    weekStartDate.setDate(meetingDate.getDate() + daysToMonday);
    weekStartDate.setHours(0, 0, 0, 0);

    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekStartDate.getDate() + 6);
    weekEndDate.setHours(23, 59, 59, 999);

    const firstStudent = students[0] || {};
    let medium = 'English';
    const rawMedium = firstStudent.medium;
    if (Array.isArray(rawMedium)) {
      medium = String(rawMedium[0] || 'English');
    } else if (typeof rawMedium === 'string') {
      const trimmed = rawMedium.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          medium = String(Array.isArray(parsed) ? parsed[0] : trimmed) || 'English';
        } catch {
          medium = trimmed.replace(/^\[|\]$/g, '').replace(/['"]/g, '').split(',')[0]?.trim() || 'English';
        }
      } else {
        medium = trimmed || 'English';
      }
    }

    timetable = new TimeTable({
      batch: batch,
      medium,
      plan: plan,
      weekStartDate: weekStartDate,
      weekEndDate: weekEndDate,
      assignedTeacher: teacherId,
      [dayOfWeek]: [{
        start: meetingTime,
        end: endTime,
        classStatus: 'Scheduled',
        zoomMeetingId: meeting.id,
        zoomJoinUrl: meeting.joinUrl,
        zoomPassword: meeting.password,
        meetingLinked: true
      }]
    });

    await timetable.save();
  } else {
    let daySlots = timetable[dayOfWeek];
    if (!daySlots || !Array.isArray(daySlots)) {
      daySlots = [];
      timetable[dayOfWeek] = daySlots;
    }

    const slotIndex = daySlots.findIndex((slot) => {
      const slotTime = slot.start;
      return slotTime === meetingTime ||
        Math.abs(new Date(`1970-01-01T${slotTime}`) - new Date(`1970-01-01T${meetingTime}`)) < 300000;
    });

    if (slotIndex !== -1) {
      timetable[dayOfWeek][slotIndex].zoomMeetingId = meeting.id;
      timetable[dayOfWeek][slotIndex].zoomJoinUrl = meeting.joinUrl;
      timetable[dayOfWeek][slotIndex].zoomPassword = meeting.password;
      timetable[dayOfWeek][slotIndex].meetingLinked = true;
      await timetable.save();
    } else {
      timetable[dayOfWeek].push({
        start: meetingTime,
        end: endTime,
        classStatus: 'Scheduled',
        zoomMeetingId: meeting.id,
        zoomJoinUrl: meeting.joinUrl,
        zoomPassword: meeting.password,
        meetingLinked: true
      });
      await timetable.save();
    }
  }
}

/**
 * Create one Zoom meeting + MeetingLink + reminder dispatch + timetable link.
 *
 * @param {object} opts
 * @param {string} opts.createdByUserId
 * @param {string} opts.batch
 * @param {string} opts.plan
 * @param {string} opts.topic
 * @param {string} [opts.agenda]
 * @param {string} opts.slotStartTime - Local IST datetime string YYYY-MM-DDTHH:mm (length >= 16)
 * @param {number} [opts.duration=60]
 * @param {string} [opts.timezone='Asia/Kolkata']
 * @param {string} opts.zoomHostEmail
 * @param {string} opts.teacherId
 * @param {Array<{_id: any, name?: string, email?: string, medium?: string}>} opts.students
 * @param {number|null} [opts.courseDay]
 * @param {string} [opts.bulkScheduleId]
 * @param {{ moduleId?: any, aiAgentId?: any, notes?: string }} [opts.journeyBulkMeta]
 * @returns {Promise<
 *   | { ok: true, meetingLink: import('mongoose').Document, meeting: object, createdMeetingSummary: object }
 *   | { ok: false, code: 'host_overlap'|'zoom_api_failed', startTime: string, message: string, conflicts?: object[] }
 * >}
 */
async function createMeetingLinkFromSlot(opts) {
  const {
    createdByUserId,
    batch,
    plan,
    topic,
    agenda,
    slotStartTime,
    duration = 60,
    timezone = 'Asia/Kolkata',
    zoomHostEmail,
    teacherId,
    students,
    courseDay: slotCourseDay = null,
    bulkScheduleId,
    journeyBulkMeta
  } = opts;

  const meetingStart = new Date(`${slotStartTime}:00+05:30`);
  const meetingEnd = new Date(meetingStart.getTime() + (duration || 60) * 60000);

  const overlap = await findZoomHostOverlap(zoomHostEmail, meetingStart, meetingEnd);
  if (overlap) {
    return {
      ok: false,
      code: 'host_overlap',
      startTime: slotStartTime,
      message: `Zoom account "${zoomHostEmail}" is already booked for "${overlap.topic}" at this time.`,
      conflicts: [{
        meetingId: overlap._id,
        topic: overlap.topic,
        startTime: overlap.startTime,
        duration: overlap.duration
      }]
    };
  }

  const zoomResult = await zoomService.createMeeting({
    topic,
    startTime: slotStartTime,
    duration: duration || 60,
    timezone: timezone || 'Asia/Kolkata',
    agenda: agenda || `German Language Class - Batch ${batch}`
  }, zoomHostEmail);

  if (!zoomResult.success) {
    return {
      ok: false,
      code: 'zoom_api_failed',
      startTime: slotStartTime,
      message: 'Failed to create Zoom meeting on Zoom API'
    };
  }

  const raw = zoomResult.meeting;
  const zoomPwd =
    String(raw.password || '').trim() ||
    extractZoomPwdFromJoinUrl(raw.joinUrl) ||
    '';
  const meeting = { ...raw, password: zoomPwd };

  const meetingLinkPayload = {
    batch,
    plan,
    platform: 'Zoom',
    link: meeting.joinUrl,
    topic: meeting.topic,
    agenda: meeting.agenda,
    startTime: meetingStart,
    duration: meeting.duration,
    timezone: meeting.timezone,
    zoomMeetingId: String(meeting.id),
    zoomMeetingUuid: meeting.uuid ? String(meeting.uuid) : undefined,
    zoomPassword: zoomPwd,
    hostEmail: meeting.hostEmail,
    startUrl: meeting.startUrl,
    joinUrl: meeting.joinUrl,
    createdBy: createdByUserId,
    assignedTeacher: teacherId,
    courseDay: slotCourseDay,
    attendees: students.map((student) => ({
      studentId: student._id,
      name: student.name,
      email: student.email,
      joinUrl: meeting.joinUrl
    })),
    status: 'scheduled',
    reminderEmailSent: false,
    emailNotificationStatus: {
      attempted: 0,
      successful: 0,
      failed: 0,
      allSent: false,
      failedStudents: [],
      lastAttempt: null
    }
  };

  if (bulkScheduleId) {
    meetingLinkPayload.bulkScheduleId = bulkScheduleId;
  }
  if (
    journeyBulkMeta &&
    typeof journeyBulkMeta === 'object' &&
    Object.keys(journeyBulkMeta).length > 0
  ) {
    meetingLinkPayload.journeyBulkMeta = journeyBulkMeta;
  }

  const meetingLink = new MeetingLink(meetingLinkPayload);
  await meetingLink.save();

  scheduleDispatchEvent({
    event: 'REMINDER_CREATED',
    entity: { ...sanitizeMeetingLink(meetingLink), type: 'MeetingLink' },
    metaOverrides: { syncMode: 'live' }
  });

  const createdMeetingSummary = {
    meetingId: meetingLink._id,
    zoomMeetingId: meeting.id,
    topic: meeting.topic,
    startTime: meeting.startTime,
    duration: meeting.duration,
    joinUrl: meeting.joinUrl,
    startUrl: meeting.startUrl,
    password: meeting.password,
    attendeesCount: students.length,
    attendees: students.map((s) => ({ name: s.name, email: s.email }))
  };

  try {
    await linkMeetingToTimetable({ meeting, batch, plan, teacherId, students });
  } catch (linkError) {
    console.error('⚠️ Error linking to timetable (non-critical):', linkError.message);
  }

  return { ok: true, meetingLink, meeting, createdMeetingSummary };
}

module.exports = {
  ACTIVE_MEETING_STATUSES,
  overlapWindowQuery,
  findZoomHostOverlap,
  findOverlappingMeetings,
  buildHostAvailability,
  createMeetingLinkFromSlot,
  linkMeetingToTimetable
};
