/**
 * Read-only CRM endpoints for WordPress / external pollers.
 * Auth: header X-CRM-Token must equal process.env.REMINDERS_CRM_TOKEN
 * (same secret as GET /api/reminders/crm/pending).
 *
 * These mirror data shown on admin Teachers / Students / Reminders views (JSON API),
 * not the SPA URLs https://gluckstudentsportal.com/teachers (frontend).
 */

const express = require('express');
const User = require('../models/User');
const Reminder = require('../models/Reminder');
const MeetingLink = require('../models/MeetingLink');
const { crmTokenAuth } = require('../middleware/crmTokenAuth');

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

// ─── GET /api/crm/summary — lightweight “dashboard” counts ───────────────────
router.get('/summary', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const [studentTotal, teacherTotal, batchSample] = await Promise.all([
      User.countDocuments({ role: 'STUDENT' }),
      User.countDocuments({ role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } }),
      User.distinct('batch', { role: 'STUDENT', batch: { $nin: [null, ''] } })
    ]);
    res.json({
      success: true,
      data: {
        studentTotal,
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
      advField,
      advValue
    } = req.query;

    const query = { role: 'STUDENT' };

    if (level) query.level = String(level).trim();
    if (plan) query.subscription = String(plan).trim().toUpperCase();
    if (batch) query.batch = String(batch).trim();
    if (studentStatus) query.studentStatus = String(studentStatus).trim().toUpperCase();
    if (studentName) query.name = { $regex: new RegExp(String(studentName).trim(), 'i') };
    if (servicesOpted) query.servicesOpted = String(servicesOpted).trim();
    if (qualifications) query.qualifications = String(qualifications).trim();
    if (languageLevelOpted) query.languageLevelOpted = String(languageLevelOpted).trim();
    if (leadSource) query.leadSource = String(leadSource).trim();
    if (stream) query.stream = String(stream).trim();

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
