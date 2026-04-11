const express = require('express');
const router = express.Router();
const ClassDoubt = require('../models/ClassDoubt');
const MeetingLink = require('../models/MeetingLink');
const { verifyToken, checkRole } = require('../middleware/auth');

// POST /:meetingId  — student submits a doubt (only after class ended)
router.post('/:meetingId', verifyToken, checkRole(['STUDENT']), async (req, res) => {
  try {
    const meeting = await MeetingLink.findById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

    const now = new Date();
    const meetingEnd = new Date(new Date(meeting.startTime).getTime() + (meeting.duration || 60) * 60000);
    if (now < meetingEnd && meeting.status !== 'ended') {
      return res.status(400).json({ success: false, message: 'Doubts can only be submitted after the class ends' });
    }

    const { title, explanation, visibility } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }

    const doubt = await ClassDoubt.create({
      meetingId: meeting._id,
      askedBy: req.user.id,
      title: title.trim(),
      explanation: (explanation || '').trim(),
      visibility: visibility === 'private' ? 'private' : 'public'
    });

    const populated = await ClassDoubt.findById(doubt._id)
      .populate('askedBy', 'name email');

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    console.error('classDoubts create error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit doubt', error: err.message });
  }
});

// GET /:meetingId  — list doubts (public for all; private only for author + teacher)
router.get('/:meetingId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const isTeacher = ['TEACHER', 'TEACHER_ADMIN', 'ADMIN'].includes(userRole);

    let doubts = await ClassDoubt.find({ meetingId: req.params.meetingId })
      .populate('askedBy', 'name email')
      .populate('replies.repliedBy', 'name email role')
      .sort({ createdAt: -1 });

    if (!isTeacher) {
      doubts = doubts.filter(d =>
        d.visibility === 'public' || d.askedBy?._id?.toString() === userId
      );
    }

    res.json({ success: true, data: doubts });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch doubts', error: err.message });
  }
});

// POST /:doubtId/reply  — teacher replies to a doubt
router.post('/:doubtId/reply', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), async (req, res) => {
  try {
    const doubt = await ClassDoubt.findById(req.params.doubtId);
    if (!doubt) return res.status(404).json({ success: false, message: 'Doubt not found' });

    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Reply text is required' });
    }

    doubt.replies.push({ repliedBy: req.user.id, text: text.trim() });
    await doubt.save();

    const updated = await ClassDoubt.findById(doubt._id)
      .populate('askedBy', 'name email')
      .populate('replies.repliedBy', 'name email role');

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reply', error: err.message });
  }
});

// DELETE /:doubtId  — teacher/admin removes a doubt (e.g. test posts)
router.delete('/:doubtId', verifyToken, checkRole(['TEACHER', 'TEACHER_ADMIN', 'ADMIN']), async (req, res) => {
  try {
    const doubt = await ClassDoubt.findById(req.params.doubtId);
    if (!doubt) return res.status(404).json({ success: false, message: 'Doubt not found' });

    const meeting = await MeetingLink.findById(doubt.meetingId).select('assignedTeacher createdBy');
    if (!meeting) return res.status(404).json({ success: false, message: 'Meeting not found' });

    const uid = req.user.id;
    const role = req.user.role;
    const isAdmin = role === 'ADMIN' || role === 'TEACHER_ADMIN';
    const teacherId = meeting.assignedTeacher?.toString();
    const createdById = meeting.createdBy?.toString();
    const canDelete = isAdmin || teacherId === uid || createdById === uid;
    if (!canDelete) {
      return res.status(403).json({ success: false, message: 'You can only delete doubts for your own classes' });
    }

    await ClassDoubt.findByIdAndDelete(doubt._id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete doubt', error: err.message });
  }
});

module.exports = router;
