const express = require('express');
const mongoose = require('mongoose');
const { verifyToken, checkRole } = require('../middleware/auth');
const { EXCLUDE_TEST } = require('../utils/analyticsFilters');
const { computeAdminProgressMetrics } = require('../utils/studentProgressMetrics');

const User = require('../models/User');
const PageActivity = require('../models/pageActivity.model');
const MeetingLink = require('../models/MeetingLink');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const DGSession = require('../models/DGSession');
const StudentDocument = require('../models/StudentDocument');
const StudentPayment = require('../models/StudentPayment');
const VisaTracking = require('../models/VisaTracking');

const router = express.Router();
const COLOMBO_TZ = 'Asia/Colombo';

function parseObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
}

/** @returns {{ from: Date, to: Date }} */
function parseDateRangeQuery(query) {
  const now = new Date();
  let to = query.to ? new Date(String(query.to)) : now;
  if (Number.isNaN(to.getTime())) to = now;
  let from = query.from ? new Date(String(query.from)) : new Date(to.getTime() - 29 * 86400000);
  if (Number.isNaN(from.getTime())) from = new Date(to.getTime() - 29 * 86400000);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  if (from > to) {
    const t = from;
    from = to;
    to = t;
  }
  return { from, to };
}

function enumerateDayKeys(from, to) {
  const startStr = from.toLocaleDateString('sr-Latn-RS', { timeZone: COLOMBO_TZ });
  const endStr = to.toLocaleDateString('sr-Latn-RS', { timeZone: COLOMBO_TZ });
  const keys = [];
  let cur = new Date(`${startStr}T12:00:00+05:30`);
  const endAnchor = new Date(`${endStr}T12:00:00+05:30`);
  while (cur <= endAnchor) {
    keys.push(cur.toLocaleDateString('sr-Latn-RS', { timeZone: COLOMBO_TZ }));
    cur = new Date(cur.getTime() + 86400000);
  }
  return keys;
}

function colomboTodayBounds() {
  const now = new Date();
  const ymd = now.toLocaleDateString('sr-Latn-RS', { timeZone: COLOMBO_TZ });
  const start = new Date(`${ymd}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

function humanizePagePath(page) {
  if (!page || typeof page !== 'string') return '—';
  const p = page.replace(/^\//, '').split('?')[0] || 'home';
  const parts = p.split('/').filter(Boolean);
  if (!parts.length) return 'Home';
  return parts.map((s) => s.replace(/-/g, ' ')).join(' › ');
}

function sumDgLogMs(logs) {
  if (!Array.isArray(logs)) return 0;
  return logs.reduce((acc, l) => acc + (Number.isFinite(l.durationMs) ? l.durationMs : 0), 0);
}

async function loadStudentProgressInputs(studentId) {
  const student = await User.findById(studentId)
    .select('role level languageLevelOpted courseCompletionDates batch name email regNo isTestAccount')
    .lean();
  if (!student || student.role !== 'STUDENT') return null;
  if (student.isTestAccount) return null;

  const [docAgg, pay, visa] = await Promise.all([
    StudentDocument.aggregate([
      { $match: { studentId: student._id } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          verified: { $sum: { $cond: [{ $eq: ['$status', 'VERIFIED'] }, 1, 0] } }
        }
      }
    ]),
    StudentPayment.findOne({ studentId: student._id }).select('totalPackageAmount totalPaid').lean(),
    VisaTracking.findOne({ studentId: student._id }).select('visaType stages').lean()
  ]);
  const doc = docAgg[0] || { total: 0, verified: 0 };
  const metrics = computeAdminProgressMetrics(student, doc, pay, visa);
  return { student, doc, pay, visa, metrics };
}

async function pageActivityKpis(studentOid, from, to) {
  const [allTimeRow] = await PageActivity.aggregate([
    { $match: { studentId: studentOid } },
    { $group: { _id: null, seconds: { $sum: '$activeSeconds' } } }
  ]);
  const allTimeSeconds = allTimeRow?.seconds || 0;

  const { start: todayStart, end: todayEnd } = colomboTodayBounds();
  const [todayRow] = await PageActivity.aggregate([
    {
      $match: {
        studentId: studentOid,
        startTime: { $gte: todayStart, $lt: todayEnd }
      }
    },
    { $group: { _id: null, seconds: { $sum: '$activeSeconds' } } }
  ]);
  const todaySeconds = todayRow?.seconds || 0;

  const [rangeRow] = await PageActivity.aggregate([
    {
      $match: {
        studentId: studentOid,
        startTime: { $gte: from, $lte: to }
      }
    },
    { $group: { _id: null, seconds: { $sum: '$activeSeconds' } } }
  ]);
  const rangeSeconds = rangeRow?.seconds || 0;

  const topPages = await PageActivity.aggregate([
    {
      $match: {
        studentId: studentOid,
        startTime: { $gte: from, $lte: to }
      }
    },
    { $group: { _id: '$page', seconds: { $sum: '$activeSeconds' } } },
    { $sort: { seconds: -1 } },
    { $limit: 1 }
  ]);
  const top = topPages[0];
  const mostUsedPage = top
    ? {
        page: top._id,
        label: humanizePagePath(top._id),
        seconds: top.seconds
      }
    : null;

  return { allTimeSeconds, todaySeconds, rangeSeconds, mostUsedPage };
}

async function classesSeriesForStudent(studentOid, from, to) {
  const rows = await MeetingLink.aggregate([
    {
      $match: {
        startTime: { $gte: from, $lte: to },
        attendance: { $elemMatch: { studentId: studentOid } }
      }
    },
    { $unwind: '$attendance' },
    { $match: { 'attendance.studentId': studentOid } },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone: COLOMBO_TZ }
        },
        attendedCount: {
          $sum: {
            $cond: [
              {
                $or: [{ $eq: ['$attendance.attended', true] }, { $eq: ['$attendance.status', 'attended'] }]
              },
              1,
              0
            ]
          }
        },
        minutesPresent: {
          $sum: {
            $cond: [
              { $gt: [{ $ifNull: ['$attendance.durationMinutes', 0] }, 0] },
              '$attendance.durationMinutes',
              { $divide: [{ $ifNull: ['$attendance.duration', 0] }, 60] }
            ]
          }
        }
      }
    }
  ]);
  const byDay = Object.fromEntries(rows.map((r) => [r._id, r]));
  const days = enumerateDayKeys(from, to);
  return days.map((d) => ({
    date: d,
    attendedCount: byDay[d]?.attendedCount || 0,
    minutesPresent: Math.round((byDay[d]?.minutesPresent || 0) * 10) / 10
  }));
}

async function exercisesSeriesForStudent(studentOid, from, to) {
  const rows = await ExerciseAttempt.aggregate([
    {
      $match: {
        studentId: studentOid,
        status: 'completed',
        completedAt: { $gte: from, $lte: to }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: COLOMBO_TZ }
        },
        completedCount: { $sum: 1 },
        avgScore: { $avg: '$scorePercentage' }
      }
    }
  ]);
  const byDay = Object.fromEntries(rows.map((r) => [r._id, r]));
  const days = enumerateDayKeys(from, to);
  return days.map((d) => ({
    date: d,
    completedCount: byDay[d]?.completedCount || 0,
    avgScore: byDay[d]?.avgScore != null ? Math.round(byDay[d].avgScore * 10) / 10 : 0
  }));
}

async function dgSeriesForStudent(studentOid, from, to) {
  const sessions = await DGSession.find({
    studentId: studentOid,
    createdAt: { $gte: from, $lte: to }
  })
    .select('createdAt logs')
    .lean();
  const byDay = {};
  for (const s of sessions) {
    const d = new Date(s.createdAt).toLocaleDateString('sr-Latn-RS', { timeZone: COLOMBO_TZ });
    if (!byDay[d]) byDay[d] = { sessionCount: 0, practiceMs: 0 };
    byDay[d].sessionCount += 1;
    byDay[d].practiceMs += sumDgLogMs(s.logs);
  }
  const days = enumerateDayKeys(from, to);
  return days.map((d) => ({
    date: d,
    sessionCount: byDay[d]?.sessionCount || 0,
    practiceMinutes: byDay[d] ? Math.round(byDay[d].practiceMs / 60000) : 0
  }));
}

async function classesTableForStudent(studentOid) {
  const meetings = await MeetingLink.find({
    'attendance.studentId': studentOid
  })
    .select('topic startTime batch attendance courseDay status')
    .sort({ startTime: -1 })
    .limit(400)
    .lean();
  const sidStr = String(studentOid);
  const rows = [];
  for (const m of meetings) {
    const row = (m.attendance || []).find((a) => a.studentId && String(a.studentId) === sidStr);
    if (!row) continue;
    const minutes =
      row.durationMinutes ||
      (row.duration ? Math.round(Number(row.duration) / 60) : null);
    rows.push({
      topic: m.topic || 'Class',
      startTime: m.startTime,
      batch: m.batch,
      courseDay: m.courseDay,
      attended: !!row.attended || row.status === 'attended',
      durationMinutes: minutes,
      attendancePercent: row.attendancePercent != null ? row.attendancePercent : null,
      status: row.status || 'absent'
    });
  }
  return rows;
}

async function exercisesTableForStudent(studentOid) {
  const attempts = await ExerciseAttempt.find({ studentId: studentOid })
    .sort({ completedAt: -1, createdAt: -1 })
    .limit(500)
    .populate('exerciseId', 'title')
    .lean();
  return attempts.map((a) => ({
    exerciseTitle: a.exerciseId?.title || 'Exercise',
    exerciseId: a.exerciseId?._id || a.exerciseId,
    scorePercentage: a.scorePercentage,
    timeSpentSeconds: a.timeSpentSeconds,
    status: a.status,
    attemptedAt: a.startedAt,
    completedAt: a.completedAt
  }));
}

async function dgTableForStudent(studentOid) {
  const sessions = await DGSession.find({ studentId: studentOid })
    .sort({ createdAt: -1 })
    .limit(400)
    .populate('moduleId', 'title')
    .lean();
  return sessions.map((s) => ({
    moduleTitle: s.moduleId?.title || 'DG module',
    moduleId: s.moduleId?._id || s.moduleId,
    score: s.score,
    completed: s.completed,
    practiceMinutes: Math.round(sumDgLogMs(s.logs) / 60000),
    createdAt: s.createdAt,
    completedAt: s.completedAt
  }));
}

/** Batch: portal time in range, today average, top page */
async function batchPageActivityKpis(studentOids, nStudents, from, to) {
  const oidList = studentOids;
  const [rangeRow] = await PageActivity.aggregate([
    {
      $match: {
        studentId: { $in: oidList },
        startTime: { $gte: from, $lte: to }
      }
    },
    { $group: { _id: null, seconds: { $sum: '$activeSeconds' } } }
  ]);
  const portalSecondsInRange = rangeRow?.seconds || 0;

  const { start: todayStart, end: todayEnd } = colomboTodayBounds();
  const todayPerStudent = await PageActivity.aggregate([
    {
      $match: {
        studentId: { $in: oidList },
        startTime: { $gte: todayStart, $lt: todayEnd }
      }
    },
    {
      $group: {
        _id: '$studentId',
        seconds: { $sum: '$activeSeconds' }
      }
    }
  ]);
  const todayTotal = todayPerStudent.reduce((s, r) => s + (r.seconds || 0), 0);

  const avgTodaySecondsPerStudent = nStudents ? Math.round(todayTotal / nStudents) : 0;

  const topPages = await PageActivity.aggregate([
    {
      $match: {
        studentId: { $in: oidList },
        startTime: { $gte: from, $lte: to }
      }
    },
    { $group: { _id: '$page', seconds: { $sum: '$activeSeconds' } } },
    { $sort: { seconds: -1 } },
    { $limit: 1 }
  ]);
  const top = topPages[0];
  const mostUsedPage = top
    ? { page: top._id, label: humanizePagePath(top._id), seconds: top.seconds }
    : null;

  const [allTimeRow] = await PageActivity.aggregate([
    { $match: { studentId: { $in: oidList } } },
    { $group: { _id: null, seconds: { $sum: '$activeSeconds' } } }
  ]);

  return {
    portalSecondsInRange,
    portalSecondsAllTime: allTimeRow?.seconds || 0,
    avgTodaySecondsPerStudent,
    mostUsedPage
  };
}

async function classesSeriesBatch(batchKey, studentOids, from, to) {
  const n = studentOids.length;
  const batchMatch = [{ batch: String(batchKey) }, { batch: batchKey }];
  const bn = Number(batchKey);
  if (Number.isFinite(bn) && String(bn) === String(batchKey).trim()) {
    batchMatch.push({ batch: bn });
  }
  const rows = await MeetingLink.aggregate([
    {
      $match: {
        $or: batchMatch,
        startTime: { $gte: from, $lte: to }
      }
    },
    { $unwind: '$attendance' },
    {
      $match: {
        'attendance.studentId': { $in: studentOids },
        $or: [{ 'attendance.attended': true }, { 'attendance.status': 'attended' }]
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$startTime', timezone: COLOMBO_TZ }
        },
        students: { $addToSet: '$attendance.studentId' },
        minutesPresent: {
          $sum: {
            $cond: [
              { $gt: [{ $ifNull: ['$attendance.durationMinutes', 0] }, 0] },
              '$attendance.durationMinutes',
              { $divide: [{ $ifNull: ['$attendance.duration', 0] }, 60] }
            ]
          }
        }
      }
    }
  ]);
  const byDay = {};
  for (const r of rows) {
    byDay[r._id] = {
      attendedStudentCount: r.students?.length || 0,
      attendanceRatePct: n ? Math.round(((r.students?.length || 0) / n) * 100) : 0,
      minutesPresent: Math.round((r.minutesPresent || 0) * 10) / 10
    };
  }
  const days = enumerateDayKeys(from, to);
  return days.map((d) => ({
    date: d,
    attendedStudentCount: byDay[d]?.attendedStudentCount || 0,
    attendanceRatePct: byDay[d]?.attendanceRatePct || 0,
    minutesPresent: byDay[d]?.minutesPresent || 0
  }));
}

async function exercisesSeriesBatch(studentOids, from, to) {
  const rows = await ExerciseAttempt.aggregate([
    {
      $match: {
        studentId: { $in: studentOids },
        status: 'completed',
        completedAt: { $gte: from, $lte: to }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$completedAt', timezone: COLOMBO_TZ }
        },
        completedCount: { $sum: 1 },
        avgScore: { $avg: '$scorePercentage' }
      }
    }
  ]);
  const byDay = Object.fromEntries(rows.map((r) => [r._id, r]));
  const days = enumerateDayKeys(from, to);
  return days.map((d) => ({
    date: d,
    completedCount: byDay[d]?.completedCount || 0,
    avgScore: byDay[d]?.avgScore != null ? Math.round(byDay[d].avgScore * 10) / 10 : 0
  }));
}

async function dgSeriesBatch(studentOids, from, to) {
  const sessions = await DGSession.find({
    studentId: { $in: studentOids },
    createdAt: { $gte: from, $lte: to }
  })
    .select('studentId createdAt logs')
    .lean();
  const byDay = {};
  for (const s of sessions) {
    const d = new Date(s.createdAt).toLocaleDateString('sr-Latn-RS', { timeZone: COLOMBO_TZ });
    if (!byDay[d]) byDay[d] = { sessionCount: 0, practiceMs: 0 };
    byDay[d].sessionCount += 1;
    byDay[d].practiceMs += sumDgLogMs(s.logs);
  }
  const days = enumerateDayKeys(from, to);
  return days.map((d) => ({
    date: d,
    sessionCount: byDay[d]?.sessionCount || 0,
    practiceMinutes: byDay[d] ? Math.round(byDay[d].practiceMs / 60000) : 0
  }));
}

async function classesTableBatch(batchKey, students) {
  const batchMatch = [{ batch: String(batchKey) }, { batch: batchKey }];
  const bn = Number(batchKey);
  if (Number.isFinite(bn) && String(bn) === String(batchKey).trim()) {
    batchMatch.push({ batch: bn });
  }
  const meetings = await MeetingLink.find({ $or: batchMatch })
    .select('topic startTime batch attendance courseDay')
    .sort({ startTime: -1 })
    .limit(500)
    .lean();
  const byId = new Map(students.map((s) => [String(s._id), s]));
  const rows = [];
  for (const m of meetings) {
    for (const a of m.attendance || []) {
      if (!a.studentId) continue;
      const st = byId.get(String(a.studentId));
      if (!st) continue;
      const minutes =
        a.durationMinutes || (a.duration ? Math.round(Number(a.duration) / 60) : null);
      rows.push({
        studentName: st.name,
        studentId: st._id,
        topic: m.topic || 'Class',
        startTime: m.startTime,
        courseDay: m.courseDay,
        attended: !!a.attended || a.status === 'attended',
        durationMinutes: minutes,
        attendancePercent: a.attendancePercent != null ? a.attendancePercent : null,
        status: a.status || 'absent'
      });
    }
  }
  return rows;
}

async function exercisesTableBatch(studentOids, nameById) {
  const attempts = await ExerciseAttempt.find({ studentId: { $in: studentOids } })
    .sort({ completedAt: -1 })
    .limit(800)
    .populate('exerciseId', 'title')
    .lean();
  return attempts.map((a) => ({
    studentName: nameById.get(String(a.studentId)) || 'Student',
    studentId: a.studentId,
    exerciseTitle: a.exerciseId?.title || 'Exercise',
    scorePercentage: a.scorePercentage,
    timeSpentSeconds: a.timeSpentSeconds,
    status: a.status,
    completedAt: a.completedAt
  }));
}

async function dgTableBatch(studentOids, nameById) {
  const sessions = await DGSession.find({ studentId: { $in: studentOids } })
    .sort({ createdAt: -1 })
    .limit(800)
    .populate('moduleId', 'title')
    .lean();
  return sessions.map((s) => ({
    studentName: nameById.get(String(s.studentId)) || 'Student',
    studentId: s.studentId,
    moduleTitle: s.moduleId?.title || 'DG module',
    score: s.score,
    completed: s.completed,
    practiceMinutes: Math.round(sumDgLogMs(s.logs) / 60000),
    createdAt: s.createdAt,
    completedAt: s.completedAt
  }));
}

router.get(
  '/student/:studentId',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const studentOid = parseObjectId(req.params.studentId);
      if (!studentOid) return res.status(400).json({ message: 'Invalid student id' });

      const ctx = await loadStudentProgressInputs(studentOid);
      if (!ctx) return res.status(404).json({ message: 'Student not found' });

      const { from, to } = parseDateRangeQuery(req.query);

      const [pageKpis, seriesClasses, seriesEx, seriesDg, tblClasses, tblEx, tblDg] = await Promise.all([
        pageActivityKpis(studentOid, from, to),
        classesSeriesForStudent(studentOid, from, to),
        exercisesSeriesForStudent(studentOid, from, to),
        dgSeriesForStudent(studentOid, from, to),
        classesTableForStudent(studentOid),
        exercisesTableForStudent(studentOid),
        dgTableForStudent(studentOid)
      ]);

      res.json({
        scope: 'student',
        range: { from: from.toISOString(), to: to.toISOString() },
        student: {
          _id: String(ctx.student._id),
          name: ctx.student.name,
          email: ctx.student.email,
          regNo: ctx.student.regNo,
          batch: ctx.student.batch || ''
        },
        kpis: {
          totalPortalSecondsAllTime: pageKpis.allTimeSeconds,
          totalPortalSecondsInRange: pageKpis.rangeSeconds,
          totalPortalSecondsToday: pageKpis.todaySeconds,
          mostUsedPageInRange: pageKpis.mostUsedPage,
          overallPct: ctx.metrics.overallPct,
          learningPct: ctx.metrics.learningPct
        },
        series: {
          classes: seriesClasses,
          exercises: seriesEx,
          dg: seriesDg
        },
        tables: {
          classes: tblClasses,
          exercises: tblEx,
          dg: tblDg
        }
      });
    } catch (err) {
      console.error('[admin-performance] student', err);
      res.status(500).json({ message: 'Failed to load performance' });
    }
  }
);

router.get('/batch/:batchKey', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const batchKey = decodeURIComponent(String(req.params.batchKey || '')).trim();
    if (!batchKey) return res.status(400).json({ message: 'Batch required' });

    const { from, to } = parseDateRangeQuery(req.query);

    const batchOr = [{ batch: batchKey }, { batch: String(batchKey) }];
    const n = Number(batchKey);
    if (Number.isFinite(n) && String(n) === String(batchKey).trim()) {
      batchOr.push({ batch: n });
    }

    const students = await User.find({
      role: 'STUDENT',
      ...EXCLUDE_TEST,
      $or: batchOr
    })
      .select('name email regNo batch level languageLevelOpted courseCompletionDates')
      .lean();

    if (!students.length) {
      return res.status(404).json({ message: 'No students in this batch' });
    }

    const studentOids = students.map((s) => s._id);
    const studentIds = studentOids.map((id) => id.toString());
    const nameById = new Map(students.map((s) => [String(s._id), s.name]));

    const [docAgg, payments, visas] = await Promise.all([
      StudentDocument.aggregate([
        { $match: { studentId: { $in: studentOids } } },
        {
          $group: {
            _id: '$studentId',
            total: { $sum: 1 },
            verified: { $sum: { $cond: [{ $eq: ['$status', 'VERIFIED'] }, 1, 0] } }
          }
        }
      ]),
      StudentPayment.find({ studentId: { $in: studentOids } })
        .select('studentId totalPackageAmount totalPaid')
        .lean(),
      VisaTracking.find({ studentId: { $in: studentOids } }).select('studentId visaType stages').lean()
    ]);

    const docMap = Object.fromEntries(docAgg.map((d) => [String(d._id), d]));
    const payMap = Object.fromEntries(payments.map((p) => [String(p.studentId), p]));
    const visaMap = Object.fromEntries(visas.map((v) => [String(v.studentId), v]));

    let sumOverall = 0;
    for (const s of students) {
      const sid = String(s._id);
      const m = computeAdminProgressMetrics(s, docMap[sid] || { total: 0, verified: 0 }, payMap[sid] || null, visaMap[sid] || null);
      sumOverall += m.overallPct;
    }
    const avgOverallPct = Math.round(sumOverall / students.length);

    const nStudents = students.length;
    const [batchPage, seriesClasses, seriesEx, seriesDg, tblClasses, tblEx, tblDg] = await Promise.all([
      batchPageActivityKpis(studentOids, nStudents, from, to),
      classesSeriesBatch(batchKey, studentOids, from, to),
      exercisesSeriesBatch(studentOids, from, to),
      dgSeriesBatch(studentOids, from, to),
      classesTableBatch(batchKey, students),
      exercisesTableBatch(studentOids, nameById),
      dgTableBatch(studentOids, nameById)
    ]);

    res.json({
      scope: 'batch',
      range: { from: from.toISOString(), to: to.toISOString() },
      batch: { key: batchKey, studentCount: nStudents, studentIds },
      kpis: {
        avgOverallPct,
        totalPortalSecondsAllTime: batchPage.portalSecondsAllTime,
        totalPortalSecondsInRange: batchPage.portalSecondsInRange,
        avgTodaySecondsPerStudent: batchPage.avgTodaySecondsPerStudent,
        mostUsedPageInRange: batchPage.mostUsedPage
      },
      series: {
        classes: seriesClasses,
        exercises: seriesEx,
        dg: seriesDg
      },
      tables: {
        classes: tblClasses,
        exercises: tblEx,
        dg: tblDg
      }
    });
  } catch (err) {
    console.error('[admin-performance] batch', err);
    res.status(500).json({ message: 'Failed to load batch performance' });
  }
});

module.exports = router;
