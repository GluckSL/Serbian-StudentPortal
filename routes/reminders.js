/**
 * routes/reminders.js
 *
 * Two groups of endpoints:
 *  1. Admin endpoints  — JWT auth, roles ADMIN / TEACHER_ADMIN
 *  2. CRM poller endpoints — X-CRM-Token header matching REMINDERS_CRM_TOKEN env var
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');

const ReminderTemplate = require('../models/ReminderTemplate');
const Reminder = require('../models/Reminder');
const User = require('../models/User');
const MeetingLink = require('../models/MeetingLink');

const { verifyToken, checkRole } = require('../middleware/auth');
const { crmTokenAuth } = require('../middleware/crmTokenAuth');

const router = express.Router();

// ─── Upload config (same approach as routes/announcements.js) ───────────────

const uploadsDir = path.join(__dirname, '..', 'uploads', 'reminders');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || 'attachment')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip'
]);

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) return cb(null, true);
    return cb(new Error('Unsupported file type'));
  }
});

function unlinkIfExists(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[reminders] failed to remove attachment', { filePath, error: err.message });
    }
  });
}

// ─── Placeholder rendering ───────────────────────────────────────────────────

/**
 * Render template placeholders for a specific student + optional upcoming class.
 */
function renderMessage(body, { studentName = '', batch = '', classTime = '', classDate = '', topic = '' } = {}) {
  return body
    .replace(/\{\{studentName\}\}/g, studentName)
    .replace(/\{\{batch\}\}/g, batch)
    .replace(/\{\{classTime\}\}/g, classTime)
    .replace(/\{\{classDate\}\}/g, classDate)
    .replace(/\{\{topic\}\}/g, topic);
}

function formatTime(date) {
  if (!date) return '';
  try {
    return new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' });
  } catch { return ''; }
}

function formatDate(date) {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' });
  } catch { return ''; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeBatchKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\bbatch\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN — TEMPLATE CRUD
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/reminders/templates
router.get('/templates', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const templates = await ReminderTemplate.find({ isActive: true })
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name role')
      .lean();
    res.json({ success: true, data: templates });
  } catch (err) {
    console.error('[reminders] GET /templates', err);
    res.status(500).json({ success: false, message: 'Failed to load templates.' });
  }
});

// POST /api/reminders/templates
router.post(
  '/templates',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  upload.array('attachments', 5),
  async (req, res) => {
    try {
      const title = String(req.body.title || '').trim();
      const body = String(req.body.body || '').trim();

      if (!title || !body) {
        return res.status(400).json({ success: false, message: 'Title and body are required.' });
      }

      const attachments = (req.files || []).map((file) => ({
        fileName: file.originalname,
        fileUrl: `/uploads/reminders/${file.filename}`,
        mimeType: file.mimetype,
        fileSize: file.size
      }));

      const template = await ReminderTemplate.create({ title, body, attachments, createdBy: req.user.id });
      const populated = await ReminderTemplate.findById(template._id).populate('createdBy', 'name role').lean();
      return res.status(201).json({ success: true, data: populated });
    } catch (err) {
      console.error('[reminders] POST /templates', err);
      return res.status(500).json({ success: false, message: 'Failed to create template.' });
    }
  }
);

// PUT /api/reminders/templates/:id
router.put('/templates/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const title = String(req.body.title || '').trim();
    const body = String(req.body.body || '').trim();

    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Title and body are required.' });
    }

    const updated = await ReminderTemplate.findByIdAndUpdate(
      id,
      { $set: { title, body } },
      { new: true, runValidators: true }
    ).populate('createdBy', 'name role').lean();

    if (!updated) return res.status(404).json({ success: false, message: 'Template not found.' });
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error('[reminders] PUT /templates/:id', err);
    return res.status(500).json({ success: false, message: 'Failed to update template.' });
  }
});

// DELETE /api/reminders/templates/:id (soft delete)
router.delete('/templates/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const template = await ReminderTemplate.findById(id).lean();
    if (!template) return res.status(404).json({ success: false, message: 'Template not found.' });

    await ReminderTemplate.findByIdAndUpdate(id, { $set: { isActive: false } });

    for (const att of template.attachments || []) {
      const fileUrl = String(att?.fileUrl || '');
      if (!fileUrl.startsWith('/uploads/reminders/')) continue;
      unlinkIfExists(path.join(uploadsDir, path.basename(fileUrl)));
    }

    return res.json({ success: true, message: 'Template deleted.' });
  } catch (err) {
    console.error('[reminders] DELETE /templates/:id', err);
    return res.status(500).json({ success: false, message: 'Failed to delete template.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN — BATCH PREVIEW
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/reminders/batch/:batchName/preview
router.get('/batch/:batchName/preview', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const batchName = String(req.params.batchName || '').trim();
    if (!batchName) return res.status(400).json({ success: false, message: 'batchName is required.' });

    const [students, meetings] = await Promise.all([
      User.find({ role: 'STUDENT', batch: batchName })
        .select('name regNo whatsappNumber phoneNumber level studentStatus isTestAccount')
        .sort({ name: 1 })
        .lean(),

      MeetingLink.find({
        batch: new RegExp(`^${batchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        status: { $in: ['scheduled', 'started'] }
      })
        .select('topic startTime duration batch plan platform joinUrl courseDay')
        .sort({ startTime: 1 })
        .limit(20)
        .lean()
    ]);

    const mappedStudents = students.map((s) => ({
      _id: s._id,
      name: s.name || '',
      regNo: s.regNo || '',
      phone: s.whatsappNumber || s.phoneNumber || '',
      level: s.level || '',
      studentStatus: s.studentStatus || '',
      isTestAccount: !!s.isTestAccount
    }));

    return res.json({ success: true, data: { students: mappedStudents, meetings } });
  } catch (err) {
    console.error('[reminders] GET /batch/:batchName/preview', err);
    return res.status(500).json({ success: false, message: 'Failed to load batch preview.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN — REMINDER CRUD + ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/reminders  — history list
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const reminders = await Reminder.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('createdBy', 'name role')
      .populate('templateId', 'title')
      .select('-recipients') // exclude heavy sub-docs from list view
      .lean();
    return res.json({ success: true, data: reminders });
  } catch (err) {
    console.error('[reminders] GET /', err);
    return res.status(500).json({ success: false, message: 'Failed to load reminders.' });
  }
});

// GET /api/reminders/:id  — single reminder with full recipients
router.get('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const id = String(req.params.id || '').trim();
    const reminder = await Reminder.findById(id)
      .populate('createdBy', 'name role')
      .populate('templateId', 'title')
      .lean();
    if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found.' });
    return res.json({ success: true, data: reminder });
  } catch (err) {
    console.error('[reminders] GET /:id', err);
    return res.status(500).json({ success: false, message: 'Failed to load reminder.' });
  }
});

// POST /api/reminders  — create + fan out recipients
router.post('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const {
      templateId,
      title: bodyTitle,
      body: bodyBody,
      targetBatch,
      deliveryMode: rawDeliveryMode,
      scheduleScope: rawScheduleScope,
      meetingIds: rawMeetingIds
    } = req.body;

    let resolvedTitle = String(bodyTitle || '').trim();
    let resolvedBody = String(bodyBody || '').trim();
    let resolvedAttachments = [];
    const deliveryMode = String(rawDeliveryMode || 'instant').trim().toLowerCase() === 'scheduled' ? 'scheduled' : 'instant';
    const scopeRaw = String(rawScheduleScope || 'one').trim().toLowerCase();
    const scheduleScope = scopeRaw === 'all' || scopeRaw === 'multi' ? scopeRaw : 'one';

    if (templateId) {
      const tpl = await ReminderTemplate.findOne({ _id: templateId, isActive: true }).lean();
      if (!tpl) return res.status(404).json({ success: false, message: 'Template not found.' });
      resolvedTitle = resolvedTitle || tpl.title;
      resolvedBody = resolvedBody || tpl.body;
      resolvedAttachments = tpl.attachments || [];
    }

    if (!resolvedTitle || !resolvedBody) {
      return res.status(400).json({ success: false, message: 'Title and body are required.' });
    }
    if (!targetBatch || !String(targetBatch).trim()) {
      return res.status(400).json({ success: false, message: 'targetBatch is required.' });
    }

    const batchName = String(targetBatch).trim();

    // Fetch students for this batch
    const students = await User.find({ role: 'STUDENT', batch: batchName })
      .select('name regNo whatsappNumber phoneNumber batch isTestAccount')
      .lean();

    if (!students.length) {
      return res.status(422).json({ success: false, message: `No students found in batch "${batchName}".` });
    }

    const now = new Date();
    let selectedMeetings = [];
    if (deliveryMode === 'scheduled') {
      const meetingIdStrings = Array.isArray(rawMeetingIds)
        ? rawMeetingIds.map((v) => String(v || '').trim()).filter(Boolean)
        : [];

      if (!meetingIdStrings.length) {
        return res.status(422).json({ success: false, message: 'Select at least one scheduled class to schedule reminders.' });
      }

      const validIds = meetingIdStrings.filter((id) => mongoose.Types.ObjectId.isValid(id));
      if (!validIds.length) {
        return res.status(422).json({ success: false, message: 'Invalid meeting selection.' });
      }

      selectedMeetings = await MeetingLink.find({
        _id: { $in: validIds.map((id) => new mongoose.Types.ObjectId(id)) },
        batch: new RegExp(`^${batchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        status: { $in: ['scheduled', 'started'] }
      })
        .select('_id topic startTime duration')
        .sort({ startTime: 1 })
        .lean();

      selectedMeetings = selectedMeetings.filter((m) => m.startTime && new Date(m.startTime) > now);
      if (!selectedMeetings.length) {
        return res.status(422).json({ success: false, message: 'No upcoming classes found in your selection.' });
      }
    }

    const recipients = [];
    const missingPhoneSet = new Set();

    if (deliveryMode === 'scheduled') {
      for (const meeting of selectedMeetings) {
        const classTime = formatTime(meeting.startTime);
        const classDate = formatDate(meeting.startTime);
        const topic = String(meeting.topic || '');

        for (const s of students) {
          const phone = s.whatsappNumber || s.phoneNumber || '';
          if (!phone) missingPhoneSet.add(`${s.name} (${s.regNo}) has no phone number`);

          recipients.push({
            studentId: s._id,
            name: s.name || '',
            phone,
            isTestAccount: !!s.isTestAccount,
            messageBody: renderMessage(resolvedBody, {
              studentName: s.name || '',
              batch: batchName,
              classTime,
              classDate,
              topic
            }),
            status: phone ? 'queued' : 'failed',
            scheduledFor: meeting.startTime ? new Date(meeting.startTime) : null,
            meetingId: meeting._id,
            meetingTopic: topic,
            meetingStartTime: meeting.startTime ? new Date(meeting.startTime) : null,
            error: phone ? '' : 'No WhatsApp/phone number on record'
          });
        }
      }
    } else {
      const upcomingClass = await MeetingLink.findOne({
        batch: new RegExp(`^${batchName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        status: { $in: ['scheduled', 'started'] },
        startTime: { $gte: now }
      })
        .sort({ startTime: 1 })
        .select('topic startTime duration')
        .lean();

      const classTime = upcomingClass ? formatTime(upcomingClass.startTime) : '';
      const classDate = upcomingClass ? formatDate(upcomingClass.startTime) : '';
      const topic = upcomingClass ? String(upcomingClass.topic || '') : '';

      for (const s of students) {
        const phone = s.whatsappNumber || s.phoneNumber || '';
        if (!phone) missingPhoneSet.add(`${s.name} (${s.regNo}) has no phone number`);

        recipients.push({
          studentId: s._id,
          name: s.name || '',
          phone,
          isTestAccount: !!s.isTestAccount,
          messageBody: renderMessage(resolvedBody, {
            studentName: s.name || '',
            batch: batchName,
            classTime,
            classDate,
            topic
          }),
          status: phone ? 'queued' : 'failed',
          scheduledFor: null,
          meetingId: null,
          meetingTopic: topic,
          meetingStartTime: upcomingClass?.startTime ? new Date(upcomingClass.startTime) : null,
          error: phone ? '' : 'No WhatsApp/phone number on record'
        });
      }
    }

    const sentCount = 0;
    const failedCount = recipients.filter((r) => r.status === 'failed').length;
    const pendingCount = recipients.filter((r) => r.status === 'queued').length;

    const reminder = await Reminder.create({
      templateId: templateId || null,
      title: resolvedTitle,
      body: resolvedBody,
      attachments: resolvedAttachments,
      targetBatch: batchName,
      deliveryMode,
      scheduleScope,
      createdBy: req.user.id,
      status: pendingCount > 0 ? (deliveryMode === 'scheduled' ? 'scheduled' : 'queued') : 'failed',
      totalRecipients: recipients.length,
      sentCount,
      failedCount,
      pendingCount,
      recipients
    });

    const populated = await Reminder.findById(reminder._id)
      .populate('createdBy', 'name role')
      .populate('templateId', 'title')
      .lean();

    return res.status(201).json({
      success: true,
      data: populated,
      warnings: Array.from(missingPhoneSet)
    });
  } catch (err) {
    console.error('[reminders] POST /', err);
    return res.status(500).json({ success: false, message: 'Failed to create reminder.' });
  }
});

// POST /api/reminders/:id/resend-failed  — requeue failed recipients
router.post('/:id/resend-failed', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const reminder = await Reminder.findById(id);
    if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found.' });

    let requeued = 0;
    for (const r of reminder.recipients) {
      if (r.status === 'failed' && r.phone) {
        r.status = 'queued';
        r.error = '';
        r.sentAt = null;
        requeued++;
      }
    }

    if (!requeued) {
      return res.status(422).json({ success: false, message: 'No failed recipients with a phone number to requeue.' });
    }

    reminder.failedCount -= requeued;
    reminder.pendingCount += requeued;
    reminder.status = 'queued';
    await reminder.save();

    return res.json({ success: true, message: `${requeued} recipient(s) requeued.`, requeued });
  } catch (err) {
    console.error('[reminders] POST /:id/resend-failed', err);
    return res.status(500).json({ success: false, message: 'Failed to resend.' });
  }
});

// DELETE /api/reminders/:id
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const deleted = await Reminder.findByIdAndDelete(id).lean();
    if (!deleted) return res.status(404).json({ success: false, message: 'Reminder not found.' });
    return res.json({ success: true, message: 'Reminder deleted.' });
  } catch (err) {
    console.error('[reminders] DELETE /:id', err);
    return res.status(500).json({ success: false, message: 'Failed to delete reminder.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CRM POLLER — protected by X-CRM-Token
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/reminders/pending?limit=50
// Returns queued recipients across all reminders, marks them in_progress atomically.
router.get('/crm/pending', crmTokenAuth, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);

    // Find reminders that have queued recipients
    const reminders = await Reminder.find({ status: { $in: ['queued', 'scheduled', 'in_progress'] } })
      .select('_id title body attachments targetBatch recipients')
      .lean();

    const flat = [];
    const now = new Date();
    for (const reminder of reminders) {
      for (const r of reminder.recipients || []) {
        const dueAt = r.scheduledFor ? new Date(r.scheduledFor) : null;
        const isDueNow = !dueAt || dueAt <= now;
        if (r.status === 'queued' && isDueNow && flat.length < limit) {
          flat.push({
            reminderId: reminder._id,
            recipientId: r._id,
            phone: r.phone,
            name: r.name,
            messageBody: r.messageBody,
            title: reminder.title,
            attachments: reminder.attachments,
            targetBatch: reminder.targetBatch
          });
        }
      }
    }

    // Atomically mark each as in_progress
    for (const item of flat) {
      await Reminder.updateOne(
        { _id: item.reminderId, 'recipients._id': item.recipientId },
        { $set: { 'recipients.$.status': 'in_progress', status: 'in_progress' } }
      );
    }

    return res.json({ success: true, count: flat.length, data: flat });
  } catch (err) {
    console.error('[reminders] GET /crm/pending', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch pending reminders.' });
  }
});

// POST /api/reminders/crm/:reminderId/ack
// CRM calls this after attempting delivery to report result per recipient.
router.post('/crm/:reminderId/ack', crmTokenAuth, async (req, res) => {
  try {
    const reminderId = String(req.params.reminderId || '').trim();
    const recipientId = String(req.body.recipientId || '').trim();
    const status = String(req.body.status || '').trim(); // 'sent' or 'failed'
    const error = String(req.body.error || '').trim();

    if (!recipientId) return res.status(400).json({ success: false, message: 'recipientId is required.' });
    if (!['sent', 'failed'].includes(status)) return res.status(400).json({ success: false, message: 'status must be sent or failed.' });

    const reminder = await Reminder.findById(reminderId);
    if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found.' });

    const recipient = reminder.recipients.id(recipientId);
    if (!recipient) return res.status(404).json({ success: false, message: 'Recipient not found.' });

    const prev = recipient.status;
    recipient.status = status;
    recipient.sentAt = status === 'sent' ? new Date() : null;
    recipient.error = error;

    // Update counters only when transitioning from in_progress
    if (prev === 'in_progress') {
      reminder.pendingCount = Math.max(0, reminder.pendingCount - 1);
      if (status === 'sent') reminder.sentCount += 1;
      else reminder.failedCount += 1;
    }

    // Flip reminder-level status when all work is done
    if (reminder.pendingCount === 0) {
      reminder.status = reminder.failedCount > 0 && reminder.sentCount === 0 ? 'failed' : 'completed';
    }

    await reminder.save();
    return res.json({ success: true, message: 'Ack recorded.' });
  } catch (err) {
    console.error('[reminders] POST /crm/:reminderId/ack', err);
    return res.status(500).json({ success: false, message: 'Failed to record ack.' });
  }
});

module.exports = router;
