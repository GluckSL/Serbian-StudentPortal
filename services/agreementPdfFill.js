// Helpers to map form values → PDF overlay positions.
const { getTextItemsByPage, findTextItem, slugifyId } = require('./agreementRedFieldDetector');
const { findPlaceholderToken } = require('./agreementPlaceholderDetector');

function parseRawValues(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (raw instanceof Map) return Object.fromEntries(raw);
  return { ...raw };
}

/**
 * Match submitted values to template field ids (handles label/slug aliases).
 */
function normalizeFieldValues(fields, rawValues) {
  const raw = parseRawValues(rawValues);
  const rawLower = {};
  for (const [k, v] of Object.entries(raw)) {
    rawLower[String(k).toLowerCase()] = v;
  }

  const out = {};
  for (const field of fields || []) {
    const key = field.id || field.fieldId || slugifyId(field.label || '');
    if (!key) continue;

    let val =
      raw[key] ??
      rawLower[key.toLowerCase()] ??
      (field.label ? raw[field.label] ?? rawLower[String(field.label).toLowerCase()] : undefined) ??
      (field.sampleText ? raw[field.sampleText] ?? rawLower[String(field.sampleText).toLowerCase()] : undefined);

    const slugFromLabel = field.label ? slugifyId(field.label) : '';
    if ((val == null || val === '') && slugFromLabel) {
      val = raw[slugFromLabel] ?? rawLower[slugFromLabel.toLowerCase()];
    }

    if (val != null && String(val).trim()) {
      out[key] = String(val).trim();
    }
  }

  // Include any extra keys that match a field slug
  for (const [k, v] of Object.entries(raw)) {
    if (v == null || !String(v).trim()) continue;
    for (const field of fields || []) {
      const key = field.id || field.fieldId || slugifyId(field.label || '');
      if (out[key]) continue;
      if (k === key || k.toLowerCase() === key.toLowerCase()) {
        out[key] = String(v).trim();
      }
    }
  }

  return out;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve where to draw on the PDF — prefer live text search using sampleText.
 */
function isBracePlaceholder(field) {
  const t = field.placeholderToken || field.sampleText || '';
  return /\{\{/.test(t);
}

function resolveFieldPlacement(field, pagesData) {
  const token = String(field.placeholderToken || field.sampleText || '').trim();

  if (token && pagesData?.length) {
    if (isBracePlaceholder(field)) {
      const braceHit = findPlaceholderToken(pagesData, token);
      if (braceHit) {
        return {
          page: braceHit.page,
          x: braceHit.x,
          y: braceHit.y,
          width: braceHit.width,
          height: braceHit.height,
          fontSize: braceHit.fontSize || field.fontSize || 11,
          brace: true
        };
      }
    }

    const hit = findTextItem(pagesData, token);
    if (hit) {
      return {
        page: hit.page,
        x: hit.xNorm,
        y: hit.yNorm,
        width: hit.widthNorm,
        height: hit.heightNorm,
        fontSize: hit.fontSize || field.fontSize || 11,
        brace: false
      };
    }
  }

  return {
    page: num(field.page, 1),
    x: num(field.x, 0.08),
    y: num(field.y, 0.2),
    width: num(field.width, 0.2),
    height: num(field.height, 0.04),
    fontSize: num(field.fontSize, 11),
    brace: isBracePlaceholder(field)
  };
}

module.exports = {
  normalizeFieldValues,
  resolveFieldPlacement,
  getTextItemsByPage,
  isBracePlaceholder
};
