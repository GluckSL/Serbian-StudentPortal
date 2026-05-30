// services/selfPace.service.js
// Self Pace: activated batches → journeys → day slots with mapped recordings.
// Students see a mapped recording when their batch is activated and they attended that courseDay.

const SelfPaceConfig = require('../models/SelfPaceConfig');
const SelfPaceJourney = require('../models/SelfPaceJourney');
const SelfPaceJourneyDay = require('../models/SelfPaceJourneyDay');
const MeetingLink = require('../models/MeetingLink');
const ClassRecording = require('../models/ClassRecording');
const ZoomRecording = require('../models/ZoomRecording');
const { allStudentBatchStringsForContent, batchesAlign } = require('../utils/effectiveStudentBatch');
const { isContentBlockedForStudent } = require('../utils/journeyContentBlock');

const CONFIG_KEY = 'default';

function attendanceRowCountsAsAttended(row) {
  if (!row) return false;
  if (row.attended === true) return true;
  if (row.status === 'attended' || row.status === 'late') return true;
  if (Number(row.attendancePercent || 0) >= 75) return true;
  return false;
}

async function getOrCreateConfig() {
  let doc = await SelfPaceConfig.findOne({ key: CONFIG_KEY }).lean();
  if (!doc) {
    doc = (
      await SelfPaceConfig.create({ key: CONFIG_KEY, activatedBatches: [] })
    ).toObject();
  }
  return doc;
}

async function studentBatchIsActivated(student) {
  const config = await getOrCreateConfig();
  const activated = config.activatedBatches || [];
  if (!activated.length) return false;
  const batchKeys = allStudentBatchStringsForContent(student);
  return batchKeys.some((k) => activated.some((b) => batchesAlign(k, b)));
}

async function studentAttendedOwnBatchOnDay(studentId, studentBatch, courseDay) {
  if (!studentId || !studentBatch || !courseDay) return false;
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

function allowedRecordingPlansForStudent(student) {
  const sub = String(student?.subscription || '').toUpperCase();
  if (String(student?.goStatus || '') === 'GO' && sub === 'SILVER') {
    return ['SILVER', 'ALL', 'PLATINUM'];
  }
  return [sub, 'ALL'].filter(Boolean);
}

async function canStudentAccessMappedRecording(student, dayMapping, recording, meetingLink, zoomRecording) {
  if (!dayMapping?.active) return false;
  if (student.journeyAccessEnabled === false) return false;

  const activated = await studentBatchIsActivated(student);
  if (!activated) return false;

  const attended = await studentAttendedOwnBatchOnDay(
    student._id,
    student.batch || '',
    dayMapping.courseDay
  );
  if (!attended) return false;

  if (dayMapping.recordingType === 'manual') {
    if (!recording?.active || recording.isPublished === false) return false;
    if (recording.level && student.level && recording.level !== student.level) return false;
    const recPlan = String(recording.plan || 'ALL').toUpperCase();
    if (recPlan !== 'ALL') {
      const allowed = allowedRecordingPlansForStudent(student).map((p) => String(p).toUpperCase());
      if (!allowed.includes(recPlan)) return false;
    }
    if (isContentBlockedForStudent(student, { courseDay: dayMapping.courseDay, level: recording.level })) {
      return false;
    }
    return true;
  }

  if (dayMapping.recordingType === 'zoom') {
    if (!zoomRecording || zoomRecording.status !== 'ready' || zoomRecording.isPublished === false) return false;
    if (!meetingLink) return false;
    if (isContentBlockedForStudent(student, { courseDay: dayMapping.courseDay, level: meetingLink.level })) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Student feed items for Self Pace mappings the student can access.
 */
async function listSelfPaceRecordingsForStudent(student) {
  const manualItems = [];
  const zoomItems = [];

  if (!(await studentBatchIsActivated(student))) {
    return { manualItems, zoomItems };
  }

  const journeys = await SelfPaceJourney.find({ active: true }).sort({ sortOrder: 1, name: 1 }).lean();
  if (!journeys.length) return { manualItems, zoomItems };

  const journeyIds = journeys.map((j) => j._id);
  const days = await SelfPaceJourneyDay.find({
    journeyId: { $in: journeyIds },
    active: true,
  })
    .sort({ sortOrder: 1, courseDay: 1 })
    .lean();

  const journeyById = new Map(journeys.map((j) => [String(j._id), j]));

  const attendedCache = new Map();

  for (const day of days) {
    const journey = journeyById.get(String(day.journeyId));
    if (!journey) continue;

    const cacheKey = String(day.courseDay);
    if (!attendedCache.has(cacheKey)) {
      attendedCache.set(
        cacheKey,
        await studentAttendedOwnBatchOnDay(student._id, student.batch || '', day.courseDay)
      );
    }
    if (!attendedCache.get(cacheKey)) continue;

    const meta = {
      accessSource: 'self_pace',
      selfPaceJourneyName: journey.name,
      selfPaceCourseDay: day.courseDay,
      sharedFromCourseDay: day.courseDay,
    };

    if (day.recordingType === 'manual' && day.classRecordingId) {
      const rec = await ClassRecording.findById(day.classRecordingId)
        .populate('uploadedBy', 'name')
        .lean();
      if (!rec) continue;
      if (!(await canStudentAccessMappedRecording(student, day, rec, null, null))) continue;

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
        courseDay: day.courseDay,
        watchedSeconds: 0,
        accessRequestStatus: null,
        canPlay: true,
        ...meta,
      });
    }

    if (day.recordingType === 'zoom' && day.meetingLinkId) {
      const meeting = await MeetingLink.findById(day.meetingLinkId)
        .select('_id topic batch startTime duration status assignedTeacher courseDay')
        .populate('assignedTeacher', 'name')
        .lean();
      if (!meeting) continue;

      const zoomRec = await ZoomRecording.findOne({
        meetingLinkId: day.meetingLinkId,
        status: 'ready',
        isPublished: true,
      })
        .select('meetingLinkId r2Key duration status createdAt isPublished')
        .lean();
      if (!zoomRec) continue;
      if (!(await canStudentAccessMappedRecording(student, day, null, meeting, zoomRec))) continue;

      zoomItems.push({
        type: 'zoom',
        id: String(meeting._id),
        title: meeting.topic || 'Class Recording',
        description: '',
        date: meeting.startTime || zoomRec.createdAt,
        duration: Number.isFinite(Number(zoomRec.duration))
          ? Number(zoomRec.duration)
          : Number.isFinite(Number(meeting.duration))
            ? Number(meeting.duration) * 60
            : null,
        batch: meeting.batch || '',
        teacherName: meeting.assignedTeacher?.name || 'Teacher',
        attempted: meeting.status === 'ended',
        attendanceStatus: 'N/A',
        meetingLinkId: String(meeting._id),
        courseDay: day.courseDay,
        watchedSeconds: 0,
        accessRequestStatus: null,
        canPlay: true,
        ...meta,
      });
    }
  }

  return { manualItems, zoomItems };
}

async function canAccessManualViaSelfPace(recording, student) {
  if (!recording?._id) return false;
  const days = await SelfPaceJourneyDay.find({
    active: true,
    recordingType: 'manual',
    classRecordingId: recording._id,
  }).lean();
  if (!days.length) return false;

  const activeJourneyIds = new Set(
    (await SelfPaceJourney.find({ active: true }).select('_id').lean()).map((j) => String(j._id))
  );

  for (const day of days) {
    if (!activeJourneyIds.has(String(day.journeyId))) continue;
    if (await canStudentAccessMappedRecording(student, day, recording, null, null)) return true;
  }
  return false;
}

async function canAccessZoomViaSelfPace(zoomRecording, meetingLink, student) {
  if (!meetingLink?._id) return false;
  const days = await SelfPaceJourneyDay.find({
    active: true,
    recordingType: 'zoom',
    meetingLinkId: meetingLink._id,
  }).lean();
  if (!days.length) return false;

  const activeJourneyIds = new Set(
    (await SelfPaceJourney.find({ active: true }).select('_id').lean()).map((j) => String(j._id))
  );

  for (const day of days) {
    if (!activeJourneyIds.has(String(day.journeyId))) continue;
    if (await canStudentAccessMappedRecording(student, day, null, meetingLink, zoomRecording)) {
      return true;
    }
  }
  return false;
}

/** Admin: full tree config + journeys + days */
async function getAdminProgram() {
  const config = await getOrCreateConfig();
  const journeys = await SelfPaceJourney.find().sort({ sortOrder: 1, name: 1 }).lean();
  const journeyIds = journeys.map((j) => j._id);
  const days = journeyIds.length
    ? await SelfPaceJourneyDay.find({ journeyId: { $in: journeyIds } })
        .sort({ sortOrder: 1, courseDay: 1 })
        .lean()
    : [];

  const manualIds = days.filter((d) => d.recordingType === 'manual' && d.classRecordingId).map((d) => d.classRecordingId);
  const meetingIds = days.filter((d) => d.recordingType === 'zoom' && d.meetingLinkId).map((d) => d.meetingLinkId);

  const [manualRecs, meetings, zoomRecs] = await Promise.all([
    manualIds.length
      ? ClassRecording.find({ _id: { $in: manualIds } })
          .select('title batches level plan isPublished status courseDay')
          .lean()
      : [],
    meetingIds.length
      ? MeetingLink.find({ _id: { $in: meetingIds } })
          .select('topic batch courseDay startTime')
          .lean()
      : [],
    meetingIds.length
      ? ZoomRecording.find({ meetingLinkId: { $in: meetingIds }, status: 'ready' })
          .select('meetingLinkId isPublished status')
          .lean()
      : [],
  ]);

  const manualMap = new Map(manualRecs.map((r) => [String(r._id), r]));
  const meetingMap = new Map(meetings.map((m) => [String(m._id), m]));
  const zoomMap = new Map(zoomRecs.map((z) => [String(z.meetingLinkId), z]));

  const daysByJourney = {};
  for (const d of days) {
    const jid = String(d.journeyId);
    if (!daysByJourney[jid]) daysByJourney[jid] = [];
    const enriched = { ...d };
    if (d.recordingType === 'manual' && d.classRecordingId) {
      enriched.recording = manualMap.get(String(d.classRecordingId)) || null;
    }
    if (d.recordingType === 'zoom' && d.meetingLinkId) {
      enriched.meeting = meetingMap.get(String(d.meetingLinkId)) || null;
      enriched.zoomRecording = zoomMap.get(String(d.meetingLinkId)) || null;
    }
    daysByJourney[jid].push(enriched);
  }

  return {
    config,
    journeys: journeys.map((j) => ({
      ...j,
      days: daysByJourney[String(j._id)] || [],
    })),
  };
}

/** Picker list for mapping recordings */
async function listRecordingsForPicker({ search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase();

  const manual = await ClassRecording.find({
    active: true,
    status: 'ready',
    isPublished: { $ne: false },
  })
    .select('title batches level plan courseDay createdAt')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const zoomRows = await ZoomRecording.find({
    status: 'ready',
    isPublished: true,
  })
    .select('meetingLinkId duration createdAt')
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const meetingIds = zoomRows.map((z) => z.meetingLinkId);
  const meetings = meetingIds.length
    ? await MeetingLink.find({ _id: { $in: meetingIds } })
        .select('topic batch courseDay startTime')
        .lean()
    : [];
  const meetingMap = new Map(meetings.map((m) => [String(m._id), m]));

  const items = [];

  for (const r of manual) {
    const title = String(r.title || '');
    const batchStr = (r.batches || []).join(' ');
    if (q && !title.toLowerCase().includes(q) && !batchStr.toLowerCase().includes(q)) continue;
    items.push({
      recordingType: 'manual',
      id: String(r._id),
      title,
      subtitle: batchStr || 'Manual',
      meta: r.level ? `Level ${r.level}` : '',
      courseDay: r.courseDay,
      isPublished: r.isPublished !== false,
    });
  }

  for (const z of zoomRows) {
    const m = meetingMap.get(String(z.meetingLinkId)) || {};
    const title = m.topic || 'Class recording';
    const batchStr = m.batch || '';
    if (q && !title.toLowerCase().includes(q) && !batchStr.toLowerCase().includes(q)) continue;
    items.push({
      recordingType: 'zoom',
      id: String(z.meetingLinkId),
      title,
      subtitle: batchStr,
      meta: m.courseDay != null ? `Journey day ${m.courseDay}` : 'Zoom',
      courseDay: m.courseDay,
      isPublished: true,
    });
  }

  return items;
}

module.exports = {
  CONFIG_KEY,
  getOrCreateConfig,
  getAdminProgram,
  listRecordingsForPicker,
  listSelfPaceRecordingsForStudent,
  canAccessManualViaSelfPace,
  canAccessZoomViaSelfPace,
  studentAttendedOwnBatchOnDay,
  studentBatchIsActivated,
};
