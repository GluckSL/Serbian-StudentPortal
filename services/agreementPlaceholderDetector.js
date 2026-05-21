// Detect {{fieldName}} placeholders in agreement PDFs (recommended over red text).
const { getTextItemsByPage, slugifyId } = require('./agreementRedFieldDetector');

// {{level}}, {{studentName}}, {{Date}} — case-insensitive match
const PLACEHOLDER_TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/gi;

function humanLabelFromId(id) {
  return String(id)
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fieldIdFromRaw(rawId) {
  const raw = String(rawId || '').trim();
  if (!raw) return 'field';
  if (/^[a-z][a-zA-Z0-9]*$/.test(raw)) return raw;
  if (/^[A-Z][a-zA-Z0-9]*$/.test(raw)) return raw.charAt(0).toLowerCase() + raw.slice(1);
  return slugifyId(raw);
}

/** Group pdf.js text items that sit on the same line. */
function groupItemsIntoLines(items, yTolerance = 0.015) {
  const sorted = [...items].sort((a, b) => b.yNorm - a.yNorm || a.xNorm - b.xNorm);
  const lines = [];

  for (const item of sorted) {
    let line = lines.find((l) => Math.abs(l[0].yNorm - item.yNorm) <= yTolerance);
    if (!line) {
      line = [];
      lines.push(line);
    }
    line.push(item);
  }

  for (const line of lines) {
    line.sort((a, b) => a.xNorm - b.xNorm);
  }
  return lines;
}

/** Map character range in concatenated line text → normalized bounding box. */
function boundingBoxForSubstring(lineItems, startChar, endChar) {
  let pos = 0;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let page = lineItems[0]?.page || 1;
  let fontSize = 11;
  let hit = false;

  for (const it of lineItems) {
    const len = it.str.length;
    const itemStart = pos;
    const itemEnd = pos + len;

    if (itemEnd > startChar && itemStart < endChar) {
      hit = true;
      minX = Math.min(minX, it.xNorm);
      minY = Math.min(minY, it.yNorm);
      maxX = Math.max(maxX, it.xNorm + it.widthNorm);
      maxY = Math.max(maxY, it.yNorm + it.heightNorm);
      page = it.page;
      fontSize = it.fontSize || fontSize;
    }
    pos += len;
  }

  if (!hit) return null;

  return {
    page,
    x: minX,
    y: minY,
    width: Math.max(0.02, maxX - minX),
    height: Math.max(0.018, maxY - minY),
    fontSize
  };
}

/** Scan a line string (no gaps / with spaces) for {{tokens}}. */
function scanLineText(line, lineItems, usedTokens, fields) {
  for (const joiner of ['', ' ']) {
    const lineText = joiner ? line.map((it) => it.str).join(' ') : line.map((it) => it.str).join('');
    PLACEHOLDER_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = PLACEHOLDER_TOKEN_RE.exec(lineText)) !== null) {
      const token = m[0];
      const key = token.toLowerCase();
      if (usedTokens.has(key)) continue;
      usedTokens.add(key);

      const rawId = m[1];
      const fieldId = fieldIdFromRaw(rawId);
      const box = boundingBoxForSubstring(line, m.index, m.index + token.length);
      if (!box) continue;

      fields.push({
        id: fieldId,
        label: humanLabelFromId(rawId),
        page: box.page,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        sampleText: token,
        placeholderToken: token,
        fontSize: box.fontSize,
        required: true,
        source: 'brace'
      });
    }
  }
}

/**
 * Find all {{fieldId}} tokens with precise positions (layout-safe).
 */
function findBracePlaceholdersInPages(pagesData) {
  const fields = [];
  const usedTokens = new Set();

  for (const page of pagesData) {
    const lines = groupItemsIntoLines(page.items);
    for (const line of lines) {
      scanLineText(line, line, usedTokens, fields);
    }

    // Whole-page pass (handles placeholders split across adjacent text runs)
    const sorted = [...page.items].sort((a, b) => b.yNorm - a.yNorm || a.xNorm - b.xNorm);
    if (sorted.length) {
      scanLineText(sorted, sorted, usedTokens, fields);
    }
  }

  return fields;
}

/** Find one {{token}} on the PDF (case-insensitive). */
function findPlaceholderToken(pagesData, token) {
  const needle = String(token || '').trim();
  if (!needle.includes('{{')) return null;
  const needleLower = needle.toLowerCase();

  for (const page of pagesData) {
    const lines = groupItemsIntoLines(page.items);
    for (const line of lines) {
      for (const joiner of ['', ' ']) {
        const lineText = joiner ? line.map((it) => it.str).join(' ') : line.map((it) => it.str).join('');
        const idx = lineText.toLowerCase().indexOf(needleLower);
        if (idx === -1) continue;
        const box = boundingBoxForSubstring(line, idx, idx + needle.length);
        if (box) return { ...box, str: lineText.slice(idx, idx + needle.length) };
      }
    }
    const sorted = [...page.items].sort((a, b) => b.yNorm - a.yNorm || a.xNorm - b.xNorm);
    for (const joiner of ['', ' ']) {
      const lineText = joiner ? sorted.map((it) => it.str).join(' ') : sorted.map((it) => it.str).join('');
      const idx = lineText.toLowerCase().indexOf(needleLower);
      if (idx === -1) continue;
      const box = boundingBoxForSubstring(sorted, idx, idx + needle.length);
      if (box) return { ...box, str: lineText.slice(idx, idx + needle.length) };
    }
  }
  return null;
}

async function detectBracePlaceholders(pdfBuffer) {
  const pagesData = await getTextItemsByPage(pdfBuffer);
  return findBracePlaceholdersInPages(pagesData);
}

module.exports = {
  detectBracePlaceholders,
  findBracePlaceholdersInPages,
  findPlaceholderToken
};
