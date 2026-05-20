// Converts uploaded agreement templates (PDF or Word) to a PDF buffer for storage and field overlay.
const path = require('path');
const { promisify } = require('util');
const mammoth = require('mammoth');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);
const WORD_MIMES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word',
  'application/octet-stream'
]);

let libreConvertAsync = null;
try {
  const libre = require('libreoffice-convert');
  if (typeof libre.convert === 'function') {
    libreConvertAsync = promisify(libre.convert.bind(libre));
  }
} catch (e) {
  console.warn('[agreements] libreoffice-convert not loaded:', e.message);
}

function extFromName(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function isPdfFile(mimetype, originalname) {
  if (mimetype === 'application/pdf') return true;
  return extFromName(originalname) === '.pdf';
}

function isWordFile(mimetype, originalname) {
  const ext = extFromName(originalname);
  if (ext === '.doc' || ext === '.docx') return true;
  return WORD_MIMES.has(mimetype) && (ext === '.doc' || ext === '.docx');
}

function isDocxFile(originalname) {
  return extFromName(originalname) === '.docx';
}

function isAllowedTemplateUpload(mimetype, originalname) {
  const ext = extFromName(originalname);
  if (ALLOWED_EXTENSIONS.has(ext)) return true;
  if (mimetype === 'application/pdf') return true;
  if (WORD_MIMES.has(mimetype) && (ext === '.doc' || ext === '.docx')) return true;
  return false;
}

/** Build a readable PDF from plain text (used when LibreOffice is not installed). */
async function docxToPdfViaMammoth(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const text = String(result.value || '').trim();
  if (!text) {
    throw new Error('Could not read text from the Word file. Try saving as PDF and uploading that.');
  }

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 11;
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = fontSize * 1.4;
  const charsPerLine = Math.max(40, Math.floor(maxWidth / (fontSize * 0.52)));

  const wrapParagraph = (para) => {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length > charsPerLine) {
        if (line) lines.push(line);
        line = w.length > charsPerLine ? w.slice(0, charsPerLine) : w;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const blocks = text.split(/\n+/);
  for (const block of blocks) {
    const lines = wrapParagraph(block.trim() || ' ');
    for (const line of lines) {
      if (y < margin + lineHeight) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(line, {
        x: margin,
        y: y - fontSize,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        maxWidth
      });
      y -= lineHeight;
    }
    y -= lineHeight * 0.35;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

async function convertWordWithLibreOffice(buffer) {
  if (!libreConvertAsync) return null;
  try {
    const pdfBuf = await libreConvertAsync(buffer, '.pdf', undefined);
    if (!pdfBuf || pdfBuf.length === 0) return null;
    return Buffer.from(pdfBuf);
  } catch (err) {
    console.warn('[agreements] LibreOffice conversion failed:', err.message);
    return null;
  }
}

async function convertWordToPdf(buffer, originalname) {
  const ext = extFromName(originalname);

  if (ext === '.doc') {
    const viaLo = await convertWordWithLibreOffice(buffer);
    if (viaLo) return { pdfBuffer: viaLo, conversion: 'libreoffice' };
    throw new Error(
      'Legacy .doc files need LibreOffice on the server, or open the file in Word and save as DOCX or PDF.'
    );
  }

  // DOCX: prefer LibreOffice (keeps layout), fall back to mammoth + pdf-lib (text layout)
  const viaLo = await convertWordWithLibreOffice(buffer);
  if (viaLo) {
    return { pdfBuffer: viaLo, conversion: 'libreoffice' };
  }

  if (!isDocxFile(originalname) && ext !== '.docx') {
    throw new Error('Only DOCX is supported without LibreOffice. Save your file as .docx or PDF.');
  }

  const pdfBuffer = await docxToPdfViaMammoth(buffer);
  return { pdfBuffer, conversion: 'mammoth' };
}

/**
 * @returns {Promise<{ pdfBuffer: Buffer, sourceType: 'pdf' | 'word', conversion?: string }>}
 */
async function normalizeTemplateUploadToPdf(buffer, mimetype, originalname) {
  if (!buffer?.length) throw new Error('Empty file uploaded');

  if (!isAllowedTemplateUpload(mimetype, originalname)) {
    throw new Error('Only PDF, DOC, and DOCX files are allowed for agreement templates.');
  }

  if (isPdfFile(mimetype, originalname)) {
    return { pdfBuffer: buffer, sourceType: 'pdf', conversion: 'none' };
  }

  if (isWordFile(mimetype, originalname)) {
    const { pdfBuffer, conversion } = await convertWordToPdf(buffer, originalname);
    return { pdfBuffer, sourceType: 'word', conversion };
  }

  throw new Error('Only PDF, DOC, and DOCX files are allowed for agreement templates.');
}

module.exports = {
  isAllowedTemplateUpload,
  normalizeTemplateUploadToPdf
};
