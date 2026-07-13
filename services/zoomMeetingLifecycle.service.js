/**
 * Shared Zoom meeting creation: MeetingLink persistence, CRM reminder dispatch,
 * and TimeTable auto-link — extracted from routes/zoom.js for reuse by bulk journey flow.
 */

const MeetingLink = require('../models/MeetingLink');
const zoomService = require('./zoomService');
const zoomConfig = require('../config/zoomConfig');
const { scheduleDispatchEvent, sanitizeMeetingLink } = require('./studentPortalCrmWebhook');
const { extractZoomPwdFromJoinUrl } = require('../utils/zoomJoinUrls');
const {
  normalizeZoomStartTime,
  parseIstSlotStartTime,
  formatZoomLocalStartTime
} = require('../utils/zoomDateTime');

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

  const meetingStart = parseIstSlotStartTime(slotStartTime) || new Date(`${String(slotStartTime).substring(0, 16)}:00+05:30`);
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

  const zoomStartTime = normalizeZoomStartTime(slotStartTime, timezone || 'Asia/Kolkata');
  if (!zoomStartTime) {
    return {
      ok: false,
      code: 'zoom_api_failed',
      startTime: slotStartTime,
      message: 'Invalid meeting start time for Zoom scheduling'
    };
  }

  const zoomResult = await zoomService.createMeeting({
    topic,
    startTime: zoomStartTime,
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
    hostEmail: String(meeting.hostEmail || zoomHostEmail || '').trim() || undefined,
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

/* ------------------------------------------------------------------ *
 * Zoom link health: verify a scheduled meeting still exists on Zoom   *
 * and regenerate (recreate) it in place when it has expired/been      *
 * deleted so students and teachers never hit "Invalid meeting ID".    *
 * ------------------------------------------------------------------ */

/** Cloud-recording meeting settings applied on every create/update. */
function cloudRecordingZoomSettings(extra = {}) {
  return {
    ...zoomConfig.defaultSettings,
    ...extra,
    auto_recording: 'cloud',
    waiting_room: false,
    join_before_host: true,
    approval_type: 2,
    private_chat: false,
  };
}

/**
 * True when a Zoom API error means the meeting no longer exists
 * (HTTP 404 or Zoom error code 3001 "Meeting does not exist").
 */
function isZoomNotFoundError(err) {
  if (err?.response?.status === 404) return true;
  if (Number(err?.response?.data?.code) === 3001) return true;
  const msg = String(err?.response?.data?.message || err?.message || '');
  if (/status code 404/i.test(msg)) return true;
  if (/does not exist|not\s*found/i.test(msg)) return true;
  return false;
}

function normalizeMeetingTimezone(tz) {
  const t = String(tz || 'Asia/Kolkata').trim();
  if (t === 'Asia/Colombo' || t === 'Asia/Kolkata') return 'Asia/Kolkata';
  return t || 'Asia/Kolkata';
}

function buildZoomUpdateFromMeeting(meeting) {
  const tz = normalizeMeetingTimezone(meeting.timezone);
  const localStart = formatZoomLocalStartTime(meeting.startTime, tz);
  if (!localStart) {
    throw new Error('Invalid meeting start time for Zoom sync');
  }
  return {
    topic: meeting.topic,
    agenda: meeting.agenda || `German Language Class - Batch ${meeting.batch}`,
    duration: meeting.duration || 60,
    start_time: localStart,
    timezone: tz,
    settings: cloudRecordingZoomSettings(),
  };
}

function zoomRemoteMatchesPortal(remote, meeting, localStart) {
  const topicOk = String(remote?.topic || '').trim() === String(meeting.topic || '').trim();
  const remoteStart = String(remote?.start_time || '').replace(' ', 'T').slice(0, 16);
  const localNorm = String(localStart || '').slice(0, 16);
  const timeOk = remoteStart === localNorm;
  const durationOk = Number(remote?.duration) === Number(meeting.duration || 60);
  const tzOk = normalizeMeetingTimezone(remote?.timezone) === normalizeMeetingTimezone(meeting.timezone);
  return topicOk && timeOk && durationOk && tzOk;
}

/** Mongo filter: scheduled meetings that have not ended yet. */
function notEndedScheduledMeetingFilter(now = new Date()) {
  return {
    status: 'scheduled',
    $expr: {
      $gte: [
        { $add: ['$startTime', { $multiply: [{ $ifNull: ['$duration', 60] }, 60000] }] },
        now,
      ],
    },
  };
}

async function linkTimetableZoomSlot(meeting, previousZoomId) {
  const TimeTable = require('../models/TimeTable');
  const meetingDate = new Date(meeting.startTime);
  const dayOfWeek = meetingDate
    .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' })
    .toLowerCase();
  const newZoomId = String(meeting.zoomMeetingId || '');
  if (!newZoomId) return;

  const timetable = await TimeTable.findOne({
    batch: meeting.batch,
    weekStartDate: { $lte: meetingDate },
    weekEndDate: { $gte: meetingDate },
  });

  if (!timetable || !Array.isArray(timetable[dayOfWeek])) return;

  const prevId = previousZoomId ? String(previousZoomId) : null;
  const slotIndex = timetable[dayOfWeek].findIndex(
    (s) => String(s.zoomMeetingId || '') === newZoomId || (prevId && String(s.zoomMeetingId || '') === prevId)
  );
  if (slotIndex === -1) return;

  timetable[dayOfWeek][slotIndex].zoomMeetingId = newZoomId;
  timetable[dayOfWeek][slotIndex].zoomJoinUrl = meeting.joinUrl;
  timetable[dayOfWeek][slotIndex].zoomPassword = meeting.zoomPassword;
  timetable[dayOfWeek][slotIndex].meetingLinked = true;
  await timetable.save();
}

/**
 * Delete the (missing/stale) Zoom meeting and create a fresh one on the same
 * host/time, updating the MeetingLink document (join/start URLs, id, password,
 * per-attendee join URLs). Mutates `meeting` in place; caller persists it.
 */
async function recreateZoomMeetingInPlace(meeting, zoomUpdateData = {}) {
  if (zoomUpdateData.topic) meeting.topic = zoomUpdateData.topic;
  if (zoomUpdateData.agenda !== undefined) meeting.agenda = zoomUpdateData.agenda;
  if (zoomUpdateData.duration) meeting.duration = zoomUpdateData.duration;

  if (!meeting.hostEmail) {
    throw new Error('Meeting has no Zoom host email — cannot recreate');
  }

  const oldZoomId = meeting.zoomMeetingId ? String(meeting.zoomMeetingId) : null;

  if (oldZoomId) {
    try {
      await zoomService.deleteMeeting(oldZoomId);
    } catch (_ignore) {
      // Already deleted/expired on Zoom
    }
  }

  const tz = normalizeMeetingTimezone(meeting.timezone);
  meeting.timezone = tz;
  const slotStartTime = zoomUpdateData.start_time || formatZoomLocalStartTime(meeting.startTime, tz);
  if (!slotStartTime) {
    throw new Error('Invalid meeting start time for Zoom recreate');
  }

  const zoomResult = await zoomService.createMeeting(
    {
      topic: meeting.topic,
      startTime: slotStartTime,
      duration: meeting.duration || 60,
      timezone: tz,
      agenda: meeting.agenda || `German Language Class - Batch ${meeting.batch}`,
    },
    meeting.hostEmail
  );

  if (!zoomResult.success) {
    throw new Error('Zoom API failed to create a new meeting');
  }

  const raw = zoomResult.meeting;
  const newPwd =
    String(raw.password || '').trim() ||
    extractZoomPwdFromJoinUrl(raw.joinUrl) ||
    '';

  meeting.zoomMeetingId = String(raw.id);
  meeting.zoomMeetingUuid = raw.uuid ? String(raw.uuid) : meeting.zoomMeetingUuid;
  meeting.zoomPassword = newPwd;
  meeting.joinUrl = raw.joinUrl;
  meeting.startUrl = raw.startUrl;
  meeting.link = raw.joinUrl;
  if (raw.hostEmail) {
    meeting.hostEmail = raw.hostEmail;
  }
  for (const attendee of meeting.attendees || []) {
    attendee.joinUrl = raw.joinUrl;
  }

  return { oldZoomId, newZoomId: meeting.zoomMeetingId, recreated: true };
}

/**
 * Align one portal MeetingLink with Zoom (topic, IST time, duration, host, cloud recording).
 * Updates Zoom in place when possible; recreates when missing or unrecoverable.
 * Mutates `meeting` in place; caller persists it.
 */
async function syncMeetingLinkToZoom(meeting, { forceRecreate = false } = {}) {
  if (!meeting.hostEmail) {
    throw new Error('Missing Zoom host email — assign a Zoom host in the portal first.');
  }

  const zoomUpdateData = buildZoomUpdateFromMeeting(meeting);
  meeting.timezone = zoomUpdateData.timezone;
  const zoomId = String(meeting.zoomMeetingId || '').trim();

  if (forceRecreate || !zoomId) {
    const result = await recreateZoomMeetingInPlace(meeting, zoomUpdateData);
    await linkTimetableZoomSlot(meeting, result.oldZoomId);
    return { ...result, action: 'recreated' };
  }

  try {
    const remote = await zoomService.getMeeting(zoomId);
    const matches = !forceRecreate && zoomRemoteMatchesPortal(remote, meeting, zoomUpdateData.start_time);

    if (!matches) {
      await zoomService.updateMeeting(zoomId, zoomUpdateData);
      return { oldZoomId: zoomId, newZoomId: zoomId, recreated: false, action: 'updated' };
    }

    await zoomService.updateMeeting(zoomId, { settings: zoomUpdateData.settings });
    return { oldZoomId: zoomId, newZoomId: zoomId, recreated: false, action: 'verified' };
  } catch (err) {
    if (!isZoomNotFoundError(err)) throw err;
    const result = await recreateZoomMeetingInPlace(meeting, zoomUpdateData);
    await linkTimetableZoomSlot(meeting, result.oldZoomId);
    return { ...result, action: 'recreated' };
  }
}

async function syncZoomMeetingFields(meeting, zoomUpdateData) {
  zoomUpdateData.settings = cloudRecordingZoomSettings(zoomUpdateData.settings || {});

  const zoomId = String(meeting.zoomMeetingId || '').trim();
  if (!zoomId) {
    return recreateZoomMeetingInPlace(meeting, zoomUpdateData);
  }
  try {
    await zoomService.updateMeeting(zoomId, zoomUpdateData);
    return { oldZoomId: zoomId, newZoomId: zoomId, recreated: false };
  } catch (err) {
    if (!isZoomNotFoundError(err)) throw err;
    return recreateZoomMeetingInPlace(meeting, zoomUpdateData);
  }
}

/**
 * Verify that `meeting`'s Zoom link is still valid and regenerate it if it has
 * expired / been deleted. Safe to call on every join click.
 *
 * - Throttled via `meeting.lastZoomCheckAt` so a burst of student clicks does
 *   not hammer the Zoom API.
 * - Only regenerates on a genuine "meeting not found" error; transient Zoom/API
 *   errors are swallowed so a join is never blocked by this safety check.
 * - Mutates and persists `meeting` when it verifies or regenerates.
 *
 * @param {import('mongoose').Document} meeting - A MeetingLink document.
 * @param {object} [opts]
 * @param {number} [opts.throttleMs=0] - Skip the remote check if it ran within this window.
 * @returns {Promise<{ checked: boolean, regenerated: boolean, reason?: string, error?: string }>}
 */
async function ensureZoomMeetingLive(meeting, { throttleMs = 0 } = {}) {
  if (!meeting) return { checked: false, regenerated: false, reason: 'no_meeting' };

  if (
    throttleMs > 0 &&
    meeting.lastZoomCheckAt &&
    Date.now() - new Date(meeting.lastZoomCheckAt).getTime() < throttleMs
  ) {
    return { checked: false, regenerated: false, reason: 'throttled' };
  }

  if (!meeting.hostEmail) {
    // Without a Zoom host we cannot recreate the meeting; leave it untouched.
    return { checked: false, regenerated: false, reason: 'no_host' };
  }

  const zoomId = String(meeting.zoomMeetingId || '').trim();

  try {
    if (zoomId) {
      // Throws (404 / code 3001) when the meeting no longer exists on Zoom.
      await zoomService.getMeeting(zoomId);
      meeting.lastZoomCheckAt = new Date();
      await meeting.save();
      return { checked: true, regenerated: false };
    }

    // No Zoom id yet — create one so the link works.
    const zoomUpdateData = buildZoomUpdateFromMeeting(meeting);
    const result = await recreateZoomMeetingInPlace(meeting, zoomUpdateData);
    await linkTimetableZoomSlot(meeting, result.oldZoomId);
    meeting.lastZoomCheckAt = new Date();
    await meeting.save();
    console.log(`♻️ Zoom link generated for meeting ${meeting._id} (had no Zoom id)`);
    return { checked: true, regenerated: true };
  } catch (err) {
    if (!isZoomNotFoundError(err)) {
      // Transient error (token/network/rate limit): do NOT regenerate; let join proceed.
      console.warn(`⚠️ Zoom link check failed for meeting ${meeting._id}: ${err.message}`);
      return { checked: true, regenerated: false, error: err.message };
    }

    const zoomUpdateData = buildZoomUpdateFromMeeting(meeting);
    const result = await recreateZoomMeetingInPlace(meeting, zoomUpdateData);
    await linkTimetableZoomSlot(meeting, result.oldZoomId);
    meeting.lastZoomCheckAt = new Date();
    await meeting.save();
    console.log(
      `♻️ Regenerated expired Zoom link for meeting ${meeting._id} (old=${result.oldZoomId} → new=${result.newZoomId})`
    );
    return { checked: true, regenerated: true };
  }
}

module.exports = {
  ACTIVE_MEETING_STATUSES,
  overlapWindowQuery,
  findZoomHostOverlap,
  findOverlappingMeetings,
  buildHostAvailability,
  createMeetingLinkFromSlot,
  linkMeetingToTimetable,
  // Zoom link health / sync
  cloudRecordingZoomSettings,
  isZoomNotFoundError,
  normalizeMeetingTimezone,
  buildZoomUpdateFromMeeting,
  zoomRemoteMatchesPortal,
  notEndedScheduledMeetingFilter,
  linkTimetableZoomSlot,
  recreateZoomMeetingInPlace,
  syncMeetingLinkToZoom,
  syncZoomMeetingFields,
  ensureZoomMeetingLive
};
