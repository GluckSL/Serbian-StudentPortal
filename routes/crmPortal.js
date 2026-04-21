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
const { crmTokenAuth } = require('../middleware/crmTokenAuth');

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

// ─── GET /api/crm/reminders — list (no per-recipient payload); same fields as admin list
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
      .select('-recipients')
      .lean();

    const pages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      data: reminders,
      pagination: { total, page, limit, pages }
    });
  } catch (err) {
    console.error('[crm] GET /reminders', err);
    res.status(500).json({ success: false, message: 'Failed to fetch reminders', error: err.message });
  }
});

module.exports = router;
