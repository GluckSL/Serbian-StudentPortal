// Generate filled agreements: DOCX mail-merge (real text) or PDF overlay (fallback).
const {
  isDocxBuffer,
  detectPlaceholdersFromDocx,
  fillDocxTemplate,
  docxToPdf
} = require('./agreementDocxService');
const { generateFilledPdf, normalizeFieldValues } = require('./agreementPdfService');
const { detectDynamicFields } = require('./agreementRedFieldDetector');
const {
  getAgreementTemplateBuffer,
  getAgreementDocxBuffer,
  isAgreementR2Configured
} = require('./agreementR2Service');

/**
 * Detect fields from DOCX source if available, else PDF.
 */
async function detectTemplateFields(template) {
  if (!isAgreementR2Configured()) throw new Error('R2 is not configured');

  if (template.docxR2Key) {
    const docx = await getAgreementDocxBuffer(template.docxR2Key);
    const fields = detectPlaceholdersFromDocx(docx);
    if (fields.length) return { fields, source: 'docx' };
  }

  const pdf = await getAgreementTemplateBuffer(template.r2Key);
  const fields = await detectDynamicFields(pdf);
  const source = fields[0]?.source === 'brace' ? 'brace' : fields.length ? 'red' : 'none';
  return { fields, source };
}

/**
 * Produce filled PDF buffer — prefers real DOCX replacement.
 */
async function generateFilledAgreement(template, rawValues) {
  const fields = template.dynamicFields || [];
  const values = normalizeFieldValues(fields, rawValues);

  if (template.docxR2Key) {
    const docx = await getAgreementDocxBuffer(template.docxR2Key);
    const filledDocx = fillDocxTemplate(docx, values, fields);
    const pdfBuffer = await docxToPdf(filledDocx);
    return { pdfBuffer, fillMode: 'docx' };
  }

  const pdf = await getAgreementTemplateBuffer(template.r2Key);
  const pdfBuffer = await generateFilledPdf(pdf, fields, values);
  return { pdfBuffer, fillMode: 'overlay' };
}

module.exports = {
  detectTemplateFields,
  generateFilledAgreement,
  isDocxBuffer,
  detectPlaceholdersFromDocx
};
