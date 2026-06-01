const PaymentNotification = require('../models/Notification');
const journeyDueService = require('../services/journeyLanguageFeeDueService');

const ADMIN_ROLES = ['ADMIN', 'TEACHER_ADMIN', 'SUPER_ADMIN', 'SUB_ADMIN'];

const listMine = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toUpperCase();
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { page = 1, limit = 50, unreadOnly, type } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const filter = { recipientId: req.user.id };
    if (String(unreadOnly) === 'true') filter.isRead = false;
    if (type && String(type).trim()) filter.type = String(type).trim();

    const unreadFilter = { recipientId: req.user.id, isRead: false };
    if (type && String(type).trim()) unreadFilter.type = String(type).trim();

    const [items, total, unreadCount] = await Promise.all([
      PaymentNotification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).lean(),
      PaymentNotification.countDocuments(filter),
      PaymentNotification.countDocuments(unreadFilter),
    ]);

    res.json({
      success: true,
      data: items,
      total,
      unreadCount,
      page: Number(page),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const unreadCount = async (req, res) => {
  try {
    const role = String(req.user?.role || '').toUpperCase();
    if (!ADMIN_ROLES.includes(role)) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    const filter = { recipientId: req.user.id, isRead: false };
    if (req.query.type && String(req.query.type).trim()) {
      filter.type = String(req.query.type).trim();
    }
    const count = await PaymentNotification.countDocuments(filter);
    res.json({ success: true, data: { count } });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const markRead = async (req, res) => {
  try {
    const updated = await PaymentNotification.findOneAndUpdate(
      { _id: req.params.id, recipientId: req.user.id },
      { $set: { isRead: true } },
      { new: true },
    );
    if (!updated) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const markAllRead = async (req, res) => {
  try {
    await PaymentNotification.updateMany(
      { recipientId: req.user.id, isRead: false },
      { $set: { isRead: true } },
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

const runJourneyDueSync = async (req, res) => {
  try {
    const result = await journeyDueService.syncAllEligibleStudents();
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};

module.exports = { listMine, unreadCount, markRead, markAllRead, runJourneyDueSync };
