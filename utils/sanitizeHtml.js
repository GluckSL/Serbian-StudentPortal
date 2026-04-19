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

/**
 * Sanitize a single HTML string coming from the client.
 * @param {string|null|undefined} raw
 * @returns {string}
 */
function sanitizeQuestionHtml(raw) {
  if (raw == null) return '';
  const str = String(raw);

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
    'translation', 'storyParagraph', 'context', 'caption', 'secondaryCaption'
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
    // pairs (matching)
    if (Array.isArray(out.pairs)) {
      out.pairs = out.pairs.map((p) =>
        p && typeof p === 'object'
          ? { ...p, left: sanitizeQuestionHtml(p.left), right: sanitizeQuestionHtml(p.right) }
          : p
      );
    }
    // acceptedVariants
    if (Array.isArray(out.acceptedVariants)) {
      out.acceptedVariants = out.acceptedVariants.map((v) =>
        typeof v === 'string' ? sanitizeQuestionHtml(v) : v
      );
    }
    return out;
  });
}

module.exports = { sanitizeQuestionHtml, sanitizeQuestions };
