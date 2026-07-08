const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const Announcement = require('../models/Announcement');
const AnnouncementComment = require('../models/AnnouncementComment');
const User = require('../models/User');
const { dispatchWebsiteEmailAnnouncement } = require('../services/announcementEmailDispatch');
const {
  normalizeBatchKey,
  isGoStudentsTarget,
  isGoStudentRecord,
  normalizeBatchList,
  batchesIntersectNormalized,
  getRecipientBatchKeys,
  findTeachersForTargetBatches
} = require('../services/announcementRecipients');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = express.Router();
const GO_STUDENTS_TARGET_KEY = '__GO_STUDENTS__';

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

const ANNOUNCEMENT_HTML_SANITIZE_OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'mark',
    'blockquote',
    'ul',
    'ol',
    'li',
    'h1',
    'h2',
    'h3',
    'a',
    'span'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    span: ['style']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  // Allow Quill highlight output (background) and optional foreground color.
  allowedStyles: {
    span: {
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/, /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\)$/],
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/, /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0(\.\d+)?|1(\.0+)?)\s*\)$/]
    }
  },
  transformTags: {
    a: (tagName, attribs) => {
      const href = String(attribs.href || '').trim();
      return {
        tagName,
        attribs: {
          href,
          target: '_blank',
          rel: 'noreferrer noopener'
        }
      };
    }
  }
};

function textToHtml(value) {
  const escaped = String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped.replace(/\r?\n/g, '<br/>');
}

function sanitizeAnnouncementHtml(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const normalized = /[<>]/.test(value) ? value : textToHtml(value);
  const cleaned = sanitizeHtml(normalized, ANNOUNCEMENT_HTML_SANITIZE_OPTIONS);
  const plain = sanitizeHtml(cleaned, { allowedTags: [], allowedAttributes: {} }).trim();
  return plain ? cleaned : '';
}

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

function unlinkIfExists(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[announcements] failed to remove attachment', { filePath, error: err.message });
    }
  });
}

// List announcements for admin/teacher management
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const filter = { channel: 'website' };
    const rawPage = req.query.page;
    const hasPage = rawPage !== undefined && rawPage !== null && String(rawPage).trim() !== '';

    if (!hasPage) {
      const list = await Announcement.find(filter)
        .sort({ createdAt: -1 })
        .limit(200)
        .populate('createdBy', 'name role')
        .lean();
      return res.json({ success: true, data: list });
    }

    const page = Math.max(1, parseInt(String(rawPage), 10) || 1);
    let limit = parseInt(String(req.query.limit ?? '5'), 10) || 5;
    if (!Number.isFinite(limit) || limit < 1) limit = 5;
    if (limit > 50) limit = 50;

    const total = await Announcement.countDocuments(filter);
    const list = await Announcement.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('createdBy', 'name role')
      .lean();

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    return res.json({
      success: true,
      data: list,
      pagination: { total, page, limit, totalPages }
    });
  } catch (error) {
    console.error('announcements GET / failed', error);
    res.status(500).json({ success: false, message: 'Failed to load announcements.' });
  }
});

// List announcements for the logged-in student or teacher.
// We intentionally allow any authenticated user here (no strict role check),
// and rely on the user record + batch lookup to determine visibility.
router.get('/student', verifyToken, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const user = await User.findById(req.user.id).select('role batch goStatus assignedBatches').lean();
    if (!user) {
      return res.json({ success: true, data: [] });
    }

    const role = String(user.role || '').toUpperCase();
    const normalizedTargets = await getRecipientBatchKeys(user, req.user.id);
    if (!normalizedTargets.length) {
      return res.json({ success: true, data: [] });
    }

    const query = { channel: 'website', isActive: true };
    query.normalizedBatches = { $in: normalizedTargets };

    const allItems = await Announcement.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .select('_id title body deliveryType attachments targetBatches normalizedBatches isActive createdAt createdBy')
      .populate('createdBy', 'name role')
      .lean();

    const batch = role === 'STUDENT' ? String(user.batch || '').trim() : '';
    const isGoStudent = role === 'STUDENT' && isGoStudentRecord(user);

    const items = allItems.filter((item) => {
      const targets = item.targetBatches || [];
      if (role === 'STUDENT') {
        const includesGoAudience = targets.some((target) => isGoStudentsTarget(target));
        if (isGoStudent && includesGoAudience) return true;
        if (!batch) return false;
        return batchesIntersectNormalized(batch, targets);
      }
      return (item.normalizedBatches || []).some((key) => normalizedTargets.includes(key));
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
        .select('name regNo email batch isTestAccount goStatus')
        .lean();

      const includeGoStudents = targetBatches.some((target) => isGoStudentsTarget(target));
      const matched = students
        .filter((s) => {
          if (includeGoStudents && isGoStudentRecord(s)) return true;
          return targetKeys.includes(normalizeBatchKey(s.batch));
        })
        .map((s) => ({
          _id: s._id,
          name: s.name || '',
          regNo: s.regNo || '',
          email: s.email || '',
          batch: s.batch || '',
          isTestAccount: !!s.isTestAccount
        }));

      const teachers = await findTeachersForTargetBatches(targetBatches, targetKeys);

      return res.json({
        success: true,
        data: matched,
        total: matched.length,
        teachers,
        teacherTotal: teachers.length
      });
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
      const body = sanitizeAnnouncementHtml(req.body.body);
      const emailSubject = String(req.body.emailSubject || '').trim();
      const emailBody = sanitizeAnnouncementHtml(req.body.emailBody);
      const targetBatches = parseTargetBatches(req.body.targetBatches);

      const scheduleRaw = String(req.body.scheduleAt || '').trim();
      const scheduleDate = scheduleRaw ? new Date(scheduleRaw) : null;
      const hasValidSchedule =
        Boolean(scheduleRaw) &&
        scheduleDate &&
        !Number.isNaN(scheduleDate.getTime()) &&
        scheduleDate.getTime() > Date.now() + 45_000;

      if (scheduleRaw && !hasValidSchedule) {
        return res.status(400).json({
          success: false,
          message: 'Invalid schedule time. Pick a date and time at least one minute in the future.'
        });
      }

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

      const normalizedBatches = targetBatches.map(normalizeBatchKey).filter(Boolean);

      const announcement = new Announcement({
        channel,
        deliveryType,
        targetBatches,
        normalizedBatches,
        title,
        body,
        attachments,
        emailSubject: deliveryType === 'website_email' ? emailSubject : '',
        emailBody: deliveryType === 'website_email' ? emailBody : '',
        createdBy: req.user.id,
        isActive: !hasValidSchedule,
        scheduledPublishAt: hasValidSchedule ? scheduleDate : null
      });

      if (deliveryType === 'website_email' && !hasValidSchedule) {
        announcement.emailDispatch = await dispatchWebsiteEmailAnnouncement({
          targetBatches,
          title,
          body,
          emailSubject,
          emailBody
        });
      }

      await announcement.save();
      const populated = await Announcement.findById(announcement._id).populate('createdBy', 'name role').lean();
      const okMessage = hasValidSchedule
        ? 'Announcement scheduled successfully. It will go live and emails will send at the chosen time.'
        : 'Announcement created successfully.';
      return res.status(201).json({ success: true, data: populated, message: okMessage });
    } catch (error) {
      console.error('announcements POST / failed', error);
      return res.status(500).json({ success: false, message: 'Failed to create announcement.' });
    }
  }
);

// Update an announcement (admin/teacher)
router.put(
  '/:id',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']),
  async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) {
        return res.status(400).json({ success: false, message: 'Announcement id is required.' });
      }

      const deliveryType = String(req.body.deliveryType || '').trim().toLowerCase();
      const title = String(req.body.title || '').trim();
      const body = sanitizeAnnouncementHtml(req.body.body);
      const targetBatches = parseTargetBatches(req.body.targetBatches);
      const emailSubject = String(req.body.emailSubject || '').trim();
      const emailBody = sanitizeAnnouncementHtml(req.body.emailBody);

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

      const normalizedBatches = targetBatches.map(normalizeBatchKey).filter(Boolean);

      const updated = await Announcement.findOneAndUpdate(
        { _id: id, channel: 'website' },
        {
          $set: {
            deliveryType,
            title,
            body,
            targetBatches,
            normalizedBatches,
            emailSubject: deliveryType === 'website_email' ? emailSubject : '',
            emailBody: deliveryType === 'website_email' ? emailBody : ''
          }
        },
        { new: true, runValidators: true }
      )
        .populate('createdBy', 'name role')
        .lean();

      if (!updated) {
        return res.status(404).json({ success: false, message: 'Announcement not found.' });
      }

      return res.json({ success: true, data: updated, message: 'Announcement updated successfully.' });
    } catch (error) {
      console.error('announcements PUT /:id failed', error);
      return res.status(500).json({ success: false, message: 'Failed to update announcement.' });
    }
  }
);

// Delete an announcement (admin/teacher)
router.delete(
  '/:id',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN', 'TEACHER']),
  async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) {
        return res.status(400).json({ success: false, message: 'Announcement id is required.' });
      }

      const deleted = await Announcement.findOneAndDelete({ _id: id, channel: 'website' }).lean();
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Announcement not found.' });
      }

      await AnnouncementComment.deleteMany({ announcementId: id });

      for (const attachment of deleted.attachments || []) {
        const fileUrl = String(attachment?.fileUrl || '');
        if (!fileUrl.startsWith('/uploads/announcements/')) continue;
        const fileName = path.basename(fileUrl);
        unlinkIfExists(path.join(announcementsUploadDir, fileName));
      }

      return res.json({ success: true, message: 'Announcement deleted successfully.' });
    } catch (error) {
      console.error('announcements DELETE /:id failed', error);
      return res.status(500).json({ success: false, message: 'Failed to delete announcement.' });
    }
  }
);

module.exports = router;
