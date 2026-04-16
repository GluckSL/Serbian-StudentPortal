const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Announcement = require('../models/Announcement');
const User = require('../models/User');
const transporter = require('../config/emailConfig');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = express.Router();

const announcementsUploadDir = path.join(__dirname, '..', 'uploads', 'announcements');
if (!fs.existsSync(announcementsUploadDir)) {
  fs.mkdirSync(announcementsUploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, announcementsUploadDir),
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || 'attachment')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
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

function parseTargetBatches(raw) {
  if (Array.isArray(raw)) return raw.map((b) => String(b || '').trim()).filter(Boolean);
  if (typeof raw === 'string') {
    const value = raw.trim();
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((b) => String(b || '').trim()).filter(Boolean);
    } catch (_err) {
      return value.split(',').map((b) => b.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeBatchKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\bbatch\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function batchesIntersectNormalized(studentBatch, targetBatches) {
  const studentKey = normalizeBatchKey(studentBatch);
  if (!studentKey) return false;
  return (targetBatches || []).some((b) => normalizeBatchKey(b) === studentKey);
}

function normalizeBatchList(values) {
  return Array.from(new Set((values || []).map((b) => normalizeBatchKey(b)).filter(Boolean)));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textToHtml(value) {
  // Treat announcement content as plain text (admin textarea) and preserve newlines.
  return escapeHtml(String(value ?? '')).replace(/\r?\n/g, '<br/>');
}

/**
 * recipients: Array<{ email: string, studentName: string }>
 */
async function sendAnnouncementEmails({ recipients, subject, body, title }) {
  if (!recipients.length) return { sent: 0, failed: 0 };

  const escapedTitle = escapeHtml(title);
  const bodyHtml = textToHtml(body);

  const results = await Promise.allSettled(
    recipients.map(({ email, studentName }) => {
      const safeStudentName = escapeHtml(studentName || 'Student');

      const html = `
        <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6;">
          <p style="margin:0 0 12px 0; font-weight:700;">Announcement</p>

          <p style="margin:0 0 12px 0;">
            Hi <strong>${safeStudentName}</strong>,
          </p>

          <p style="margin:0 0 16px 0;">
            <strong>${escapedTitle}</strong>
          </p>

          <p style="margin:0 0 16px 0;">${bodyHtml}</p>

          <p style="margin:0;">
            Thanks,<br/>
            <span style="font-weight:700;">Gluck Global Pvt Ltd</span>
          </p>
        </div>
      `;

      return transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject,
        html
      });
    })
  );

  const sent = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.length - sent;
  return { sent, failed };
}

// List announcements for admin/teacher management
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const list = await Announcement.find({ channel: 'website' })
      .sort({ createdAt: -1 })
      .limit(200)
      .populate('createdBy', 'name role')
      .lean();
    res.json({ success: true, data: list });
  } catch (error) {
    console.error('announcements GET / failed', error);
    res.status(500).json({ success: false, message: 'Failed to load announcements.' });
  }
});

// List announcements for the logged-in student.
// We intentionally allow any authenticated user here (no strict role check),
// and rely on the student record + batch lookup to determine visibility.
router.get('/student', verifyToken, async (req, res) => {
  try {
    const student = await User.findById(req.user.id).select('batch').lean();
    const batch = String(student?.batch || '').trim();
    if (!batch) {
      console.info('[announcements][student] no batch for student', { studentId: req.user.id });
      return res.json({ success: true, data: [] });
    }

    const allItems = await Announcement.find({
      channel: 'website',
      isActive: true
    })
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name role')
      .lean();

    const items = allItems.filter((item) => batchesIntersectNormalized(batch, item.targetBatches || []));
    console.info('[announcements][student] fetched announcements', {
      studentId: req.user.id,
      studentBatch: batch,
      studentBatchKey: normalizeBatchKey(batch),
      totalAnnouncements: allItems.length,
      visibleAnnouncements: items.length,
      sampleTargetBatches: allItems
        .slice(0, 5)
        .map((x) => ({ id: String(x._id), targetBatches: x.targetBatches || [] }))
    });

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('announcements GET /student failed', error);
    res.status(500).json({ success: false, message: 'Failed to load student announcements.' });
  }
});

// Preview students for selected batches (admin/teacher)
router.get(
  '/target-students',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']),
  async (req, res) => {
    try {
      const targetBatches = parseTargetBatches(req.query.batches);
      const targetKeys = normalizeBatchList(targetBatches);
      if (!targetKeys.length) {
        return res.json({ success: true, data: [], total: 0 });
      }

      const students = await User.find({
        role: 'STUDENT',
        isActive: true
      })
        .select('name regNo email batch')
        .lean();

      const matched = students
        .filter((s) => targetKeys.includes(normalizeBatchKey(s.batch)))
        .map((s) => ({
          _id: s._id,
          name: s.name || '',
          regNo: s.regNo || '',
          email: s.email || '',
          batch: s.batch || ''
        }));

      console.info('[announcements][target-students] preview', {
        requestedBy: req.user.id,
        targetBatches,
        matchedStudents: matched.length
      });

      return res.json({ success: true, data: matched, total: matched.length });
    } catch (error) {
      console.error('announcements GET /target-students failed', error);
      return res.status(500).json({ success: false, message: 'Failed to load target students.' });
    }
  }
);

// Create website announcement (website / website+email)
router.post(
  '/',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']),
  upload.array('attachments', 5),
  async (req, res) => {
    try {
      const channel = String(req.body.channel || 'website').toLowerCase();
      const deliveryType = String(req.body.deliveryType || 'website').toLowerCase();
      const title = String(req.body.title || '').trim();
      const body = String(req.body.body || '').trim();
      const emailSubject = String(req.body.emailSubject || '').trim();
      const emailBody = String(req.body.emailBody || '').trim();
      const targetBatches = parseTargetBatches(req.body.targetBatches);
      const targetKeys = normalizeBatchList(targetBatches);

      if (channel !== 'website') {
        return res.status(400).json({ success: false, message: 'Only website announcements are supported currently.' });
      }
      if (!['website', 'website_email'].includes(deliveryType)) {
        return res.status(400).json({ success: false, message: 'Invalid website type.' });
      }
      if (!title || !body) {
        return res.status(400).json({ success: false, message: 'Title and body are required.' });
      }
      if (!targetBatches.length) {
        return res.status(400).json({ success: false, message: 'Please select at least one batch.' });
      }
      if (deliveryType === 'website_email' && (!emailSubject || !emailBody)) {
        return res.status(400).json({ success: false, message: 'Email subject and email body are required for website + email.' });
      }

      const attachments = (req.files || []).map((file) => ({
        fileName: file.originalname,
        fileUrl: `/uploads/announcements/${file.filename}`,
        mimeType: file.mimetype,
        fileSize: file.size
      }));

      const announcement = new Announcement({
        channel,
        deliveryType,
        targetBatches,
        title,
        body,
        attachments,
        emailSubject: deliveryType === 'website_email' ? emailSubject : '',
        emailBody: deliveryType === 'website_email' ? emailBody : '',
        createdBy: req.user.id
      });

      if (deliveryType === 'website_email') {
        const students = await User.find({
          role: 'STUDENT',
          email: { $nin: [null, ''] }
        })
          .select('name email batch')
          .lean();

        const recipients = students
          .filter((s) => targetKeys.includes(normalizeBatchKey(s.batch)))
          .map((s) => ({
            email: String(s.email || '').trim().toLowerCase(),
            studentName: String(s.name || '').trim()
          }))
          .filter((r) => r.email);

        // Dedupe recipients by email while preserving a (best-effort) name.
        const recipientsByEmail = new Map();
        for (const r of recipients) {
          if (!recipientsByEmail.has(r.email)) recipientsByEmail.set(r.email, r);
        }

        const cleanedRecipients = Array.from(recipientsByEmail.values());

        const { sent, failed } = await sendAnnouncementEmails({
          recipients: cleanedRecipients,
          subject: emailSubject,
          body: emailBody,
          title
        });
        announcement.emailDispatch = {
          totalRecipients: cleanedRecipients.length,
          sentCount: sent,
          failedCount: failed,
          sentAt: new Date()
        };
      }

      console.info('[announcements][create] targeting announcement', {
        createdBy: req.user.id,
        deliveryType,
        targetBatches,
        normalizedTargetBatchCount: targetKeys.length,
        attachmentCount: attachments.length
      });

      await announcement.save();
      const populated = await Announcement.findById(announcement._id).populate('createdBy', 'name role').lean();
      return res.status(201).json({ success: true, data: populated, message: 'Announcement created successfully.' });
    } catch (error) {
      console.error('announcements POST / failed', error);
      return res.status(500).json({ success: false, message: 'Failed to create announcement.' });
    }
  }
);

module.exports = router;
