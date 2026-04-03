// routes/assignmentTemplates.js
const express = require('express');
const router = express.Router();

const AssignmentTemplate = require('../models/AssignmentTemplates');
const { verifyToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const assignmentUpload = require('../config/assignmentUpload');
const Notification = require('../models/Notification');

const User = require('../models/User');

// ============ TEACHER: create assignment template (question paper) ============
router.post(
  '/',
  verifyToken,
  checkRole('TEACHER'),
  assignmentUpload.array('files', 5),
  async (req, res) => {
    try {
      const teacherId = req.user.id;
      const { courseId, moduleId, title, description, dueDate } = req.body;

      if (!title) {
        return res.status(400).json({ ok: false, msg: 'Title is required' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ ok: false, msg: 'At least one file is required' });
      }

      const files = req.files.map((f) => ({
        path: f.location, // S3 URL from multer-s3
        originalName: f.originalname,
        mimeType: f.mimetype,
        size: f.size,
      }));

      const template = new AssignmentTemplate({
        teacherId,
        courseId: courseId || undefined,
        moduleId: moduleId || undefined,
        title,
        description,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        files,
      });

      await template.save();

      const studentsToNotify = await User.find({
        role: 'STUDENT',
        assignedTeacher: teacherId,
      }).select('_id name regNo');

      if (studentsToNotify.length) {
        const notifications = studentsToNotify.map((student) => ({
          recipientId: student._id,
          actorId: teacherId,
          type: 'ASSIGNMENT_ASSIGNED',
          assignmentId: template._id,
          message: `New assignment: "${template.title}" has been assigned to you.`,
        }));

        await Notification.insertMany(notifications);
      }

      res.status(201).json({ ok: true, data: template });
    } catch (err) {
      console.error('Error creating assignment template:', err);
      res.status(500).json({ ok: false, msg: 'Failed to create assignment template' });
    }
  }
);

// ============ STUDENT: list available assignments for a module/course ============
router.get('/', verifyToken, async (req, res) => {
  try {
    const { courseId, moduleId, activeOnly } = req.query;

    const filter = {};
    if (courseId) filter.courseId = courseId;
    if (moduleId) filter.moduleId = moduleId;
    if (activeOnly === 'true') filter.isActive = true;

    // Optionally also filter by the student's assignedTeacher later
    const templates = await AssignmentTemplate.find(filter)
      .populate('teacherId', 'name regNo email')
      .sort({ createdAt: -1 });

    res.json({ ok: true, data: templates });
  } catch (err) {
    console.error('Error fetching assignment templates:', err);
    res.status(500).json({ ok: false, msg: 'Failed to fetch assignment templates' });
  }
});

module.exports = router;
