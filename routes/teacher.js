//routes/teacher.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');
const { verifyToken, checkRole } = require('../middleware/auth');

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
  const monthLabel = from.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { month, monthLabel, from, to };
}

function getScheduledMinutes(meeting) {
  const duration = Number(meeting.duration || 0);
  if (duration > 0) return duration;
  return meeting.attendanceRecorded ? 60 : 0;
}

const TEACHER_ATTENDANCE_BONUS_RATE = 200;
const TEACHER_ATTENDANCE_BONUS_THRESHOLD = 90;

// Get current teacher profile (GET /api/teacher/profile)
router.get('/profile', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').lean();
    
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      profilePhoto: user.profilePhoto,
      assignedCourses: user.assignedCourses || [],
      registeredAt: user.registeredAt,
    });
  } catch (err) {
    console.error('Teacher profile error:', err);
    res.status(500).json({ msg: 'Error retrieving teacher profile', error: err.message });
  }
});


// // Get list of all students
// router.get('/students', async (req, res) => {
//   try {
//     const students = await User.find({ role: 'STUDENT' }).select('_id name');
//     res.json(students);
//   } catch (err) {
//     res.status(500).json({ message: 'Server error' });
//   }
// });

// PUT /api/teacher/update-course-progress/:studentId
router.put('/update-course-progress/:studentId', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), async (req, res) => {
  const { courseId, progress } = req.body;

  try {
    const user = await User.findById(req.params.studentId);
    if (!user) return res.status(404).json({ message: 'Student not found' });

    const courseEntry = user.assignedCourses.find(c => c.courseId.toString() === courseId);
    if (!courseEntry) return res.status(404).json({ message: 'Course not assigned to this student' });

    courseEntry.progress = progress; // update progress
    await user.save();

    res.status(200).json({ message: 'Course progress updated successfully' });
  } catch (err) {
    console.error('Update progress error:', err);
    res.status(500).json({ message: 'Failed to update course progress', error: err.message });
  }
});

// Get students assigned to the logged-in teacher
router.get('/students', verifyToken, async (req, res) => {
  try {
    // req.user.id should contain the logged-in teacher's ID
    const teacherId = req.user.id;

    const students = await User.find({ 
        role: 'STUDENT', 
        assignedTeacher: teacherId // filter by assignedTeacher
      })
      .select('-password') // exclude passwords
      .populate({
        path: 'assignedTeacher',  
        select: 'name regNo email medium' // useful teacher info
      })
      .lean();

    res.json({ success: true, data: students });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students',
      error: err.message
    });
  }
});

// Distinct batch names from meetings this teacher hosts (for My Classes filters)
router.get('/class-batches', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const teacherId = req.user.id;
    const { batchesAlign } = require('../utils/effectiveStudentBatch');
    const teacher = await User.findById(teacherId).select('assignedBatches').lean();

    let batches = await MeetingLink.distinct('batch', {
      $or: [{ createdBy: teacherId }, { assignedTeacher: teacherId }],
      status: { $ne: 'cancelled' },
      batch: { $exists: true, $nin: [null, ''] },
    });

    const profileBatches = (teacher?.assignedBatches || []).map((b) => String(b || '').trim()).filter(Boolean);
    if (profileBatches.length > 0) {
      batches = batches.filter((b) => profileBatches.some((pb) => batchesAlign(pb, b)));
    }

    const sorted = batches
      .filter(Boolean)
      .map(String)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    res.json({ success: true, data: sorted });
  } catch (err) {
    console.error('class-batches error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch batch list', error: err.message });
  }
});

// Monthly teaching-hours summary for the logged-in teacher only.
router.get('/monthly-hours', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const teacherId = req.user.id;
    const monthFilter = getTeacherAnalyticsMonth(req.query.month);
    const { from, to } = monthFilter;

    const [teacher, meetings] = await Promise.all([
      User.findOne({
        _id: teacherId,
        role: { $in: ['TEACHER', 'TEACHER_ADMIN'] }
      })
        .populate('assignedCourses', 'title')
        .select('name regNo email medium assignedBatches assignedCourses')
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
      return res.status(404).json({ success: false, message: 'Teacher not found' });
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
      allLevelSet.add(level);
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
          levels: [...allLevelSet].sort()
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
    console.error('teacher monthly-hours error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch monthly hour details',
      error: err.message
    });
  }
});

// GET /api/teacher/:teacherId  →  Fetch teacher details by ID
router.get('/:teacherId', verifyToken, async (req, res) => {
  try {
    const teacherId = req.params.teacherId;

    // Find teacher by ID
    const teacher = await User.findOne({ _id: teacherId, role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } }).select('-password').lean();

    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }

    res.json({
      success: true,
      data: {
        _id: teacher._id,
        name: teacher.name,
      }
      
    });

  } catch (err) {
    console.error('Error fetching teacher by ID:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch teacher details',
      error: err.message
    });
  }
});

//get all teachers
router.get('/', verifyToken, async (req, res) => {
  try {
    const teachers = await User.find({ role: { $in: ['TEACHER', 'TEACHER_ADMIN'] } }).select('-password').lean();
    res.json({ success: true, data: teachers });
  } catch (err) {
    console.error('Error fetching teachers:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch teachers', error: err.message });
  }
});

module.exports = router;



