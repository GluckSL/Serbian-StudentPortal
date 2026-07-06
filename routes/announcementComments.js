const express = require('express');
const Announcement = require('../models/Announcement');
const AnnouncementComment = require('../models/AnnouncementComment');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const STAFF_ROLES = ['ADMIN', 'TEACHER_ADMIN', 'TEACHER'];

function isStaff(role) {
  return STAFF_ROLES.includes(String(role || '').toUpperCase());
}

// ── List comments ──────────────────────────────────────────────────────────
// Everyone sees all comments, newest first. Paginated.
router.get('/announcements/:announcementId/comments', verifyToken, async (req, res) => {
  try {
    const { announcementId } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const baseFilter = { announcementId };

    const total = await AnnouncementComment.countDocuments(baseFilter);
    const comments = await AnnouncementComment.find(baseFilter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('userId', 'name role profilePic')
      .lean();

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return res.json({
      success: true,
      data: comments,
      pagination: { total, page, limit, totalPages }
    });
  } catch (error) {
    console.error('announcementComments GET failed', error);
    return res.status(500).json({ success: false, message: 'Failed to load comments.' });
  }
});

// ── Create comment ─────────────────────────────────────────────────────────
// Anyone authenticated can post a top-level comment.
// Only TEACHER/ADMIN/TEACHER_ADMIN can set parentCommentId (staff reply).
router.post('/announcements/:announcementId/comments', verifyToken, async (req, res) => {
  try {
    const { announcementId } = req.params;
    const text = String(req.body.text || '').trim();
    const parentCommentId = req.body.parentCommentId || null;

    const announcement = await Announcement.findById(announcementId).select('isActive').lean();
    if (!announcement) {
      return res.status(404).json({ success: false, message: 'Announcement not found.' });
    }
    if (!announcement.isActive) {
      return res.status(400).json({ success: false, message: 'Cannot comment on an inactive announcement.' });
    }

    if (!text) {
      return res.status(400).json({ success: false, message: 'Comment text is required.' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ success: false, message: 'Comment must be under 2000 characters.' });
    }

    const user = await User.findById(req.user.id).select('role').lean();
    const role = String(user.role || '').toUpperCase();

    if (parentCommentId) {
      if (!isStaff(role)) {
        return res.status(403).json({
          success: false,
          message: 'Only teachers and admins can reply to comments.'
        });
      }
      const parentExists = await AnnouncementComment.findOne({
        _id: parentCommentId,
        announcementId
      }).lean();
      if (!parentExists) {
        return res.status(404).json({ success: false, message: 'Parent comment not found.' });
      }
    }

    const comment = await AnnouncementComment.create({
      announcementId,
      userId: req.user.id,
      text,
      parentCommentId: parentCommentId || null
    });

    const populated = await AnnouncementComment.findById(comment._id)
      .populate('userId', 'name role profilePic')
      .lean();

    return res.status(201).json({ success: true, data: populated });
  } catch (error) {
    console.error('announcementComments POST failed', error);
    return res.status(500).json({ success: false, message: 'Failed to create comment.' });
  }
});

// ── Delete comment ─────────────────────────────────────────────────────────
// Author can delete own comment.
// STAFF (ADMIN / TEACHER_ADMIN / TEACHER) can delete any comment.
router.delete('/announcements/:announcementId/comments/:commentId', verifyToken, async (req, res) => {
  try {
    const { announcementId, commentId } = req.params;

    const comment = await AnnouncementComment.findOne({
      _id: commentId,
      announcementId
    }).lean();

    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found.' });
    }

    const user = await User.findById(req.user.id).select('role').lean();
    const role = String(user.role || '').toUpperCase();
    const isOwner = String(comment.userId) === String(req.user.id);
    const isStaffUser = isStaff(role);

    if (!isOwner && !isStaffUser) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this comment.' });
    }

    await AnnouncementComment.deleteOne({ _id: commentId });

    if (isStaffUser) {
      await AnnouncementComment.deleteMany({ parentCommentId: commentId });
    }

    return res.json({ success: true, message: 'Comment deleted.' });
  } catch (error) {
    console.error('announcementComments DELETE failed', error);
    return res.status(500).json({ success: false, message: 'Failed to delete comment.' });
  }
});

module.exports = router;
