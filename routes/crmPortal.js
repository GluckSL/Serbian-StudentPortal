/**
 * Read-only CRM endpoints for WordPress / external pollers.
 * Auth: header X-CRM-Token must equal process.env.REMINDERS_CRM_TOKEN
 * (same secret as GET /api/reminders/crm/pending).
 *
 * These mirror data shown on admin Teachers / Students / Reminders views (JSON API),
 * not the SPA URLs https://gluckstudentsportal.com/teachers (frontend).
 */

const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const Reminder = require('../models/Reminder');
const MeetingLink = require('../models/MeetingLink');
const { crmTokenAuth } = require('../middleware/crmTokenAuth');
const { toStudentDto } = require('../services/crmStudentExport');
const { upsertStudentFromCrm } = require('../services/crmStudentUpsert');
const { applyStudentNameFilter } = require('../utils/studentSearchQuery');
const { applyStudentCountryFilters } = require('../utils/studentCountry');

async function batchParticipantsAndSchedules(batchName) {
  const name = String(batchName || '').trim();
  if (!name) return { participants: [], classSchedules: [] };
  const batchEsc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const [participants, classSchedules] = await Promise.all([
    User.find({ role: 'STUDENT', batch: name })
      .select('-password')
      .sort({ name: 1 })
      .lean(),
    MeetingLink.find({
      batch: new RegExp(`^${batchEsc}$`, 'i'),
      status: { $in: ['scheduled', 'started'] }
    })
      .sort({ startTime: 1 })
      .limit(100)
      .populate('assignedTeacher', 'name email regNo role medium assignedBatches')
      .populate('createdBy', 'name email role regNo')
      .lean()
  ]);
  return { participants, classSchedules };
}

const router = express.Router();

function toPositiveInt(value, fallback) {
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Same whitelist as routes/admin.js for student filters */
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

router.use(crmTokenAuth);

/** Stable ordering for CRM exports — pairs with cursor pagination to avoid skipping rows during large syncs */
const CRM_STUDENT_EXPORT_SORT = { updatedAt: 1, _id: 1 };

function buildCrmStudentExportFilter(query) {
  const filter = { role: 'STUDENT' };

  if (query.excludeTestAccounts === 'true') {
    filter.isTestAccount = { $ne: true };
  }
  if (query.studentStatus) {
    filter.studentStatus = String(query.studentStatus).trim().toUpperCase();
  }
  if (query.batch) {
    filter.batch = String(query.batch).trim();
  }
  if (query.updatedSince) {
    const since = new Date(String(query.updatedSince).trim());
    if (!isNaN(since.getTime())) {
      filter.updatedAt = { $gte: since };
    }
  }

  return filter;
}

// ─── GET /api/crm/summary — lightweight “dashboard” counts ───────────────────
router.get('/summary', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    const [
      studentTotal,
      studentTotalExcludingTest,
      teacherTotal,
      batchSample,
      statusAgg
    ] = await Promise.all([
      User.countDocuments({ role: 'STUDENT' }),
      User.countDocuments({ role: 'STUDENT', isTestAccount: { $ne: true } }),
      User.countDocuments({ role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } }),
      User.distinct('batch', { role: 'STUDENT', batch: { $nin: [null, ''] } }),
      User.aggregate([
        { $match: { role: 'STUDENT' } },
        { $group: { _id: '$studentStatus', count: { $sum: 1 } } }
      ])
    ]);

    const byStatus = { ONGOING: 0, COMPLETED: 0, WITHDREW: 0, UNCERTAIN: 0 };
    for (const row of statusAgg) {
      const key = String(row._id || 'UNCERTAIN').toUpperCase();
      byStatus[key] = (byStatus[key] || 0) + row.count;
    }

    res.json({
      success: true,
      data: {
        studentTotal,
        studentTotalExcludingTest,
        byStatus,
        teacherTotal,
        distinctBatchCount: (batchSample || []).length
      }
    });
  } catch (err) {
    console.error('[crm] GET /summary', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/crm/teachers — same shape as GET /api/admin/teachers (+ pagination) ─
router.get('/teachers', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 100), 500);
    const skip = (page - 1) * limit;

    const teacherQuery = { role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } };
    const total = await User.countDocuments(teacherQuery);

    const teachers = await User.find(teacherQuery)
      .populate('assignedCourses', 'title')
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const teacherIds = teachers.map((t) => t._id);
    const studentCounts = await User.aggregate([
      { $match: { role: 'STUDENT', assignedTeacher: { $in: teacherIds } } },
      { $group: { _id: '$assignedTeacher', count: { $sum: 1 } } }
    ]);
    const countMap = {};
    studentCounts.forEach((sc) => {
      countMap[sc._id.toString()] = sc.count;
    });

    const teachersWithCount = teachers.map((t) => ({
      ...t,
      studentCount: countMap[t._id.toString()] || 0
    }));

    const pages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      data: teachersWithCount,
      count: total,
      pagination: { total, page, limit, pages }
    });
  } catch (err) {
    console.error('[crm] GET /teachers', err);
    res.status(500).json({ success: false, message: 'Failed to fetch teachers', error: err.message });
  }
});

// ─── GET /api/crm/students — same filters as GET /api/admin/students ────────
router.get('/students', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 100), 500);
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
    if (batch) query.batch = String(batch).trim();
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

    const total = await User.countDocuments(query);
    const students = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'assignedTeacher',
        select: 'name regNo email medium role'
      });

    const pages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      data: students,
      pagination: { total, page, limit, pages }
    });
  } catch (err) {
    console.error('[crm] GET /students', err);
    res.status(500).json({ success: false, message: 'Failed to fetch students', error: err.message });
  }
});

// ─── GET /api/crm/students/export — full student dump in CRM DTO shape ────────
//
// Pagination:
//   • Recommended for large syncs — cursor mode (stable under concurrent writes):
//       GET ...?cursorUpdatedAt=<ISO>&cursorId=<MongoObjectId>&limit=500
//     Follow pagination.nextCursor until hasMore is false.
//   • Legacy — page mode:
//       GET ...?page=1&limit=500
//
// Sort is always { updatedAt: 1, _id: 1 } for deterministic ordering.
//
// Filters: excludeTestAccounts, studentStatus, batch, updatedSince (same as before)
router.get('/students/export', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const limit = Math.min(toPositiveInt(req.query.limit, 500), 500);
    const baseFilter = buildCrmStudentExportFilter(req.query);

    const cursorUpdatedAt = req.query.cursorUpdatedAt ? String(req.query.cursorUpdatedAt).trim() : '';
    const cursorId = req.query.cursorId ? String(req.query.cursorId).trim() : '';

    const usePartialCursor =
      (cursorUpdatedAt && !cursorId) || (!cursorUpdatedAt && cursorId);
    if (usePartialCursor) {
      return res.status(400).json({
        success: false,
        message: 'cursor pagination requires both cursorUpdatedAt and cursorId (or omit both for page mode).',
      });
    }

    const useCursor = !!(cursorUpdatedAt && cursorId);

    let mongoFilter = baseFilter;
    if (useCursor) {
      const cu = new Date(cursorUpdatedAt);
      if (isNaN(cu.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid cursorUpdatedAt.' });
      }
      if (!mongoose.Types.ObjectId.isValid(cursorId)) {
        return res.status(400).json({ success: false, message: 'Invalid cursorId.' });
      }
      const oid = new mongoose.Types.ObjectId(cursorId);
      mongoFilter = {
        $and: [
          baseFilter,
          {
            $or: [{ updatedAt: { $gt: cu } }, { updatedAt: cu, _id: { $gt: oid } }],
          },
        ],
      };
    }

    const populateTeacher = {
      path: 'assignedTeacher',
      select: 'name regNo email medium role',
    };

    let studentsRaw;
    let paginationPayload;

    if (useCursor) {
      studentsRaw = await User.find(mongoFilter)
        .select('-password')
        .sort(CRM_STUDENT_EXPORT_SORT)
        .limit(limit + 1)
        .populate(populateTeacher)
        .lean();

      const hasMore = studentsRaw.length > limit;
      const slice = hasMore ? studentsRaw.slice(0, limit) : studentsRaw;

      let nextCursor = null;
      if (hasMore && slice.length > 0) {
        const last = slice[slice.length - 1];
        nextCursor = {
          updatedAt:
            last.updatedAt instanceof Date ? last.updatedAt.toISOString() : String(last.updatedAt || ''),
          id: String(last._id),
        };
      }

      paginationPayload = {
        mode: 'cursor',
        limit,
        hasMore,
        nextCursor,
      };
      studentsRaw = slice;
    } else {
      const page = toPositiveInt(req.query.page, 1);
      const skip = (page - 1) * limit;
      const total = await User.countDocuments(baseFilter);

      studentsRaw = await User.find(baseFilter)
        .select('-password')
        .sort(CRM_STUDENT_EXPORT_SORT)
        .skip(skip)
        .limit(limit)
        .populate(populateTeacher)
        .lean();

      const pages = Math.max(1, Math.ceil(total / limit));
      paginationPayload = {
        mode: 'page',
        total,
        page,
        limit,
        pages,
      };
    }

    res.json({
      success: true,
      data: studentsRaw.map(toStudentDto),
      pagination: paginationPayload,
    });
  } catch (err) {
    console.error('[crm] GET /students/export', err);
    res.status(500).json({ success: false, message: 'Failed to export students', error: err.message });
  }
});

// ─── GET /api/crm/students/:portalId — single student by Mongo _id ────────────
router.get('/students/:portalId', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const { portalId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(portalId)) {
      return res.status(400).json({ success: false, message: 'Invalid portalId.' });
    }
    const student = await User.findOne({ _id: portalId, role: 'STUDENT' })
      .select('-password')
      .populate({ path: 'assignedTeacher', select: 'name regNo email medium role' })
      .lean();

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    res.json({ success: true, data: toStudentDto(student) });
  } catch (err) {
    console.error('[crm] GET /students/:portalId', err);
    res.status(500).json({ success: false, message: 'Failed to fetch student', error: err.message });
  }
});

// ─── POST /api/crm/students/upsert — create or update one student from CRM ───
//
// Minimum body for a WhatsApp lead:
//   { name, whatsappNumber }
//
// Full options:
//   crmExternalId, name, email, whatsappNumber, phoneNumber,
//   createPortalLogin (bool, default false),
//   sendCredentialsEmail (bool, default false),
//   + any student profile fields (batch, level, subscription, studentStatus, etc.)
//   idempotencyKey | requestId — optional; replays return the same payload + idempotentReplay:true
router.post('/students/upsert', async (req, res) => {
  try {
    const result = await upsertStudentFromCrm(req.body || {});
    const replayStatus = result._replayHttpStatus;
    if (Object.prototype.hasOwnProperty.call(result, '_replayHttpStatus')) {
      delete result._replayHttpStatus;
    }
    const status =
      typeof replayStatus === 'number'
        ? replayStatus
        : result.action === 'created'
          ? 201
          : 200;
    res.status(status).json({ success: true, ...result });
  } catch (err) {
    console.error('[crm] POST /students/upsert', err);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ success: false, message: err.message });
  }
});

// ─── POST /api/crm/students/bulk-upsert — batch upsert (max 100 per call) ────
router.post('/students/bulk-upsert', async (req, res) => {
  try {
    const items = Array.isArray(req.body) ? req.body : (req.body?.students || []);
    if (!items.length) {
      return res.status(400).json({ success: false, message: 'Provide an array of student objects (or { students: [...] }).' });
    }
    if (items.length > 100) {
      return res.status(400).json({ success: false, message: 'Maximum 100 students per bulk-upsert call.' });
    }

    const results = [];
    for (const item of items) {
      try {
        const r = await upsertStudentFromCrm(item);
        const row = { ...r };
        delete row._replayHttpStatus;
        results.push({ success: true, ...row });
      } catch (e) {
        results.push({ success: false, message: e.message, input: item });
      }
    }

    const created = results.filter((r) => r.action === 'created').length;
    const updated = results.filter((r) => r.action === 'updated').length;
    const failed  = results.filter((r) => !r.success).length;

    res.json({
      success: true,
      summary: { total: items.length, created, updated, failed },
      results
    });
  } catch (err) {
    console.error('[crm] POST /students/bulk-upsert', err);
    res.status(500).json({ success: false, message: 'Bulk upsert failed', error: err.message });
  }
});

// ─── GET /api/crm/reminders — list + recipients + schedule context
router.get('/reminders', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 100), 500);
    const skip = (page - 1) * limit;

    const total = await Reminder.countDocuments({});
    const reminders = await Reminder.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name role')
      .populate('templateId', 'title')
      .lean();

    const recipientStudentIds = [
      ...new Set(
        reminders
          .flatMap((r) => (r.recipients || []).map((rc) => rc?.studentId).filter(Boolean))
          .map((id) => String(id))
      )
    ];
    const recipientStudents = recipientStudentIds.length
      ? await User.find({ _id: { $in: recipientStudentIds } })
        .select('-password')
        .lean()
      : [];
    const recipientStudentMap = new Map(recipientStudents.map((s) => [String(s._id), s]));

    const uniqueBatches = [...new Set(reminders.map((r) => String(r.targetBatch || '').trim()).filter(Boolean))];
    const batchCtx = new Map();
    await Promise.all(
      uniqueBatches.map(async (batchName) => {
        const ctx = await batchParticipantsAndSchedules(batchName);
        batchCtx.set(batchName, ctx);
      })
    );

    const mapped = reminders.map((reminder) => {
      const { classSchedules, participants } = batchCtx.get(reminder.targetBatch) || { classSchedules: [], participants: [] };
      const nextUpcomingClass = classSchedules[0] || null;
      const scheduleTimeKind =
        reminder.scheduleTimeKind ||
        (reminder.deliveryMode !== 'scheduled'
          ? 'instant'
          : reminder.minutesBeforeClass != null && Number.isFinite(Number(reminder.minutesBeforeClass))
            ? 'minutes_before_class'
            : 'fixed_datetime');

      const recipientsDetailed = (reminder.recipients || []).map((rc) => {
        const student = recipientStudentMap.get(String(rc.studentId || '')) || null;
        return {
          ...rc,
          student,
          batch: student?.batch || reminder.targetBatch || null,
          regNo: student?.regNo || null
        };
      });

      return {
        ...reminder,
        recipients: reminder.recipients || [],
        scheduleTimeKind,
        recipientsDetailed,
        participants,
        classSchedules,
        nextUpcomingClass,
        scheduleSummary:
          scheduleTimeKind === 'minutes_before_class' &&
          reminder.minutesBeforeClass != null &&
          nextUpcomingClass?.startTime
            ? `Send ${reminder.minutesBeforeClass} min before class at ${nextUpcomingClass.startTime}`
            : reminder.scheduledFor
              ? `Send at ${reminder.scheduledFor}`
              : null
      };
    });

    const pages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      data: mapped,
      pagination: { total, page, limit, pages }
    });
  } catch (err) {
    console.error('[crm] GET /reminders', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reminders', error: err.message });
  }
});

// ─── GET /api/crm/reminders/:id — one reminder + recipients + batch participants & classes
router.get('/reminders/:id', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id || '').trim();
    const reminder = await Reminder.findById(id)
      .populate('createdBy', 'name role email regNo')
      .populate('templateId', 'title body isActive')
      .lean();

    if (!reminder) {
      return res.status(404).json({ success: false, message: 'Reminder not found.' });
    }

    const { participants, classSchedules } = await batchParticipantsAndSchedules(reminder.targetBatch);
    const nextUpcomingClass = classSchedules[0] || null;

    const scheduleTimeKind =
      reminder.scheduleTimeKind ||
      (reminder.deliveryMode !== 'scheduled'
        ? 'instant'
        : reminder.minutesBeforeClass != null && Number.isFinite(Number(reminder.minutesBeforeClass))
          ? 'minutes_before_class'
          : 'fixed_datetime');

    res.json({
      success: true,
      data: {
        ...reminder,
        scheduleTimeKind,
        participants,
        classSchedules,
        nextUpcomingClass,
        scheduleSummary:
          scheduleTimeKind === 'minutes_before_class' &&
          reminder.minutesBeforeClass != null &&
          nextUpcomingClass?.startTime
            ? `Send ${reminder.minutesBeforeClass} min before class at ${nextUpcomingClass.startTime}`
            : reminder.scheduledFor
              ? `Send at ${reminder.scheduledFor}`
              : null
      }
    });
  } catch (err) {
    console.error('[crm] GET /reminders/:id', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reminder', error: err.message });
  }
});

module.exports = router;
