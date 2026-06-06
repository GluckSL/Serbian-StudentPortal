// PDF generation for agreement templates.
const path = require('path');
const { pathToFileURL } = require('url');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { sanitizeForWinAnsi } = require('./agreementPdfText');
const {
  normalizeFieldValues,
  resolveFieldPlacement,
  getTextItemsByPage,
  isBracePlaceholder
} = require('./agreementPdfFill');

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerPath = path.join(
    __dirname,
    '..',
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.worker.mjs'
  );
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  return pdfjs;
}

/** Fast page count only (no full text extraction) — used on template upload. */
async function getPdfPageCount(buffer) {
  if (!buffer?.length) return 0;
  try {
    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return pdfDoc.getPageCount();
  } catch (_) {
    try {
      const pdfjs = await loadPdfjs();
      const doc = await pdfjs
        .getDocument({ data: new Uint8Array(buffer), useSystemFonts: true })
        .promise;
      const count = doc.numPages || 1;
      await doc.destroy();
      return count;
    } catch (__) {
      return 1;
    }
  }
}

async function extractPagesText(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs
    .getDocument({ data: new Uint8Array(buffer), useSystemFonts: true })
    .promise;
  const pages = [];

  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const tc = await page.getTextContent();
    const text = tc.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .trim();
    pages.push({ page: pn, text });
  }

  await doc.destroy();
  return { pages, pageCount: doc.numPages };
}

/**
 * Overlay filled values on template PDF (preview, email attachment, download).
 * {{placeholders}} use tight boxes so layout stays intact.
 */
async function generateFilledPdf(templateBuffer, fields, values) {
  const pdfDoc = await PDFDocument.load(templateBuffer);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const valueMap = normalizeFieldValues(fields, values);
  const pagesData = await getTextItemsByPage(templateBuffer);

  for (const field of fields || []) {
    const fieldKey = field.id || field.fieldId;
    const value = valueMap[fieldKey];
    if (!value) continue;

    const place = resolveFieldPlacement(field, pagesData);
    const pageIdx = (place.page || 1) - 1;
    const page = pages[pageIdx];
    if (!page) continue;

    const { width: pageW, height: pageH } = page.getSize();
    const fontSize = place.fontSize || 11;
    const safeValue = sanitizeForWinAnsi(value);
    const token = sanitizeForWinAnsi(field.placeholderToken || field.sampleText || '');
    const tight = place.brace || isBracePlaceholder(field);
    const pad = tight ? 2 : 5;

    const absX = place.x * pageW;
    const boxTopFromBottom = pageH - place.y * pageH;
    const placeH = place.height * pageH;
    const absH = Math.max(placeH, fontSize * 1.25);
    const absY = boxTopFromBottom - absH;

    const placeholderW = place.width * pageW;
    const valueW = font.widthOfTextAtSize(safeValue, fontSize);
    const tokenW = token ? font.widthOfTextAtSize(token, fontSize) : 0;

    const coverW = tight
      ? Math.max(placeholderW, tokenW, valueW) + pad * 2
      : Math.max(placeholderW, valueW, pageW * 0.06) + pad * 2;
    const coverH = absH + (tight ? pad : pad * 2);
    const coverX = Math.max(0, absX - pad);
    const coverY = Math.max(0, absY - pad / 2);

    const maxChars = Math.floor((coverW - pad * 2) / (fontSize * 0.52));
    const displayValue =
      safeValue.length > maxChars
        ? safeValue.slice(0, Math.max(0, maxChars - 3)) + '...'
        : safeValue;

    const coverOpts = {
      x: coverX,
      y: coverY,
      width: coverW,
      height: coverH,
      color: rgb(1, 1, 1),
      opacity: 1,
      borderWidth: 0
    };

    page.drawRectangle(coverOpts);
    if (!tight) page.drawRectangle(coverOpts);

    page.drawText(displayValue, {
      x: coverX + pad,
      y: coverY + (coverH - fontSize) / 2,
      size: fontSize,
      font,
      color: rgb(0, 0, 0)
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { getPdfPageCount, extractPagesText, generateFilledPdf, normalizeFieldValues };
