//routes/admin.js

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Subscription = require('../models/subscriptions');
const User = require('../models/User');
//const auth = require('../middleware/auth');
const { verifyToken, isAdmin, checkRole } = require('../middleware/auth'); // ✅ Correct import

// Admin dashboard route
router.get("/admin-dashboard", verifyToken, checkRole("admin"), (req, res) => {
  res.json({ msg: "Welcome Admin" });
});

// Get all students
router.get('/students', verifyToken, isAdmin, async (req, res) => {
  try {
    const students = await User.find({ role: 'STUDENT' })
      .select('-password') // exclude passwords
      .populate({
        path: 'assignedTeacher',   // the field in User schema
        select: 'name regNo email medium' // fetch only useful teacher info
      });

    res.json({ success: true, data: students });
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




