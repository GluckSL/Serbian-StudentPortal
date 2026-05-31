const { allStudentBatchStringsForContent, batchesAlign } = require('./effectiveStudentBatch');
const { isContentBlockedForStudent } = require('./journeyContentBlock');
const RecordingAccessRequest = require('../models/RecordingAccessRequest');

function allowedRecordingPlansForStudent(student) {
  const sub = String(student?.subscription || '').toUpperCase();
  if (String(student?.goStatus || '') === 'GO' && sub === 'SILVER') {
    return ['SILVER', 'ALL', 'PLATINUM'];
  }
  return [sub, 'ALL'].filter(Boolean);
}

function normalizedStudentCourseDay(student) {
  const v = student && student.currentCourseDay;
  if (v != null && v !== undefined && Number.isFinite(Number(v))) {
    return Math.min(200, Math.max(1, Math.floor(Number(v))));
  }
  return 1;
}

function journeyCourseDayUnlockedForStudent(doc, student) {
  const studentDay = normalizedStudentCourseDay(student);
  const raw = doc && doc.courseDay;
  if (raw == null || raw === undefined) return true;
  const cd = Number(raw);
  if (!Number.isFinite(cd)) return true;
  return cd <= studentDay;
}

function canUserAccessManualRecording(recording, student) {
  if (!recording?.active) return false;
  if (recording.isPublished === false) return false;
  if (!student) return false;
  if (student.journeyAccessEnabled === false) return false;
  const batchKeys = allStudentBatchStringsForContent(student);
  const inBatch = batchKeys.length > 0 && Array.isArray(recording.batches) &&
    recording.batches.some((b) => batchKeys.some((k) => batchesAlign(k, b)));
  if (!inBatch) return false;
  if (!journeyCourseDayUnlockedForStudent(recording, student)) return false;
  if (isContentBlockedForStudent(student, { courseDay: recording.courseDay, level: recording.level })) return false;
  if (recording.level && student.level && recording.level !== student.level) return false;
  const recPlan = String(recording.plan || 'ALL').toUpperCase();
  if (!recPlan || recPlan === 'ALL') return true;
  const allowed = allowedRecordingPlansForStudent(student).map((p) => String(p).toUpperCase());
  return allowed.includes(recPlan);
}

function normalizeZoomAccessSettings(zoomRecording, meetingLink) {
  const accessBatches = Array.isArray(zoomRecording?.accessBatches)
    ? zoomRecording.accessBatches.map((b) => String(b).trim()).filter(Boolean)
    : [];
  const batches = accessBatches.length
    ? accessBatches
    : (meetingLink?.batch ? [String(meetingLink.batch)] : []);
  const level = zoomRecording?.accessLevel ? String(zoomRecording.accessLevel).toUpperCase() : null;
  const plan = String(zoomRecording?.accessPlan || 'ALL').toUpperCase();
  return { batches, level, plan };
}

function canUserAccessZoomRecording(zoomRecording, meetingLink, student) {
  if (!zoomRecording || zoomRecording.isPublished === false) return false;
  if (!student || !meetingLink) return false;
  if (student.journeyAccessEnabled === false) return false;
  if (!journeyCourseDayUnlockedForStudent(meetingLink, student)) return false;
  if (isContentBlockedForStudent(student, { courseDay: meetingLink?.courseDay, level: meetingLink?.level })) return false;

  const { batches, level, plan } = normalizeZoomAccessSettings(zoomRecording, meetingLink);
  const studentBatchKeys = allStudentBatchStringsForContent(student);
  const inBatch = studentBatchKeys.length > 0 &&
    batches.length > 0 &&
    batches.some((b) => studentBatchKeys.some((k) => batchesAlign(k, b)));
  if (!inBatch) return false;

  if (level && student.level && String(student.level).toUpperCase() !== level) return false;
  if (!plan || plan === 'ALL') return true;

  const sub = String(student?.subscription || '').toUpperCase();
  const allowed = String(student?.goStatus || '') === 'GO' && sub === 'SILVER'
    ? ['SILVER', 'ALL', 'PLATINUM']
    : [sub, 'ALL'].filter(Boolean);
  return allowed.map((p) => String(p).toUpperCase()).includes(plan);
}

/** True when a student has an approved per-student recording grant for this class. */
async function hasApprovedRecordingGrant(studentId, meetingLinkId) {
  if (!studentId || !meetingLinkId) return false;
  return !!(await RecordingAccessRequest.exists({
    studentId,
    meetingLinkId,
    status: 'APPROVED',
  }));
}

module.exports = {
  canUserAccessManualRecording,
  canUserAccessZoomRecording,
  hasApprovedRecordingGrant,
};
