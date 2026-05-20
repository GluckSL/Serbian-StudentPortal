// PDF generation for agreement templates.
// Uses pdf-lib to overlay filled values on a template PDF, and pdf-parse for text extraction.
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const pdfParse = require('pdf-parse');

/**
 * Extract text from each page of a PDF buffer.
 * Returns an array of { page (1-indexed), text } objects.
 */
async function extractPagesText(buffer) {
  const data = await pdfParse(buffer);
  const fullText = data.text || '';
  const pageCount = data.numpages || 1;
  // pdf-parse gives us full text; split by form-feed (\f) for per-page text when available
  const pageSections = fullText.split(/\f/);
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    pages.push({ page: i + 1, text: (pageSections[i] || '').trim() });
  }
  return { pages, pageCount };
}

/**
 * Generate a filled PDF by overlaying dynamic values on the template.
 * fields: AgreementTemplate.dynamicFields array
 * values: Map or plain object { fieldId: value }
 * Returns a Buffer with the modified PDF.
 */
async function generateFilledPdf(templateBuffer, fields, values) {
  const pdfDoc = await PDFDocument.load(templateBuffer);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const valueMap = values instanceof Map ? Object.fromEntries(values) : (values || {});

  for (const field of fields) {
    const value = valueMap[field.id];
    if (!value) continue;
    const pageIdx = (field.page || 1) - 1;
    const page = pages[pageIdx];
    if (!page) continue;

    const { width: pageW, height: pageH } = page.getSize();

    // Convert normalized 0-1 coords to absolute PDF points
    const absX = field.x * pageW;
    const absY = pageH - field.y * pageH - (field.height * pageH); // flip y-axis
    const absW = field.width * pageW;
    const absH = field.height * pageH;
    const fontSize = field.fontSize || 11;

    // White rectangle to cover the original sample text
    page.drawRectangle({
      x: absX,
      y: absY,
      width: absW,
      height: absH,
      color: rgb(1, 1, 1),
      opacity: 1
    });

    // Draw replacement text — simple single-line; truncate to fit
    const maxChars = Math.floor(absW / (fontSize * 0.55));
    const displayValue = String(value).length > maxChars
      ? String(value).slice(0, maxChars - 1) + '…'
      : String(value);

    page.drawText(displayValue, {
      x: absX + 2,
      y: absY + (absH - fontSize) / 2 + 1,
      size: fontSize,
      font,
      color: rgb(0, 0, 0)
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { extractPagesText, generateFilledPdf };
