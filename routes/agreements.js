// routes/agreements.js — Agreement template management and student agreement sharing

const express = require('express');
const router = express.Router();
const multer = require('multer');
const mongoose = require('mongoose');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { verifyToken, checkRole } = require('../middleware/auth');
const AgreementTemplate = require('../models/AgreementTemplate');
const StudentAgreement = require('../models/StudentAgreement');
const StudentDocument = require('../models/StudentDocument');
const DocumentRequirement = require('../models/DocumentRequirement');
const User = require('../models/User');

const s3Client = require('../config/s3');
const {
  isAgreementR2Configured,
  putAgreementTemplate,
  getAgreementTemplateBuffer,
  getAgreementTemplateSignedUrl
} = require('../services/agreementR2Service');
const { extractPagesText, generateFilledPdf } = require('../services/agreementPdfService');
const { suggestDynamicFields } = require('../services/agreementAiService');
const { detectRedDynamicFields } = require('../services/agreementRedFieldDetector');
const {
  isAllowedTemplateUpload,
  normalizeTemplateUploadToPdf
} = require('../services/agreementDocConvertService');
const {
  getDocumentTransporter,
  getDocumentFromAddress,
  getDocumentCc,
  isDocumentEmailConfigured
} = require('../config/documentEmailConfig');

// Memory upload for template files — PDF or Word (converted to PDF on upload)
const memUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAllowedTemplateUpload(file.mimetype, file.originalname)) cb(null, true);
    else cb(new Error('Only PDF, DOC, and DOCX files are allowed for agreement templates'));
  }
});

// Memory upload for signed copy from student (max 20 MB, PDF/images)
const signedUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype);
    cb(ok ? null : new Error('PDF or image required'), ok);
  }
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function ensureAgreementRequirement(templateSlug, templateName) {
  const type = `AGREEMENT_${templateSlug.toUpperCase().replace(/-/g, '_')}`;
  let req = await DocumentRequirement.findOne({ type });
  if (!req) {
    req = await DocumentRequirement.create({
      name: templateName,
      type,
      label: templateName,
      description: `Agreement: ${templateName}`,
      category: 'AGREEMENT',
      isRequired: false,
      required: false,
      allowMultiple: true,
      programKeys: []
    });
  }
  return req;
}

async function uploadBufferToS3(buffer, key, mimeType) {
  await s3Client.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType
  }));
  // Return a simple path URL as used by the student-documents system
  return `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

async function createSignedS3Url(filePath) {
  if (!filePath) return null;
  // Extract the S3 key from the full URL or treat as-is
  const key = filePath.includes('.amazonaws.com/')
    ? filePath.split('.amazonaws.com/')[1]
    : filePath;
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const cmd = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key });
  return getSignedUrl(s3Client, cmd, { expiresIn: 300 });
}

// ─── Template routes (ADMIN) ───────────────────────────────────────────────

// GET /api/agreements/templates — list active templates
router.get('/templates', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const templates = await AgreementTemplate.find({ isActive: true })
      .select('-aiSuggestions')
      .sort({ name: 1 })
      .lean();
    res.json({ success: true, templates });
  } catch (err) {
    console.error('❌ agreements/templates GET:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/agreements/templates/:id — single template
router.get('/templates/:id', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id).lean();
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/templates/upload — upload PDF or Word (DOC/DOCX), convert to PDF, store in R2
router.post('/templates/upload', verifyToken, checkRole(['ADMIN']), memUpload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'File required (PDF, DOC, or DOCX)' });
    if (!isAgreementR2Configured()) {
      return res.status(503).json({ success: false, message: 'R2 storage is not configured' });
    }
    const { pdfBuffer, sourceType, conversion } = await normalizeTemplateUploadToPdf(
      req.file.buffer,
      req.file.mimetype,
      req.file.originalname
    );
    const tempId = new mongoose.Types.ObjectId().toHexString();
    const r2Key = await putAgreementTemplate(pdfBuffer, tempId);
    const { pageCount } = await extractPagesText(pdfBuffer);
    res.json({ success: true, tempId, r2Key, pageCount, convertedFrom: sourceType, conversion });
  } catch (err) {
    console.error('❌ template upload:', err);
    const status = /LibreOffice|Word conversion|Only PDF/i.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/templates — create template metadata
router.post('/templates', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { name, description, r2Key, pageCount, tempId } = req.body;
    if (!name || !r2Key) return res.status(400).json({ success: false, message: 'name and r2Key required' });

    const slug = slugify(name);
    const existing = await AgreementTemplate.findOne({ slug });
    if (existing) return res.status(409).json({ success: false, message: 'A template with this name already exists' });

    const template = await AgreementTemplate.create({
      name,
      slug,
      description: description || '',
      r2Key,
      pageCount: pageCount || 0,
      dynamicFields: [],
      createdBy: req.user.id
    });

    // Move the R2 key to use the real template ID (best-effort)
    if (tempId && isAgreementR2Configured()) {
      try {
        const buf = await getAgreementTemplateBuffer(r2Key);
        const newKey = await putAgreementTemplate(buf, template._id.toHexString());
        await AgreementTemplate.findByIdAndUpdate(template._id, { r2Key: newKey });
        template.r2Key = newKey;
      } catch (mvErr) {
        console.warn('⚠️  Could not move template R2 key:', mvErr.message);
      }
    }

    res.status(201).json({ success: true, template });
  } catch (err) {
    console.error('❌ template create:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/templates/:id/detect-red-fields — auto-detect red placeholder text
router.post('/templates/:id/detect-red-fields', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    if (!isAgreementR2Configured()) {
      return res.status(503).json({ success: false, message: 'R2 not configured' });
    }
    const buf = await getAgreementTemplateBuffer(template.r2Key);
    const fields = await detectRedDynamicFields(buf);
    res.json({ success: true, fields, count: fields.length });
  } catch (err) {
    console.error('❌ detect-red-fields:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/templates/:id/analyze — red fields first, then AI fallback
router.post('/templates/:id/analyze', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    if (!isAgreementR2Configured()) {
      return res.status(503).json({ success: false, message: 'R2 not configured' });
    }
    const buf = await getAgreementTemplateBuffer(template.r2Key);
    const redFields = await detectRedDynamicFields(buf);
    if (redFields.length > 0) {
      template.aiSuggestions = redFields.map((f) => ({
        id: f.id,
        label: f.label,
        page: f.page,
        sampleText: f.sampleText,
        confidence: 'high',
        source: 'red'
      }));
      await template.save();
      return res.json({ success: true, suggestions: template.aiSuggestions, fields: redFields, source: 'red' });
    }
    const { pages } = await extractPagesText(buf);
    const suggestions = await suggestDynamicFields(pages);
    template.aiSuggestions = suggestions;
    await template.save();
    res.json({ success: true, suggestions, fields: [], source: 'ai' });
  } catch (err) {
    console.error('❌ template analyze:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/agreements/templates/:id/fields — save confirmed dynamic fields
router.put('/templates/:id/fields', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { fields } = req.body;
    if (!Array.isArray(fields) || fields.length > 7) {
      return res.status(400).json({ success: false, message: 'Provide 1–7 dynamic fields' });
    }
    const template = await AgreementTemplate.findByIdAndUpdate(
      req.params.id,
      { dynamicFields: fields },
      { new: true }
    );
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/agreements/templates/:id/preview — presigned R2 URL for PDF.js
router.get('/templates/:id/preview', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id).lean();
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    const url = await getAgreementTemplateSignedUrl(template.r2Key, 600);
    res.json({ success: true, url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/agreements/templates/:id — soft delete
router.delete('/templates/:id', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    await AgreementTemplate.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Template deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── Instance (student agreement) routes ──────────────────────────────────

// POST /api/agreements/instances/preview — returns generated PDF buffer (not saved)
router.post('/instances/preview', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { templateId, fieldValues } = req.body;
    const template = await AgreementTemplate.findById(templateId).lean();
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    const buf = await getAgreementTemplateBuffer(template.r2Key);
    const filled = await generateFilledPdf(buf, template.dynamicFields, fieldValues || {});
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(filled);
  } catch (err) {
    console.error('❌ instance preview:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/instances/share — generate, save, optionally email
router.post('/instances/share', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { templateId, studentId, fieldValues, displayName, sendEmail } = req.body;
    if (!templateId || !studentId || !displayName) {
      return res.status(400).json({ success: false, message: 'templateId, studentId, displayName required' });
    }

    const [template, student] = await Promise.all([
      AgreementTemplate.findById(templateId).lean(),
      User.findById(studentId).select('name email').lean()
    ]);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

    // Generate filled PDF
    const templateBuf = await getAgreementTemplateBuffer(template.r2Key);
    const filledBuf = await generateFilledPdf(templateBuf, template.dynamicFields, fieldValues || {});

    // Upload generated PDF to S3
    const safeDisplay = displayName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const s3Key = `uploads/agreements/${studentId}/${template.slug}_${Date.now()}_${safeDisplay}.pdf`;
    const s3Url = await uploadBufferToS3(filledBuf, s3Key, 'application/pdf');

    // Ensure a DocumentRequirement exists for this agreement type
    const requirement = await ensureAgreementRequirement(template.slug, template.name);

    // Create StudentDocument so the existing checklist includes this agreement
    const docRecord = new StudentDocument({
      studentId: student._id,
      studentName: student.name,
      studentEmail: student.email,
      documentTypeId: requirement._id,
      documentType: requirement.type,
      documentName: displayName,
      documentCategory: 'AGREEMENT',
      fileName: `${safeDisplay}.pdf`,
      filePath: s3Url,
      fileSize: filledBuf.length,
      mimeType: 'application/pdf',
      description: `Agreement: ${template.name}`,
      status: 'PENDING',
      isCurrent: true,
      version: 1
    });
    await docRecord.save();

    // Create StudentAgreement record
    const agreement = await StudentAgreement.create({
      studentId: student._id,
      studentName: student.name,
      studentEmail: student.email,
      templateId: template._id,
      templateName: template.name,
      displayName,
      fieldValues: new Map(Object.entries(fieldValues || {})),
      generatedFile: { s3Key, fileName: `${safeDisplay}.pdf`, fileSize: filledBuf.length, mimeType: 'application/pdf' },
      studentDocumentId: docRecord._id,
      status: 'SENT',
      sentBy: req.user.id
    });

    // Send email to student
    if (sendEmail !== false && isDocumentEmailConfigured()) {
      try {
        const transporter = getDocumentTransporter();
        const portalUrl = process.env.FRONTEND_URL || 'https://gluckstudentsportal.com';
        await transporter.sendMail({
          from: getDocumentFromAddress(),
          to: student.email,
          cc: getDocumentCc(),
          subject: `Agreement Ready for Signature: ${displayName}`,
          attachments: [{ filename: `${safeDisplay}.pdf`, content: filledBuf, contentType: 'application/pdf' }],
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#1a237e;color:white;padding:20px;text-align:center;">
                <h2 style="margin:0;">Glück Global</h2>
              </div>
              <div style="padding:24px;">
                <p>Dear ${student.name},</p>
                <p>Please find your <strong>${displayName}</strong> agreement attached to this email.</p>
                <p>Kindly review the document, sign it, and upload the signed copy to your student portal:</p>
                <div style="text-align:center;margin:24px 0;">
                  <a href="${portalUrl}/student/documents" style="background:#1a237e;color:white;padding:12px 24px;text-decoration:none;border-radius:4px;">
                    Upload Signed Agreement
                  </a>
                </div>
                <p>If you have any questions, please contact your advisor.</p>
                <p>Regards,<br>Glück Global Team</p>
              </div>
            </div>`
        });
      } catch (mailErr) {
        console.warn('⚠️  Agreement email failed:', mailErr.message);
      }
    }

    res.status(201).json({
      success: true,
      agreement,
      studentDocumentId: docRecord._id,
      downloadUrl: `/api/agreements/instances/${agreement._id}/download`
    });
  } catch (err) {
    console.error('❌ instance share:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/agreements/instances — list by studentId (admin) or own (student)
router.get('/instances', verifyToken, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'ADMIN';
    const studentId = isAdmin ? (req.query.studentId || null) : req.user.id;
    if (!studentId) return res.status(400).json({ success: false, message: 'studentId required' });

    const agreements = await StudentAgreement.find({ studentId })
      .populate('templateId', 'name slug dynamicFields')
      .sort({ sentAt: -1 })
      .lean();

    res.json({ success: true, agreements });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/agreements/instances/:id/download — generated or signed PDF
router.get('/instances/:id/download', verifyToken, async (req, res) => {
  try {
    const agreement = await StudentAgreement.findById(req.params.id).lean();
    if (!agreement) return res.status(404).json({ success: false, message: 'Not found' });

    const isAdmin = req.user.role === 'ADMIN';
    if (!isAdmin && String(agreement.studentId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const type = req.query.type === 'signed' ? 'signed' : 'generated';
    const fileInfo = type === 'signed' ? agreement.signedFile : agreement.generatedFile;
    if (!fileInfo || !fileInfo.s3Key) {
      return res.status(404).json({ success: false, message: `${type} file not found` });
    }

    const signedUrl = await createSignedS3Url(fileInfo.s3Key);
    res.redirect(signedUrl);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/instances/:id/upload-signed — student uploads signed copy
router.post('/instances/:id/upload-signed', verifyToken, signedUpload.single('file'), async (req, res) => {
  try {
    const agreement = await StudentAgreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ success: false, message: 'Not found' });
    if (String(agreement.studentId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'File required' });

    const ext = req.file.originalname.split('.').pop();
    const s3Key = `uploads/agreements/${req.user.id}/${agreement._id}_signed_${Date.now()}.${ext}`;
    const s3Url = await uploadBufferToS3(req.file.buffer, s3Key, req.file.mimetype);

    agreement.signedFile = {
      s3Key,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    };
    agreement.status = 'SIGNED_PENDING';
    await agreement.save();

    // Update the linked StudentDocument so it shows up for admin verification
    if (agreement.studentDocumentId) {
      await StudentDocument.findByIdAndUpdate(agreement.studentDocumentId, {
        fileName: req.file.originalname,
        filePath: s3Url,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        status: 'PENDING',
        updatedAt: new Date()
      });
    }

    res.json({ success: true, message: 'Signed agreement uploaded successfully' });
  } catch (err) {
    console.error('❌ upload-signed:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/agreements/instances/:id/verify — admin verify/reject signed agreement
router.put('/instances/:id/verify', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { status, notes } = req.body;
    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'status must be VERIFIED or REJECTED' });
    }
    const agreement = await StudentAgreement.findById(req.params.id);
    if (!agreement) return res.status(404).json({ success: false, message: 'Not found' });

    agreement.status = status;
    agreement.verificationNotes = notes || '';
    agreement.verifiedBy = req.user.id;
    agreement.verifiedAt = new Date();
    await agreement.save();

    // Sync StudentDocument status
    if (agreement.studentDocumentId) {
      await StudentDocument.findByIdAndUpdate(agreement.studentDocumentId, {
        status: status === 'VERIFIED' ? 'VERIFIED' : 'REJECTED',
        verificationNotes: notes || '',
        remarks: notes || '',
        verifiedBy: req.user.id,
        verifiedAt: new Date()
      });
    }

    res.json({ success: true, agreement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
