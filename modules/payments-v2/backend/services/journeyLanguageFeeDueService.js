/**
 * Notify finance admins when a student is past journey day 11 and still owes language fee.
 */
const mongoose = require('mongoose');
const PaymentRequest = require('../models/PaymentRequest');
const PaymentNotification = require('../models/Notification');

const User = mongoose.model('User');

const TYPE = 'JOURNEY_LANGUAGE_FEE_DUE';
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

async function upsertAdminNotification(adminId, student, journeyDay, due) {
  const { title, message } = buildCopy(student, journeyDay, due);
  const metadata = {
    studentId: String(student._id),
    studentName: student.name,
    studentEmail: student.email,
    batch: student.batch,
    level: student.level,
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

/**
 * Create or refresh admin alerts for one student; clear when no longer applicable.
 */
async function syncForStudent(studentId) {
  const student = await User.findById(studentId)
    .select('name email batch level role currentCourseDay')
    .lean();
  if (!student || student.role !== 'STUDENT') return { notified: 0, cleared: false };

  const journeyDay = normalizeCourseDay(student.currentCourseDay);
  const due = await getLanguageFeeDue(studentId);

  if (journeyDay <= JOURNEY_DAY_THRESHOLD || !due) {
    await clearDueNotificationsForStudent(studentId);
    return { notified: 0, cleared: true, journeyDay, due };
  }

  const adminIds = await getAdminIds();
  await Promise.all(adminIds.map((adminId) => upsertAdminNotification(adminId, student, journeyDay, due)));
  return { notified: adminIds.length, cleared: false, journeyDay, due };
}

/**
 * Scan all students past the journey threshold with open language fee balance.
 */
async function syncAllEligibleStudents() {
  const students = await User.find({
    role: 'STUDENT',
    currentCourseDay: { $gt: JOURNEY_DAY_THRESHOLD },
  })
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
    type: TYPE,
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
  JOURNEY_DAY_THRESHOLD,
  getLanguageFeeDue,
  syncForStudent,
  syncAllEligibleStudents,
  clearDueNotificationsForStudent,
};
