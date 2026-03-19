// routes/student.js

const express = require('express');
const router = express.Router();

const Subscription = require('../models/subscriptions');
const User = require('../models/User'); // for fetching student info
const authMiddleware = require('../middleware/auth'); // JWT auth middleware
const { verifyToken, checkRole } = require('../middleware/auth');
const Courses = require('../models/Course');

const CourseProgress = require('../models/CourseProgress');

// ✅ Combined dashboard data route
router.get('/dashboard', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const studentId = req.user.id;

    // 1. Get student profile
    const student = await User.findById(studentId).select('-password');

    // 2. Get subscriptions
    const subscriptions = await Subscription.find({ userId: studentId });

    // 3. Get enrolled courses (if Course model uses "students: [ObjectId]" structure)
    const enrolledCourses = await Course.find({ students: studentId });

    // 4. VAPI access is part of student profile (in vapiAccess field)

    return res.status(200).json({
      success: true,
      data: {
        profile: student,
        subscriptions,
        enrolledCourses,
        vapiAccess: student.vapiAccess || null,
      },
    });
  } catch (err) {
    console.error('Error fetching student dashboard data:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard data', error: err.message });
  }
});

// GET /api/student/vapi-courses
router.get('/vapi-courses', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ userId: req.user.id });

    if (!subscription || subscription.courses.length === 0) {
      return res.status(200).json([]);
    }

    res.status(200).json( success, subscription.courses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error while fetching VAPI courses' });
  }
});

// View own active subscriptions - GET /api/subscriptions/me
router.get("/me", verifyToken, checkRole("STUDENT"), async (req, res) => {
  try {
    const subs = await Subscription.find({ userId: req.user.id });
    res.status(200).json(subs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ GET /api/student/profile - Get current student's profile
router.get('/profile', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const user = await User.findById(req.userId)
      .select('-password')
      .populate('assignedCourses.courseId', 'name language level');

    if (!user) {
      return res.status(404).json({ msg: 'Student not found' });
    }

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      level: user.level,
      subscription: user.subscription,
      profilePhoto: user.profilePhoto,
      registeredAt: user.registeredAt,
      subscriptionPlan: user.subscriptionPlan || null,
      assignedCourses: user.assignedCourses || [],
      vapiAccess: user.vapiAccess || null,
      preferredVoiceAgent: user.preferredVoiceAgent || null
    });
  } catch (err) {
    console.error('Student profile error:', err);
    res.status(500).json({ msg: 'Error retrieving student profile', error: err.message });
  }
});


// ✅ Get course progress for current student
router.get('/course-progress', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('courseProgress.courseId', 'name');
    if (!user) return res.status(404).json({ msg: 'Student not found' });

    res.status(200).json(user.courseProgress);
  } catch (err) {
    console.error('Fetch progress error:', err);
    res.status(500).json({ msg: 'Failed to fetch course progress' });
  }
});

// ✅ GET /api/student/progress - Get course progress for logged-in student
router.get('/progress', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const studentId = req.user.id;
    const progress = await CourseProgress.find({ studentId }).populate('courseId', 'name');

    res.status(200).json(progress);
  } catch (err) {
    console.error('Error fetching course progress:', err);
    res.status(500).json({ msg: 'Server error fetching course progress' });
  }
});

// ✅ Update course progress
router.put('/course-progress', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const { courseId, progressPercent } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ msg: 'Student not found' });

    const existing = user.courseProgress.find(cp => cp.courseId.toString() === courseId);
    if (existing) {
      existing.progressPercent = progressPercent;
      existing.lastUpdated = new Date();
    } else {
      user.courseProgress.push({ courseId, progressPercent });
    }

    await user.save();
    res.status(200).json({ msg: 'Progress updated', courseProgress: user.courseProgress });
  } catch (err) {
    console.error('Course progress update error:', err);
    res.status(500).json({ msg: 'Failed to update course progress' });
  }
});


module.exports = router;
