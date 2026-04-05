//routes/admin.js

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Subscription = require('../models/subscriptions');
const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');
//const auth = require('../middleware/auth');
const { verifyToken, isAdmin, checkRole } = require('../middleware/auth'); // ✅ Correct import

// Admin dashboard route
router.get("/admin-dashboard", verifyToken, checkRole("admin"), (req, res) => {
  res.json({ msg: "Welcome Admin" });
});

// Get all students
router.get('/students', verifyToken, isAdmin, async (req, res) => {
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
      teacherName
    } = req.query;

    const query = { role: 'STUDENT' };

    if (level) query.level = String(level).trim();
    if (plan) query.subscription = String(plan).trim().toUpperCase();
    if (batch) query.batch = String(batch).trim();
    if (studentStatus) query.studentStatus = String(studentStatus).trim().toUpperCase();
    if (studentName) query.name = { $regex: new RegExp(String(studentName).trim(), 'i') };

    if (teacherName) {
      const matchingTeachers = await User.find({
        role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
        name: { $regex: new RegExp(String(teacherName).trim(), 'i') }
      }).select('_id');

      const teacherIds = matchingTeachers.map((teacher) => teacher._id);
      query.assignedTeacher = { $in: teacherIds };
    }

    const total = await User.countDocuments(query);
    const students = await User.find(query)
      .select('-password') // exclude passwords
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'assignedTeacher',   // the field in User schema
        select: 'name regNo email medium' // fetch only useful teacher info
      });

    const pages = Math.max(1, Math.ceil(total / limit));
    res.json({
      success: true,
      data: students,
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
    console.log('📊 Student counts per teacher:', studentCounts);
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
      .select('topic batch startTime attendance attendanceRecorded status')
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
        attendanceRate
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
    const pastMeetings = mappedMeetings
      .filter((meeting) => meeting.startTime && new Date(meeting.startTime) < now)
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      .slice(0, 15);

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
          averageCourseDay: courseDayCount ? Math.round(courseDaySum / courseDayCount) : 0
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
    const courses = await Course.find({ students: req.params.studentId });
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

    if (updates.studentStatus) {
      updateData.studentStatus = updates.studentStatus;
    }

    if (updates.subscription) {
      updateData.subscription = updates.subscription;
    }

    if (updates.batch) {
      updateData.batch = updates.batch;
    }

    if (updates.currentCourseDay !== undefined && updates.currentCourseDay !== null) {
      const d = parseInt(String(updates.currentCourseDay), 10);
      if (!Number.isFinite(d) || d < 1 || d > 200) {
        return res.status(400).json({
          success: false,
          message: 'currentCourseDay must be a number from 1 to 200'
        });
      }
      updateData.currentCourseDay = d;
    }

    // Update all selected students
    const result = await User.updateMany(
      { _id: { $in: studentIds }, role: 'STUDENT' },
      { $set: updateData }
    );

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


module.exports = router;




