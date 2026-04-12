const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const classSubmissionUpload = require('../config/classSubmissionUpload');
const ClassSubmission = require('../models/ClassSubmission');
const MeetingLink = require('../models/MeetingLink');
const { verifyToken, checkRole } = require('../middleware/auth');
const { presignStoredS3Url } = require('../config/presign');

const uploadSingle = classSubmissionUpload.single('file');

// Helper: presign a submission's fileUrl in-place
async function presignSubmission(sub) {
  if (sub.fileUrl) {
    sub.fileUrl = await presignStoredS3Url(sub.fileName, sub.fileUrl);
  }
  return sub;
}

// POST /:meetingId/upload — student uploads an answer file
// Allowed only when class is live or has ended
router.post('/:meetingId/upload', verifyToken, checkRole(['STUDENT']), (req, res, next) => {
  uploadSingle(req, res, (err) => {
    if (err) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ success: false, message: err.message || 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const meeting = await MeetingLink.findById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

    // Allow upload during live class OR after class has ended
    const now = new Date();
    const startTime = new Date(meeting.startTime);
    const meetingEnd = new Date(startTime.getTime() + (meeting.duration || 60) * 60000);
    const isLive = now >= startTime && now <= meetingEnd;
    const hasEnded = meeting.status === 'ended' || now > meetingEnd;

    if (!isLive && !hasEnded) {
      return res.status(400).json({ success: false, message: 'Answers can only be uploaded during or after the class' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const f = req.file;
    const doc = await ClassSubmission.create({
      meetingId: meeting._id,
      studentId: req.user.id,
      fileName: f.key || f.filename,
      originalName: f.originalname,
      fileUrl: f.location || f.path,
      fileSize: f.size,
      mimeType: f.mimetype,
      caption: (req.body.caption || '').trim().slice(0, 500),
      feedback: {}
    });

    const populated = await ClassSubmission.findById(doc._id)
      .populate('studentId', 'name email')
      .populate('feedback.reviewedBy', 'name')
      .lean();

    await presignSubmission(populated);
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    console.error('classSubmissions upload error:', err);
    res.status(500).json({ success: false, message: 'Upload failed', error: err.message });
  }
});

// GET /:meetingId — list submissions
// Students see only their own; teachers/admin see all
router.get('/:meetingId', verifyToken, async (req, res) => {
  try {
    const { meetingId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(meetingId)) {
      return res.status(400).json({ success: false, message: 'Invalid meeting id' });
    }

    const isTeacher = ['TEACHER', 'TEACHER_ADMIN', 'ADMIN'].includes(req.user.role);
    const filter = { meetingId };
    if (!isTeacher) filter.studentId = req.user.id;

    const submissions = await ClassSubmission.find(filter)
      .populate('studentId', 'name email')
      .populate('feedback.reviewedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    await Promise.all(submissions.map(presignSubmission));
    res.json({ success: true, data: submissions });
  } catch (err) {
    console.error('classSubmissions list error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch submissions', error: err.message });
  }
});

// PUT /:submissionId/review — teacher marks correct/wrong + optional comment
router.put('/:submissionId/review', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), async (req, res) => {
  try {
    const { submissionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(submissionId)) {
      return res.status(400).json({ success: false, message: 'Invalid submission id' });
    }

    const { status, comment } = req.body;
    if (!['correct', 'wrong'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be "correct" or "wrong"' });
    }

    const submission = await ClassSubmission.findById(submissionId);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    submission.feedback.status = status;
    submission.feedback.comment = (comment || '').trim().slice(0, 1000);
    submission.feedback.reviewedBy = req.user.id;
    submission.feedback.reviewedAt = new Date();
    await submission.save();

    const updated = await ClassSubmission.findById(submission._id)
      .populate('studentId', 'name email')
      .populate('feedback.reviewedBy', 'name')
      .lean();

    await presignSubmission(updated);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error('classSubmissions review error:', err);
    res.status(500).json({ success: false, message: 'Failed to save review', error: err.message });
  }
});

// DELETE /:submissionId — teacher/admin removes a submission
router.delete('/:submissionId', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), async (req, res) => {
  try {
    const { submissionId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(submissionId)) {
      return res.status(400).json({ success: false, message: 'Invalid submission id' });
    }

    const submission = await ClassSubmission.findById(submissionId);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    await ClassSubmission.findByIdAndDelete(submissionId);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    console.error('classSubmissions delete error:', err);
    res.status(500).json({ success: false, message: 'Delete failed', error: err.message });
  }
});

module.exports = router;
