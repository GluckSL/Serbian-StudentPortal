const express = require('express');
const router = express.Router();
const GluckRoomChatMessage = require('../models/GluckRoomChatMessage');
const GluckRoomSession = require('../models/GluckRoomSession');
const { verifyToken } = require('../middleware/auth');

function getUserId(req) {
  return req.user?.id || req.user?.userId || req.user?._id;
}

// GET /api/gluckroom/chat/:sessionId — Fetch recent chat messages
router.get('/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
    const before = req.query.before ? new Date(req.query.before) : new Date();

    const session = await GluckRoomSession.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const messages = await GluckRoomChatMessage.find({
      sessionId,
      createdAt: { $lt: before },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    messages.reverse();

    res.json({ success: true, data: messages });
  } catch (err) {
    console.error('Get chat messages error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/gluckroom/chat/:sessionId — Send a chat message
router.post('/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    if (message.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message too long (max 2000 chars)' });
    }

    const session = await GluckRoomSession.findById(sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    const userId = getUserId(req);
    const user = await require('../models/User').findById(userId).select('name role');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const roleMap = {
      STUDENT: 'student',
      TEACHER: 'teacher',
      ADMIN: 'admin',
      TEACHER_ADMIN: 'teacher_admin',
      SUB_ADMIN: 'sub_admin',
    };

    const msg = await GluckRoomChatMessage.create({
      sessionId,
      userId,
      userName: user.name,
      userRole: roleMap[user.role] || 'student',
      message: message.trim(),
    });

    res.status(201).json({ success: true, data: msg });
  } catch (err) {
    console.error('Send chat message error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
