const { GetObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const StudentDocument = require('../models/StudentDocument');
const StudentExtractedData = require('../models/StudentExtractedData');
const User = require('../models/User');
const pdfParse = require('pdf-parse');
const visionOcrService = require('./visionOcrService');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BUCKET = process.env.S3_BUCKET;
const TEMP_DIR = path.join(__dirname, '..', 'temp');
fs.mkdirSync(TEMP_DIR, { recursive: true });

try {
  const entries = fs.readdirSync(TEMP_DIR);
  for (const e of entries) {
    if (e.startsWith('ocr-') || e.startsWith('pdftotext-')) {
      fs.rmSync(path.join(TEMP_DIR, e), { recursive: true, force: true });
    }
  }
} catch (e) {
  console.error('[OCR] Failed to clean stale temp dirs:', e.message);
}

function log(...args) {
  console.log(`[OCR]`, ...args);
}

function extractS3Key(fileUrlOrKey = '') {
  if (!fileUrlOrKey) return '';
  if (!String(fileUrlOrKey).startsWith('http')) return String(fileUrlOrKey).replace(/^\//, '');
  try {
    const parsed = new URL(fileUrlOrKey);
    return parsed.pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

async function downloadFromS3(filePath) {
  const key = extractS3Key(filePath);
  log(`Downloading from S3: key="${key}"`);
  if (!key) throw new Error(`Could not extract S3 key from: ${filePath}`);
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  const response = await s3Client.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  const buf = Buffer.concat(chunks);
  return buf;
}

async function extractTextFromPDF(buffer) {
  if (detectPasswordProtected(buffer)) {
    log(`PDF is password-protected`);
    return null;
  }
  try {
    const data = await pdfParse(buffer);
    const textLen = (data.text || '').trim().length;
    if (textLen > 20) {
      return data.text.trim();
    }
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('password') || msg.includes('encrypt') || msg.includes('/encrypt')) {
      log(`PDF is password-protected`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(    TEMP_DIR, 'pdftotext-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  fs.writeFileSync(inputPath, buffer);
  try {
    const output = execSync(`pdftotext "${inputPath}" - 2>/dev/null`, { encoding: 'utf-8', timeout: 30000 });
    const textLen = (output || '').trim().length;
    if (textLen > 20) {
      return output.trim();
    }
  } catch (e) {
    log(`pdftotext failed: ${e.message}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return null;
}

function detectPasswordProtected(buffer) {
  const str = buffer.slice(0, 2000).toString('latin1');
  return str.includes('/Encrypt') || /<<\s*\/Encrypt\s/i.test(str);
}

function convertPdfToImages(pdfBuffer) {
  if (detectPasswordProtected(pdfBuffer)) {
    log(`PDF is password-protected — cannot render`);
    return { tmpDir: null, files: [] };
  }
  const tmpDir = fs.mkdtempSync(path.join(    TEMP_DIR, 'ocr-'));
  const inputPath = path.join(tmpDir, 'input.pdf');
  const outputPrefix = path.join(tmpDir, 'page');
  fs.writeFileSync(inputPath, pdfBuffer);
  try {
    execSync(`pdftoppm -png -r 300 "${inputPath}" "${outputPrefix}"`, { timeout: 60000 });
  } catch (e) {
    log(`pdftoppm failed, trying ImageMagick...`);
    execSync(`convert -density 300 "${inputPath}" -quality 90 "${outputPrefix}.png"`, { timeout: 60000 });
  }
  const files = fs.readdirSync(tmpDir)
    .filter(f => f.startsWith('page') && f.endsWith('.png'))
    .sort()
    .map(f => path.join(tmpDir, f));
  log(`Generated ${files.length} page image(s)`);
  return { tmpDir, files };
}

async function ocrImageFile(imagePath) {
  log(`OCR'ing ${path.basename(imagePath)}...`);
  const buffer = fs.readFileSync(imagePath);
  const result = await visionOcrService.extractTextWithVision(buffer, 'image/png');
  return result.rawText || null;
}

async function extractTextFromImage(buffer) {
  log(`Processing image via Vision API...`);
  const result = await visionOcrService.extractTextWithVision(buffer, 'image/png');
  return result.rawText || null;
}

async function extractTextFromScannedPdf(buffer) {
  const { tmpDir, files } = convertPdfToImages(buffer);
  if (!tmpDir) {
    log(`Could not process scanned PDF`);
    return null;
  }
  try {
    const texts = [];
    for (const file of files) {
      const text = await ocrImageFile(file);
      if (text) texts.push(text);
    }
    const combined = texts.join('\n\n');
    return combined || null;
  } finally {
    if (!process.env.KEEP_TEMP_FILES) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

async function extractText(buffer, mimeType) {
  const isPDF = mimeType === 'application/pdf' || (!mimeType && buffer.slice(0, 5).toString() === '%PDF-');
  log(`Extracting text from ${isPDF ? 'PDF' : 'image'}...`);

  if (isPDF) {
    const text = await extractTextFromPDF(buffer);
    if (text) return text;
    return extractTextFromScannedPdf(buffer);
  }
  return extractTextFromImage(buffer);
}

function parseName(fullName) {
  if (!fullName) return { familyName: '', firstName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { familyName: parts[0], firstName: '' };
  return { firstName: parts.slice(0, -1).join(' '), familyName: parts[parts.length - 1] };
}

async function processTextDocWithGPT(buffer, documentType) {
  log(`Text-extracting PDF for ${documentType || 'unknown'}...`);
  const text = await extractTextFromPDF(buffer);
  if (!text) return null;
  log(`Extracted ${text.length} chars, sending to GPT...`);
  return visionOcrService.extractStructuredFromText(text, documentType);
}

async function processDocWithVision(buffer, mimeType, documentType) {
  const isPDF = mimeType === 'application/pdf' || (!mimeType && buffer.slice(0, 5).toString() === '%PDF-');
  const docLabel = documentType || 'unknown';

  if (isPDF) {
    log(`Vision OCR for ${docLabel}...`);
    const { tmpDir, files } = convertPdfToImages(buffer);
    if (!tmpDir || files.length === 0) {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      log(`No images generated for ${docLabel}`);
      return null;
    }
    try {
      const imageBuffer = fs.readFileSync(files[0]);
      return await visionOcrService.extractTextWithVision(imageBuffer, 'image/png', documentType);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return visionOcrService.extractTextWithVision(buffer, mimeType, documentType);
}

const FIELD_MAP = [
  { key: 'firstName',      path: ['candidate', 'firstName'] },
  { key: 'familyName',     path: ['candidate', 'familyName'] },
  { key: 'gender',         path: ['candidate', 'gender'] },
  { key: 'nationality',    path: ['candidate', 'nationality'] },
  { key: 'dateOfBirth',    path: ['candidate', 'dateOfBirth'] },
  { key: 'placeOfBirth',   path: ['candidate', 'placeOfBirth'] },
  { key: 'street',         path: ['candidate', 'street'] },
  { key: 'houseNumber',    path: ['candidate', 'houseNumber'] },
  { key: 'postalCode',     path: ['candidate', 'postalCode'] },
  { key: 'townCity',       path: ['candidate', 'townCity'] },
  { key: 'country',        path: ['candidate', 'country'] },
  { key: 'email',          path: ['candidate', 'email'] },
  { key: 'phone',          path: ['candidate', 'telephoneMobile'] },
  { key: 'jobTitle',       path: ['candidate', 'placeOfResidence'] },
  { key: 'company',        path: ['candidate', 'otherAddressInfo'] },
  { key: 'degreeTitle',    path: ['education', 'degreeTitle'] },
  { key: 'institution',    path: ['education', 'institution'] },
  { key: 'graduationDate', path: ['education', 'graduationDate'] },
  { key: 'studyStartDate', path: ['education', 'studyStartDate'] },
  { key: 'studyEndDate',   path: ['education', 'studyEndDate'] },
  { key: 'courseType',     path: ['education', 'courseType'] },
  { key: 'subjects',       path: ['education', 'subjects'] },
  { key: 'grades',         path: ['education', 'grades'] },
  { key: 'year',           path: ['education', 'year'] },
];

const NAME_FIELDS = ['fullName', 'fatherName', 'motherName'];
const NAME_TARGETS = { fullName: 'candidate', fatherName: 'father', motherName: 'mother' };

const DOC_ID_FIELDS = ['passportNumber', 'aadhaarNumber', 'epicNumber', 'documentNumber', 'studentId', 'rollNo', 'employeeId', 'certificateNo'];

function applyStructured(extracted, structured) {
  if (!structured) return;
  const s = structured;

  for (const { key, path: [parent, field] } of FIELD_MAP) {
    if (s[key]) {
      if (!extracted[parent]) extracted[parent] = {};
      if (!extracted[parent][field]) {
        extracted[parent][field] = s[key];
      }
    }
  }

  for (const nameField of NAME_FIELDS) {
    if (s[nameField]) {
      const target = NAME_TARGETS[nameField];
      if (!extracted[target]) extracted[target] = {};
      const parsed = parseName(s[nameField]);
      if (parsed.firstName && !extracted[target].firstName) extracted[target].firstName = parsed.firstName;
      if (parsed.familyName && !extracted[target].familyName) extracted[target].familyName = parsed.familyName;
    }
  }

  const docIds = DOC_ID_FIELDS.filter(k => s[k]).map(k => {
    const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
    return `${label}: ${s[k]}`;
  });
  if (docIds.length > 0) {
    if (!extracted.candidate) extracted.candidate = {};
    const existing = extracted.candidate.documentNumbers || '';
    const newIds = docIds.filter(id => !existing.includes(id.split(':')[0].trim()));
    if (newIds.length > 0) {
      extracted.candidate.documentNumbers = existing ? existing + '; ' + newIds.join('; ') : newIds.join('; ');
    }
  }
}

async function processSingleDocument(doc, { buffer, dryRun } = {}) {
  const studentId = doc.studentId?._id || doc.studentId;
  const logLabel = `${doc.documentType || 'unknown'} / ${doc.fileName || 'unnamed'}`;
  log(`Processing ${logLabel}...`);

  let extracted = null;
  if (!dryRun) {
    extracted = await StudentExtractedData.findOne({ studentId });
    if (!extracted) {
      const student = await User.findById(studentId).select('regNo').lean();
      extracted = new StudentExtractedData({
        studentId,
        regNo: student?.regNo || '',
      });
    }

    if ((extracted.documentsUsed || []).some(d => d.filePath === doc.filePath)) {
      log(`Already processed: ${doc.filePath}`);
      return { extracted, result: null };
    }
  }

  const fileBuffer = buffer || await downloadFromS3(doc.filePath);
  const docType = (doc.documentType || '').toUpperCase();

  let result = null;
  if (doc.mimeType === 'application/pdf') {
    result = await processTextDocWithGPT(fileBuffer, docType);
  }
  if (!result) {
    result = await processDocWithVision(fileBuffer, doc.mimeType, docType);
  }

  if (result && !dryRun && extracted) {
    applyStructured(extracted, result.structured);
    extracted.documentsUsed = extracted.documentsUsed || [];
    extracted.documentsUsed.push({
      documentTypeId: doc.documentTypeId,
      documentType: doc.documentType,
      fileName: doc.fileName,
      filePath: doc.filePath,
      documentName: doc.documentName,
    });
    await extracted.save();
  }

  log(`Done processing ${logLabel}`);
  return { extracted, result };
}

async function runOcrForStudent(studentId) {
  const student = await User.findById(studentId);
  if (!student || student.role !== 'STUDENT') {
    throw new Error('Student not found');
  }

  let extracted = await StudentExtractedData.findOne({ studentId });
  if (!extracted) {
    extracted = new StudentExtractedData({
      studentId: student._id,
      regNo: student.regNo || '',
    });
  }

  extracted.ocrStatus = 'PROCESSING';
  await extracted.save();

  try {
    const docs = await StudentDocument.find({
      studentId,
      isCurrent: true,
      status: { $ne: 'REJECTED' },
      mimeType: { $in: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'] },
    }).lean();

    if (!docs || docs.length === 0) {
      extracted.ocrStatus = 'COMPLETED';
      extracted.ocrProcessedAt = new Date();
      extracted.documentsUsed = extracted.documentsUsed || [];
      await extracted.save();
      return extracted;
    }

    const allProcessed = docs.every(d =>
      (extracted.documentsUsed || []).some(u => u.filePath === d.filePath)
    );

    if (allProcessed) {
      extracted.ocrStatus = 'COMPLETED';
      extracted.ocrProcessedAt = new Date();
      await extracted.save();
      return extracted;
    }

    for (const doc of docs) {
      try {
        await processSingleDocument(doc);
      } catch (docErr) {
        console.error(`[OCR] Failed ${doc.fileName}: ${docErr.message}`);
      }
    }

    extracted = await StudentExtractedData.findOne({ studentId });

    if (!extracted.candidate?.email && student.email) {
      if (!extracted.candidate) extracted.candidate = {};
      extracted.candidate.email = student.email;
    }
    if (!extracted.candidate?.familyName && !extracted.candidate?.firstName && student.name) {
      const n = parseName(student.name);
      if (!extracted.candidate) extracted.candidate = {};
      if (!extracted.candidate.familyName) extracted.candidate.familyName = n.familyName;
      if (!extracted.candidate.firstName) extracted.candidate.firstName = n.firstName;
    }

    extracted.ocrStatus = 'COMPLETED';
    extracted.ocrProcessedAt = new Date();
    await extracted.save();
    return extracted;
  } catch (err) {
    extracted.ocrStatus = 'FAILED';
    await extracted.save();
    throw err;
  }
}

let batchRunning = false;
const activityLog = require('./googleSheetActivityLog');

async function runOcrForAllStudents() {
  if (batchRunning || activityLog.isJobRunning()) {
    throw new Error('Batch OCR is already in progress. Please wait for it to complete.');
  }
  batchRunning = true;

  try {
    const students = await User.find({ role: 'STUDENT', isTestAccount: { $ne: true } }).select('_id regNo name email').lean();
    const total = students.length;
    log(`Starting batch OCR for ${total} students`);
    activityLog.startJob('ocr', total, `Starting OCR for ${total} students…`);
    const results = [];
    const logEvery = Math.max(1, Math.floor(total / 25));
    for (let i = 0; i < total; i++) {
      const student = students[i];
      try {
        await runOcrForStudent(student._id);
        results.push({ studentId: student._id, regNo: student.regNo, status: 'ok' });
        log(`[${i + 1}/${total}] Done: ${student.regNo || student._id}`);
      } catch (err) {
        results.push({ studentId: student._id, regNo: student.regNo, status: 'error', error: err.message });
        console.error(`[OCR] [${i + 1}/${total}] Failed: ${student.regNo || student._id} — ${err.message}`);
      }
      if ((i + 1) % logEvery === 0 || i === total - 1) {
        const ok = results.filter((r) => r.status === 'ok').length;
        const failed = results.length - ok;
        activityLog.setJobProgress(
          i + 1,
          total,
          `OCR ${i + 1} / ${total} — ✓ ${ok}${failed ? `, ✗ ${failed}` : ''}`,
        );
      }
    }
    const ok = results.filter(r => r.status === 'ok').length;
    const failed = total - ok;
    log(`Batch complete: ${ok}/${total} done`);
    activityLog.endJob(failed === 0, `✓ OCR complete: ${ok} / ${total} succeeded${failed ? `, ${failed} failed` : ''}`);
    return results;
  } catch (err) {
    activityLog.endJob(false, `✗ OCR batch failed: ${err.message}`);
    throw err;
  } finally {
    batchRunning = false;
  }
}

async function runOcrForSelectedStudents(studentIds) {
  if (batchRunning || activityLog.isJobRunning()) {
    throw new Error('Batch OCR is already in progress. Please wait for it to complete.');
  }
  batchRunning = true;

  try {
    const total = studentIds.length;
    log(`Starting selected OCR for ${total} students`);
    activityLog.startJob('ocr', total, `Starting OCR for ${total} selected students…`);
    const results = [];
    for (let i = 0; i < total; i++) {
      const id = studentIds[i];
      try {
        const result = await runOcrForStudent(id);
        results.push({ studentId: id, regNo: result.regNo, status: 'ok' });
        log(`[${i + 1}/${total}] Done: ${result.regNo || id}`);
        activityLog.setJobProgress(i + 1, total, `✓ ${result.regNo || id} (${i + 1} / ${total})`);
      } catch (err) {
        results.push({ studentId: id, regNo: '', status: 'error', error: err.message });
        console.error(`[OCR] [${i + 1}/${total}] Failed: ${id} — ${err.message}`);
        activityLog.append('error', `✗ ${id}: ${err.message}`);
      }
    }
    const ok = results.filter(r => r.status === 'ok').length;
    const failed = total - ok;
    log(`Selected batch complete: ${ok}/${total} done`);
    activityLog.endJob(failed === 0, `✓ Selected OCR: ${ok} / ${total} succeeded${failed ? `, ${failed} failed` : ''}`);
    return results;
  } catch (err) {
    activityLog.endJob(false, `✗ Selected OCR failed: ${err.message}`);
    throw err;
  } finally {
    batchRunning = false;
  }
}

module.exports = { runOcrForStudent, runOcrForAllStudents, runOcrForSelectedStudents, extractText, processDocWithVision, processTextDocWithGPT, processSingleDocument, parseName };
