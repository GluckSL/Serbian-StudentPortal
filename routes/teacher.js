//routes/teacher.js

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');
const { verifyToken, checkRole } = require('../middleware/auth');

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



