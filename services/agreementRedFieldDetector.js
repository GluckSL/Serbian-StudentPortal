// Detect placeholder text drawn in red in agreement PDFs and return dynamic field coordinates.
const path = require('path');
const { pathToFileURL } = require('url');

const RED_MARKERS = ['1 0 0 rg', '1 0 0 RG', '1 0 0 k', '1 0 0 scn', '1 0 0 sc'];

function slugifyId(label) {
  const words = String(label).trim().replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'field';
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

function isRedRgbTriplet(r, g, b) {
  return r >= 0.65 && g <= 0.35 && b <= 0.35 && r > g + 0.2 && r > b + 0.2;
}

/** Find positions where PDF sets a red fill color (rg / RG / sc). */
function findRedColorPositions(s) {
  const positions = [];
  for (const marker of RED_MARKERS) {
    let idx = 0;
    while ((idx = s.indexOf(marker, idx)) !== -1) {
      positions.push(idx);
      idx += marker.length;
    }
  }
  const rgRe = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\b/g;
  let m;
  while ((m = rgRe.exec(s)) !== null) {
    const r = parseFloat(m[1]);
    const g = parseFloat(m[2]);
    const b = parseFloat(m[3]);
    if (isRedRgbTriplet(r, g, b)) positions.push(m.index);
  }
  return positions.sort((a, b) => a - b);
}

function collectTextAfterPosition(s, startIdx) {
  const window = s.slice(startIdx, startIdx + 900);
  const found = new Set();
  const tjRe = /\(([^)\\n]{1,120})\)\s*Tj/g;
  let m;
  while ((m = tjRe.exec(window)) !== null) {
    const text = decodePdfString(m[1]).trim();
    if (isLikelyPlaceholder(text)) found.add(text);
  }
  const tjArrayRe = /\[([^\]]{1,240})\]\s*TJ/g;
  while ((m = tjArrayRe.exec(window)) !== null) {
    const parts = m[1].match(/\(([^)]+)\)/g) || [];
    const text = parts.map((p) => decodePdfString(p.slice(1, -1))).join('').trim();
    if (isLikelyPlaceholder(text)) found.add(text);
  }
  return found;
}

/** Parse PDF content streams for text shown after a red fill color operator. */
function extractRedTextCandidates(buffer) {
  const s = buffer.toString('latin1');
  const candidates = new Set();
  const redPositions = findRedColorPositions(s);
  for (const pos of redPositions) {
    for (const text of collectTextAfterPosition(s, pos)) {
      candidates.add(text);
    }
  }
  return [...candidates];
}

function decodePdfString(raw) {
  return String(raw)
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyPlaceholder(text) {
  if (!text || text.length < 2 || text.length > 80) return false;
  if (/^[\d.,\s%$€£]+$/.test(text)) return false;
  return true;
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const workerPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  return pdfjs;
}

/** Text positions per page via pdf.js (for bounding boxes). */
async function getTextItemsByPage(buffer) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const pages = [];

  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];

    for (const item of tc.items) {
      if (!('str' in item) || !item.str?.trim()) continue;
      const t = item.transform;
      const fontSize = Math.hypot(t[0], t[1]) || 11;
      const x = t[4];
      const y = t[5];
      const w = item.width || fontSize * item.str.length * 0.55;
      const h = item.height || fontSize * 1.2;
      items.push({
        str: item.str.trim(),
        page: pn,
        xNorm: Math.max(0, Math.min(0.95, x / vp.width)),
        yNorm: Math.max(0, Math.min(0.95, 1 - (y + h) / vp.height)),
        widthNorm: Math.max(0.06, Math.min(0.45, w / vp.width)),
        heightNorm: Math.max(0.025, Math.min(0.1, h / vp.height)),
        fontSize: Math.round(fontSize)
      });
    }
    pages.push({ pageNum: pn, items });
  }

  await doc.destroy();
  return pages;
}

function findTextItem(pagesData, sample) {
  const lower = sample.toLowerCase();
  for (const page of pagesData) {
    const exact = page.items.find((it) => it.str === sample || it.str.toLowerCase() === lower);
    if (exact) return exact;
    const partial = page.items.find((it) => it.str.includes(sample) || sample.includes(it.str));
    if (partial) return partial;
  }
  return null;
}

function matchCandidatesToFields(candidates, pagesData) {
  const fields = [];
  const usedIds = new Set();

  for (const sample of candidates) {
    const hit = findTextItem(pagesData, sample);
    let id = slugifyId(sample);
    let n = 1;
    while (usedIds.has(id)) {
      id = `${slugifyId(sample)}${n++}`;
    }
    usedIds.add(id);

    if (hit) {
      fields.push({
        id,
        label: sample,
        page: hit.page,
        x: hit.xNorm,
        y: hit.yNorm,
        width: hit.widthNorm,
        height: hit.heightNorm,
        sampleText: hit.str,
        fontSize: hit.fontSize,
        required: true
      });
    } else {
      fields.push({
        id,
        label: sample,
        page: 1,
        x: 0.08,
        y: 0.15 + fields.length * 0.05,
        width: 0.22,
        height: 0.04,
        sampleText: sample,
        fontSize: 11,
        required: true
      });
    }
  }

  return fields.slice(0, 7);
}

/**
 * Detect dynamic fields from red-colored placeholder text in a PDF buffer.
 * @returns {Promise<Array>} dynamicFields ready for AgreementTemplate
 */
async function detectRedDynamicFields(pdfBuffer) {
  const candidates = extractRedTextCandidates(pdfBuffer);
  if (!candidates.length) return [];

  const pagesData = await getTextItemsByPage(pdfBuffer);
  return matchCandidatesToFields(candidates, pagesData);
}

/** Find coordinates for a text snippet the admin selected or pasted from the PDF. */
async function locateTextInPdf(pdfBuffer, sampleText) {
  const sample = String(sampleText || '').trim();
  if (!sample) return null;
  const pagesData = await getTextItemsByPage(pdfBuffer);
  return findTextItem(pagesData, sample);
}

module.exports = { detectRedDynamicFields, extractRedTextCandidates, locateTextInPdf };
