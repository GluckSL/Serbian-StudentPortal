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

/** Reject literal "null", invalid hex, etc. before User.findById. */
function parseStudentObjectId(raw) {
  if (raw == null) return null;
  const id = String(raw).trim();
  if (!id || id === 'null' || id === 'undefined') return null;
  if (!/^[a-fA-F0-9]{24}$/.test(id)) return null;
  return id;
}

const s3Client = require('../config/s3');
const {
  isAgreementR2Configured,
  putAgreementTemplate,
  putAgreementDocx,
  getAgreementTemplateBuffer,
  getAgreementTemplateSignedUrl,
  copyAgreementObject,
  deleteAgreementTemplateFiles
} = require('../services/agreementR2Service');
const deleteFromS3 = require('../config/s3Delete');
const { getPdfPageCount, extractPagesText, normalizeFieldValues } = require('../services/agreementPdfService');
const { detectTemplateFields, generateFilledAgreement } = require('../services/agreementFillService');
const { isDocxBuffer } = require('../services/agreementDocxService');
const { suggestDynamicFields } = require('../services/agreementAiService');
const {
  detectRedDynamicFields,
  detectDynamicFields,
  locateTextInPdf
} = require('../services/agreementRedFieldDetector');
const { detectBracePlaceholders } = require('../services/agreementPlaceholderDetector');
const {
  isAllowedTemplateUpload,
  normalizeTemplateUploadToPdf,
  convertWordToPdf,
  isDocxFile,
  isWordFile,
  ensureDocxBuffer,
  isDocxBuffer: isDocxBufferFile
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

/** Convert + store template file (parallel DOCX upload, PDF conversion, R2 put, fast page count). */
async function processTemplateFileUpload(file, storageId) {
  const originalBuf = file.buffer;
  const wordUpload = isWordFile(file.mimetype, file.originalname);

  let docxBuf = null;
  if (wordUpload) {
    docxBuf = await ensureDocxBuffer(originalBuf, file.mimetype, file.originalname);
    if (!docxBuf && isDocxBufferFile(originalBuf, file.originalname)) docxBuf = originalBuf;
  }

  let pdfBuffer;
  let sourceType;
  let conversion;
  let pageCount = 0;
  let pdfWarning = null;
  let docxR2Key = null;

  try {
    const convPromise = normalizeTemplateUploadToPdf(originalBuf, file.mimetype, file.originalname, {
      docxBuffer: docxBuf || undefined
    });
    const docxPutPromise =
      docxBuf && wordUpload ? putAgreementDocx(docxBuf, storageId) : Promise.resolve(null);

    const [normalized, uploadedDocxKey] = await Promise.all([convPromise, docxPutPromise]);
    if (uploadedDocxKey) docxR2Key = uploadedDocxKey;

    pdfBuffer = normalized.pdfBuffer;
    sourceType = normalized.sourceType;
    conversion = normalized.conversion;
    if (!docxBuf && normalized.docxBuffer) {
      docxBuf = normalized.docxBuffer;
      if (!docxR2Key) docxR2Key = await putAgreementDocx(docxBuf, storageId);
    }

    if (pdfBuffer) {
      const [r2Key, count] = await Promise.all([
        putAgreementTemplate(pdfBuffer, storageId),
        getPdfPageCount(pdfBuffer)
      ]);
      pageCount = count;
      return {
        r2Key,
        docxR2Key,
        fillMode: docxR2Key ? 'docx' : 'overlay',
        pageCount,
        convertedFrom: sourceType,
        conversion,
        warning: pdfWarning
      };
    }
  } catch (convErr) {
    if (!docxR2Key) throw convErr;
    pdfWarning =
      'DOCX saved for real text editing, but PDF preview could not be generated. ' +
      'Install LibreOffice or fix Microsoft Word, then re-upload — or fill fields and use Preview on the share screen.';
    console.warn('[agreements] PDF conversion failed; DOCX stored:', convErr.message);
    sourceType = 'word';
    conversion = 'docx-only';
  }

  return {
    r2Key: null,
    docxR2Key,
    fillMode: docxR2Key ? 'docx' : 'overlay',
    pageCount,
    convertedFrom: sourceType,
    conversion,
    warning: pdfWarning
  };
}

async function relocateTemplateR2Keys(template, tempId, r2Key, docxR2Key) {
  if (!tempId || !isAgreementR2Configured()) return;
  const id = template._id.toHexString();
  if (tempId === id) return;

  const updates = {};
  const finalPdfKey = `agreements/templates/${id}/source.pdf`;
  const finalDocxKey = `agreements/templates/${id}/source.docx`;

  try {
    if (r2Key && r2Key !== finalPdfKey) {
      await copyAgreementObject(r2Key, finalPdfKey);
      updates.r2Key = finalPdfKey;
    }
    if (docxR2Key && docxR2Key !== finalDocxKey) {
      await copyAgreementObject(docxR2Key, finalDocxKey);
      updates.docxR2Key = finalDocxKey;
      updates.fillMode = 'docx';
    }
    if (Object.keys(updates).length) {
      await AgreementTemplate.findByIdAndUpdate(template._id, updates);
      if (updates.r2Key) template.r2Key = updates.r2Key;
      if (updates.docxR2Key) {
        template.docxR2Key = updates.docxR2Key;
        template.fillMode = 'docx';
      }
    }
  } catch (mvErr) {
    console.warn('⚠️  Could not move template R2 key:', mvErr.message);
  }
}

// ─── Template routes (ADMIN) ───────────────────────────────────────────────

// GET /api/agreements/templates — list active templates (?summary=1 for lean card list)
router.get('/templates', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const summary = req.query.summary === '1' || req.query.summary === 'true';
    let query = AgreementTemplate.find({ isActive: true }).sort({ name: 1 });
    if (summary) {
      query = query.select(
        'name slug description fillMode docxR2Key pageCount dynamicFields.id dynamicFields.label isActive createdAt'
      );
    } else {
      query = query.select('-aiSuggestions');
    }
    const templates = await query.lean();
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
    const tempId = new mongoose.Types.ObjectId().toHexString();
    const result = await processTemplateFileUpload(req.file, tempId);
    res.json({ success: true, tempId, ...result });
  } catch (err) {
    console.error('❌ template upload:', err);
    const status = /LibreOffice|Microsoft Word|Save As|Only PDF|formatting/i.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/templates/upload-and-create — one round-trip: upload, convert, store, create DB row
router.post(
  '/templates/upload-and-create',
  verifyToken,
  checkRole(['ADMIN']),
  memUpload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, message: 'File required (PDF, DOC, or DOCX)' });
      const name = String(req.body?.name || '').trim();
      if (!name) return res.status(400).json({ success: false, message: 'name required' });
      if (!isAgreementR2Configured()) {
        return res.status(503).json({ success: false, message: 'R2 storage is not configured' });
      }

      const slug = slugify(name);
      const existing = await AgreementTemplate.findOne({ slug });
      if (existing) {
        return res.status(409).json({ success: false, message: 'A template with this name already exists' });
      }

      const templateId = new mongoose.Types.ObjectId();
      const storageId = templateId.toHexString();
      const uploaded = await processTemplateFileUpload(req.file, storageId);
      if (!uploaded.r2Key && !uploaded.docxR2Key) {
        return res.status(400).json({ success: false, message: 'Upload failed — no file stored' });
      }

      const template = await AgreementTemplate.create({
        _id: templateId,
        name,
        slug,
        description: String(req.body?.description || '').trim(),
        r2Key: uploaded.r2Key || '',
        docxR2Key: uploaded.docxR2Key || '',
        fillMode: uploaded.fillMode,
        pageCount: uploaded.pageCount || 0,
        dynamicFields: [],
        createdBy: req.user.id
      });

      res.status(201).json({
        success: true,
        template,
        tempId: storageId,
        ...uploaded
      });
    } catch (err) {
      console.error('❌ template upload-and-create:', err);
      const status = /LibreOffice|Microsoft Word|Save As|Only PDF|formatting|already exists/i.test(err.message)
        ? 400
        : 500;
      res.status(status).json({ success: false, message: err.message });
    }
  }
);

// POST /api/agreements/templates — create template metadata
router.post('/templates', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { name, description, r2Key, docxR2Key, fillMode, pageCount, tempId } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'name required' });
    if (!r2Key && !docxR2Key) {
      return res.status(400).json({ success: false, message: 'Upload a PDF or Word (.docx) file first' });
    }

    const slug = slugify(name);
    const existing = await AgreementTemplate.findOne({ slug });
    if (existing) return res.status(409).json({ success: false, message: 'A template with this name already exists' });

    const template = await AgreementTemplate.create({
      name,
      slug,
      description: description || '',
      r2Key,
      docxR2Key: docxR2Key || '',
      fillMode: docxR2Key ? 'docx' : (fillMode || 'overlay'),
      pageCount: pageCount || 0,
      dynamicFields: [],
      createdBy: req.user.id
    });

    await relocateTemplateR2Keys(template, tempId, r2Key, docxR2Key);

    res.status(201).json({ success: true, template });
  } catch (err) {
    console.error('❌ template create:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/templates/:id/upload-docx — attach Word source for real text fill (upgrade overlay templates)
router.post('/templates/:id/upload-docx', verifyToken, checkRole(['ADMIN']), memUpload.single('docx'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '.docx file required' });
    if (!isAgreementR2Configured()) {
      return res.status(503).json({ success: false, message: 'R2 storage is not configured' });
    }
    if (!isDocxBuffer(req.file.buffer, req.file.originalname) && !isDocxFile(req.file.originalname)) {
      return res.status(400).json({
        success: false,
        message: 'Only .docx files are accepted. Save your agreement in Word as .docx with {{placeholders}}.'
      });
    }

    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

    const id = template._id.toHexString();
    let docxBuf = req.file.buffer;
    if (!isDocxBufferFile(docxBuf, req.file.originalname)) {
      docxBuf = await ensureDocxBuffer(docxBuf, req.file.mimetype, req.file.originalname);
    }
    if (!docxBuf) {
      return res.status(400).json({ success: false, message: 'Could not read .docx file' });
    }

    const updates = { fillMode: 'docx' };
    let warning = null;

    try {
      const [docxR2Key, { pdfBuffer }] = await Promise.all([
        putAgreementDocx(docxBuf, id),
        convertWordToPdf(docxBuf, 'source.docx')
      ]);
      updates.docxR2Key = docxR2Key;
      const [r2Key, pageCount] = await Promise.all([
        putAgreementTemplate(pdfBuffer, id),
        getPdfPageCount(pdfBuffer)
      ]);
      updates.r2Key = r2Key;
      updates.pageCount = pageCount;
    } catch (convErr) {
      warning =
        'DOCX attached (Word mode enabled). PDF preview failed — install LibreOffice or open Word once, then try again. ' +
        'Sharing/preview with filled fields may still work if conversion succeeds at that step.';
      console.warn('[agreements] upload-docx PDF failed:', convErr.message);
    }

    const probe = { ...template.toObject(), ...updates };
    const { fields, source } = await detectTemplateFields(probe);
    if (fields.length) updates.dynamicFields = fields;

    const updated = await AgreementTemplate.findByIdAndUpdate(id, updates, { new: true }).lean();

    res.json({
      success: true,
      template: updated,
      fillMode: 'docx',
      fields,
      source,
      warning,
      message: 'DOCX source attached. Agreements will use real text replacement (no white boxes).'
    });
  } catch (err) {
    console.error('❌ upload-docx:', err);
    const status = /LibreOffice|Microsoft Word|Save As|formatting/i.test(err.message) ? 400 : 500;
    res.status(status).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/templates/:id/detect-placeholders — {{fieldName}} markers (preferred)
router.post('/templates/:id/detect-placeholders', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    if (!isAgreementR2Configured()) {
      return res.status(503).json({ success: false, message: 'R2 not configured' });
    }
    const { fields, source } = await detectTemplateFields(template);
    res.json({ success: true, fields, count: fields.length, source });
  } catch (err) {
    console.error('❌ detect-placeholders:', err);
    const msg = err.message || 'Placeholder detection failed';
    const status = /R2 not configured|PDF/i.test(msg) ? 503 : 500;
    res.status(status).json({ success: false, message: msg });
  }
});

// POST /api/agreements/templates/:id/detect-red-fields — legacy alias
router.post('/templates/:id/detect-red-fields', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    if (!isAgreementR2Configured()) {
      return res.status(503).json({ success: false, message: 'R2 not configured' });
    }
    const { fields, source } = await detectTemplateFields(template);
    res.json({ success: true, fields, count: fields.length, source });
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
    const { fields: detected, source: detectSource } = await detectTemplateFields(template);
    if (detected.length > 0) {
      const src = detectSource === 'docx' ? 'docx' : detectSource === 'brace' ? 'brace' : 'red';
      template.aiSuggestions = detected.map((f) => ({
        id: f.id,
        label: f.label,
        page: f.page,
        sampleText: f.sampleText,
        placeholderToken: f.placeholderToken || f.sampleText,
        confidence: 'high',
        source: src
      }));
      await template.save();
      return res.json({ success: true, suggestions: template.aiSuggestions, fields: detected, source: src });
    }
    const buf = await getAgreementTemplateBuffer(template.r2Key);
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

// POST /api/agreements/templates/:id/locate-text — find field coords from selected PDF text
router.post('/templates/:id/locate-text', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { sampleText } = req.body;
    if (!sampleText || !String(sampleText).trim()) {
      return res.status(400).json({ success: false, message: 'sampleText is required' });
    }
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    if (!isAgreementR2Configured()) {
      return res.status(503).json({ success: false, message: 'R2 not configured' });
    }
    const buf = await getAgreementTemplateBuffer(template.r2Key);
    const hit = await locateTextInPdf(buf, sampleText);
    if (!hit) {
      return res.status(404).json({
        success: false,
        message: `Could not find "${sampleText}" in PDF. Use the exact text from the PDF (e.g. {{level}} or {{Level}}).`
      });
    }
    res.json({
      success: true,
      field: {
        page: hit.page,
        x: hit.x,
        y: hit.y,
        width: hit.width,
        height: hit.height,
        sampleText: hit.str || sampleText,
        placeholderToken: hit.str || sampleText,
        fontSize: hit.fontSize
      }
    });
  } catch (err) {
    console.error('❌ locate-text:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/agreements/templates/:id/fields — save confirmed dynamic fields
router.put('/templates/:id/fields', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { fields } = req.body;
    if (!Array.isArray(fields) || fields.length > 20) {
      return res.status(400).json({ success: false, message: 'Provide 1–20 dynamic fields' });
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

/** Remove student agreements (+ linked checklist docs / S3 files) for a template. */
async function deleteStudentAgreementsForTemplate(templateId) {
  const agreements = await StudentAgreement.find({ templateId }).lean();
  let removedAgreements = 0;
  let removedDocuments = 0;

  for (const agreement of agreements) {
    if (agreement.generatedFile?.s3Key) {
      await deleteFromS3(agreement.generatedFile.s3Key);
    }
    if (agreement.signedFile?.s3Key) {
      await deleteFromS3(agreement.signedFile.s3Key);
    }
    if (agreement.studentDocumentId) {
      const doc = await StudentDocument.findById(agreement.studentDocumentId).lean();
      if (doc?.filePath) await deleteFromS3(doc.filePath);
      await StudentDocument.findByIdAndDelete(agreement.studentDocumentId);
      removedDocuments++;
    }
    await StudentAgreement.findByIdAndDelete(agreement._id);
    removedAgreements++;
  }

  return { removedAgreements, removedDocuments };
}

// DELETE /api/agreements/templates/:id — permanent delete (R2 + DB) or ?soft=true to hide only
// ?cascade=true also deletes linked student agreements (test cleanup)
router.delete('/templates/:id', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const template = await AgreementTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

    if (req.query.soft === 'true') {
      await AgreementTemplate.findByIdAndUpdate(template._id, { isActive: false });
      return res.json({ success: true, message: 'Template hidden from list', mode: 'soft' });
    }

    const inUse = await StudentAgreement.countDocuments({ templateId: template._id });
    const cascade = req.query.cascade === 'true';

    if (inUse > 0 && !cascade) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete: ${inUse} student agreement(s) use this template. Hide it instead (?soft=true), use ?cascade=true to delete those agreements too, or remove them first.`
      });
    }

    let cascadeCleanup = { removedAgreements: 0, removedDocuments: 0 };
    if (inUse > 0 && cascade) {
      cascadeCleanup = await deleteStudentAgreementsForTemplate(template._id);
    }

    let r2Cleanup = { deleted: 0, errors: [] };
    if (isAgreementR2Configured()) {
      r2Cleanup = await deleteAgreementTemplateFiles(template);
    }

    await AgreementTemplate.findByIdAndDelete(template._id);

    res.json({
      success: true,
      message: cascade
        ? `Template deleted (${cascadeCleanup.removedAgreements} linked student agreement(s) removed)`
        : 'Template and R2 files deleted permanently',
      mode: cascade ? 'hard-cascade' : 'hard',
      cascadeCleanup,
      r2Cleanup
    });
  } catch (err) {
    console.error('❌ template delete:', err);
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
    const fields = template.dynamicFields || [];
    const mapped = normalizeFieldValues(fields, fieldValues);
    if (!Object.keys(mapped).length) {
      return res.status(400).json({ success: false, message: 'Enter at least one field value before preview' });
    }
    const { pdfBuffer } = await generateFilledAgreement(template, mapped);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="preview.pdf"');
    res.send(pdfBuffer);
  } catch (err) {
    console.error('❌ instance preview:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/agreements/instances/share — generate, save, optionally email
router.post('/instances/share', verifyToken, checkRole(['ADMIN']), async (req, res) => {
  try {
    const { templateId, studentId, studentEmail, fieldValues, displayName, sendEmail } = req.body;
    if (!templateId || !displayName) {
      return res.status(400).json({ success: false, message: 'templateId and displayName required' });
    }

    const template = await AgreementTemplate.findById(templateId).lean();
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

    let studentOid = parseStudentObjectId(studentId);
    let student = null;
    if (studentOid) {
      student = await User.findById(studentOid).select('name email').lean();
    }
    if (!student && studentEmail) {
      student = await User.findOne({
        email: String(studentEmail).trim().toLowerCase(),
        role: 'STUDENT'
      })
        .select('name email')
        .lean();
      if (student) studentOid = String(student._id);
    }
    if (!student) {
      return res.status(400).json({
        success: false,
        message:
          'Student not found. Open Generate Agreement from the student document profile, or ensure the student email is correct.'
      });
    }

    const fields = template.dynamicFields || [];
    const mappedValues = normalizeFieldValues(fields, fieldValues);
    if (!Object.keys(mappedValues).length) {
      return res.status(400).json({
        success: false,
        message: 'Enter at least one field value before saving or sending'
      });
    }

    // Real DOCX merge when template has source.docx; else PDF overlay fallback
    const { pdfBuffer: filledBuf, fillMode } = await generateFilledAgreement(template, mappedValues);

    // Upload generated PDF to S3
    const safeDisplay = displayName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const s3Key = `uploads/agreements/${studentOid}/${template.slug}_${Date.now()}_${safeDisplay}.pdf`;
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
      fieldValues: new Map(Object.entries(mappedValues)),
      generatedFile: { s3Key, fileName: `${safeDisplay}.pdf`, fileSize: filledBuf.length, mimeType: 'application/pdf' },
      studentDocumentId: docRecord._id,
      status: 'SENT',
      sentBy: req.user.id
    });

    // Send email to student
    if (sendEmail !== false && isDocumentEmailConfigured()) {
      try {
        const transporter = getDocumentTransporter();
        const portalUrl = (process.env.FRONTEND_URL || 'https://gluckstudentsportal.com').replace(/\/$/, '');
        const docsUrl = `${portalUrl}/student-documents`;
        await transporter.sendMail({
          from: getDocumentFromAddress(),
          to: student.email,
          cc: getDocumentCc(),
          subject: `Agreement ready for signature — ${displayName}`,
          attachments: [{ filename: `${safeDisplay}.pdf`, content: filledBuf, contentType: 'application/pdf' }],
          html: `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
              <div style="background:linear-gradient(135deg,#1a237e,#3949ab);color:white;padding:22px;text-align:center;">
                <h2 style="margin:0;">Glück Global</h2>
              </div>
              <div style="padding:24px;">
                <p>Dear <strong>${student.name}</strong>,</p>
                <p>Your agreement <strong>${displayName}</strong> is ready. The PDF is attached to this email.</p>
                <p>Please review it, sign it, and upload the signed copy in the student portal.</p>
                <div style="text-align:center;margin:24px 0;">
                  <a href="${docsUrl}" style="background:#1565c0;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:600;">
                    Check it out
                  </a>
                </div>
                <p style="font-size:13px;color:#666;">Portal: <a href="${docsUrl}">${docsUrl}</a></p>
                <p>Regards,<br><strong>Glück Global Team</strong></p>
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
      downloadUrl: `/api/agreements/instances/${agreement._id}/download`,
      message: sendEmail !== false
        ? 'Agreement saved to student portal and email sent'
        : 'Agreement saved to student portal — student can view and upload signed copy'
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
    const rawStudentId = isAdmin ? req.query.studentId : req.user.id;
    const studentOid = parseStudentObjectId(rawStudentId);
    const summary = ['1', 'true', 'yes'].includes(String(req.query.summary || '').toLowerCase());
    if (!studentOid) {
      return res.status(400).json({ success: false, message: 'Valid studentId required' });
    }

    const agreements = await StudentAgreement.find({ studentId: studentOid })
      .select(
        summary
          ? 'studentDocumentId templateName displayName generatedFile signedFile status verificationNotes sentAt verifiedAt'
          : ''
      )
      .populate('templateId', summary ? 'name slug' : 'name slug dynamicFields')
      .sort({ sentAt: -1 })
      .lean();

    res.json({ success: true, agreements });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/agreements/instances/:id/download — generated (re-filled) or signed PDF
router.get('/instances/:id/download', verifyToken, async (req, res) => {
  try {
    const agreement = await StudentAgreement.findById(req.params.id).lean();
    if (!agreement) return res.status(404).json({ success: false, message: 'Not found' });

    const isAdmin = req.user.role === 'ADMIN';
    if (!isAdmin && String(agreement.studentId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const type = req.query.type === 'signed' ? 'signed' : 'generated';

    if (type === 'signed') {
      const fileInfo = agreement.signedFile;
      if (!fileInfo?.s3Key) {
        return res.status(404).json({ success: false, message: 'signed file not found' });
      }
      const signedUrl = await createSignedS3Url(fileInfo.s3Key);
      return res.redirect(signedUrl);
    }

    const filename = agreement.generatedFile?.fileName || `${agreement.displayName || 'agreement'}.pdf`;
    const safeName = filename.replace(/"/g, '');

    if (agreement.generatedFile?.s3Key) {
      try {
        const { GetObjectCommand } = require('@aws-sdk/client-s3');
        const resp = await s3Client.send(
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: agreement.generatedFile.s3Key
          })
        );
        const chunks = [];
        for await (const chunk of resp.Body) chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `inline; filename="${safeName}"`);
        return res.send(buf);
      } catch (s3Err) {
        console.warn('[agreements] S3 read failed, regenerating PDF:', s3Err.message);
      }
    }

    const template = await AgreementTemplate.findById(agreement.templateId).lean();
    if (!template?.r2Key && !template?.docxR2Key) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    const fv = agreement.fieldValues || {};
    const mapped = normalizeFieldValues(template.dynamicFields || [], fv);
    const { pdfBuffer: filledBuf } = await generateFilledAgreement(template, mapped);

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${safeName}"`);
    res.send(filledBuf);
  } catch (err) {
    console.error('❌ agreement download:', err);
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

    let emailSent = false;
    if (status === 'REJECTED' || status === 'VERIFIED') {
      try {
        const {
          sendDocumentReuploadEmail,
          sendDocumentApprovedEmail,
          isDocumentEmailConfigured
        } = require('../config/documentEmailConfig');
        if (isDocumentEmailConfigured()) {
          if (status === 'REJECTED') {
            emailSent = await sendDocumentReuploadEmail({
              studentName: agreement.studentName,
              studentEmail: agreement.studentEmail,
              documentName: agreement.displayName,
              reason: notes || '',
              isAgreement: true
            });
          } else {
            emailSent = await sendDocumentApprovedEmail({
              studentName: agreement.studentName,
              studentEmail: agreement.studentEmail,
              documentName: agreement.displayName,
              isAgreement: true
            });
          }
        }
      } catch (mailErr) {
        console.warn(`⚠️ Agreement ${status === 'REJECTED' ? 'rejection' : 'approval'} email failed:`, mailErr.message);
      }
    }

    res.json({
      success: true,
      agreement,
      emailSent,
      message: status === 'REJECTED' && emailSent
        ? 'Rejected — student notified by email'
        : status === 'VERIFIED' && emailSent
          ? 'Approved — student notified by email'
          : status === 'VERIFIED'
            ? 'Approved (email not sent — check DOCS_EMAIL_* in .env)'
            : undefined
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
