const { GetObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
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
    if (e.startsWith('ocr-')) {
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

function detectPasswordProtected(buffer) {
  const str = buffer.slice(0, 2000).toString('latin1');
  return str.includes('/Encrypt') || /<<\s*\/Encrypt\s/i.test(str);
}

function convertPdfToImages(pdfBuffer) {
  if (detectPasswordProtected(pdfBuffer)) {
    log(`PDF is password-protected — cannot render`);
    return { tmpDir: null, files: [] };
  }
  const tmpDir = fs.mkdtempSync(path.join(TEMP_DIR, 'ocr-'));
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

function parseName(fullName) {
  if (!fullName) return { familyName: '', firstName: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { familyName: parts[0], firstName: '' };
  return { firstName: parts.slice(0, -1).join(' '), familyName: parts[parts.length - 1] };
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

async function extractDocument(buffer, mimeType, documentType) {
  const docLabel = documentType || 'unknown';
  log(`Extracting ${docLabel}...`);

  return processDocWithVision(buffer, mimeType, documentType);
}

const FIELD_MAP = [
  { key: 'firstName', path: ['candidate', 'firstName'] },
  { key: 'familyName', path: ['candidate', 'familyName'] },
  { key: 'gender', path: ['candidate', 'gender'] },
  { key: 'nationality', path: ['candidate', 'nationality'] },
  { key: 'dateOfBirth', path: ['candidate', 'dateOfBirth'] },
  { key: 'placeOfBirth', path: ['candidate', 'placeOfBirth'] },
  { key: 'placeOfResidence', path: ['candidate', 'placeOfResidence'] },
  { key: 'street', path: ['candidate', 'street'] },
  { key: 'houseNumber', path: ['candidate', 'houseNumber'] },
  { key: 'otherAddressInfo', path: ['candidate', 'otherAddressInfo'] },
  { key: 'postalCode', path: ['candidate', 'postalCode'] },
  { key: 'townCity', path: ['candidate', 'townCity'] },
  { key: 'country', path: ['candidate', 'country'] },
  { key: 'email', path: ['candidate', 'email'] },
  { key: 'phone', path: ['candidate', 'telephoneMobile'] },
  { key: 'jobTitle', path: ['candidate', 'jobTitle'] },
  { key: 'company', path: ['candidate', 'company'] },
  { key: 'degreeTitle', path: ['education', 'degreeTitle'] },
  { key: 'institution', path: ['education', 'institution'] },
  { key: 'graduationDate', path: ['education', 'graduationDate'] },
  { key: 'studyStartDate', path: ['education', 'studyStartDate'] },
  { key: 'studyEndDate', path: ['education', 'studyEndDate'] },
  { key: 'courseType', path: ['education', 'courseType'] },
  { key: 'thesisCompleted', path: ['education', 'thesisCompleted'] },
  { key: 'subjects', path: ['education', 'subjects'] },
  { key: 'grades', path: ['education', 'grades'] },
  { key: 'year', path: ['education', 'year'] },
  { key: 'passportNumber', path: ['candidate', 'passportNumber'] },
  { key: 'aadhaarNumber', path: ['candidate', 'aadhaarNumber'] },
  { key: 'epicNumber', path: ['candidate', 'epicNumber'] },
  { key: 'documentNumber', path: ['candidate', 'documentNumber'] },
  { key: 'studentId', path: ['candidate', 'studentId'] },
  { key: 'rollNo', path: ['candidate', 'rollNo'] },
  { key: 'certificateNo', path: ['candidate', 'certificateNo'] },
  { key: 'employeeId', path: ['candidate', 'employeeId'] },
  { key: 'language', path: ['candidate', 'language'] },
  { key: 'level', path: ['candidate', 'level'] },
  { key: 'score', path: ['candidate', 'score'] },
  { key: 'startDate', path: ['candidate', 'startDate'] },
  { key: 'endDate', path: ['candidate', 'endDate'] },
  { key: 'activity', path: ['candidate', 'activity'] },
  { key: 'organization', path: ['candidate', 'organization'] },
  { key: 'issuingAuthority', path: ['candidate', 'issuingAuthority'] },
  { key: 'issueDate', path: ['candidate', 'issueDate'] },
  { key: 'expiryDate', path: ['candidate', 'expiryDate'] },
  { key: 'examBoard', path: ['candidate', 'examBoard'] },
];

function mergeStructuredResults(merged, structured) {
  if (!structured) return;

  for (const { key, path: [parent, field] } of FIELD_MAP) {
    if (structured[key] && !merged[parent][field]) {
      merged[parent][field] = structured[key];
    }
  }

  const nameFields = [
    { field: 'fullName', target: 'candidate' },
    { field: 'fatherName', target: 'father' },
    { field: 'motherName', target: 'mother' },
  ];

  for (const { field: nameField, target } of nameFields) {
    if (structured[nameField]) {
      if (!merged[target]) merged[target] = {};
      if (!merged[target].firstName && !merged[target].familyName) {
        const parsed = parseName(structured[nameField]);
        if (parsed.firstName) merged[target].firstName = parsed.firstName;
        if (parsed.familyName) merged[target].familyName = parsed.familyName;
      }
    }
  }

  const DOC_ID_FIELDS = ['passportNumber', 'aadhaarNumber', 'epicNumber', 'documentNumber', 'studentId', 'rollNo', 'employeeId', 'certificateNo'];
  for (const k of DOC_ID_FIELDS) {
    if (structured[k] && !merged.candidate[k]) {
      merged.candidate[k] = structured[k];
    }
  }
}

module.exports = {
  extractDocument,
  downloadFromS3,
  processDocWithVision,
  convertPdfToImages,
  parseName,
  mergeStructuredResults,
};
