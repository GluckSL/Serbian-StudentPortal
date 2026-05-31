// Real text replacement: fill {{placeholders}} inside DOCX, then export to PDF via Word/LibreOffice.
const Docxtemplater = require('docxtemplater');
const PizZip = require('pizzip');
const { convertWordToPdf, isDocxFile } = require('./agreementDocConvertService');

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

function slugifyId(label) {
  const words = String(label).trim().replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'field';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

function humanLabel(id) {
  return String(id)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isDocxBuffer(buffer, filename = '') {
  if (!buffer?.length) return false;
  if (isDocxFile(filename)) return true;
  return buffer[0] === 0x50 && buffer[1] === 0x4b; // PK zip (docx)
}

/** Word often splits {{tag}} across XML runs — merge so detection/replace works. */
function normalizeBraceXml(xml) {
  return xml.replace(/\{\{([\s\S]*?)\}\}/g, (full, inner) => {
    const cleaned = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    return `{{${cleaned}}}`;
  });
}

function escapeXmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read all XML parts that may contain body text. */
function extractDocxXmlText(docxBuffer) {
  const zip = new PizZip(docxBuffer);
  const parts = ['word/document.xml', 'word/header1.xml', 'word/header2.xml', 'word/footer1.xml', 'word/footer2.xml'];
  let text = '';
  for (const part of parts) {
    const file = zip.files[part];
    if (file) text += normalizeBraceXml(file.asText()) + '\n';
  }
  return text;
}

/**
 * Detect {{fieldId}} placeholders from DOCX XML (reliable, no coordinates needed).
 */
function detectPlaceholdersFromDocx(docxBuffer) {
  const xml = extractDocxXmlText(docxBuffer);
  const fields = [];
  const used = new Set();
  PLACEHOLDER_RE.lastIndex = 0;
  let m;
  while ((m = PLACEHOLDER_RE.exec(xml)) !== null) {
    const token = m[0];
    const key = token.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    const rawId = m[1];
    let id = /^[a-z][a-zA-Z0-9]*$/.test(rawId) ? rawId : slugifyId(rawId);
    if (/^[A-Z][a-zA-Z0-9]*$/.test(rawId)) id = rawId.charAt(0).toLowerCase() + rawId.slice(1);

    fields.push({
      id,
      label: humanLabel(rawId),
      page: 1,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      sampleText: token,
      placeholderToken: token,
      fontSize: 11,
      required: true,
      source: 'docx'
    });
  }
  return fields.slice(0, 20);
}

/**
 * Map form values to exact {{Tag}} names in the DOCX (docxtemplater is case-sensitive).
 */
function buildDocxRenderData(fields, values) {
  const data = { ...(values || {}) };
  for (const field of fields || []) {
    const key = field.id || field.fieldId;
    if (!key) continue;
    const val = values[key] ?? values[String(key).toLowerCase()];
    if (val == null || !String(val).trim()) continue;

    const strVal = String(val).trim();
    data[key] = strVal;

    const token = field.placeholderToken || field.sampleText || '';
    const m = token.match(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/);
    if (m) data[m[1]] = strVal;
  }
  return data;
}

/**
 * Replace {{tags}} in all DOCX XML parts (handles Word-split placeholders).
 */
function fillDocxByXmlReplace(docxBuffer, renderData) {
  const zip = new PizZip(docxBuffer);
  let replaced = 0;

  for (const fileName of Object.keys(zip.files)) {
    const entry = zip.files[fileName];
    if (entry.dir || !fileName.endsWith('.xml')) continue;

    let xml = normalizeBraceXml(entry.asText());
    for (const [tag, val] of Object.entries(renderData)) {
      if (!tag || val == null || !String(val).trim()) continue;
      const safe = escapeXmlText(String(val).trim());
      const re = new RegExp(`\\{\\{${escapeRegExp(tag)}\\}\\}`, 'g');
      const next = xml.replace(re, safe);
      if (next !== xml) {
        replaced += 1;
        xml = next;
      }
    }
    zip.file(fileName, xml);
  }

  return {
    buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    replaced
  };
}

/**
 * Replace {{tags}} inside the DOCX (true in-document editing).
 */
function fillDocxTemplate(docxBuffer, values, fields = []) {
  const renderData = fields?.length ? buildDocxRenderData(fields, values) : values || {};
  const { buffer, replaced } = fillDocxByXmlReplace(docxBuffer, renderData);
  if (replaced > 0) return buffer;

  try {
    const zip = new PizZip(docxBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{{', end: '}}' }
    });
    doc.render(renderData);
    return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (err) {
    console.warn('[agreements] docxtemplater fallback failed:', err.message);
    return buffer;
  }
}

/** Filled DOCX → PDF using Word (Windows) or LibreOffice. */
async function docxToPdf(docxBuffer) {
  const result = await convertWordToPdf(docxBuffer, 'agreement-filled.docx');
  return result.pdfBuffer;
}

module.exports = {
  isDocxBuffer,
  detectPlaceholdersFromDocx,
  fillDocxTemplate,
  docxToPdf
};
