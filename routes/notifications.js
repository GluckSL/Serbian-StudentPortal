// routes/notifications.js
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const Notification = require('../models/Notification');

// GET /api/notifications?type=ASSIGNMENT_ASSIGNED (or other types)
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type } = req.query;

    const filter = { recipientId: userId };
    if (type) {
      filter.type = type;
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, data: notifications });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ ok: false, msg: 'Failed to fetch notifications' });
  }
});

// Mark all as read
router.patch('/mark-all/read', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    await Notification.updateMany(
      { recipientId: userId, isRead: { $ne: true } },
      { $set: { isRead: true } }
    );
    res.json({ ok: true, msg: 'All notifications marked as read' });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ ok: false, msg: 'Failed to update notifications' });
  }
});

// Single notification read (optional)
router.patch('/:id/read', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notif = await Notification.findOneAndUpdate(
      { _id: id, recipientId: userId },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notif) {
      return res.status(404).json({ ok: false, msg: 'Notification not found' });
    }

    res.json({ ok: true, data: notif });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ ok: false, msg: 'Failed to update notification' });
  }
});

module.exports = router;
