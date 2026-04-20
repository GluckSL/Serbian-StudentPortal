/**
 * routes/allReminders.js
 *
 * GET /api/allreminders
 * CRM-facing endpoint that returns every reminder with full detail:
 *   - title, body, batch, deliveryMode, scheduledFor, isActive
 *   - recipients (name, phone, regNo, messageBody, status, scheduledFor, sentAt)
 *   - scheduledClasses linked to recipients (topic, startTime, platform, joinUrl)
 *   - createdBy (admin/teacher who created the reminder)
 *   - batchTeachers (all teachers assigned to the target batch)
 */

const express = require('express');
const router = express.Router();

const Reminder = require('../models/Reminder');
const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');

const { crmTokenAuth } = require('../middleware/crmTokenAuth');

const ACTIVE_STATUSES = new Set(['queued', 'scheduled', 'in_progress']);

// GET /api/allreminders
router.get('/', crmTokenAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');

    const reminders = await Reminder.find()
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name email role phone whatsappNumber phoneNumber')
      .lean();

    if (!reminders.length) {
      return res.json({ success: true, count: 0, data: [] });
    }

    // Collect all unique batch names to fetch teachers in one query
    const batchNames = [...new Set(reminders.map((r) => r.targetBatch).filter(Boolean))];

    // Collect all unique meetingIds referenced in recipients
    const meetingIdSet = new Set();
    for (const reminder of reminders) {
      for (const recipient of reminder.recipients || []) {
        if (recipient.meetingId) meetingIdSet.add(String(recipient.meetingId));
      }
    }

    // Fetch batch teachers and meetings in parallel
    const [teacherRows, meetingRows] = await Promise.all([
      User.find({
        role: { $in: ['TEACHER', 'TEACHER_ADMIN'] },
        batch: { $in: batchNames }
      })
        .select('name email role phone whatsappNumber phoneNumber batch')
        .lean(),

      meetingIdSet.size > 0
        ? MeetingLink.find({ _id: { $in: [...meetingIdSet] } })
            .select('_id topic startTime duration platform joinUrl batch courseDay plan')
            .lean()
        : Promise.resolve([])
    ]);

    // Build lookup maps
    const teachersByBatch = {};
    for (const t of teacherRows) {
      const key = String(t.batch || '');
      if (!teachersByBatch[key]) teachersByBatch[key] = [];
      teachersByBatch[key].push({
        _id: t._id,
        name: t.name || '',
        email: t.email || '',
        role: t.role || '',
        phone: t.whatsappNumber || t.phoneNumber || t.phone || ''
      });
    }

    const meetingsById = {};
    for (const m of meetingRows) {
      meetingsById[String(m._id)] = {
        _id: m._id,
        topic: m.topic || '',
        startTime: m.startTime || null,
        duration: m.duration || null,
        platform: m.platform || '',
        joinUrl: m.joinUrl || '',
        batch: m.batch || '',
        courseDay: m.courseDay || null,
        plan: m.plan || ''
      };
    }

    // Collect all studentIds for regNo lookup
    const studentIdSet = new Set();
    for (const reminder of reminders) {
      for (const r of reminder.recipients || []) {
        if (r.studentId) studentIdSet.add(String(r.studentId));
      }
    }

    const studentRows = studentIdSet.size > 0
      ? await User.find({ _id: { $in: [...studentIdSet] } })
          .select('_id regNo level studentStatus')
          .lean()
      : [];

    const studentsById = {};
    for (const s of studentRows) {
      studentsById[String(s._id)] = { regNo: s.regNo || '', level: s.level || '', studentStatus: s.studentStatus || '' };
    }

    // Assemble final response
    const data = reminders.map((reminder) => {
      const batchTeachers = teachersByBatch[String(reminder.targetBatch || '')] || [];

      const recipients = (reminder.recipients || []).map((r) => {
        const studentMeta = studentsById[String(r.studentId)] || {};
        const scheduledClass = r.meetingId ? (meetingsById[String(r.meetingId)] || null) : null;

        return {
          _id: r._id,
          studentId: r.studentId,
          name: r.name || '',
          phone: r.phone || '',
          regNo: studentMeta.regNo || '',
          level: studentMeta.level || '',
          studentStatus: studentMeta.studentStatus || '',
          messageBody: r.messageBody || '',
          status: r.status || 'queued',
          scheduledFor: r.scheduledFor || null,
          sentAt: r.sentAt || null,
          error: r.error || '',
          isTestAccount: !!r.isTestAccount,
          scheduledClass
        };
      });

      return {
        _id: reminder._id,
        title: reminder.title || '',
        body: reminder.body || '',
        targetBatch: reminder.targetBatch || '',
        deliveryMode: reminder.deliveryMode || 'instant',
        scheduledFor: reminder.scheduledFor || null,
        status: reminder.status || 'queued',
        isActive: ACTIVE_STATUSES.has(reminder.status),
        totalRecipients: reminder.totalRecipients || 0,
        sentCount: reminder.sentCount || 0,
        failedCount: reminder.failedCount || 0,
        pendingCount: reminder.pendingCount || 0,
        createdBy: reminder.createdBy
          ? {
              _id: reminder.createdBy._id,
              name: reminder.createdBy.name || '',
              email: reminder.createdBy.email || '',
              role: reminder.createdBy.role || ''
            }
          : null,
        batchTeachers,
        recipients,
        createdAt: reminder.createdAt,
        updatedAt: reminder.updatedAt
      };
    });

    return res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[allReminders] GET /', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch reminders.' });
  }
});

module.exports = router;
