/**
 * Notify finance admins when a student is past journey day 11 and still owes language fee.
 */
const mongoose = require('mongoose');
const PaymentRequest = require('../models/PaymentRequest');
const PaymentNotification = require('../models/Notification');
const DigitalExercise = require('../../../../models/DigitalExercise');
const ExerciseAttempt = require('../../../../models/ExerciseAttempt');
const MeetingLink = require('../../../../models/MeetingLink');

const User = mongoose.model('User');

const TYPE = 'JOURNEY_LANGUAGE_FEE_DUE';
const TYPE_EXERCISE = 'JOURNEY_EXERCISE_MISSED_TODAY';
const TYPE_CLASS = 'JOURNEY_CLASS_ABSENT_TODAY';
const JOURNEY_DAY_THRESHOLD = 11;
const ADMIN_ROLES = ['ADMIN', 'TEACHER_ADMIN', 'SUPER_ADMIN', 'SUB_ADMIN'];
/** Same grace as WhatsApp during-class absence alerts — do not mark missed before this. */
const CLASS_ABSENCE_GRACE_MS = 30 * 60 * 1000;
const DEFAULT_CLASS_DURATION_MIN = 60;

function meetingEndTime(cls) {
  const start = cls.startTime ? new Date(cls.startTime) : null;
  if (!start || Number.isNaN(start.getTime())) return null;
  const durationMin = Number(cls.duration) > 0 ? Number(cls.duration) : DEFAULT_CLASS_DURATION_MIN;
  return new Date(start.getTime() + durationMin * 60 * 1000);
}

/**
 * Only evaluate absence after class has started (with grace) or ended, or when attendance is finalized.
 */
function shouldEvaluateClassAbsence(cls, now = new Date()) {
  if (cls.attendanceRecorded) return true;

  const start = cls.startTime ? new Date(cls.startTime) : null;
  if (!start || Number.isNaN(start.getTime())) return false;

  if (now < start) return false;

  const end = meetingEndTime(cls);
  if (end && now >= end) return true;

  const graceAt = new Date(start.getTime() + CLASS_ABSENCE_GRACE_MS);
  return now >= graceAt;
}

function isStudentPresentInMeeting(record) {
  return (
    !!record &&
    (record.attended === true || ['attended', 'late'].includes(String(record.status || '').toLowerCase()))
  );
}

const meetingStartCache = new Map();
const batchClockCache = new Map();

function batchNameRegex(batchName) {
  const name = String(batchName || '').trim();
  if (!name) return null;
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

function parseValidDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoOrNull(value) {
  const d = parseValidDate(value);
  return d ? d.toISOString() : null;
}

function getZoomService() {
  return require('../../../../services/zoomService');
}

function clearMeetingStartCaches() {
  meetingStartCache.clear();
  batchClockCache.clear();
}

async function inferBatchClassClock(batchName) {
  const key = String(batchName || '').trim().toLowerCase();
  if (batchClockCache.has(key)) return batchClockCache.get(key);
  const rx = batchNameRegex(batchName);
  if (!rx) {
    batchClockCache.set(key, null);
    return null;
  }
  const sample = await MeetingLink.findOne({
    batch: rx,
    startTime: { $exists: true, $ne: null },
  })
    .sort({ startTime: -1 })
    .select('startTime')
    .lean();
  const clock = parseValidDate(sample?.startTime);
  batchClockCache.set(key, clock);
  return clock;
}

/** Use today's calendar date with the batch's usual class clock (e.g. 19:00). */
function todayWithBatchClock(clockDate) {
  const clock = parseValidDate(clockDate);
  if (!clock) return null;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), clock.getHours(), clock.getMinutes(), 0, 0);
}

async function persistMeetingStartTime(meetingId, startTime) {
  if (!meetingId || !startTime) return;
  try {
    await MeetingLink.updateOne({ _id: meetingId }, { $set: { startTime } });
  } catch (_) {
    /* non-fatal */
  }
}

/** Fill missing startTime from Zoom or the batch's typical class time. */
async function resolveMeetingStartTime(cls, batchName) {
  const cacheKey = String(cls._id);
  if (meetingStartCache.has(cacheKey)) return meetingStartCache.get(cacheKey);

  let resolved = parseValidDate(cls.startTime);

  if (!resolved && cls.zoomMeetingId) {
    try {
      const zm = await getZoomService().getMeeting(String(cls.zoomMeetingId));
      resolved = parseValidDate(zm?.start_time);
      if (resolved) {
        cls.startTime = resolved;
        await persistMeetingStartTime(cls._id, resolved);
      }
    } catch (_) {
      /* Zoom unavailable — fall through */
    }
  }

  if (!resolved) {
    const batchClock = await inferBatchClassClock(batchName);
    resolved = todayWithBatchClock(batchClock);
    if (resolved) cls.startTime = resolved;
  }

  meetingStartCache.set(cacheKey, resolved || null);
  return resolved;
}

function normalizeCourseDay(d) {
  const n = parseInt(String(d), 10);
  if (!Number.isFinite(n)) return 1;
  return Math.min(200, Math.max(1, n));
}

async function getLanguageFeeDue(studentId) {
  const reqs = await PaymentRequest.find({
    studentId,
    paymentType: 'LANGUAGE_FEE',
    isArchived: false,
    amountRemaining: { $gt: 0 },
    status: { $nin: ['FULLY_PAID', 'REJECTED'] },
  }).lean();

  if (!reqs.length) return null;

  const byCurrency = {};
  for (const r of reqs) {
    const c = String(r.currency || 'LKR').toUpperCase();
    byCurrency[c] = (byCurrency[c] || 0) + Math.max(0, r.amountRemaining || 0);
  }

  let best = { currency: 'LKR', amount: 0 };
  for (const [currency, amount] of Object.entries(byCurrency)) {
    if (amount > best.amount) best = { currency, amount };
  }
  return best.amount > 0 ? best : null;
}

async function getAdminIds() {
  const rows = await User.find({ role: { $in: ADMIN_ROLES } }).select('_id').lean();
  return rows.map((r) => r._id);
}

async function clearDueNotificationsForStudent(studentId) {
  await PaymentNotification.updateMany(
    {
      type: TYPE,
      relatedEntityId: studentId,
      isRead: false,
    },
    { $set: { isRead: true } },
  );
}

function buildCopy(student, journeyDay, due) {
  const name = student.name || student.email || 'Student';
  const amt = Math.round(due.amount).toLocaleString();
  const title = 'Language fee due — journey alert';
  const message = `${name} (journey day ${journeyDay}) has language fee due: ${due.currency} ${amt}.`;
  return { title, message };
}

function buildExerciseCopy(student, journeyDay, missedCount) {
  const name = student.name || student.email || 'Student';
  const title = 'Exercise missed — today alert';
  const label = missedCount === 1 ? 'exercise' : 'exercises';
  const message = `${name} (journey day ${journeyDay}) has not completed ${missedCount} ${label} scheduled for today.`;
  return { title, message };
}

function formatClassWhen(startTime) {
  if (!startTime) return 'today';
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) return 'today';
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} at ${time}`;
}

function buildClassCopy(student, journeyDay, absentItems) {
  const name = student.name || student.email || 'Student';
  const title = 'Class absent — today alert';
  const absentCount = absentItems.length;
  if (absentCount === 1) {
    const c = absentItems[0];
    const topic = c.topic || 'Live class';
    const batch = c.batch || student.batch || '—';
    const when = formatClassWhen(c.startTime);
    const message = `${name} (journey day ${journeyDay}) missed "${topic}" — Batch ${batch}, ${when}.`;
    return { title, message };
  }
  const label = absentCount === 1 ? 'class' : 'classes';
  const message = `${name} (journey day ${journeyDay}) missed ${absentCount} ${label} scheduled for today.`;
  return { title, message };
}

async function upsertAdminNotification(adminId, student, journeyDay, due) {
  const { title, message } = buildCopy(student, journeyDay, due);
  const metadata = {
    studentId: String(student._id),
    studentName: student.name,
    studentEmail: student.email,
    batch: student.batch,
    level: student.level,
    studentStatus: student.studentStatus,
    journeyDay,
    dueAmount: due.amount,
    currency: due.currency,
  };

  await PaymentNotification.findOneAndUpdate(
    {
      recipientId: adminId,
      type: TYPE,
      relatedEntityId: student._id,
      isRead: false,
    },
    {
      $set: {
        recipientRole: 'ADMIN',
        title,
        message,
        relatedEntityType: 'User',
        priority: 'HIGH',
        metadata,
      },
    },
    { upsert: true, new: true },
  );
}

async function upsertAdminExerciseNotification(adminId, student, journeyDay, missedItems) {
  const missedCount = missedItems.length;
  const { title, message } = buildExerciseCopy(student, journeyDay, missedCount);
  const metadata = {
    studentId: String(student._id),
    studentName: student.name,
    studentEmail: student.email,
    batch: student.batch,
    level: student.level,
    studentStatus: student.studentStatus,
    journeyDay,
    missedCount,
    missedItems,
  };

  await PaymentNotification.findOneAndUpdate(
    {
      recipientId: adminId,
      type: TYPE_EXERCISE,
      relatedEntityId: student._id,
      isRead: false,
    },
    {
      $set: {
        recipientRole: 'ADMIN',
        title,
        message,
        relatedEntityType: 'User',
        priority: 'HIGH',
        metadata,
      },
    },
    { upsert: true, new: true },
  );
}

async function upsertAdminClassNotification(adminId, student, journeyDay, absentItems) {
  const absentCount = absentItems.length;
  const { title, message } = buildClassCopy(student, journeyDay, absentItems);
  const metadata = {
    studentId: String(student._id),
    studentName: student.name,
    studentEmail: student.email,
    batch: student.batch,
    level: student.level,
    studentStatus: student.studentStatus,
    journeyDay,
    absentCount,
    absentItems,
  };

  await PaymentNotification.findOneAndUpdate(
    {
      recipientId: adminId,
      type: TYPE_CLASS,
      relatedEntityId: student._id,
      isRead: false,
    },
    {
      $set: {
        recipientRole: 'ADMIN',
        title,
        message,
        relatedEntityType: 'User',
        priority: 'HIGH',
        metadata,
      },
    },
    { upsert: true, new: true },
  );
}

async function clearNotificationsForStudentByType(studentId, type) {
  await PaymentNotification.updateMany(
    {
      type,
      relatedEntityId: studentId,
      isRead: false,
    },
    { $set: { isRead: true } },
  );
}

async function getMissedExercisesForCurrentDay(studentId, journeyDay) {
  const exercises = await DigitalExercise.find({
    isDeleted: { $ne: true },
    visibleToStudents: true,
    isActive: true,
    courseDay: journeyDay,
  })
    .select('_id title')
    .lean();

  if (!exercises.length) return [];
  const exerciseIds = exercises.map((e) => e._id);
  const completedIds = await ExerciseAttempt.find({
    studentId,
    exerciseId: { $in: exerciseIds },
    status: 'completed',
  }).distinct('exerciseId');
  const completedSet = new Set(completedIds.map((id) => String(id)));
  return exercises
    .filter((e) => !completedSet.has(String(e._id)))
    .map((e) => (e.title && String(e.title).trim() ? e.title : 'Digital exercise'));
}

async function getAbsentClassesForCurrentDay(student, journeyDay) {
  const batchName = String(student.batch || '').trim();
  if (!batchName) return [];
  const batchRegex = new RegExp(`^${String(batchName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const classes = await MeetingLink.find({
    batch: batchRegex,
    courseDay: journeyDay,
    status: { $ne: 'cancelled' },
  })
    .select('_id topic startTime duration batch courseDay attendance attendanceRecorded zoomMeetingId')
    .lean();

  if (!classes.length) return [];
  const studentId = String(student._id);
  const now = new Date();
  const absentItems = [];
  for (const cls of classes) {
    await resolveMeetingStartTime(cls, batchName);

    if (!shouldEvaluateClassAbsence(cls, now)) continue;

    const record = (cls.attendance || []).find((a) => String(a.studentId) === studentId);
    if (!isStudentPresentInMeeting(record)) {
      absentItems.push({
        meetingId: String(cls._id),
        topic: cls.topic && String(cls.topic).trim() ? cls.topic : 'Live class',
        startTime: toIsoOrNull(cls.startTime),
        batch: cls.batch || batchName,
        courseDay: cls.courseDay ?? journeyDay,
        status: 'missed',
      });
    }
  }
  return absentItems;
}

/** Patch stored notification rows so class alerts include a resolvable startTime. */
async function hydrateClassAbsentItemsInNotifications(notifications) {
  if (!Array.isArray(notifications) || !notifications.length) return notifications;

  const meetingIds = [];
  for (const n of notifications) {
    if (n.type !== TYPE_CLASS || !Array.isArray(n.metadata?.absentItems)) continue;
    for (const item of n.metadata.absentItems) {
      if (item && typeof item === 'object' && item.meetingId) {
        meetingIds.push(item.meetingId);
      }
    }
  }
  if (!meetingIds.length) return notifications;

  const meetings = await MeetingLink.find({ _id: { $in: meetingIds } })
    .select('_id topic startTime batch zoomMeetingId duration courseDay attendanceRecorded')
    .lean();
  const byId = new Map(meetings.map((m) => [String(m._id), m]));

  for (const n of notifications) {
    if (n.type !== TYPE_CLASS || !Array.isArray(n.metadata?.absentItems)) continue;
    const batchName = n.metadata?.batch;
    for (const item of n.metadata.absentItems) {
      if (!item || typeof item !== 'object') continue;
      const m = byId.get(String(item.meetingId));
      if (!m) continue;
      await resolveMeetingStartTime(m, item.batch || batchName);
      const iso = toIsoOrNull(m.startTime);
      if (iso) item.startTime = iso;
      if (!item.topic && m.topic) item.topic = m.topic;
    }
  }
  return notifications;
}

/**
 * Create or refresh admin alerts for one student; clear when no longer applicable.
 */
async function syncForStudent(studentId) {
  clearMeetingStartCaches();
  const student = await User.findById(studentId)
    .select('name email batch level role studentStatus currentCourseDay')
    .lean();
  if (!student || student.role !== 'STUDENT') return { notified: 0, cleared: false };

  const journeyDay = normalizeCourseDay(student.currentCourseDay);
  const due = await getLanguageFeeDue(studentId);

  let notified = 0;
  let cleared = 0;
  const adminIds = await getAdminIds();

  if (journeyDay <= JOURNEY_DAY_THRESHOLD || !due) {
    await clearDueNotificationsForStudent(studentId);
    cleared += 1;
  } else {
    await Promise.all(adminIds.map((adminId) => upsertAdminNotification(adminId, student, journeyDay, due)));
    notified += adminIds.length;
  }

  const missedExercises = await getMissedExercisesForCurrentDay(student._id, journeyDay);
  if (missedExercises.length) {
    await Promise.all(
      adminIds.map((adminId) =>
        upsertAdminExerciseNotification(adminId, student, journeyDay, missedExercises),
      ),
    );
    notified += adminIds.length;
  } else {
    await clearNotificationsForStudentByType(student._id, TYPE_EXERCISE);
    cleared += 1;
  }

  const absentClasses = await getAbsentClassesForCurrentDay(student, journeyDay);
  if (absentClasses.length) {
    await Promise.all(
      adminIds.map((adminId) =>
        upsertAdminClassNotification(adminId, student, journeyDay, absentClasses),
      ),
    );
    notified += adminIds.length;
  } else {
    await clearNotificationsForStudentByType(student._id, TYPE_CLASS);
    cleared += 1;
  }

  return { notified, cleared: cleared > 0, journeyDay, due, missedExerciseCount: missedExercises.length, absentClassCount: absentClasses.length };
}

/**
 * Scan all students past the journey threshold with open language fee balance.
 */
async function syncAllEligibleStudents() {
  clearMeetingStartCaches();
  const students = await User.find({ role: 'STUDENT' })
    .select('_id')
    .lean();

  let notified = 0;
  let cleared = 0;
  for (const s of students) {
    const r = await syncForStudent(s._id);
    if (r.cleared) cleared += 1;
    else if (r.notified) notified += 1;
  }

  const openStudentIds = await PaymentNotification.distinct('relatedEntityId', {
    type: { $in: [TYPE, TYPE_EXERCISE, TYPE_CLASS] },
    isRead: false,
  });
  for (const sid of openStudentIds) {
    if (sid && !students.some((s) => String(s._id) === String(sid))) {
      const r = await syncForStudent(sid);
      if (r.cleared) cleared += 1;
    }
  }

  return { scanned: students.length, notified, cleared };
}

module.exports = {
  TYPE,
  TYPE_EXERCISE,
  TYPE_CLASS,
  JOURNEY_DAY_THRESHOLD,
  getLanguageFeeDue,
  syncForStudent,
  syncAllEligibleStudents,
  clearDueNotificationsForStudent,
  clearNotificationsForStudentByType,
  getMissedExercisesForCurrentDay,
  getAbsentClassesForCurrentDay,
  hydrateClassAbsentItemsInNotifications,
  clearMeetingStartCaches,
};
