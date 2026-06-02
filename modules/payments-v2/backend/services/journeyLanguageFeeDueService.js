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

function buildClassCopy(student, journeyDay, absentCount) {
  const name = student.name || student.email || 'Student';
  const title = 'Class absent — today alert';
  const label = absentCount === 1 ? 'class' : 'classes';
  const message = `${name} (journey day ${journeyDay}) is absent in ${absentCount} ${label} scheduled for today.`;
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
  const { title, message } = buildClassCopy(student, journeyDay, absentCount);
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
    .select('topic attendance')
    .lean();

  if (!classes.length) return [];
  const studentId = String(student._id);
  const absentItems = [];
  for (const cls of classes) {
    const record = (cls.attendance || []).find((a) => String(a.studentId) === studentId);
    const isPresent = !!record && (record.attended === true || ['attended', 'late'].includes(String(record.status || '').toLowerCase()));
    if (!isPresent) absentItems.push(cls.topic && String(cls.topic).trim() ? cls.topic : 'Live class');
  }
  return absentItems;
}

/**
 * Create or refresh admin alerts for one student; clear when no longer applicable.
 */
async function syncForStudent(studentId) {
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
};
