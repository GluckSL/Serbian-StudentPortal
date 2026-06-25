const User = require('../models/User');
const TimeTable = require('../models/TimeTable');

const GO_STUDENTS_TARGET_NORMALIZED = 'gostudents';

function normalizeBatchKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\bbatch\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isGoStudentsTarget(value) {
  return normalizeBatchKey(value) === GO_STUDENTS_TARGET_NORMALIZED;
}

function isGoStudentRecord(student) {
  return String(student?.goStatus || '')
    .trim()
    .toUpperCase() === 'GO';
}

function normalizeBatchList(values) {
  return Array.from(new Set((values || []).map((b) => normalizeBatchKey(b)).filter(Boolean)));
}

function batchesIntersectNormalized(batchValue, targetBatches) {
  const batchKey = normalizeBatchKey(batchValue);
  if (!batchKey) return false;
  return (targetBatches || []).some((b) => normalizeBatchKey(b) === batchKey);
}

/**
 * Normalized batch keys used to match announcements for the logged-in user.
 */
async function getRecipientBatchKeys(user, userId) {
  const role = String(user?.role || '').toUpperCase();
  const keys = [];

  if (role === 'STUDENT') {
    if (isGoStudentRecord(user)) keys.push(GO_STUDENTS_TARGET_NORMALIZED);
    const batch = String(user?.batch || '').trim();
    if (batch) keys.push(normalizeBatchKey(batch));
    return normalizeBatchList(keys);
  }

  if (role === 'TEACHER' || role === 'TEACHER_ADMIN') {
    for (const batch of user?.assignedBatches || []) {
      const key = normalizeBatchKey(batch);
      if (key) keys.push(key);
    }

    const fromTimetables = await TimeTable.distinct('batch', {
      assignedTeacher: String(userId),
      batch: { $nin: [null, ''] }
    });

    for (const batch of fromTimetables) {
      const key = normalizeBatchKey(batch);
      if (key) keys.push(key);
    }
    return normalizeBatchList(keys);
  }

  return [];
}

function addTeacherMatch(matched, teacher) {
  const email = String(teacher.email || '').trim().toLowerCase();
  if (!email || matched.has(email)) return;
  matched.set(email, {
    _id: teacher._id,
    name: String(teacher.name || '').trim(),
    regNo: String(teacher.regNo || '').trim(),
    email,
    role: 'TEACHER'
  });
}

/**
 * Teachers who should receive announcements for the given target batches.
 * Uses teacher assignedBatches and the latest timetable per batch — not
 * per-student assignedTeacher, which can point at a former tutor.
 */
async function findTeachersForTargetBatches(targetBatches, targetKeys) {
  const keys = targetKeys || normalizeBatchList(targetBatches);
  if (!keys.length) return [];

  const matched = new Map();

  const teachers = await User.find({
    role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
    isActive: true,
    email: { $nin: [null, ''] }
  })
    .select('name email regNo assignedBatches')
    .lean();

  for (const teacher of teachers) {
    const assigned = (teacher.assignedBatches || []).map(normalizeBatchKey).filter(Boolean);
    if (!assigned.some((batchKey) => keys.includes(batchKey))) continue;
    addTeacherMatch(matched, teacher);
  }

  const timetables = await TimeTable.find({ batch: { $nin: [null, ''] } })
    .select('batch assignedTeacher weekStartDate')
    .sort({ weekStartDate: -1 })
    .lean();

  const timetableTeacherIds = new Set();
  const seenBatchKeys = new Set();
  for (const tt of timetables) {
    const batchKey = normalizeBatchKey(tt.batch);
    if (!keys.includes(batchKey) || seenBatchKeys.has(batchKey)) continue;
    seenBatchKeys.add(batchKey);
    const teacherId = String(tt.assignedTeacher || '').trim();
    if (teacherId) timetableTeacherIds.add(teacherId);
  }

  if (timetableTeacherIds.size) {
    const timetableTeachers = await User.find({
      _id: { $in: [...timetableTeacherIds] },
      role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
      isActive: true,
      email: { $nin: [null, ''] }
    })
      .select('name email regNo')
      .lean();

    for (const teacher of timetableTeachers) {
      addTeacherMatch(matched, teacher);
    }
  }

  return Array.from(matched.values());
}

module.exports = {
  GO_STUDENTS_TARGET_NORMALIZED,
  normalizeBatchKey,
  isGoStudentsTarget,
  isGoStudentRecord,
  normalizeBatchList,
  batchesIntersectNormalized,
  getRecipientBatchKeys,
  findTeachersForTargetBatches
};
