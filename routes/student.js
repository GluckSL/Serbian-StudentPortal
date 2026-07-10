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

    // Run all independent queries in parallel instead of sequentially
    const [student, subscriptions, enrolledCourseIds] = await Promise.all([
      User.findById(studentId).select('-password').lean(),
      Subscription.find({ userId: studentId }).lean(),
      CourseProgress.find({ studentId }).distinct('courseId'),
    ]);

    const enrolledCourses = enrolledCourseIds.length
      ? await Courses.find({ _id: { $in: enrolledCourseIds } }).lean()
      : [];

    return res.status(200).json({
      success: true,
      data: {
        profile: student,
        subscriptions,
        enrolledCourses,
        vapiAccess: student?.vapiAccess || null,
      },
    });
  } catch (err) {
    console.error('Error fetching student dashboard data:', err);
    res.status(500).json({ success: false, message: 'Greška pri dohvatanju podataka kontrolne table', error: err.message });
  }
});

// GET /api/student/vapi-courses
router.get('/vapi-courses', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ userId: req.user.id }).lean();

    if (!subscription || subscription.courses.length === 0) {
      return res.status(200).json([]);
    }

    res.status(200).json( success, subscription.courses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Greška servera pri dohvatanju VAPI kurseva' });
  }
});

// View own active subscriptions - GET /api/subscriptions/me
router.get("/me", verifyToken, checkRole("STUDENT"), async (req, res) => {
  try {
    const subs = await Subscription.find({ userId: req.user.id }).lean();
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
      .populate('assignedCourses.courseId', 'name language level')
      .lean();

    if (!user) {
      return res.status(404).json({ msg: 'Učenik nije pronađen' });
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
    res.status(500).json({ msg: 'Greška pri dohvatanju profila učenika', error: err.message });
  }
});


// ✅ Get course progress for current student
router.get('/course-progress', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate('courseProgress.courseId', 'name').lean();
    if (!user) return res.status(404).json({ msg: 'Učenik nije pronađen' });

    res.status(200).json(user.courseProgress);
  } catch (err) {
    console.error('Fetch progress error:', err);
    res.status(500).json({ msg: 'Greška pri dohvatanju napretka u kursu' });
  }
});

// ✅ GET /api/student/progress - Get course progress for logged-in student
router.get('/progress', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const studentId = req.user.id;
    const progress = await CourseProgress.find({ studentId }).populate('courseId', 'name').lean();

    res.status(200).json(progress);
  } catch (err) {
    console.error('Error fetching course progress:', err);
    res.status(500).json({ msg: 'Greška servera pri dohvatanju napretka u kursu' });
  }
});

// ✅ Update course progress
router.put('/course-progress', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const { courseId, progressPercent } = req.body;

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ msg: 'Učenik nije pronađen' });

    const existing = user.courseProgress.find(cp => cp.courseId.toString() === courseId);
    if (existing) {
      existing.progressPercent = progressPercent;
      existing.lastUpdated = new Date();
    } else {
      user.courseProgress.push({ courseId, progressPercent });
    }

    await user.save();
    res.status(200).json({ msg: 'Napredak ažuriran', courseProgress: user.courseProgress });
  } catch (err) {
    console.error('Course progress update error:', err);
    res.status(500).json({ msg: 'Greška pri ažuriranju napretka u kursu' });
  }
});


module.exports = router;
