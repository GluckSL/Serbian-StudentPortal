//routes/admin.js

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Subscription = require('../models/subscriptions');
const User = require('../models/User');
const StudentChangeHistory = require('../models/StudentChangeHistory');
const UserAuditLog = require('../models/UserAuditLog');
const SignupApplication = require('../models/StudentSignupApplication');
const MeetingLink = require('../models/MeetingLink');
const Course = require('../models/Course');
const CourseProgress = require('../models/CourseProgress');
const BatchConfig = require('../models/BatchConfig');
//const auth = require('../middleware/auth');
const { verifyToken, isAdmin, checkRole } = require('../middleware/auth'); // ✅ Correct import
const { requireStudentsListAccess } = require('../middleware/subAdminTabAccess');
const { readRecoverablePassword } = require('../utils/passwordRecoverable');
const { resolveStudentDisplayPassword } = require('../utils/resolveStudentDisplayPassword');
const { mergePortalBatchNames } = require('../utils/portalBatchPresets');
const { applyStudentNameFilter } = require('../utils/studentSearchQuery');
const { computeStudentDataIssues } = require('../services/studentDataIssues');
const {
  recordStudentChange,
  recordBulkStudentChanges,
} = require('../services/studentChangeHistory.service');
const {
  applyStudentCountryFilters,
  backfillPhoneCountries,
  STUDENT_COUNTRY_FILTER_OPTIONS,
} = require('../utils/studentCountry');
const { approvePublicSignupApplication, rejectPublicSignupApplication } = require('../utils/signupActivation');
const { batchMatchFilters } = require('../utils/analyticsFilters');
const { shareTeacherWeeklyTimetable } = require('../services/weeklyTimetableService');

const FILTER_OPTIONS_CACHE_TTL_MS = 2 * 60 * 1000;
let filterOptionsCache = { at: 0, payload: null };

function noStoreJson(res, body) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('ETag', false);
  return res.json(body);
}

function mapAdminStudentListRows(students) {
  return students.map((s) => {
    const displayPassword = readRecoverablePassword(s.passwordRecoverable);
    const { passwordRecoverable, ...rest } = s;
    return {
      ...rest,
      displayPassword,
      passwordDisplayState: displayPassword ? 'VISIBLE' : 'UNAVAILABLE',
    };
  });
}

async function loadStudentFilterOptions() {
  const now = Date.now();
  if (filterOptionsCache.payload && now - filterOptionsCache.at < FILTER_OPTIONS_CACHE_TTL_MS) {
    return filterOptionsCache.payload;
  }

  const base = { role: 'STUDENT' };
  const clean = (arr) =>
    [...new Set((arr || []).map((v) => String(v).trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );

  const visaDocSubscriptions = ['VISA_DOC', 'VISA_DOC_ONLY', 'DOCS_RECOGNITION'];
  const nonTestBase = { role: 'STUDENT', isTestAccount: { $ne: true } };

  function summarizePlanGroup(rows, matchSubscription) {
    const byStatus = {};
    let total = 0;
    for (const row of rows) {
      const subscription = String(row._id?.subscription || '').toUpperCase();
      if (!matchSubscription(subscription)) continue;
      const status = String(row._id?.status || 'UNCERTAIN').toUpperCase();
      total += row.count;
      byStatus[status] = (byStatus[status] || 0) + row.count;
    }
    const statusOrder = ['UNCERTAIN', 'COMPLETED', 'WITHDREW', 'DROPPED'];
    const statusBreakdown = statusOrder
      .map((status) => ({ status, count: byStatus[status] || 0 }))
      .filter((entry) => entry.count > 0);
    return {
      total,
      ongoing: byStatus.ONGOING || 0,
      statusBreakdown,
    };
  }

  const [batches, configBatchNames, servicesOpted, qualifications, languageLevelOpted, leadSource, stream, signupAppUserIds, countAgg, planStatusAgg] =
    await Promise.all([
      User.distinct('batch', base),
      BatchConfig.distinct('batchName', { batchName: { $ne: null } }),
      User.distinct('servicesOpted', base),
      User.distinct('qualifications', base),
      User.distinct('languageLevelOpted', base),
      User.distinct('leadSource', base),
      User.distinct('stream', base),
      SignupApplication.distinct('userId', { userId: { $ne: null } }),
      User.aggregate([
        { $match: base },
        {
          $group: {
            _id: null,
            portalTotal: { $sum: 1 },
            portalActive: {
              $sum: { $cond: [{ $ne: ['$studentStatus', 'WITHDREW'] }, 1, 0] },
            },
            portalWithdrew: {
              $sum: { $cond: [{ $eq: ['$studentStatus', 'WITHDREW'] }, 1, 0] },
            },
            portalCrmLinked: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: [{ $ifNull: ['$crmExternalId', ''] }, ''] },
                      { $ne: ['$crmExternalId', null] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            portalSignupForm: {
              $sum: {
                $cond: [{ $eq: ['$signupSource', 'public_signup'] }, 1, 0],
              },
            },
            portalTestAccounts: {
              $sum: {
                $cond: [{ $eq: ['$isTestAccount', true] }, 1, 0],
              },
            },
          },
        },
      ]),
      User.aggregate([
        { $match: nonTestBase },
        {
          $group: {
            _id: { subscription: '$subscription', status: '$studentStatus' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

  const counts = countAgg[0] || {};
  const planStatusRows = planStatusAgg || [];
  let portalNonTest = 0;
  let ongoingNonTest = 0;
  for (const row of planStatusRows) {
    portalNonTest += row.count;
    if (String(row._id?.status || '').toUpperCase() === 'ONGOING') {
      ongoingNonTest += row.count;
    }
  }
  const platinumStats = summarizePlanGroup(planStatusRows, (sub) => sub === 'PLATINUM');
  const silverStats = summarizePlanGroup(planStatusRows, (sub) => sub === 'SILVER');
  const visaDocsStats = summarizePlanGroup(planStatusRows, (sub) => visaDocSubscriptions.includes(sub));
  const signupFormUserIds = (signupAppUserIds || []).filter((id) => id != null);
  let portalSignupForm = counts.portalSignupForm ?? 0;
  if (signupFormUserIds.length) {
    portalSignupForm = await User.countDocuments({
      ...base,
      $or: [{ signupSource: 'public_signup' }, { _id: { $in: signupFormUserIds } }],
    });
  }
  const payload = {
    success: true,
    batches: mergePortalBatchNames(clean([...batches, ...configBatchNames])),
    servicesOpted: clean(servicesOpted),
    qualifications: clean(qualifications),
    languageLevelOpted: clean(languageLevelOpted),
    leadSource: clean(leadSource),
    stream: clean(stream),
    studentCounts: {
      portalTotal: counts.portalTotal ?? 0,
      portalActive: counts.portalActive ?? 0,
      portalWithdrew: counts.portalWithdrew ?? 0,
      portalCrmLinked: counts.portalCrmLinked ?? 0,
      portalSignupForm,
      portalTestAccounts: counts.portalTestAccounts ?? 0,
      portalNonTest,
      ongoingNonTest,
      platinumTotal: platinumStats.total,
      platinumOngoing: platinumStats.ongoing,
      platinumStatusBreakdown: platinumStats.statusBreakdown,
      silverTotal: silverStats.total,
      silverOngoing: silverStats.ongoing,
      silverStatusBreakdown: silverStats.statusBreakdown,
      visaDocsTotal: visaDocsStats.total,
      visaDocsOngoing: visaDocsStats.ongoing,
      visaDocsStatusBreakdown: visaDocsStats.statusBreakdown,
    },
    phoneCountries: STUDENT_COUNTRY_FILTER_OPTIONS,
    loginCountries: STUDENT_COUNTRY_FILTER_OPTIONS,
  };

  filterOptionsCache = { at: now, payload };
  return payload;
}

function bustFilterOptionsCache() {
  filterOptionsCache = { at: 0, payload: null };
}

/** Whitelist: API key → User schema path (advanced filter + distinct values) */
const ADV_STUDENT_FILTER_FIELDS = {
  level: 'level',
  subscription: 'subscription',
  batch: 'batch',
  studentStatus: 'studentStatus',
  servicesOpted: 'servicesOpted',
  qualifications: 'qualifications',
  languageLevelOpted: 'languageLevelOpted',
  leadSource: 'leadSource',
  stream: 'stream',
  teacherIncharge: 'teacherIncharge',
  otherLanguageKnown: 'otherLanguageKnown',
  documentationPaymentStatus: 'documentationPaymentStatus',
  languageExamStatus: 'languageExamStatus',
  candidateStatus: 'candidateStatus',
  phoneNumber: 'phoneNumber',
  whatsappNumber: 'whatsappNumber',
  address: 'address',
  medium: 'medium',
  age: 'age'
};

// Admin dashboard route
router.get("/admin-dashboard", verifyToken, checkRole("admin"), (req, res) => {
  res.json({ msg: "Welcome Admin" });
});

// Distinct CRM filter values for student list (Monday-synced fields)
router.get('/students/filter-options', verifyToken, isAdmin, async (req, res) => {
  try {
    const payload = await loadStudentFilterOptions();
    return noStoreJson(res, payload);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Distinct values for one student field (analytic advanced filter)
router.get('/students/distinct/:fieldKey', verifyToken, isAdmin, async (req, res) => {
  try {
    const fieldKey = String(req.params.fieldKey || '').trim();
    const path = ADV_STUDENT_FILTER_FIELDS[fieldKey];
    if (!path) {
      return res.status(400).json({ success: false, message: 'Unknown or disallowed field' });
    }

    const base = { role: 'STUDENT' };
    let raw = await User.distinct(path, base);

    if (path === 'medium') {
      raw = (raw || []).flatMap((v) => (Array.isArray(v) ? v : [v]));
    }

    const clean = [...new Set((raw || []).map((v) => String(v).trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
    );

    res.json({ success: true, fieldKey, values: clean });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Students with data-quality issues (duplicate email, portal-only vs CRM, etc.)
router.get('/students/uncertain-engagement-report', verifyToken, isAdmin, async (req, res) => {
  try {
    const { getUncertainStudentsEngagementReport } = require('../services/uncertainStudentsReport.service');
    const batchFrom = parseInt(String(req.query.batchFrom || '35'), 10);
    const batchTo = parseInt(String(req.query.batchTo || '45'), 10);
    const report = await getUncertainStudentsEngagementReport({
      batchFrom: Number.isFinite(batchFrom) ? batchFrom : 35,
      batchTo: Number.isFinite(batchTo) ? batchTo : 45,
    });
    return noStoreJson(res, { success: true, ...report });
  } catch (err) {
    console.error('[admin] GET /students/uncertain-engagement-report', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to build uncertain students engagement report',
    });
  }
});

router.get('/students/data-issues', verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await computeStudentDataIssues();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin] GET /students/data-issues', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to scan student data issues' });
  }
});

// Get all students (admin, sub-admin with scope, and teachers assigned document-type tabs)
router.get('/students', verifyToken, requireStudentsListAccess, async (req, res) => {
  try {
    const toPositiveInt = (value, fallback) => {
      const parsed = parseInt(String(value), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    };

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const skip = (page - 1) * limit;

    const {
      level,
      plan,
      batch,
      studentStatus,
      studentName,
      teacherName,
      servicesOpted,
      qualifications,
      languageLevelOpted,
      leadSource,
      stream,
      phoneCountry,
      loginCountry,
      advField,
      advValue
    } = req.query;

    const query = { role: 'STUDENT' };

    if (level) query.level = String(level).trim();
    if (plan) query.subscription = String(plan).trim().toUpperCase();
    const batchFilter = batchMatchFilters(batch);
    if (batchFilter) query.batch = batchFilter;
    if (studentStatus) query.studentStatus = String(studentStatus).trim().toUpperCase();
    applyStudentNameFilter(query, studentName);
    if (servicesOpted) query.servicesOpted = String(servicesOpted).trim();
    if (qualifications) query.qualifications = String(qualifications).trim();
    if (languageLevelOpted) query.languageLevelOpted = String(languageLevelOpted).trim();
    if (leadSource) query.leadSource = String(leadSource).trim();
    if (stream) query.stream = String(stream).trim();
    applyStudentCountryFilters(query, { phoneCountry, loginCountry });

    if (teacherName) {
      const matchingTeachers = await User.find({
        role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
        name: { $regex: new RegExp(String(teacherName).trim(), 'i') }
      }).select('_id');

      const teacherIds = matchingTeachers.map((teacher) => teacher._id);
      query.assignedTeacher = { $in: teacherIds };
    }

    // Advanced filter (single field/value); applied after basics — overrides same path if duplicated
    if (advField && advValue !== undefined && advValue !== null && String(advValue).trim() !== '') {
      const advPath = ADV_STUDENT_FILTER_FIELDS[String(advField).trim()];
      if (advPath) {
        let v = String(advValue).trim();
        if (advPath === 'studentStatus') v = v.toUpperCase();
        if (advPath === 'subscription') v = v.toUpperCase();
        if (advPath === 'age') {
          const n = parseInt(v, 10);
          if (Number.isFinite(n)) query.age = n;
        } else if (advPath === 'medium') {
          query.medium = v;
        } else {
          query[advPath] = v;
        }
      }
    }

    const isFullAdmin = req.user?.role === 'ADMIN';

    const [total, students] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .select(isFullAdmin ? '+passwordRecoverable' : '-password -passwordRecoverable')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'assignedTeacher',
          select: 'name regNo email medium',
        })
        .lean(),
    ]);

    const pages = Math.max(1, Math.ceil(total / limit));
    const data = isFullAdmin ? mapAdminStudentListRows(students) : students;

    return noStoreJson(res, {
      success: true,
      data,
      pagination: {
        total,
        page,
        limit,
        pages
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students',
      error: err.message
    });
  }
});

router.get('/students/:studentId/change-history', verifyToken, isAdmin, async (req, res) => {
  try {
    const { studentId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID' });
    }

    const history = await StudentChangeHistory.find({ studentId })
      .populate('changedBy', 'name email role')
      .sort({ changedAt: -1 })
      .limit(500)
      .lean();

    return res.json({ success: true, count: history.length, data: history });
  } catch (err) {
    console.error('Error fetching student change history:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch student change history' });
  }
});

// Account audit log — who created/updated/deleted any portal user (all roles)
router.get('/user-audit-logs', verifyToken, isAdmin, async (req, res) => {
  try {
    const page = Math.max(parseInt(String(req.query.page || '1'), 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.targetUserId && mongoose.Types.ObjectId.isValid(String(req.query.targetUserId))) {
      query.targetUserId = req.query.targetUserId;
    }
    if (req.query.actorId && mongoose.Types.ObjectId.isValid(String(req.query.actorId))) {
      query.actorId = req.query.actorId;
    }
    if (req.query.action) {
      query.action = String(req.query.action).toUpperCase();
    }
    if (req.query.targetUserRole) {
      query.targetUserRole = String(req.query.targetUserRole).toUpperCase();
    }
    if (req.query.q) {
      const q = String(req.query.q).trim();
      if (q) {
        query.$or = [
          { targetUserName: new RegExp(q, 'i') },
          { targetUserEmail: new RegExp(q, 'i') },
          { targetUserRegNo: new RegExp(q, 'i') },
          { actorName: new RegExp(q, 'i') },
        ];
      }
    }
    if (req.query.from || req.query.to) {
      query.occurredAt = {};
      if (req.query.from) {
        const from = new Date(req.query.from);
        if (!Number.isNaN(from.getTime())) query.occurredAt.$gte = from;
      }
      if (req.query.to) {
        const to = new Date(req.query.to);
        if (!Number.isNaN(to.getTime())) query.occurredAt.$lte = to;
      }
      if (!Object.keys(query.occurredAt).length) delete query.occurredAt;
    }

    const [total, rows] = await Promise.all([
      UserAuditLog.countDocuments(query),
      UserAuditLog.find(query)
        .sort({ occurredAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.json({
      success: true,
      count: rows.length,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
      data: rows,
    });
  } catch (err) {
    console.error('Error fetching user audit logs:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch user audit logs' });
  }
});

// One-time repair: resolve display passwords from recoverable/signup/email-change sources and backfill DB.
router.post('/students/sync-display-passwords', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { resolveStudentDisplayPassword } = require('../utils/resolveStudentDisplayPassword');
    const { readRecoverablePassword, storeRecoverablePassword } = require('../utils/passwordRecoverable');
    const students = await User.find({ role: 'STUDENT' }).select('+password');
    let withDisplay = 0;
    let backfilled = 0;

    for (const s of students) {
      const plain = await resolveStudentDisplayPassword(s);
      if (!plain) continue;
      withDisplay += 1;
      if (!readRecoverablePassword(s.passwordRecoverable)) {
        const stored = storeRecoverablePassword(plain);
        if (stored) {
          await User.updateOne({ _id: s._id }, { passwordRecoverable: stored });
          backfilled += 1;
        }
      }
    }

    bustFilterOptionsCache();
    return res.json({ success: true, withDisplay, backfilled });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});


// Get all teachers
router.get('/teachers', verifyToken, isAdmin, async (req, res) => {
  try {
    const teachers = await User.find({ role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } })
      .populate('assignedCourses', 'title')
      .select('-password')
      .lean();

    // Count students per teacher
    const studentCounts = await User.aggregate([
      { $match: { role: 'STUDENT', assignedTeacher: { $exists: true, $ne: null } } },
      { $group: { _id: '$assignedTeacher', count: { $sum: 1 } } }
    ]);
    const countMap = {};
    studentCounts.forEach(sc => { countMap[sc._id.toString()] = sc.count; });

    const teachersWithCount = teachers.map(t => ({
      ...t,
      studentCount: countMap[t._id.toString()] || 0
    }));

    res.json({ success: true, data: teachersWithCount });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teachers',
      error: err.message
    });
  }
});

// Share weekly timetable (Mon–Sun) with a teacher via email + WhatsApp
router.post('/teachers/:teacherId/share-timetable', verifyToken, isAdmin, async (req, res) => {
  try {
    const result = await shareTeacherWeeklyTimetable(req.params.teacherId, {
      phoneOverride: req.body?.whatsappNumber || req.body?.phoneNumber,
    });
    const hasDelivery = result.emailSent || result.whatsappSent;
    return res.json({
      success: hasDelivery,
      message: hasDelivery
        ? `Timetable shared with ${result.teacherName}`
        : `Could not deliver timetable to ${result.teacherName}`,
      data: result,
      warnings: result.warnings || [],
    });
  } catch (err) {
    console.error('[POST /admin/teachers/:teacherId/share-timetable]', err);
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Failed to share timetable',
    });
  }
});

function getTeacherAnalyticsMonth(queryMonth) {
  const now = new Date();
  const raw = String(queryMonth || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})$/);
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const monthIndex = match ? Number(match[2]) - 1 : now.getUTCMonth();
  const safeMonthIndex = monthIndex >= 0 && monthIndex <= 11 ? monthIndex : now.getUTCMonth();
  const safeYear = Number.isFinite(year) ? year : now.getUTCFullYear();
  const from = new Date(Date.UTC(safeYear, safeMonthIndex, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(safeYear, safeMonthIndex + 1, 1, 0, 0, 0, 0));
  const month = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
  const monthLabel = from.toLocaleString('sr-Latn-RS', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { month, monthLabel, from, to };
}

function getScheduledMinutes(meeting) {
  const duration = Number(meeting.duration || 0);
  if (duration > 0) return duration;
  return meeting.attendanceRecorded ? 60 : 0;
}

function normTeacherBatch(b) {
  return String(b || '').trim().toLowerCase();
}

function getTeacherAnalyticsMeetingUpperBound(from, to, now = new Date()) {
  return to < now ? to : now;
}

function summarizeMeetingAttendance(meeting) {
  const scheduledMinutes = getScheduledMinutes(meeting);
  const attendance = Array.isArray(meeting.attendance) ? meeting.attendance : [];
  const present = attendance.filter((e) => e?.attended === true || e?.status === 'attended').length;
  const late = attendance.filter((e) => e?.status === 'late').length;
  const total = attendance.length;
  return { scheduledMinutes, present, late, total };
}

function indexStudentsByTeacher(students) {
  const byTeacher = new Map();
  const byTeacherBatch = new Map();
  for (const s of students) {
    const tid = String(s.assignedTeacher);
    if (!byTeacher.has(tid)) byTeacher.set(tid, []);
    byTeacher.get(tid).push(s);
    const batchKey = normTeacherBatch(s.batch);
    const key = `${tid}::${batchKey}`;
    if (!byTeacherBatch.has(key)) byTeacherBatch.set(key, []);
    byTeacherBatch.get(key).push(s);
  }
  return { byTeacher, byTeacherBatch };
}

function indexMeetingsByTeacherAndBatch(meetings, batchToTeachers) {
  const byTeacher = new Map();
  const byTeacherBatch = new Map();
  for (const m of meetings) {
    const tid = m?.assignedTeacher
      ? String(m.assignedTeacher)
      : resolveMeetingTeacherId(m, batchToTeachers);
    if (!tid) continue;
    if (!byTeacher.has(tid)) byTeacher.set(tid, []);
    byTeacher.get(tid).push(m);
    const batchKey = normTeacherBatch(m.batch);
    const key = `${tid}::${batchKey}`;
    if (!byTeacherBatch.has(key)) byTeacherBatch.set(key, []);
    byTeacherBatch.get(key).push(m);
  }
  return { byTeacher, byTeacherBatch };
}

function buildTeacherBatchOwnerMap(teachers) {
  const batchToTeachers = new Map();
  for (const teacher of teachers) {
    const tid = String(teacher._id);
    for (const batch of teacher.assignedBatches || []) {
      const key = normTeacherBatch(batch);
      if (!key) continue;
      if (!batchToTeachers.has(key)) batchToTeachers.set(key, []);
      batchToTeachers.get(key).push(tid);
    }
  }
  return batchToTeachers;
}

function resolveMeetingTeacherId(meeting, batchToTeachers) {
  if (meeting?.assignedTeacher) return String(meeting.assignedTeacher);
  const owners = batchToTeachers.get(normTeacherBatch(meeting?.batch)) || [];
  return owners.length === 1 ? owners[0] : null;
}

function normalizeLevelHourlyRates(raw) {
  const out = {};
  if (!raw) return out;
  const entries = raw instanceof Map ? raw.entries() : Object.entries(raw);
  for (const [level, rate] of entries) {
    const n = Number(rate);
    if (level && Number.isFinite(n) && n >= 0) out[String(level).toUpperCase()] = n;
  }
  return out;
}

function collectTeacherBatchNames(teachers) {
  return [...new Set(
    teachers.flatMap((t) => (t.assignedBatches || []).map((b) => String(b || '').trim()).filter(Boolean)),
  )];
}

const TEACHER_ANALYTICS_OVERVIEW_CACHE_TTL_MS = 3 * 60 * 1000;
const teacherAnalyticsOverviewCache = new Map();

async function buildTeacherAnalyticsOverview(monthFilter) {
  const { from, to } = monthFilter;
  const now = new Date();
  const meetingUpperBound = getTeacherAnalyticsMeetingUpperBound(from, to, now);

  const [teachers, allStudents] = await Promise.all([
    User.find({ role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } })
      .populate('assignedCourses', 'title')
      .select('name regNo email medium assignedBatches assignedCourses levelHourlyRates noTds')
      .lean(),
    User.find({ role: 'STUDENT', assignedTeacher: { $exists: true, $ne: null } })
      .select('assignedTeacher batch level')
      .lean(),
  ]);

  const batchToTeachers = buildTeacherBatchOwnerMap(teachers);
  const teacherBatchNames = collectTeacherBatchNames(teachers);
  const meetingQuery = {
    startTime: { $gte: from, $lt: meetingUpperBound },
    $or: [
      { assignedTeacher: { $exists: true, $ne: null } },
      ...(teacherBatchNames.length ? [{ batch: { $in: teacherBatchNames } }] : []),
    ],
  };
  const monthMeetings = await MeetingLink.find(meetingQuery)
    .select('assignedTeacher batch startTime duration attendance attendanceRecorded status')
    .lean();

  const { byTeacher: studentsByTeacher, byTeacherBatch: studentsByTeacherBatch } =
    indexStudentsByTeacher(allStudents);
  const { byTeacher: meetingsByTeacher, byTeacherBatch: meetingsByTeacherBatch } =
    indexMeetingsByTeacherAndBatch(monthMeetings, batchToTeachers);

  const batchRows = [];
  const teacherRows = [];

  for (const teacher of teachers) {
    const tid = String(teacher._id);
    const students = studentsByTeacher.get(tid) || [];
    const meetings = meetingsByTeacher.get(tid) || [];

    const batchSet = new Set();
    (teacher.assignedBatches || []).forEach((b) => { if (b) batchSet.add(String(b).trim()); });
    students.forEach((s) => { if (s.batch) batchSet.add(String(s.batch).trim()); });
    meetings.forEach((m) => { if (m.batch) batchSet.add(String(m.batch).trim()); });

    const batchBreakdown = [];
    let teacherMinutes = 0;
    let teacherPresent = 0;
    let teacherLate = 0;
    let teacherRecords = 0;
    let teacherMeetingCount = 0;
    const levelSet = new Set();
    const batchLabels = [];

    for (const batch of batchSet) {
      if (!batch) continue;

      const batchKey = normTeacherBatch(batch);
      const batchStudents = studentsByTeacherBatch.get(`${tid}::${batchKey}`) || [];

      const levelCounts = {};
      batchStudents.forEach((s) => {
        const lv = String(s.level || '').toUpperCase();
        if (lv) {
          levelCounts[lv] = (levelCounts[lv] || 0) + 1;
          levelSet.add(lv);
        }
      });
      let level = Object.entries(levelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      if (!level && teacher.assignedCourses?.length) {
        const courseLevels = new Set(
          teacher.assignedCourses
            .map((c) => String(c.title || '').toUpperCase().match(/\b(A1|A2|B1|B2)\b/)?.[1])
            .filter(Boolean)
        );
        level = courseLevels.size === 1 ? [...courseLevels][0] : '';
        if (level) levelSet.add(level);
      }

      let tutorMinutes = 0;
      let totalPresent = 0;
      let totalLate = 0;
      let totalRecords = 0;
      let pastMeetingCount = 0;

      const batchMeetings = meetingsByTeacherBatch.get(`${tid}::${batchKey}`) || [];

      for (const meeting of batchMeetings) {
        pastMeetingCount += 1;
        const { scheduledMinutes, present, late, total } = summarizeMeetingAttendance(meeting);
        tutorMinutes += scheduledMinutes;
        if (total > 0) {
          totalPresent += present;
          totalLate += late;
          totalRecords += total;
        }
      }

      const tutorHours = Math.round((tutorMinutes / 60) * 100) / 100;
      const attendancePct = totalRecords
        ? Math.round(((totalPresent + totalLate) / totalRecords) * 10000) / 100
        : null;

      teacherMinutes += tutorMinutes;
      teacherPresent += totalPresent;
      teacherLate += totalLate;
      teacherRecords += totalRecords;
      teacherMeetingCount += pastMeetingCount;
      batchLabels.push(batch);

      const batchRow = {
        teacherId: teacher._id,
        tutor: teacher.name,
        regNo: teacher.regNo || '',
        email: teacher.email || '',
        medium: teacher.medium || '',
        batch,
        level: level || '—',
        studentCount: batchStudents.length,
        meetingCount: pastMeetingCount,
        tutorHours,
        tutorMinutes,
        attendance: attendancePct,
      };
      batchBreakdown.push(batchRow);
      batchRows.push(batchRow);
    }

    const tutorHours = Math.round((teacherMinutes / 60) * 100) / 100;
    const attendancePct = teacherRecords
      ? Math.round(((teacherPresent + teacherLate) / teacherRecords) * 10000) / 100
      : null;

    teacherRows.push({
      teacherId: teacher._id,
      tutor: teacher.name,
      regNo: teacher.regNo || '',
      email: teacher.email || '',
      medium: teacher.medium || '',
      batches: batchLabels.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })),
      levels: [...levelSet].sort().join(', ') || '—',
      batchCount: batchBreakdown.length,
      studentCount: students.length,
      meetingCount: teacherMeetingCount,
      tutorHours,
      tutorMinutes: teacherMinutes,
      attendance: attendancePct,
      batchBreakdown,
      levelHourlyRates: normalizeLevelHourlyRates(teacher.levelHourlyRates),
      noTds: teacher.noTds === true,
    });
  }

  batchRows.sort((a, b) => {
    const nameCmp = String(a.tutor).localeCompare(String(b.tutor));
    if (nameCmp !== 0) return nameCmp;
    return String(a.batch).localeCompare(String(b.batch), undefined, { numeric: true });
  });

  teacherRows.sort((a, b) => String(a.tutor).localeCompare(String(b.tutor)));

  const totals = {
    teachers: teacherRows.length,
    rows: teacherRows.length,
    totalTutorHours: Math.round(teacherRows.reduce((s, r) => s + (r.tutorHours || 0), 0) * 100) / 100,
    totalStudents: teacherRows.reduce((s, r) => s + (r.studentCount || 0), 0),
    avgAttendance: (() => {
      const withAtt = teacherRows.filter((r) => r.attendance != null);
      if (!withAtt.length) return null;
      const sum = withAtt.reduce((s, r) => s + r.attendance, 0);
      return Math.round((sum / withAtt.length) * 100) / 100;
    })(),
  };

  return {
    teachers: teacherRows,
    rows: teacherRows,
    batchRows,
    totals,
    generatedAt: new Date().toISOString(),
    filters: {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      month: monthFilter.month,
      monthLabel: monthFilter.monthLabel,
    },
  };
}

const TEACHER_ATTENDANCE_BONUS_RATE = 200;
const TEACHER_ATTENDANCE_BONUS_THRESHOLD = 90;

// Bulk teacher analytics overview (monthly, spreadsheet-style, no payment/rate fields)
router.get('/teachers/analytics-overview', verifyToken, isAdmin, async (req, res) => {
  try {
    const monthFilter = getTeacherAnalyticsMonth(req.query.month);
    const cacheKey = monthFilter.month;
    const skipCache = String(req.query.refresh || '') === '1';
    const now = Date.now();
    if (!skipCache) {
      const cached = teacherAnalyticsOverviewCache.get(cacheKey);
      if (cached && now - cached.at < TEACHER_ANALYTICS_OVERVIEW_CACHE_TTL_MS) {
        return res.json({ success: true, data: cached.payload });
      }
    }

    const data = await buildTeacherAnalyticsOverview(monthFilter);
    teacherAnalyticsOverviewCache.set(cacheKey, { at: now, payload: data });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('Error fetching teacher analytics overview:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher analytics overview',
      error: err.message,
    });
  }
});

// Persist per-teacher level hourly rates (shared across all admin browsers)
router.put('/teachers/:teacherId/level-rates', verifyToken, isAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher ID' });
    }

    const rawRates = req.body?.rates && typeof req.body.rates === 'object' ? req.body.rates : {};
    const levelHourlyRates = normalizeLevelHourlyRates(rawRates);

    const teacher = await User.findOneAndUpdate(
      { _id: teacherId, role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } },
      { $set: { levelHourlyRates, updatedAt: new Date() } },
      { new: true },
    )
      .select('name levelHourlyRates')
      .lean();

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    teacherAnalyticsOverviewCache.clear();

    return res.json({
      success: true,
      data: {
        teacherId,
        levelHourlyRates: normalizeLevelHourlyRates(teacher.levelHourlyRates),
      },
    });
  } catch (err) {
    console.error('Error saving teacher level rates:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to save teacher level rates',
      error: err.message,
    });
  }
});

// Toggle TDS exemption for a teacher
router.put('/teachers/:teacherId/toggle-tds', verifyToken, isAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({ success: false, message: 'Invalid teacher ID' });
    }

    const teacher = await User.findOne({ _id: teacherId, role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } })
      .select('name noTds')
      .lean();

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    const newNoTds = !teacher.noTds;
    await User.updateOne({ _id: teacherId }, { $set: { noTds: newNoTds, updatedAt: new Date() } });

    teacherAnalyticsOverviewCache.clear();

    return res.json({ success: true, data: { teacherId, noTds: newNoTds } });
  } catch (err) {
    console.error('Error toggling teacher TDS exemption:', err);
    return res.status(500).json({ success: false, message: 'Failed to update TDS exemption', error: err.message });
  }
});

// Monthly teaching-hours audit for one teacher
router.get('/teachers/:teacherId/monthly-hours', verifyToken, isAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid teacher ID'
      });
    }

    const monthFilter = getTeacherAnalyticsMonth(req.query.month);
    const { from, to } = monthFilter;

    const [teacher, meetings] = await Promise.all([
      User.findOne({
        _id: teacherId,
        role: { $in: ['TEACHER', 'TEACHER_ADMIN'] }
      })
        .populate('assignedCourses', 'title')
        .select('name regNo email medium assignedBatches assignedCourses levelHourlyRates noTds')
        .lean(),
      MeetingLink.find({
        assignedTeacher: teacherId,
        startTime: { $gte: from, $lt: to }
      })
        .select('topic batch startTime duration attendance attendanceRecorded status')
        .sort({ startTime: 1 })
        .lean()
    ]);

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    const normBatch = (b) => String(b || '').trim().toLowerCase();
    const meetingBatches = [...new Set(meetings.map((m) => String(m.batch || '').trim()).filter(Boolean))];
    const teacherBatches = (teacher.assignedBatches || []).map((b) => String(b || '').trim()).filter(Boolean);
    const relevantBatches = [...new Set([...meetingBatches, ...teacherBatches])];
    const validLevels = new Set(['A1', 'A2', 'B1', 'B2']);
    const students = await User.find({
      role: 'STUDENT',
      batch: { $in: relevantBatches }
    })
      .select('name regNo level batch')
      .lean();
    const now = new Date();
    const batchLevelByKey = new Map();
    const studentCountByKey = new Map();
    const allLevelSet = new Set();

    for (const student of students) {
      const batchKey = normBatch(student.batch);
      if (!batchKey) continue;
      const level = String(student.level || '').toUpperCase();
      if (!validLevels.has(level)) continue;
      studentCountByKey.set(batchKey, (studentCountByKey.get(batchKey) || 0) + 1);
      if (level) allLevelSet.add(level);
      if (!batchLevelByKey.has(batchKey)) batchLevelByKey.set(batchKey, {});
      const levelCounts = batchLevelByKey.get(batchKey);
      levelCounts[level] = (levelCounts[level] || 0) + 1;
    }

    const resolveBatchLevel = (batch) => {
      const counts = batchLevelByKey.get(normBatch(batch)) || {};
      const level = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (level) return level;
      const courseLevels = new Set(
        (teacher.assignedCourses || [])
          .map((c) => String(c.title || '').toUpperCase().match(/\b(A1|A2|B1|B2)\b/)?.[1])
          .filter(Boolean)
      );
      return courseLevels.size === 1 ? [...courseLevels][0] : '—';
    };

    const breakdownMap = new Map();
    const meetingRows = [];
    let totalMinutes = 0;
    let totalMeetings = 0;
    let recordedDurationMeetings = 0;
    let estimatedDurationMeetings = 0;

    for (const meeting of meetings) {
      if (!meeting.startTime) continue;
      const start = new Date(meeting.startTime);
      if (start >= now) continue;

      const batch = String(meeting.batch || 'N/A').trim() || 'N/A';
      const level = resolveBatchLevel(batch);
      const key = `${normBatch(batch)}::${level}`;
      const scheduledMinutes = getScheduledMinutes(meeting);
      const hasRecordedDuration = Number(meeting.duration || 0) > 0;
      if (hasRecordedDuration) recordedDurationMeetings += 1;
      else if (scheduledMinutes > 0) estimatedDurationMeetings += 1;

      const attendance = Array.isArray(meeting.attendance) ? meeting.attendance : [];
      const present = attendance.filter((entry) => entry?.attended === true || entry?.status === 'attended').length;
      const late = attendance.filter((entry) => entry?.status === 'late').length;
      const absent = Math.max(attendance.length - present - late, 0);
      const attendanceRate = attendance.length
        ? Math.round(((present + late) / attendance.length) * 10000) / 100
        : null;

      if (!breakdownMap.has(key)) {
        breakdownMap.set(key, {
          batch,
          level,
          studentCount: studentCountByKey.get(normBatch(batch)) || 0,
          meetingCount: 0,
          tutorMinutes: 0,
          tutorHours: 0,
          attendanceRecords: 0,
          presentOrLate: 0,
          attendance: null
        });
      }

      const breakdown = breakdownMap.get(key);
      breakdown.meetingCount += 1;
      breakdown.tutorMinutes += scheduledMinutes;
      breakdown.tutorHours = Math.round((breakdown.tutorMinutes / 60) * 100) / 100;
      breakdown.attendanceRecords += attendance.length;
      breakdown.presentOrLate += present + late;
      breakdown.attendance = breakdown.attendanceRecords
        ? Math.round((breakdown.presentOrLate / breakdown.attendanceRecords) * 10000) / 100
        : null;

      totalMeetings += 1;
      totalMinutes += scheduledMinutes;

      meetingRows.push({
        _id: meeting._id,
        topic: meeting.topic || 'Class Meeting',
        batch,
        level,
        startTime: meeting.startTime,
        status: meeting.status || 'scheduled',
        scheduledMinutes,
        duration: Number(meeting.duration || 0),
        durationSource: hasRecordedDuration ? 'Recorded' : (scheduledMinutes > 0 ? 'Estimated (60 min)' : 'No duration'),
        present,
        late,
        absent,
        attendanceRate
      });
    }

    let totalBonus = 0;
    const batchBreakdown = Array.from(breakdownMap.values())
      .map((row) => {
        const { attendanceRecords, presentOrLate, ...publicRow } = row;
        const bonusEligible = publicRow.attendance != null && publicRow.attendance >= TEACHER_ATTENDANCE_BONUS_THRESHOLD;
        const bonusHours = bonusEligible ? publicRow.tutorHours : 0;
        const bonusAmount = Math.round(bonusHours * TEACHER_ATTENDANCE_BONUS_RATE * 100) / 100;
        totalBonus += bonusAmount;
        return {
          ...publicRow,
          bonusEligible,
          bonusHours,
          bonusAmount
        };
      })
      .sort((a, b) => {
        const batchCmp = String(a.batch).localeCompare(String(b.batch), undefined, { numeric: true });
        if (batchCmp !== 0) return batchCmp;
        return String(a.level).localeCompare(String(b.level));
      });

    return res.json({
      success: true,
      data: {
        teacher: {
          _id: teacher._id,
          name: teacher.name,
          regNo: teacher.regNo || '',
          email: teacher.email || '',
          medium: teacher.medium || '',
          assignedBatches: teacher.assignedBatches || [],
          levels: [...allLevelSet].sort(),
          levelHourlyRates: normalizeLevelHourlyRates(teacher.levelHourlyRates),
          noTds: teacher.noTds === true,
        },
        month: monthFilter.month,
        monthLabel: monthFilter.monthLabel,
        generatedAt: new Date().toISOString(),
        totals: {
          totalMinutes,
          totalHours: Math.round((totalMinutes / 60) * 100) / 100,
          totalMeetings,
          totalStudents: students.length,
          recordedDurationMeetings,
          estimatedDurationMeetings,
          bonusRate: TEACHER_ATTENDANCE_BONUS_RATE,
          bonusThreshold: TEACHER_ATTENDANCE_BONUS_THRESHOLD,
          totalBonus: Math.round(totalBonus * 100) / 100
        },
        batchBreakdown,
        meetings: meetingRows
      }
    });
  } catch (err) {
    console.error('Error fetching teacher monthly hours:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher monthly hours',
      error: err.message
    });
  }
});

// Get detailed report for a single teacher
router.get('/teachers/:teacherId/report', verifyToken, isAdmin, async (req, res) => {
  try {
    const { teacherId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(teacherId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid teacher ID'
      });
    }

    const teacher = await User.findOne({
      _id: teacherId,
      role: { $in: ['TEACHER', 'TEACHER_ADMIN'] }
    })
      .populate('assignedCourses', 'title')
      .select('-password')
      .lean();

    if (!teacher) {
      return res.status(404).json({
        success: false,
        message: 'Teacher not found'
      });
    }

    const students = await User.find({
      role: 'STUDENT',
      assignedTeacher: teacherId
    })
      .select('name regNo email level batch studentStatus currentCourseDay examScores')
      .lean();

    const meetings = await MeetingLink.find({ assignedTeacher: teacherId })
      .select('topic batch startTime duration attendance attendanceRecorded status')
      .sort({ startTime: -1 })
      .lean();

    const statusTemplate = {
      ONGOING: 0,
      COMPLETED: 0,
      WITHDREW: 0,
      UNCERTAIN: 0
    };

    const levelTemplate = {
      A1: 0,
      A2: 0,
      B1: 0,
      B2: 0,
      C1: 0,
      C2: 0
    };

    const batchMap = new Map();
    const allKnownBatches = new Set([...(teacher.assignedBatches || [])]);
    let courseDaySum = 0;
    let courseDayCount = 0;

    students.forEach((student) => {
      const status = String(student.studentStatus || '').toUpperCase();
      const level = String(student.level || '').toUpperCase();
      const batch = String(student.batch || '').trim();

      if (statusTemplate[status] !== undefined) {
        statusTemplate[status] += 1;
      }

      if (levelTemplate[level] !== undefined) {
        levelTemplate[level] += 1;
      }

      if (batch) {
        allKnownBatches.add(batch);
        if (!batchMap.has(batch)) {
          batchMap.set(batch, {
            batch,
            totalStudents: 0,
            ongoing: 0,
            completed: 0,
            withdrew: 0,
            uncertain: 0
          });
        }

        const info = batchMap.get(batch);
        info.totalStudents += 1;

        if (status === 'ONGOING') info.ongoing += 1;
        if (status === 'COMPLETED') info.completed += 1;
        if (status === 'WITHDREW') info.withdrew += 1;
        if (status === 'UNCERTAIN') info.uncertain += 1;
      }

      if (typeof student.currentCourseDay === 'number' && Number.isFinite(student.currentCourseDay)) {
        courseDaySum += student.currentCourseDay;
        courseDayCount += 1;
      }
    });

    // Include assigned teacher batches even if no students are currently mapped.
    allKnownBatches.forEach((batch) => {
      if (!batchMap.has(batch)) {
        batchMap.set(batch, {
          batch,
          totalStudents: 0,
          ongoing: 0,
          completed: 0,
          withdrew: 0,
          uncertain: 0
        });
      }
    });

    const batchBreakdown = Array.from(batchMap.values()).sort((a, b) =>
      String(a.batch).localeCompare(String(b.batch))
    );

    let attendedCount = 0;
    let absentCount = 0;
    let lateCount = 0;
    let totalAttendanceRecords = 0;

    const formatMeeting = (meeting) => {
      const attendance = Array.isArray(meeting.attendance) ? meeting.attendance : [];
      const present = attendance.filter((entry) => entry?.attended === true || entry?.status === 'attended').length;
      const late = attendance.filter((entry) => entry?.status === 'late').length;
      const absent = Math.max(attendance.length - present - late, 0);
      const total = attendance.length;
      const attendanceRate = total ? Math.round(((present + late) / total) * 100) : 0;

      const meetingDurationMinutes = Number(meeting.duration || 0);
      const attendedEntries = attendance.filter((entry) => entry?.attended === true || entry?.status === 'attended' || entry?.status === 'late');
      const attendedMinutesList = attendedEntries
        .map((entry) => {
          const mins = entry?.durationMinutes;
          if (typeof mins === 'number' && Number.isFinite(mins)) return mins;
          const secs = entry?.duration;
          if (typeof secs === 'number' && Number.isFinite(secs)) return Math.round(secs / 60);
          return 0;
        })
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
      const totalAttendedMinutes = attendedMinutesList.reduce((sum, v) => sum + v, 0);
      const avgAttendedMinutes = attendedMinutesList.length ? Math.round(totalAttendedMinutes / attendedMinutesList.length) : 0;

      return {
        _id: meeting._id,
        topic: meeting.topic || 'Class Meeting',
        batch: meeting.batch || 'N/A',
        startTime: meeting.startTime,
        status: meeting.status || 'scheduled',
        attendanceRecorded: Boolean(meeting.attendanceRecorded),
        present,
        late,
        absent,
        total,
        attendanceRate,
        meetingDurationMinutes,
        avgAttendedMinutes,
        totalAttendedMinutes
      };
    };

    const now = new Date();
    const mappedMeetings = meetings.map((meeting) => {
      const mapped = formatMeeting(meeting);
      attendedCount += mapped.present;
      lateCount += mapped.late;
      absentCount += mapped.absent;
      totalAttendanceRecords += mapped.total;
      return mapped;
    });

    const recentMeetings = mappedMeetings.slice(0, 8);
    const upcomingMeetings = mappedMeetings
      .filter((meeting) => meeting.startTime && new Date(meeting.startTime) >= now)
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .slice(0, 10);
    const allPastMeetings = mappedMeetings
      .filter((meeting) => meeting.startTime && new Date(meeting.startTime) < now)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

    const pastMeetings = allPastMeetings.slice(0, 15);

    let totalScheduledMinutes = 0;
    let totalAttendedStudentMinutes = 0;
    let meetingsWithRecordedDuration = 0;
    let meetingsUsingDefaultDuration = 0;

    const teachingTimeMeetings = allPastMeetings.map((meeting) => {
      const hasRecordedDuration = meeting.meetingDurationMinutes > 0;
      const scheduledMinutes = hasRecordedDuration
        ? meeting.meetingDurationMinutes
        : (meeting.attendanceRecorded ? 60 : 0);

      if (hasRecordedDuration) meetingsWithRecordedDuration += 1;
      else if (scheduledMinutes > 0) meetingsUsingDefaultDuration += 1;

      totalScheduledMinutes += scheduledMinutes;
      totalAttendedStudentMinutes += meeting.totalAttendedMinutes || 0;

      return {
        _id: meeting._id,
        topic: meeting.topic,
        batch: meeting.batch,
        startTime: meeting.startTime,
        status: meeting.status,
        attendanceRecorded: meeting.attendanceRecorded,
        present: meeting.present,
        late: meeting.late,
        absent: meeting.absent,
        attendanceRate: meeting.attendanceRate,
        scheduledMinutes,
        meetingDurationMinutes: meeting.meetingDurationMinutes,
        totalAttendedMinutes: meeting.totalAttendedMinutes || 0,
        avgAttendedMinutes: meeting.avgAttendedMinutes || 0
      };
    });

    const overallAttendanceRate = totalAttendanceRecords
      ? Math.round(((attendedCount + lateCount) / totalAttendanceRecords) * 100)
      : 0;

    const studentsWithExamAverage = students.map((student) => {
      const examScores = student.examScores || {};
      const scoreValues = [examScores.reading, examScores.listening, examScores.writing, examScores.speaking]
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
      const averageExamScore = scoreValues.length
        ? Math.round((scoreValues.reduce((sum, v) => sum + v, 0) / scoreValues.length) * 10) / 10
        : null;

      return {
        _id: student._id,
        name: student.name,
        regNo: student.regNo,
        email: student.email,
        level: student.level || 'N/A',
        batch: student.batch || 'N/A',
        studentStatus: student.studentStatus || 'UNCERTAIN',
        currentCourseDay: typeof student.currentCourseDay === 'number' ? student.currentCourseDay : null,
        averageExamScore
      };
    });

    return res.json({
      success: true,
      data: {
        teacher: {
          _id: teacher._id,
          name: teacher.name,
          regNo: teacher.regNo,
          email: teacher.email,
          role: teacher.role,
          medium: teacher.medium || [],
          assignedCourses: teacher.assignedCourses || [],
          assignedBatches: teacher.assignedBatches || []
        },
        summary: {
          totalStudents: students.length,
          totalAssignedBatches: allKnownBatches.size,
          totalMeetings: meetings.length,
          totalAttendanceRecords,
          overallAttendanceRate,
          averageCourseDay: courseDayCount ? Math.round(courseDaySum / courseDayCount) : 0,
          totalTeachingMinutes: totalScheduledMinutes
        },
        teachingTime: {
          totalMinutes: totalScheduledMinutes,
          totalAttendedStudentMinutes,
          pastMeetingCount: allPastMeetings.length,
          meetingsWithRecordedDuration,
          meetingsUsingDefaultDuration,
          meetings: teachingTimeMeetings
        },
        performance: {
          statusBreakdown: statusTemplate,
          levelBreakdown: levelTemplate
        },
        attendance: {
          attendedCount,
          lateCount,
          absentCount,
          recentMeetings
        },
        meetings: {
          pastMeetings,
          upcomingMeetings
        },
        batchBreakdown,
        students: studentsWithExamAverage
      }
    });
  } catch (err) {
    console.error('Error fetching teacher report:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher report',
      error: err.message
    });
  }
});


// Assign course to a student (simplified without VAPI)
router.post('/assign-course', verifyToken, isAdmin, async (req, res) => {
  const { studentId, courseName } = req.body;

  try {
    const student = await User.findById(studentId);
    if (!student || student.role !== 'STUDENT') {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    student.courseAssigned = courseName;
    student.updatedAt = new Date();

    await student.save();
    return res.status(201).json({ success: true, message: 'Course assigned successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Error assigning course', error: err });
  }
});

// Update student's subscription - PUT /api/subscriptions/:id
router.put("/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    const updated = await Subscription.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ message: "Subscription not found" });
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});


// Delete a subscription - DELETE /api/subscriptions/:id
router.delete("/:id", verifyToken, isAdmin, async (req, res) => {
  try {
    await Subscription.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Subscription deleted" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// View subscriptions for a specific student - GET /api/subscriptions/user/:userId
router.get("/user/:userId", verifyToken, isAdmin, async (req, res) => {
  try {
    const subs = await Subscription.find({ userId: req.params.userId });
    res.status(200).json({ success: true, data: subs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// List all courses a student is enrolled in - GET /api/courses/enrolled/:studentId
router.get("/enrolled/:studentId", verifyToken, isAdmin, async (req, res) => {
  try {
    const enrolledCourseIds = await CourseProgress.find({ studentId: req.params.studentId }).distinct('courseId');
    const courses = enrolledCourseIds.length ? await Course.find({ _id: { $in: enrolledCourseIds } }) : [];
    res.status(200).json({ success: true, data: courses });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// Bulk assign course (simplified without VAPI)
router.post('/bulk-assign', verifyToken, checkRole('admin'), async (req, res) => {
  try {
    const { studentIds, courseName } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || !courseName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await User.updateMany(
      { _id: { $in: studentIds } },
      {
        courseAssigned: courseName
      }
    );

    res.json({ message: 'Bulk assignment successful' });
  } catch (err) {
    console.error('Bulk assignment error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk update students (teacher, level, status, subscription)
router.post('/bulk-update', verifyToken, isAdmin, async (req, res) => {
  try {
    const { studentIds, updates } = req.body;

    // Validate input
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student IDs are required' 
      });
    }

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'No updates provided' 
      });
    }

    // Build update object
    const updateData = {};
    
    if (updates.assignedTeacher) {
      // Validate teacher exists
      const teacher = await User.findById(updates.assignedTeacher);
      if (!teacher || teacher.role !== 'TEACHER') {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid teacher ID' 
        });
      }
      updateData.assignedTeacher = updates.assignedTeacher;
    }

    if (updates.level) {
      updateData.level = updates.level;
    }

    if (updates.level && studentIds.length === 1) {
      const existingStudent = await User.findById(studentIds[0])
        .select('role currentCourseDay blockedJourneyLevels level')
        .lean();
      if (existingStudent?.role === 'STUDENT' && updates.level !== existingStudent.level) {
        const { buildAdminLevelJumpUpdate } = require('../services/journeyLevelSync.service');
        Object.assign(updateData, buildAdminLevelJumpUpdate(updates.level, existingStudent, updateData));
      }
    }

    if (updates.studentStatus) {
      updateData.studentStatus = updates.studentStatus;
    }

    if (updates.subscription) {
      updateData.subscription = updates.subscription;
    }

    if (updates.batch) {
      updateData.batch = updates.batch;
    }

    const beforeStudents = await User.find({ _id: { $in: studentIds }, role: 'STUDENT' }).lean();

    let oldBatchStudentIds = [];
    if (updates.currentCourseDay !== undefined && updates.currentCourseDay !== null) {
      const d = parseInt(String(updates.currentCourseDay), 10);
      if (!Number.isFinite(d) || d < 1 || d > 200) {
        return res.status(400).json({
          success: false,
          message: 'currentCourseDay must be a number from 1 to 200'
        });
      }
      const { withJourneyLevelInSet } = require('../services/journeyLevelSync.service');
      const { isOldBatchType } = require('../utils/batchType');

      // Old batches never get `level` auto-derived from currentCourseDay — resolve
      // which of the selected students are in an old batch so we can exclude them.
      const batchNames = [...new Set(beforeStudents.map((s) => s.batch).filter(Boolean))];
      const batchConfigs = batchNames.length
        ? await BatchConfig.find({
            batchName: { $in: batchNames.map((b) => new RegExp(`^${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) }
          })
            .select('batchName batchType')
            .lean()
        : [];
      const oldBatchNames = new Set(
        batchConfigs.filter((c) => isOldBatchType(c.batchType)).map((c) => String(c.batchName).toLowerCase())
      );
      oldBatchStudentIds = beforeStudents
        .filter((s) => s.batch && oldBatchNames.has(String(s.batch).toLowerCase()))
        .map((s) => String(s._id));

      Object.assign(
        updateData,
        withJourneyLevelInSet(d, {
          currentCourseDay: d,
          pendingJourneyDayAdvance: false,
          pendingJourneyDayAdvanceForDay: null
        })
      );
    }

    // Update all selected students
    let result;
    if (oldBatchStudentIds.length) {
      const { level: _omitLevel, ...updateDataNoLevel } = updateData;
      const [oldRes, restRes] = await Promise.all([
        User.updateMany(
          { _id: { $in: oldBatchStudentIds }, role: 'STUDENT' },
          { $set: updateDataNoLevel }
        ),
        User.updateMany(
          { _id: { $in: studentIds.filter((id) => !oldBatchStudentIds.includes(String(id))) }, role: 'STUDENT' },
          { $set: updateData }
        )
      ]);
      result = { modifiedCount: (oldRes.modifiedCount || 0) + (restRes.modifiedCount || 0) };
    } else {
      result = await User.updateMany(
        { _id: { $in: studentIds }, role: 'STUDENT' },
        { $set: updateData }
      );
    }

    const afterStudents = await User.find({ _id: { $in: studentIds }, role: 'STUDENT' }).lean();
    await recordBulkStudentChanges({
      beforeDocs: beforeStudents,
      afterDocs: afterStudents,
      fields: Object.keys(updateData),
      req,
      source: 'admin_bulk_update'
    });

    if (updates.currentCourseDay !== undefined) {
      try {
        const journeyDue = require('../modules/payments-v2/backend/services/journeyLanguageFeeDueService');
        for (const sid of studentIds) {
          journeyDue.syncForStudent(sid).catch(() => {});
        }
      } catch (_) { /* payment module optional */ }
    }

    // Auto-remove students from future scheduled meetings when status changes to UNCERTAIN or WITHDREW
    if (updates.studentStatus === 'UNCERTAIN' || updates.studentStatus === 'WITHDREW') {
      try {
        const objectIds = studentIds.map((id) => new mongoose.Types.ObjectId(String(id)));
        await MeetingLink.updateMany(
          {
            status: 'scheduled',
            'attendees.studentId': { $in: objectIds }
          },
          {
            $pull: { attendees: { studentId: { $in: objectIds } } }
          }
        );
      } catch (autoRemoveErr) {
        console.error('Auto-remove from scheduled meetings error:', autoRemoveErr);
      }
    }

    res.json({ 
      success: true, 
      message: `Successfully updated ${result.modifiedCount} student(s)`,
      modifiedCount: result.modifiedCount
    });

  } catch (err) {
    console.error('Bulk update error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update students',
      error: err.message 
    });
  }
});

// Get course progress for a specific student
router.get('/course-progress/:studentId', verifyToken, isAdmin, async (req, res) => {
  try {
    const { studentId } = req.params;
    const CourseProgress = require('../models/CourseProgress');
    
    const progress = await CourseProgress.find({ studentId })
      .populate('courseId', 'title')
      .sort({ lastUpdated: -1 });
    
    // Format the response to match frontend expectations
    const formattedProgress = progress.map(p => ({
      courseId: p.courseId?._id,
      courseName: p.courseId?.title || 'Unknown Course',
      progressPercentage: p.progressPercentage,
      lastUpdated: p.lastUpdated
    }));
    
    res.json(formattedProgress);
  } catch (err) {
    console.error('Error fetching course progress:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch course progress',
      error: err.message 
    });
  }
});

// Bulk delete students
router.post('/bulk-delete', verifyToken, isAdmin, async (req, res) => {
  try {
    const { studentIds } = req.body;

    // Validate input
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Student IDs are required' 
      });
    }

    console.log(`🗑️ Bulk delete request for ${studentIds.length} students`);

    // Import related models for cascade delete
    const CourseProgress = require('../models/CourseProgress');
    const Feedback = require('../models/Feedback');
    const StudentProgress = require('../models/StudentProgress');
    const SessionRecord = require('../models/SessionRecord');
    const StudentDocument = require('../models/StudentDocument');
    const StudentLogs = require('../models/StudentLogs');
    const AiTutorSession = require('../models/AiTutorSession');
    const AssignmentSubmission = require('../models/AssignmentSubmission');
    const GradingResult = require('../models/GradingResult');

    // Delete related data first (cascade delete)
    const deletePromises = [
      CourseProgress.deleteMany({ studentId: { $in: studentIds } }),
      Feedback.deleteMany({ studentId: { $in: studentIds } }),
      StudentProgress.deleteMany({ studentId: { $in: studentIds } }),
      SessionRecord.deleteMany({ studentId: { $in: studentIds } }),
      StudentDocument.deleteMany({ studentId: { $in: studentIds } }),
      StudentLogs.deleteMany({ studentId: { $in: studentIds } }),
      AiTutorSession.deleteMany({ studentId: { $in: studentIds } }),
      AssignmentSubmission.deleteMany({ studentId: { $in: studentIds } }),
      GradingResult.deleteMany({ studentId: { $in: studentIds } })
    ];

    // Execute all deletions
    const relatedResults = await Promise.all(deletePromises);
    
    console.log('🗑️ Deleted related data:', {
      courseProgress: relatedResults[0].deletedCount,
      feedback: relatedResults[1].deletedCount,
      studentProgress: relatedResults[2].deletedCount,
      sessionRecords: relatedResults[3].deletedCount,
      studentDocuments: relatedResults[4].deletedCount,
      studentLogs: relatedResults[5].deletedCount,
      aiTutorSessions: relatedResults[6].deletedCount,
      assignmentSubmissions: relatedResults[7].deletedCount,
      gradingResults: relatedResults[8].deletedCount
    });

    // Finally, delete the students themselves (only those with STUDENT role for safety)
    const result = await User.deleteMany(
      { _id: { $in: studentIds }, role: 'STUDENT' }
    );

    console.log(`✅ Deleted ${result.deletedCount} students`);

    res.json({ 
      success: true, 
      message: `Successfully deleted ${result.deletedCount} student(s) and all related data`,
      deletedCount: result.deletedCount,
      relatedDataDeleted: {
        courseProgress: relatedResults[0].deletedCount,
        feedback: relatedResults[1].deletedCount,
        studentProgress: relatedResults[2].deletedCount,
        sessionRecords: relatedResults[3].deletedCount,
        studentDocuments: relatedResults[4].deletedCount,
        studentLogs: relatedResults[5].deletedCount,
        aiTutorSessions: relatedResults[6].deletedCount,
        assignmentSubmissions: relatedResults[7].deletedCount,
        gradingResults: relatedResults[8].deletedCount
      }
    });

  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to delete students',
      error: err.message 
    });
  }
});


// ─────────────────────────────────────────────────────────────────────
// Email Change Requests (first-login setup — admin approval flow)
// ─────────────────────────────────────────────────────────────────────
const EmailChangeRequest = require('../models/EmailChangeRequest');
const { setUserPassword } = require('../utils/setUserPassword');
const nodemailer = require('nodemailer');

// GET /admin/email-change-requests
router.get('/email-change-requests', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const statusFilter = req.query.status || 'pending';
    const requests = await EmailChangeRequest.find({ status: statusFilter })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, data: requests });
  } catch (err) {
    console.error('[GET /admin/email-change-requests]', err);
    return res.status(500).json({ success: false, message: 'Failed to load requests.' });
  }
});

// POST /admin/email-change-requests/:id/approve
router.post('/email-change-requests/:id/approve', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const ecr = await EmailChangeRequest.findById(req.params.id);
    if (!ecr) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (ecr.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Request already ${ecr.status}.` });
    }

    const user = await User.findById(ecr.userId);
    if (!user) return res.status(404).json({ success: false, message: 'Student account not found.' });

    // Read password chosen during setup (AES-encrypted or legacy plain text)
    const plainPassword = readRecoverablePassword(ecr.newPasswordEncrypted);
    if (!plainPassword) {
      return res.status(500).json({
        success: false,
        message: 'Could not decrypt stored password. If encryption is enabled, verify PASSWORD_RECOVERABLE_KEY matches the key used when the student submitted this request.',
      });
    }

    user.email = ecr.newEmail;
    await setUserPassword(user, plainPassword);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();

    ecr.status = 'approved';
    ecr.processedAt = new Date();
    ecr.processedBy = req.user._id || req.user.id;
    await ecr.save();

    // Notify the student at their new email
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    const approvalHtml = `
<div style="font-family:Arial,sans-serif;line-height:1.6;color:#1a1a2e;max-width:560px;">
  <h2 style="color:#6c3fc5;">Your Email Has Been Updated — Glück Global Portal</h2>
  <p>Hi <strong>${user.name}</strong>,</p>
  <p>Your email change request has been approved. You can now log in with your new email or your Web App ID.</p>
  <table style="border-collapse:collapse;width:100%;margin:16px 0;">
    <tr><td style="padding:8px;background:#f3f4f6;font-weight:600;width:140px;">Web App ID</td><td style="padding:8px;">${user.regNo}</td></tr>
    <tr><td style="padding:8px;background:#f3f4f6;font-weight:600;">Email</td><td style="padding:8px;">${user.email}</td></tr>
  </table>
  <p>If you did not make this request, please contact support immediately.</p>
  <p style="color:#9ca3af;font-size:12px;">Glück Global German Language School</p>
</div>`;
    transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Email Updated — Glück Global Portal',
      html: approvalHtml,
    }).catch((e) => console.error('[approve email change] notify student failed:', e?.message));

    return res.json({ success: true, message: 'Email change approved and applied.' });
  } catch (err) {
    console.error('[POST /admin/email-change-requests/:id/approve]', err);
    return res.status(500).json({ success: false, message: 'Failed to approve request.' });
  }
});

// POST /admin/email-change-requests/:id/reject
router.post('/email-change-requests/:id/reject', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const ecr = await EmailChangeRequest.findById(req.params.id);
    if (!ecr) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (ecr.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Request already ${ecr.status}.` });
    }
    ecr.status = 'rejected';
    ecr.processedAt = new Date();
    ecr.processedBy = req.user._id || req.user.id;
    ecr.rejectionReason = req.body.reason || '';
    await ecr.save();
    return res.json({ success: true, message: 'Request rejected.' });
  } catch (err) {
    console.error('[POST /admin/email-change-requests/:id/reject]', err);
    return res.status(500).json({ success: false, message: 'Failed to reject request.' });
  }
});

// POST /admin/students/lookup-by-emails
// Returns portal student snapshots for a given list of emails (for detail correction comparison)
router.post('/students/lookup-by-emails', verifyToken, isAdmin, async (req, res) => {
  try {
    const { emails } = req.body;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ success: false, message: 'emails array required' });
    }
    const normalised = emails.map(e => String(e).toLowerCase().trim()).filter(Boolean);
    const students = await User.find(
      { email: { $in: normalised }, role: 'STUDENT' },
      { _id: 1, regNo: 1, name: 1, email: 1, subscription: 1, level: 1, studentStatus: 1, servicesOpted: 1, batch: 1, medium: 1 }
    ).lean();
    return res.json({ success: true, students });
  } catch (err) {
    console.error('[POST /admin/students/lookup-by-emails]', err);
    return res.status(500).json({ success: false, message: 'Failed to lookup students' });
  }
});

// POST /admin/batch-correct-details
// Applies per-student field corrections from an Excel reconciliation
router.post('/batch-correct-details', verifyToken, isAdmin, async (req, res) => {
  try {
    const { corrections } = req.body;
    if (!corrections || !Array.isArray(corrections) || corrections.length === 0) {
      return res.status(400).json({ success: false, message: 'corrections array required' });
    }

    const ALLOWED = ['subscription', 'level', 'studentStatus', 'servicesOpted', 'batch', 'medium'];
    let updated = 0;
    let skipped = 0;
    const failed = [];

    for (const c of corrections) {
      const { studentId, updates } = c;
      if (!studentId || !updates || typeof updates !== 'object') {
        failed.push({ studentId, reason: 'Invalid format' });
        continue;
      }
      const sanitized = {};
      for (const field of ALLOWED) {
        if (updates[field] !== undefined && updates[field] !== null && String(updates[field]).trim() !== '') {
          sanitized[field] = String(updates[field]).trim();
        }
      }
      if (Object.keys(sanitized).length === 0) {
        skipped++;
        continue;
      }
      try {
        const beforeStudent = await User.findById(studentId).lean();
        const result = await User.findByIdAndUpdate(studentId, { $set: sanitized }, { new: true });
        if (!result) {
          failed.push({ studentId, reason: 'Student not found' });
        } else {
          await recordStudentChange({
            beforeDoc: beforeStudent,
            afterDoc: result,
            fields: Object.keys(sanitized),
            req,
            source: 'admin_batch_correct_details'
          });
          updated++;
        }
      } catch (e) {
        failed.push({ studentId, reason: e.message });
      }
    }

    return res.json({ success: true, updated, skipped, failed });
  } catch (err) {
    console.error('[POST /admin/batch-correct-details]', err);
    return res.status(500).json({ success: false, message: 'Failed to apply corrections' });
  }
});

// ── Manual trigger: Student Detail Changes Report (last 24 hours) ──────────────
router.post('/send-changes-report', verifyToken, isAdmin, async (req, res) => {
  try {
    const { sendStudentDetailChangesReport } = require('../jobs/studentDetailChangesReport');
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
    // Run async — don't await so the API responds immediately
    sendStudentDetailChangesReport({ from, rangeLabel: 'Last 24 Hours' })
      .catch((err) => console.error('[send-changes-report] background error:', err.message));
    return res.json({ success: true, message: 'Changes report is being generated and will be emailed shortly.' });
  } catch (err) {
    console.error('[POST /admin/send-changes-report]', err);
    return res.status(500).json({ success: false, message: 'Failed to trigger changes report.' });
  }
});

// ── Public signup: pending proof submissions (no portal account until approved) ─
router.get('/signup-applications/pending', verifyToken, isAdmin, async (req, res) => {
  try {
    const list = await SignupApplication.find({ status: 'proof_submitted' })
      .sort({ proofSubmittedAt: -1, updatedAt: -1 })
      .select(
        'applicationToken name email phoneNumber whatsappNumber level subscription currency amount proofPaidAmount proofPaymentDateTime proofAccountHolderName proofScreenshotKey proofScreenshotOriginalName proofSubmittedAt paymentMethod status createdAt'
      )
      .lean();
    const data = list.map((row) => {
      const key = row.proofScreenshotKey;
      const proofViewUrl =
        key && (String(key).startsWith('http://') || String(key).startsWith('https://'))
          ? String(key)
          : key
            ? `/uploads/${String(key).replace(/^\/+/, '')}`
            : null;
      return { ...row, proofViewUrl };
    });
    return noStoreJson(res, { success: true, data, total: data.length });
  } catch (err) {
    console.error('[GET /admin/signup-applications/pending]', err);
    return res.status(500).json({ success: false, message: 'Failed to load pending signup applications.' });
  }
});

router.patch('/signup-applications/:applicationToken', verifyToken, isAdmin, async (req, res) => {
  try {
    const applicationToken = String(req.params.applicationToken || '').trim();
    if (!applicationToken) {
      return res.status(400).json({ success: false, message: 'Application token is required.' });
    }

    const app = await SignupApplication.findOne({ applicationToken });
    if (!app) {
      return res.status(404).json({ success: false, message: 'Signup application not found.' });
    }
    if (app.status !== 'proof_submitted') {
      return res.status(400).json({
        success: false,
        message: `Cannot edit application in status "${app.status}".`,
      });
    }

    const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const PLANS = ['SILVER', 'PLATINUM', 'DOCS_RECOGNITION', 'VISA_DOC', 'POST_LANDING', 'VISA_DOC_ONLY'];
    const CURRENCIES = ['INR', 'LKR', 'USD'];
    const body = req.body || {};

    if (body.level != null) {
      const level = String(body.level).trim().toUpperCase();
      if (!LEVELS.includes(level)) {
        return res.status(400).json({ success: false, message: 'Invalid level.' });
      }
      app.level = level;
      app.languageLevelOpted = level;
    }
    if (body.subscription != null) {
      const subscription = String(body.subscription).trim().toUpperCase();
      if (!PLANS.includes(subscription)) {
        return res.status(400).json({ success: false, message: 'Invalid plan.' });
      }
      app.subscription = subscription;
    }
    if (body.currency != null) {
      const currency = String(body.currency).trim().toUpperCase();
      if (!CURRENCIES.includes(currency)) {
        return res.status(400).json({ success: false, message: 'Invalid currency.' });
      }
      app.currency = currency;
    }
    if (body.amount != null) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: 'Quoted fee must be a positive number.' });
      }
      app.amount = amount;
    }
    if (body.proofPaidAmount != null) {
      const paid = Number(body.proofPaidAmount);
      if (!Number.isFinite(paid) || paid <= 0) {
        return res.status(400).json({ success: false, message: 'Declared paid amount must be a positive number.' });
      }
      app.proofPaidAmount = paid;
    }
    if (body.proofPaymentDateTime != null && body.proofPaymentDateTime !== '') {
      const dt = new Date(body.proofPaymentDateTime);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid payment date.' });
      }
      app.proofPaymentDateTime = dt;
    }
    if (body.proofAccountHolderName != null) {
      const holder = String(body.proofAccountHolderName).trim();
      if (!holder) {
        return res.status(400).json({ success: false, message: 'Account holder name is required.' });
      }
      app.proofAccountHolderName = holder;
    }

    await app.save();

    const row = app.toObject();
    const key = row.proofScreenshotKey;
    const proofViewUrl =
      key && (String(key).startsWith('http://') || String(key).startsWith('https://'))
        ? String(key)
        : key
          ? `/uploads/${String(key).replace(/^\/+/, '')}`
          : null;

    return res.json({
      success: true,
      message: 'Signup details updated.',
      data: { ...row, proofViewUrl },
    });
  } catch (err) {
    console.error('[PATCH /admin/signup-applications/:token]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update signup application.' });
  }
});

router.post('/signup-applications/:applicationToken/reject', verifyToken, isAdmin, async (req, res) => {
  try {
    const applicationToken = String(req.params.applicationToken || '').trim();
    if (!applicationToken) {
      return res.status(400).json({ success: false, message: 'Application token is required.' });
    }

    const rejectionReason = req.body?.rejectionReason != null
      ? String(req.body.rejectionReason).trim()
      : '';

    const result = await rejectPublicSignupApplication(applicationToken, {
      rejectionReason,
      adminId: req.user?.id || req.user?._id,
    });
    if (!result.ok) {
      const status =
        result.reason === 'application_not_found' ? 404
          : result.reason === 'already_approved' ? 409
            : 400;
      return res.status(status).json({
        success: false,
        message:
          result.reason === 'invalid_status'
            ? `Cannot reject application in status "${result.status}".`
            : result.reason === 'already_approved'
              ? 'This signup is already approved.'
              : 'Could not reject signup application.',
        reason: result.reason,
      });
    }

    return res.json({
      success: true,
      message: rejectionReason
        ? 'Signup rejected. The student has been emailed with your reason.'
        : 'Signup rejected. The student has been notified by email.',
      rejectionReason: result.rejectionReason,
    });
  } catch (err) {
    console.error('[POST /admin/signup-applications/:token/reject]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to reject signup.' });
  }
});

router.post('/signup-applications/:applicationToken/approve', verifyToken, isAdmin, async (req, res) => {
  try {
    const applicationToken = String(req.params.applicationToken || '').trim();
    if (!applicationToken) {
      return res.status(400).json({ success: false, message: 'Application token is required.' });
    }
    const batch = req.body?.batch ? String(req.body.batch).trim() : undefined;
    const skipEmail = req.body?.skipEmail === true;

    const result = await approvePublicSignupApplication(applicationToken, { batch, skipEmail });
    if (!result.ok) {
      const status = result.reason === 'application_not_found' ? 404 : 400;
      return res.status(status).json({
        success: false,
        message:
          result.reason === 'invalid_status'
            ? `Cannot approve application in status "${result.status}".`
            : 'Could not approve signup application.',
        reason: result.reason,
      });
    }

    return res.json({
      success: true,
      message: result.alreadyApproved
        ? 'Application was already approved.'
        : skipEmail
          ? 'Account created and activated.'
          : 'Account created. Welcome email with Web App ID and password sent to the student.',
      regNo: result.regNo,
      userId: result.userId,
      alreadyApproved: !!result.alreadyApproved,
    });
  } catch (err) {
    console.error('[POST /admin/signup-applications/:token/approve]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to approve signup.' });
  }
});

module.exports = router;




