'use strict';

/**
 * Engagement report for uncertain / withdrew students in numeric batches (default 35–45).
 * Used by Student Management → Uncertain export.
 */

const User = require('../models/User');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGSession = require('../models/DGSession');
const MeetingLink = require('../models/MeetingLink');
const DigitalExercise = require('../models/DigitalExercise');
const DGModule = require('../models/DGModule');
const StudentPayment = require('../models/StudentPayment');
const PaymentRequest = require('../modules/payments-v2/backend/models/PaymentRequest');
const PaymentFlowSubmission = require('../modules/payments-v2/backend/models/PaymentSubmission');
const PaymentHubCatalog = require('../modules/payments-v2/backend/models/PaymentHubCatalog');
const {
  buildSubscriptionPriceMapLookup,
  pendingTotalsForStudent,
} = require('../modules/payments-v2/backend/helpers/paymentHubStatsAggregator');
const { EXCLUDE_TEST, batchMatchFilter } = require('../utils/analyticsFilters');
const { totalSessionMinutes } = require('../utils/dgSessionMetrics');
const { MAX_ATTEMPT_SECONDS } = require('../utils/exerciseAttemptMetrics');

const DEFAULT_BATCH_FROM = 35;
const DEFAULT_BATCH_TO = 45;
const STATUS_LABELS = {
  UNCERTAIN: 'Uncertain',
  WITHDREW: 'Withdrew',
};

function parseBatchNumber(batch) {
  const match = String(batch || '').match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function formatActivityDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  const month = d.toLocaleString('en-GB', { month: 'long' });
  return `${day} ${month}`;
}

function minutesToHours(minutes) {
  return round1(Number(minutes || 0) / 60);
}

function pickLastJourneyDay(exercise, classes, dg) {
  const candidates = [
    { at: exercise.lastExerciseAt, day: exercise.lastExerciseJourneyDay },
    { at: classes.lastClassAt, day: classes.lastClassJourneyDay },
    { at: dg.lastDgAt, day: dg.lastDgJourneyDay },
  ].filter((entry) => entry.at && entry.day != null && Number(entry.day) > 0);

  if (!candidates.length) return null;
  candidates.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return Number(candidates[0].day);
}

function maxDate(...values) {
  let best = null;
  for (const value of values) {
    if (!value) continue;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) continue;
    if (!best || d > best) best = d;
  }
  return best;
}

function round1(n) {
  return Math.round(Number(n || 0) * 10) / 10;
}

function formatPendingAmount(totals) {
  if (!totals) return '';
  const parts = [];
  for (const currency of ['LKR', 'INR', 'USD']) {
    const amount = Math.round(Number(totals[currency] || 0));
    if (amount > 0) parts.push(`${currency} ${amount.toLocaleString('en-US')}`);
  }
  return parts.join('; ');
}

function groupDocsByStudentId(docs) {
  const map = {};
  for (const doc of docs || []) {
    const sid = String(doc.studentId);
    if (!map[sid]) map[sid] = [];
    map[sid].push(doc);
  }
  return map;
}

async function aggregatePendingAmounts(students) {
  if (!students.length) return new Map();

  const studentIds = students.map((s) => s._id);
  const emails = students.map((s) => String(s.email || '').toLowerCase()).filter(Boolean);

  const [catalog, requests, approvedSubmissions, pendingSubmissions, legacyPayments] = await Promise.all([
    PaymentHubCatalog.getOrCreate(),
    PaymentRequest.find({ studentId: { $in: studentIds }, isArchived: false }).lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: studentIds },
      status: 'APPROVED',
      isArchived: false,
    }).lean(),
    PaymentFlowSubmission.find({
      studentId: { $in: studentIds },
      status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
      isArchived: false,
    }).lean(),
    StudentPayment.find({
      $or: [{ studentId: { $in: studentIds } }, { email: { $in: emails } }],
    }).lean(),
  ]);

  const getPriceMap = buildSubscriptionPriceMapLookup(catalog);
  const requestsByStudent = groupDocsByStudentId(requests);
  const approvedByStudent = groupDocsByStudentId(approvedSubmissions);
  const pendingByStudent = groupDocsByStudentId(pendingSubmissions);

  const legacyByStudentId = new Map();
  const legacyByEmail = new Map();
  for (const payment of legacyPayments) {
    if (payment.studentId) legacyByStudentId.set(String(payment.studentId), payment);
    const email = String(payment.email || '').toLowerCase();
    if (email) legacyByEmail.set(email, payment);
  }

  const result = new Map();

  for (const student of students) {
    const sid = String(student._id);
    const studentRequests = requestsByStudent[sid] || [];

    if (studentRequests.length) {
      const levelPriceMap = getPriceMap(student.subscription);
      const totals = pendingTotalsForStudent(
        studentRequests,
        approvedByStudent[sid] || [],
        pendingByStudent[sid] || [],
        student,
        levelPriceMap,
      );
      result.set(sid, formatPendingAmount(totals));
      continue;
    }

    const legacy =
      legacyByStudentId.get(sid) ||
      legacyByEmail.get(String(student.email || '').toLowerCase()) ||
      null;
    if (legacy) {
      const currency = legacy.currency || 'LKR';
      const pending = Math.max(
        0,
        Number(legacy.pendingPayment) ||
          (Number(legacy.totalPackageAmount) || 0) - (Number(legacy.totalPaid) || 0),
      );
      result.set(sid, pending > 0 ? `${currency} ${Math.round(pending).toLocaleString('en-US')}` : '');
      continue;
    }

    result.set(sid, '');
  }

  return result;
}

function formatRatio(done, total) {
  return `${done || 0}/${total || 0}`;
}

function normalizeBatchKey(batch) {
  return String(batch || '').trim().toLowerCase();
}

function buildCumulativeCountByDay(items, getDay) {
  const counts = {};
  for (const item of items) {
    const day = Number(getDay(item));
    if (!Number.isFinite(day) || day < 1) continue;
    counts[day] = (counts[day] || 0) + 1;
  }
  const maxDay = Math.max(0, ...Object.keys(counts).map(Number));
  const cumulative = new Array(maxDay + 1).fill(0);
  let running = 0;
  for (let d = 1; d <= maxDay; d++) {
    running += counts[d] || 0;
    cumulative[d] = running;
  }
  return cumulative;
}

function totalUpToDay(cumulative, day) {
  const n = Number(day);
  if (!Number.isFinite(n) || n < 1) return 0;
  if (n >= cumulative.length) return cumulative[cumulative.length - 1] || 0;
  return cumulative[n] || 0;
}

function isAttended(attendanceEntry) {
  return attendanceEntry?.attended === true || attendanceEntry?.status === 'attended';
}

function classMinutesFromAttendance(attendanceEntry) {
  const durationMinutes = Number(attendanceEntry?.durationMinutes || 0);
  if (durationMinutes > 0) return durationMinutes;
  return Number(attendanceEntry?.duration || 0) / 60;
}

function latestActivityByDay(rows, requireActivity = false) {
  return rows.reduce(
    (best, row) => {
      if (requireActivity && !row.hasActivity) return best;
      if (!row.at || row.courseDay == null || Number(row.courseDay) < 1) return best;
      if (!best.at || new Date(row.at) > new Date(best.at)) {
        return { at: row.at, courseDay: row.courseDay };
      }
      return best;
    },
    { at: null, courseDay: null },
  );
}

async function buildStudentEngagementMetrics(students, studentIds) {
  if (!students.length) return new Map();

  const batchKeys = [...new Set(students.map((s) => String(s.batch || '').trim()).filter(Boolean))];
  const batchPatterns = batchKeys.map((b) => batchMatchFilter(b)).filter(Boolean);
  const meetingMatch = {
    status: { $ne: 'cancelled' },
    courseDay: { $gte: 1 },
  };
  if (batchPatterns.length === 1) {
    meetingMatch.batch = batchPatterns[0];
  } else if (batchPatterns.length > 1) {
    meetingMatch.batch = { $in: batchPatterns };
  }

  const [catalogExercises, catalogDgModules, exerciseAttempts, meetings, dgSessions] = await Promise.all([
    DigitalExercise.find({
      isDeleted: { $ne: true },
      isActive: true,
      visibleToStudents: true,
      courseDay: { $gte: 1 },
    })
      .select('_id courseDay')
      .lean(),
    DGModule.find({
      isActive: true,
      visibleToStudents: true,
      courseDay: { $gte: 1 },
    })
      .select('_id courseDay')
      .lean(),
    ExerciseAttempt.find({
      studentId: { $in: studentIds },
      status: 'completed',
    })
      .select('studentId exerciseId scorePercentage timeSpentSeconds completedAt')
      .lean(),
    MeetingLink.find(meetingMatch)
      .select('batch courseDay startTime attendance')
      .lean(),
    DGSession.find({ studentId: { $in: studentIds } })
      .select('studentId moduleId createdAt updatedAt completed completedAt timePerSceneMs logs')
      .lean(),
  ]);

  const exerciseDayById = new Map(
    catalogExercises.map((exercise) => [String(exercise._id), Number(exercise.courseDay)]),
  );
  const moduleDayById = new Map(
    catalogDgModules.map((module) => [String(module._id), Number(module.courseDay)]),
  );
  const exerciseCumulative = buildCumulativeCountByDay(catalogExercises, (item) => item.courseDay);
  const dgCumulative = buildCumulativeCountByDay(catalogDgModules, (item) => item.courseDay);

  const meetingsByBatch = new Map();
  for (const meeting of meetings) {
    const key = normalizeBatchKey(meeting.batch);
    if (!meetingsByBatch.has(key)) meetingsByBatch.set(key, []);
    meetingsByBatch.get(key).push(meeting);
  }
  const classCumulativeByBatch = new Map();
  for (const [batchKey, batchMeetings] of meetingsByBatch) {
    classCumulativeByBatch.set(batchKey, buildCumulativeCountByDay(batchMeetings, (item) => item.courseDay));
  }

  const attemptsByStudent = new Map();
  for (const attempt of exerciseAttempts) {
    const sid = String(attempt.studentId);
    if (!attemptsByStudent.has(sid)) attemptsByStudent.set(sid, []);
    attemptsByStudent.get(sid).push({
      exerciseId: String(attempt.exerciseId),
      courseDay: exerciseDayById.get(String(attempt.exerciseId)) ?? null,
      score: attempt.scorePercentage,
      seconds: Math.min(Number(attempt.timeSpentSeconds) || 0, MAX_ATTEMPT_SECONDS),
      at: attempt.completedAt,
    });
  }

  const dgSessionsByStudent = new Map();
  for (const session of dgSessions) {
    const sid = String(session.studentId);
    if (!dgSessionsByStudent.has(sid)) dgSessionsByStudent.set(sid, []);
    const minutes = totalSessionMinutes(session);
    dgSessionsByStudent.get(sid).push({
      moduleId: String(session.moduleId),
      courseDay: moduleDayById.get(String(session.moduleId)) ?? null,
      minutes,
      hasActivity: minutes > 0 || session.completed,
      at: maxDate(session.completedAt, session.updatedAt, session.createdAt),
    });
  }

  const metricsByStudent = new Map();

  for (const student of students) {
    const sid = String(student._id);
    const batchKey = normalizeBatchKey(student.batch);
    const batchMeetings = meetingsByBatch.get(batchKey) || [];

    const exerciseRows = attemptsByStudent.get(sid) || [];
    const dgRows = dgSessionsByStudent.get(sid) || [];

    const classRows = [];
    for (const meeting of batchMeetings) {
      const courseDay = Number(meeting.courseDay);
      if (!Number.isFinite(courseDay) || courseDay < 1) continue;
      for (const attendance of meeting.attendance || []) {
        if (String(attendance.studentId) !== sid || !isAttended(attendance)) continue;
        classRows.push({
          courseDay,
          minutes: classMinutesFromAttendance(attendance),
          at: meeting.startTime,
        });
      }
    }

    const lastJourneyDay = pickLastJourneyDay(
      {
        lastExerciseAt: latestActivityByDay(exerciseRows).at,
        lastExerciseJourneyDay: latestActivityByDay(exerciseRows).courseDay,
      },
      {
        lastClassAt: latestActivityByDay(classRows).at,
        lastClassJourneyDay: latestActivityByDay(classRows).courseDay,
      },
      {
        lastDgAt: latestActivityByDay(dgRows, true).at,
        lastDgJourneyDay: latestActivityByDay(dgRows, true).courseDay,
      },
    );

    const dayLimit = Number(lastJourneyDay) || 0;
    const scopedExercises = exerciseRows.filter(
      (row) => row.courseDay != null && row.courseDay <= dayLimit,
    );
    const scopedClasses = classRows.filter((row) => row.courseDay <= dayLimit);
    const scopedDg = dgRows.filter(
      (row) => row.hasActivity && row.courseDay != null && row.courseDay <= dayLimit,
    );

    const exercisesDone = new Set(scopedExercises.map((row) => row.exerciseId)).size;
    const exercisesTotal = totalUpToDay(exerciseCumulative, dayLimit);
    const classesAttended = scopedClasses.length;
    const classesTotal = totalUpToDay(classCumulativeByBatch.get(batchKey) || [], dayLimit);
    const dgDone = new Set(scopedDg.map((row) => row.moduleId)).size;
    const dgTotal = totalUpToDay(dgCumulative, dayLimit);

    const scored = scopedExercises.filter((row) => row.score != null);
    const avgExerciseScore = scored.length
      ? round1(scored.reduce((sum, row) => sum + Number(row.score), 0) / scored.length)
      : 0;

    const exerciseMinutes = round1(
      scopedExercises.reduce((sum, row) => sum + row.seconds, 0) / 60,
    );
    const classMinutes = round1(scopedClasses.reduce((sum, row) => sum + row.minutes, 0));
    const dgMinutes = round1(scopedDg.reduce((sum, row) => sum + row.minutes, 0));
    const totalMinutes = round1(exerciseMinutes + classMinutes + dgMinutes);
    const activityCount = exercisesDone + classesAttended + dgDone;

    metricsByStudent.set(sid, {
      lastJourneyDay: lastJourneyDay ?? '',
      classesAttended: formatRatio(classesAttended, classesTotal),
      exercisesCompleted: formatRatio(exercisesDone, exercisesTotal),
      dgBotSessions: formatRatio(dgDone, dgTotal),
      avgExerciseScore,
      totalHoursSpent: minutesToHours(totalMinutes),
      avgMinutesPerActivity: activityCount > 0 ? round1(totalMinutes / activityCount) : 0,
      lastActivityDate: formatActivityDate(
        maxDate(
          maxDate(...scopedExercises.map((row) => row.at)),
          maxDate(...scopedClasses.map((row) => row.at)),
          maxDate(...scopedDg.map((row) => row.at)),
        ),
      ),
    });
  }

  return metricsByStudent;
}

/**
 * @param {{ batchFrom?: number, batchTo?: number }} opts
 */
async function getUncertainStudentsEngagementReport(opts = {}) {
  const batchFrom = Number.isFinite(opts.batchFrom) ? opts.batchFrom : DEFAULT_BATCH_FROM;
  const batchTo = Number.isFinite(opts.batchTo) ? opts.batchTo : DEFAULT_BATCH_TO;

  const candidates = await User.find({
    role: 'STUDENT',
    studentStatus: { $in: ['UNCERTAIN', 'WITHDREW'] },
    ...EXCLUDE_TEST,
  })
    .select('_id name email regNo batch level subscription studentStatus lastLogin')
    .populate({ path: 'assignedTeacher', select: 'name' })
    .lean();

  const students = candidates.filter((student) => {
    const batchNum = parseBatchNumber(student.batch);
    return batchNum != null && batchNum >= batchFrom && batchNum <= batchTo;
  });

  const studentIds = students.map((s) => s._id);

  const [engagementByStudent, pendingByStudent] = await Promise.all([
    buildStudentEngagementMetrics(students, studentIds),
    aggregatePendingAmounts(students),
  ]);

  const rows = students.map((student) => {
    const sid = String(student._id);
    const engagement = engagementByStudent.get(sid) || {
      lastJourneyDay: '',
      classesAttended: '0/0',
      exercisesCompleted: '0/0',
      dgBotSessions: '0/0',
      avgExerciseScore: 0,
      totalHoursSpent: 0,
      avgMinutesPerActivity: 0,
      lastActivityDate: '',
    };

    const teacherName =
      student.assignedTeacher && typeof student.assignedTeacher === 'object'
        ? student.assignedTeacher.name || ''
        : '';

    return {
      regNo: student.regNo || '',
      name: student.name || '',
      email: student.email || '',
      batch: student.batch || '',
      level: student.level || '',
      plan: student.subscription || '',
      status: STATUS_LABELS[student.studentStatus] || student.studentStatus || '',
      lastJourneyDay: engagement.lastJourneyDay,
      assignedTeacher: teacherName,
      lastLoginDate: toIsoDate(student.lastLogin),
      pendingAmount: pendingByStudent.get(sid) || '',
      classesAttended: engagement.classesAttended,
      exercisesCompleted: engagement.exercisesCompleted,
      avgExerciseScore: engagement.avgExerciseScore,
      dgBotSessions: engagement.dgBotSessions,
      totalHoursSpent: engagement.totalHoursSpent,
      avgMinutesPerActivity: engagement.avgMinutesPerActivity,
      lastActivityDate: engagement.lastActivityDate,
    };
  });

  rows.sort((a, b) => {
    const batchA = parseBatchNumber(a.batch) ?? 0;
    const batchB = parseBatchNumber(b.batch) ?? 0;
    if (batchA !== batchB) return batchA - batchB;
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    batchFrom,
    batchTo,
    generatedAt: new Date().toISOString(),
    totalStudents: rows.length,
    students: rows,
  };
}

module.exports = {
  getUncertainStudentsEngagementReport,
  parseBatchNumber,
  DEFAULT_BATCH_FROM,
  DEFAULT_BATCH_TO,
};
