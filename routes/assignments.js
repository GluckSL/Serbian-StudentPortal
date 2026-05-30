// routes/assignments.js
const express = require('express');
const router = express.Router();
const AssignmentSubmission = require('../models/AssignmentSubmission');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');
const checkRole = require('../middleware/checkRole');
const assignmentUpload = require('../config/assignmentUpload');
const transporter = require('../config/emailConfig');
const Notification = require('../models/Notification');


// Helper to send email without blocking the main flow
async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.error('Error sending email:', err.message);
  }
}

// ========================
// Student: upload assignment
// ========================
router.post(
  '/student-upload',
  verifyToken,
  checkRole('STUDENT'),
  assignmentUpload.array('files', 5), // up to 5 files, field name: 'files'
  async (req, res) => {
    try {
      const studentId = req.user.id; // from JWT [file:103]
      const { courseId, moduleId, title, assignmentTemplateId } = req.body;

      const student = await User.findById(studentId).populate('assignedTeacher').lean();
      if (!student) {
        return res.status(404).json({ msg: 'Student not found' });
      }
      if (!student.assignedTeacher) {
        return res.status(400).json({ msg: 'No teacher assigned to this student' });
      }

      const teacher = student.assignedTeacher;

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ msg: 'No files uploaded' });
      }

      const files = req.files.map((file) => ({
        path: file.location,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      }));

      const submission = new AssignmentSubmission({
        studentId,
        teacherId: teacher._id,
        courseId: courseId || null,
        moduleId: moduleId || null,
        assignmentTemplateId: assignmentTemplateId || undefined,
        title: title || '',
        uploadedBy: 'STUDENT',
        files,
        status: 'SUBMITTED',
      });


      await submission.save();

      // Create notification for teacher
      await Notification.create({
        recipientId: teacher._id,
        actorId: student._id,
        type: 'ASSIGNMENT_SUBMITTED',
        assignmentId: submission._id,
        message: `Student ${student.name} (${student.regNo}) has uploaded a new assignment.`,
      });

      // Email notification to teacher
      if (teacher.email) {
        const html = `
      Hello ${teacher.name},

      Student

      **${student.name}** (${student.regNo}) has uploaded a new assignment.

      Title: ${submission.title || 'Untitled assignment'}

      Please log in to the teacher portal to review and correct it.`;

        // ✅ use helper
        sendEmail(teacher.email, 'New Assignment Submitted', html);
      }


      res.status(201).json({
        success: true,
        msg: 'Assignment submitted successfully',
        data: submission,
      });
    } catch (err) {
      console.error('Student assignment upload error:', err);
      res.status(500).json({ msg: 'Server error', error: err.message });
    }
  }
);

// ========================
// Teacher: upload on behalf of a student
// ========================
router.post(
  '/teacher-upload',
  verifyToken,
  checkRole(['TEACHER', 'TEACHER_ADMIN']),
  assignmentUpload.array('files', 5),
  async (req, res) => {
    try {
      const teacherId = req.user.id;
      const { studentId, courseId, moduleId, title } = req.body;

      const teacher = await User.findById(teacherId).lean();
      if (!teacher) {
        return res.status(404).json({ msg: 'Teacher not found' });
      }

      const student = await User.findById(studentId).lean();
      if (!student) {
        return res.status(404).json({ msg: 'Student not found' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ msg: 'No files uploaded' });
      }

      const files = req.files.map((file) => ({
        path: file.location,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      }));

      const submission = new AssignmentSubmission({
        studentId: student._id,
        teacherId: teacher._id,
        courseId: courseId || null,
        moduleId: moduleId || null,
        title: title || '',
        uploadedBy: 'TEACHER',
        files,
        status: 'SUBMITTED',
      });

      await submission.save();

      res.status(201).json({
        success: true,
        msg: 'Assignment uploaded for student successfully',
        data: submission,
      });
    } catch (err) {
      console.error('Teacher assignment upload error:', err);
      res.status(500).json({ msg: 'Server error', error: err.message });
    }
  }
);

// ========================
// Student: list own submissions
// ========================
router.get(
  '/student',
  verifyToken,
  checkRole('STUDENT'),
  async (req, res) => {
    try {
      const studentId = req.user.id;

      const submissions = await AssignmentSubmission.find({ studentId })
        .populate('teacherId', 'name email regNo')
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({ success: true, data: submissions });
    } catch (err) {
      console.error('Fetch student submissions error:', err);
      res.status(500).json({ msg: 'Server error', error: err.message });
    }
  }
);

// ========================
// Teacher: list submissions to correct
// ========================
router.get(
  '/teacher',
  verifyToken,
  checkRole(['TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const teacherId = req.user.id;
      const { status } = req.query; // optional filter

      const filter = { teacherId };
      if (status) {
        filter.status = status;
      }

      const submissions = await AssignmentSubmission.find(filter)
        .populate('studentId', 'name email regNo')
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({ success: true, data: submissions });
    } catch (err) {
      console.error('Fetch teacher submissions error:', err);
      res.status(500).json({ msg: 'Server error', error: err.message });
    }
  }
);

// ========================
// Teacher: correct assignment
// ========================
router.put(
  '/:id/mark',
  verifyToken,
  checkRole(['TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const teacherId = req.user.id;
      const { id } = req.params;
      const { marks, feedback, status } = req.body;

      const submission = await AssignmentSubmission.findById(id).populate('studentId');
      if (!submission) {
        return res.status(404).json({ msg: 'Submission not found' });
      }

      // Ensure this submission belongs to the logged-in teacher
      if (submission.teacherId.toString() !== teacherId) {
        return res.status(403).json({ msg: 'Not authorized to mark this submission' });
      }

      if (typeof marks !== 'undefined') submission.marks = marks;
      if (typeof feedback !== 'undefined') submission.feedback = feedback;
      if (status) submission.status = status;
      else submission.status = 'CORRECTED';

      await submission.save();

      // Email student about correction
      const student = submission.studentId;
      if (student && student.email) {
        const html = `
          <p>Hello ${student.name},</p>
          <p>Your assignment "${submission.title || 'Untitled assignment'}" has been corrected.</p>
          <p>Marks: ${submission.marks ?? 'N/A'}</p>
          <p>Feedback: ${submission.feedback || 'No feedback provided.'}</p>
        `;
        sendEmail(student.email, 'Assignment Corrected', html);
      }

      res.status(200).json({
        success: true,
        msg: 'Assignment marked successfully',
        data: submission,
      });
    } catch (err) {
      console.error('Mark assignment error:', err);
      res.status(500).json({ msg: 'Server error', error: err.message });
    }
  }
);


// Temporary in‑memory mock
const mockAssigned = [
  {
    id: 'exam1',
    title: 'A2 Writing Exam – Practice Paper 1',
    description: 'Write a formal email to your course coordinator.',
    dueDate: '2026-02-10T00:00:00.000Z',
    teacherName: 'Ms. Anna',
    // public URL or static path to the sample PDF
    fileUrl: '/uploads/mock-exams/a2-writing-exam-1.pdf',
    status: 'PENDING',
  },
  {
    id: 'exam2',
    title: 'B1 Reading Comprehension – Sample',
    description: 'Read the passage and answer the questions.',
    dueDate: '2026-02-15T00:00:00.000Z',
    teacherName: 'Mr. Max',
    fileUrl: '/uploads/mock-exams/b1-reading-sample.pdf',
    status: 'PENDING',
  },
];

// Student‑visible list
router.get('/student-assigned', (req, res) => {
  // later you can filter by student ID in req.user
  res.json({ data: mockAssigned });
});

module.exports = router;
