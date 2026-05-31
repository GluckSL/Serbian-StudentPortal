/**
 * utils/sanitizeHtml.js
 *
 * Server-side HTML sanitizer for digital exercise question fields.
 * Strips everything except a small safe inline-formatting whitelist so that
 * rich-text formatted questions cannot carry XSS payloads into the database.
 *
 * Allowed: <b> <strong> <i> <em> <mark> <br> <u> <span>
 * All attributes are removed to prevent on* / href / src injection.
 *
 * Falls back gracefully if sanitize-html is not installed (plain-text strip).
 */

let _sanitize = null;

function getSanitize() {
  if (_sanitize !== null) return _sanitize;
  try {
    const mod = require('sanitize-html');
    _sanitize = typeof mod === 'function' ? mod : (mod.default || null);
  } catch {
    _sanitize = false; // mark as unavailable
  }
  return _sanitize;
}

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'mark', 'br', 'u', 'span'];

function decodeHtmlEntities(raw) {
  return String(raw ?? '')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * Sanitize a single HTML string coming from the client.
 * @param {string|null|undefined} raw
 * @returns {string}
 */
function sanitizeQuestionHtml(raw) {
  if (raw == null) return '';
  const str = decodeHtmlEntities(raw);

  const sanitize = getSanitize();
  if (sanitize) {
    return sanitize(str, {
      allowedTags: ALLOWED_TAGS,
      allowedAttributes: {},   // no attributes at all
      disallowedTagsMode: 'discard'
    });
  }

  // Fallback: regex strip — same logic as the client-side pipe
  return str.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tagName) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TAGS.includes(tag)) return '';
    if (tag === 'br') return '<br>';
    if (match.startsWith('</')) return `</${tag}>`;
    return `<${tag}>`;
  });
}

/**
 * Strip all HTML and return readable plain text.
 * Used for fields that are expected to be plain labels/answers.
 * @param {string|null|undefined} raw
 * @returns {string}
 */
function sanitizeQuestionPlainText(raw) {
  const decoded = decodeHtmlEntities(raw);
  const sanitize = getSanitize();
  if (sanitize) {
    return sanitize(decoded, { allowedTags: [], allowedAttributes: {} })
      .replace(/\s+/g, ' ')
      .trim();
  }
  return decoded
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Walk every text-bearing field in a questions array and sanitize it.
 * Mutates the array in place and returns it.
 * @param {Array} questions
 * @returns {Array}
 */
function sanitizeQuestions(questions) {
  if (!Array.isArray(questions)) return questions;
  const TEXT_FIELDS = [
    'question', 'prompt', 'instruction', 'example', 'sentence',
    'hint', 'explanation', 'answerExplanation', 'word', 'phonetic',
    'translation', 'storyParagraph', 'context', 'caption', 'secondaryCaption',
    'scrambledText', 'boldLetter', 'expectedWord', 'categoryTip',
    // Rearrange
    'rearrangePrompt', 'rearrangeAnswer'
  ];
  return questions.map((q) => {
    if (!q || typeof q !== 'object') return q;
    const out = { ...q };
    for (const field of TEXT_FIELDS) {
      if (typeof out[field] === 'string') {
        out[field] = sanitizeQuestionHtml(out[field]);
      }
    }
    // options array (MCQ)
    if (Array.isArray(out.options)) {
      out.options = out.options.map((o) =>
        typeof o === 'string' ? sanitizeQuestionHtml(o) : o
      );
    }
    // sampleAnswers
    if (Array.isArray(out.sampleAnswers)) {
      out.sampleAnswers = out.sampleAnswers.map((a) =>
        typeof a === 'string' ? sanitizeQuestionHtml(a) : a
      );
    }
    // pairs (matching, or singular/plural rows)
    if (Array.isArray(out.pairs)) {
      out.pairs = out.pairs.map((p) => {
        if (!p || typeof p !== 'object') return p;
        if (p.singular != null || p.plural != null) {
          return {
            singular: sanitizeQuestionPlainText(p.singular),
            plural: sanitizeQuestionPlainText(p.plural)
          };
        }
        return {
          ...p,
          left: sanitizeQuestionPlainText(p.left),
          right: sanitizeQuestionPlainText(p.right)
        };
      });
    }
    // acceptedVariants
    if (Array.isArray(out.acceptedVariants)) {
      out.acceptedVariants = out.acceptedVariants.map((v) =>
        typeof v === 'string' ? sanitizeQuestionHtml(v) : v
      );
    }
    // rearrangeTokens
    if (Array.isArray(out.rearrangeTokens)) {
      out.rearrangeTokens = out.rearrangeTokens
        .map((t) => sanitizeQuestionPlainText(t))
        .filter((t) => typeof t === 'string' && t.trim().length > 0);
    }
    return out;
  });
}

module.exports = { sanitizeQuestionHtml, sanitizeQuestionPlainText, sanitizeQuestions };
