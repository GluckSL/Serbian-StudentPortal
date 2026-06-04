const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const JobOpening = require('../models/JobOpening');
const JobApplication = require('../models/JobApplication');
const JobPortalSettings = require('../models/JobPortalSettings');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');

const router = express.Router();

const logosUploadDir = path.join(__dirname, '..', 'uploads', 'job-openings');
if (!fs.existsSync(logosUploadDir)) {
  fs.mkdirSync(logosUploadDir, { recursive: true });
}

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, logosUploadDir),
  filename: (_req, file, cb) => {
    const safeName = String(file.originalname || 'logo')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    cb(null, `${Date.now()}_${safeName}`);
  }
});

const LOGO_MAX_BYTES = 5 * 1024 * 1024;

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: LOGO_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'].includes(file.mimetype);
    if (ok) return cb(null, true);
    return cb(new Error('Logo must be PNG, JPG, WEBP, or SVG'));
  }
});

const uploadLogo = logoUpload.single('companyLogo');

function runLogoUpload(req, res, next) {
  uploadLogo(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: 'Company logo is too large. Please use an image under 5 MB.'
      });
    }
    return res.status(400).json({
      success: false,
      message: err.message || 'Logo upload failed.'
    });
  });
}

const resumesUploadDir = path.join(__dirname, '..', 'uploads', 'job-applications');
if (!fs.existsSync(resumesUploadDir)) {
  fs.mkdirSync(resumesUploadDir, { recursive: true });
}

const resumeStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, resumesUploadDir),
  filename: (req, file, cb) => {
    const safeName = String(file.originalname || 'resume.pdf')
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 80);
    cb(null, `${req.user.id}_${Date.now()}_${safeName}`);
  }
});

const resumeUpload = multer({
  storage: resumeStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ].includes(file.mimetype);
    if (ok) return cb(null, true);
    return cb(new Error('Resume must be PDF or Word document'));
  }
});

const DESCRIPTION_HTML_OPTIONS = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'a',
    'blockquote'
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel']
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        href: String(attribs.href || '').trim(),
        target: '_blank',
        rel: 'noreferrer noopener'
      }
    })
  }
};

function textToHtml(value) {
  const escaped = String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped.replace(/\r?\n/g, '<br/>');
}

function sanitizeDescription(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const normalized = /[<>]/.test(value) ? value : textToHtml(value);
  const cleaned = sanitizeHtml(normalized, DESCRIPTION_HTML_OPTIONS);
  const plain = sanitizeHtml(cleaned, { allowedTags: [], allowedAttributes: {} }).trim();
  return plain ? cleaned : '';
}

function parseSkills(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 30);
  if (typeof raw === 'string') {
    const value = raw.trim();
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 30);
    } catch (_err) {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30);
    }
  }
  return [];
}

function studentVisibleFilter() {
  const now = new Date();
  return {
    isPublished: true,
    isActive: true,
    applyBefore: { $gte: now }
  };
}

async function getOrCreatePortalSettings() {
  let doc = await JobPortalSettings.findOne().lean();
  if (!doc) {
    const created = await JobPortalSettings.create({});
    doc = created.toObject();
  }
  return doc;
}

async function buildPortalStats() {
  const visible = studentVisibleFilter();
  const openings = await JobOpening.find(visible).select('companyName').lean();
  const orgSet = new Set(openings.map((o) => String(o.companyName || '').trim().toLowerCase()).filter(Boolean));
  const settings = await getOrCreatePortalSettings();
  return {
    organizations: orgSet.size,
    openings: openings.length,
    averagePackageLabel: settings.averagePackageLabel || '6 LPA Average Package',
    heroTitle: settings.heroTitle || 'Get Hired with Glück',
    heroSubtitle: settings.heroSubtitle || ''
  };
}

function unlinkLogoIfLocal(fileUrl) {
  const url = String(fileUrl || '').trim();
  if (!url.startsWith('/uploads/job-openings/')) return;
  const filePath = path.join(__dirname, '..', url.replace(/^\//, ''));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[job-openings] failed to remove logo', { filePath, error: err.message });
    }
  });
}

function unlinkResumeIfLocal(fileUrl) {
  const url = String(fileUrl || '').trim();
  if (!url.startsWith('/uploads/job-applications/')) return;
  const filePath = path.join(__dirname, '..', url.replace(/^\//, ''));
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[job-openings] failed to remove resume', { filePath, error: err.message });
    }
  });
}

async function attachApplicationCounts(openings) {
  if (!openings?.length) return openings;
  const ids = openings.map((o) => o._id);
  const counts = await JobApplication.aggregate([
    { $match: { jobOpeningId: { $in: ids } } },
    { $group: { _id: '$jobOpeningId', count: { $sum: 1 } } }
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.count]));
  return openings.map((o) => ({ ...o, applicationCount: map.get(String(o._id)) || 0 }));
}

// ── Admin: list all openings ─────────────────────────────────────────────
router.get('/', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const list = await JobOpening.find()
      .sort({ createdAt: -1 })
      .populate('createdBy', 'name role')
      .lean();
    const data = await attachApplicationCounts(list);
    res.json({ success: true, data });
  } catch (error) {
    console.error('job-openings GET / failed', error);
    res.status(500).json({ success: false, message: 'Failed to load job openings.' });
  }
});

// ── Admin: portal settings ───────────────────────────────────────────────
router.get('/portal-settings', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const settings = await getOrCreatePortalSettings();
    const stats = await buildPortalStats();
    res.json({ success: true, data: { settings, stats } });
  } catch (error) {
    console.error('job-openings GET /portal-settings failed', error);
    res.status(500).json({ success: false, message: 'Failed to load portal settings.' });
  }
});

router.put('/portal-settings', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const heroTitle = String(req.body.heroTitle || '').trim();
    const heroSubtitle = String(req.body.heroSubtitle || '').trim();
    const averagePackageLabel = String(req.body.averagePackageLabel || '').trim();
    let doc = await JobPortalSettings.findOne();
    if (!doc) doc = new JobPortalSettings();
    if (heroTitle) doc.heroTitle = heroTitle.slice(0, 120);
    if (heroSubtitle) doc.heroSubtitle = heroSubtitle.slice(0, 500);
    if (averagePackageLabel) doc.averagePackageLabel = averagePackageLabel.slice(0, 80);
    await doc.save();
    const stats = await buildPortalStats();
    res.json({ success: true, data: { settings: doc.toObject(), stats } });
  } catch (error) {
    console.error('job-openings PUT /portal-settings failed', error);
    res.status(500).json({ success: false, message: 'Failed to save portal settings.' });
  }
});

// ── Admin: list applications (optional ?jobOpeningId=) ─────────────────────
router.get('/admin/applications', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const filter = {};
    const jobOpeningId = String(req.query.jobOpeningId || '').trim();
    if (jobOpeningId) filter.jobOpeningId = jobOpeningId;

    const list = await JobApplication.find(filter)
      .sort({ createdAt: -1 })
      .populate('studentId', 'name email regNo batch isTestAccount')
      .populate('jobOpeningId', 'companyName jobTitle')
      .lean();

    res.json({ success: true, data: list, total: list.length });
  } catch (error) {
    console.error('job-openings GET /admin/applications failed', error);
    res.status(500).json({ success: false, message: 'Failed to load applications.' });
  }
});

// ── Student: profile prefill for apply form ──────────────────────────────────
router.get('/student/apply-prefill', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    const student = await User.findById(req.user.id)
      .select('name email regNo batch phoneNumber')
      .lean();
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found.' });
    }
    res.json({
      success: true,
      data: {
        name: student.name || '',
        email: student.email || '',
        regNo: student.regNo || '',
        batch: student.batch || '',
        phone: student.phoneNumber || ''
      }
    });
  } catch (error) {
    console.error('job-openings GET /student/apply-prefill failed', error);
    res.status(500).json({ success: false, message: 'Failed to load profile.' });
  }
});

// ── Student: list + stats ──────────────────────────────────────────────────
router.get('/student', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const filter = studentVisibleFilter();
    const appliedOnly = String(req.query.appliedOnly || '') === '1';

    let openingIds = null;
    if (appliedOnly) {
      const apps = await JobApplication.find({ studentId: req.user.id }).select('jobOpeningId').lean();
      openingIds = apps.map((a) => a.jobOpeningId);
      if (!openingIds.length) {
        const stats = await buildPortalStats();
        return res.json({ success: true, data: [], stats, appliedIds: [] });
      }
      filter._id = { $in: openingIds };
    }

    const list = await JobOpening.find(filter).sort({ applyBefore: 1, createdAt: -1 }).lean();
    const apps = await JobApplication.find({ studentId: req.user.id }).select('jobOpeningId').lean();
    const appliedIds = apps.map((a) => String(a.jobOpeningId));
    const stats = await buildPortalStats();

    res.json({ success: true, data: list, stats, appliedIds });
  } catch (error) {
    console.error('job-openings GET /student failed', error);
    res.status(500).json({ success: false, message: 'Failed to load job openings.' });
  }
});

// ── Student: single opening ───────────────────────────────────────────────
router.get('/student/:id', verifyToken, checkRole('STUDENT'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const opening = await JobOpening.findOne({
      _id: req.params.id,
      ...studentVisibleFilter()
    }).lean();
    if (!opening) {
      return res.status(404).json({ success: false, message: 'Job opening not found or expired.' });
    }
    const applied = await JobApplication.exists({
      studentId: req.user.id,
      jobOpeningId: opening._id
    });
    res.json({ success: true, data: opening, applied: !!applied });
  } catch (error) {
    console.error('job-openings GET /student/:id failed', error);
    res.status(500).json({ success: false, message: 'Failed to load job opening.' });
  }
});

// ── Student: submit in-portal application ────────────────────────────────────
router.post(
  '/student/:id/apply',
  verifyToken,
  checkRole('STUDENT'),
  resumeUpload.single('resume'),
  async (req, res) => {
    try {
      const opening = await JobOpening.findOne({
        _id: req.params.id,
        ...studentVisibleFilter()
      }).lean();
      if (!opening) {
        return res.status(404).json({ success: false, message: 'Job opening not found or expired.' });
      }

      const existing = await JobApplication.findOne({
        studentId: req.user.id,
        jobOpeningId: opening._id
      });
      if (existing) {
        return res.status(409).json({ success: false, message: 'You have already applied for this opening.' });
      }

      const coverLetter = String(req.body.coverLetter || '').trim();
      const phone = String(req.body.phone || '').trim();
      const linkedIn = String(req.body.linkedIn || '').trim();

      if (!coverLetter || coverLetter.length < 20) {
        return res.status(400).json({
          success: false,
          message: 'Please write a cover letter (at least 20 characters).'
        });
      }
      if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone number is required.' });
      }
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'Resume file is required (PDF or Word).' });
      }

      const student = await User.findById(req.user.id)
        .select('name email regNo batch')
        .lean();

      const application = await JobApplication.create({
        studentId: req.user.id,
        jobOpeningId: opening._id,
        studentName: student?.name || '',
        studentEmail: student?.email || '',
        studentRegNo: student?.regNo || '',
        studentBatch: student?.batch || '',
        phone,
        linkedIn,
        coverLetter,
        resumeFileName: req.file.originalname,
        resumeUrl: `/uploads/job-applications/${req.file.filename}`
      });

      res.status(201).json({ success: true, data: application });
    } catch (error) {
      console.error('job-openings POST /student/:id/apply failed', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to submit application.' });
    }
  }
);

// ── Admin: get one ─────────────────────────────────────────────────────────
router.get('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const opening = await JobOpening.findById(req.params.id).populate('createdBy', 'name role').lean();
    if (!opening) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, data: opening });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load job opening.' });
  }
});

// ── Admin: create ──────────────────────────────────────────────────────────
router.post(
  '/',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  runLogoUpload,
  async (req, res) => {
    try {
      const companyName = String(req.body.companyName || '').trim();
      const jobTitle = String(req.body.jobTitle || '').trim();
      const applyBeforeRaw = String(req.body.applyBefore || '').trim();
      const applyBefore = applyBeforeRaw ? new Date(applyBeforeRaw) : null;

      if (!companyName || !jobTitle) {
        return res.status(400).json({ success: false, message: 'Company name and job title are required.' });
      }
      if (!applyBefore || Number.isNaN(applyBefore.getTime())) {
        return res.status(400).json({ success: false, message: 'Valid apply-before date is required.' });
      }

      let companyLogoUrl = String(req.body.companyLogoUrl || '').trim();
      if (req.file) {
        companyLogoUrl = `/uploads/job-openings/${req.file.filename}`;
      }

      const opening = await JobOpening.create({
        companyName,
        companyLogoUrl,
        jobTitle,
        jobType: String(req.body.jobType || 'Full Time'),
        experience: String(req.body.experience || '').trim(),
        jobCategory: String(req.body.jobCategory || '').trim(),
        locationType: String(req.body.locationType || 'Onsite'),
        location: String(req.body.location || '').trim(),
        salary: String(req.body.salary || '').trim(),
        skills: parseSkills(req.body.skills),
        description: sanitizeDescription(req.body.description),
        applyBefore,
        isPublished: String(req.body.isPublished || 'true') !== 'false',
        isActive: String(req.body.isActive || 'true') !== 'false',
        createdBy: req.user.id
      });

      res.status(201).json({ success: true, data: opening });
    } catch (error) {
      console.error('job-openings POST / failed', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to create job opening.' });
    }
  }
);

// ── Admin: update ──────────────────────────────────────────────────────────
router.put(
  '/:id',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER_ADMIN']),
  runLogoUpload,
  async (req, res) => {
    try {
      const opening = await JobOpening.findById(req.params.id);
      if (!opening) return res.status(404).json({ success: false, message: 'Not found.' });

      const prevLogo = opening.companyLogoUrl;

      if (req.body.companyName !== undefined) opening.companyName = String(req.body.companyName).trim();
      if (req.body.jobTitle !== undefined) opening.jobTitle = String(req.body.jobTitle).trim();
      if (req.body.jobType !== undefined) opening.jobType = String(req.body.jobType);
      if (req.body.experience !== undefined) opening.experience = String(req.body.experience).trim();
      if (req.body.jobCategory !== undefined) opening.jobCategory = String(req.body.jobCategory).trim();
      if (req.body.locationType !== undefined) opening.locationType = String(req.body.locationType);
      if (req.body.location !== undefined) opening.location = String(req.body.location).trim();
      if (req.body.salary !== undefined) opening.salary = String(req.body.salary).trim();
      if (req.body.skills !== undefined) opening.skills = parseSkills(req.body.skills);
      if (req.body.description !== undefined) opening.description = sanitizeDescription(req.body.description);
      if (req.body.applyBefore !== undefined) {
        const d = new Date(String(req.body.applyBefore));
        if (!Number.isNaN(d.getTime())) opening.applyBefore = d;
      }
      if (req.body.isPublished !== undefined) opening.isPublished = String(req.body.isPublished) !== 'false';
      if (req.body.isActive !== undefined) opening.isActive = String(req.body.isActive) !== 'false';

      if (req.file) {
        opening.companyLogoUrl = `/uploads/job-openings/${req.file.filename}`;
        if (prevLogo && prevLogo !== opening.companyLogoUrl) unlinkLogoIfLocal(prevLogo);
      } else if (req.body.companyLogoUrl !== undefined) {
        const nextUrl = String(req.body.companyLogoUrl).trim();
        if (nextUrl !== prevLogo) {
          opening.companyLogoUrl = nextUrl;
          if (prevLogo) unlinkLogoIfLocal(prevLogo);
        }
      }

      await opening.save();
      res.json({ success: true, data: opening });
    } catch (error) {
      console.error('job-openings PUT /:id failed', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to update job opening.' });
    }
  }
);

// ── Admin: delete ──────────────────────────────────────────────────────────
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const opening = await JobOpening.findByIdAndDelete(req.params.id);
    if (!opening) return res.status(404).json({ success: false, message: 'Not found.' });
    if (opening.companyLogoUrl) unlinkLogoIfLocal(opening.companyLogoUrl);
    const apps = await JobApplication.find({ jobOpeningId: opening._id }).lean();
    for (const app of apps) {
      if (app.resumeUrl) unlinkResumeIfLocal(app.resumeUrl);
    }
    await JobApplication.deleteMany({ jobOpeningId: opening._id });
    res.json({ success: true });
  } catch (error) {
    console.error('job-openings DELETE /:id failed', error);
    res.status(500).json({ success: false, message: 'Failed to delete job opening.' });
  }
});

module.exports = router;
