// services/pronunciationScoring.js
//
// Pure-function helpers for comparing an expected phrase with what the
// student said. Used by POST /api/pronunciation/evaluate.
//
//  - normalizeText(text)            → lowercase, strip punctuation / diacritics,
//                                     collapse whitespace, canonicalise number words.
//  - calculateSimilarity(a, b)      → 0–100 score combining Levenshtein +
//                                     token F1 with target-coverage weighting.
//  - scorePronunciation(expected,   → { score, normalizedExpected, normalizedSpoken }
//      spoken, { variants, lang })
//  - evaluateThreshold(score, t)    → { isCorrect, threshold }

const DEFAULT_THRESHOLD = 70;

// ── Text normalisation ──────────────────────────────────────────────────────

function stripDiacritics(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeText(raw) {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Number-word ↔ digit equivalence (covers DE + EN, enough for our exercises).
const NUMBER_MAPS = {
  'de-DE': {
    '0': ['null'],
    '1': ['eins', 'ein', 'eine'],
    '2': ['zwei'],
    '3': ['drei'],
    '4': ['vier'],
    '5': ['funf', 'fuenf'],
    '6': ['sechs'],
    '7': ['sieben'],
    '8': ['acht'],
    '9': ['neun'],
    '10': ['zehn'],
    '11': ['elf'],
    '12': ['zwolf', 'zwoelf'],
  },
  'en-US': {
    '0': ['zero'],
    '1': ['one', 'a', 'an'],
    '2': ['two', 'to', 'too'],
    '3': ['three'],
    '4': ['four', 'for'],
    '5': ['five'],
    '6': ['six'],
    '7': ['seven'],
    '8': ['eight', 'ate'],
    '9': ['nine'],
    '10': ['ten'],
    '11': ['eleven'],
    '12': ['twelve'],
  },
};

function canonicaliseNumbers(text, lang) {
  const map = NUMBER_MAPS[lang] || NUMBER_MAPS['en-US'];
  const reverse = {};
  Object.entries(map).forEach(([digit, words]) => {
    reverse[digit] = digit;
    words.forEach((w) => { reverse[w] = digit; });
  });
  return normalizeText(text)
    .split(' ')
    .map((tok) => reverse[tok] || tok)
    .join(' ')
    .trim();
}

// ── Similarity ──────────────────────────────────────────────────────────────

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function levenshteinRatio(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - editDistance(a, b) / maxLen;
}

/**
 * 0–100 similarity between two already-normalised strings.
 * Combines Levenshtein + token-F1 and down-weights results when
 * only a fraction of the target was actually spoken.
 */
function calculateSimilarity(expected, spoken) {
  const a = normalizeText(spoken);
  const b = normalizeText(expected);
  if (!a || !b) return 0;
  if (a === b) return 100;

  const aTokens = a.split(' ').filter(Boolean);
  const bTokens = b.split(' ').filter(Boolean);
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const overlap = [...aSet].filter((t) => bSet.has(t)).length;
  const recall = bSet.size ? overlap / bSet.size : 0;
  const precision = aSet.size ? overlap / aSet.size : 0;
  const tokenF1 = (precision + recall) > 0
    ? (2 * precision * recall) / (precision + recall)
    : 0;

  if (a.includes(b) || b.includes(a)) {
    const coverage = Math.round(
      (Math.min(a.length, b.length) / Math.max(a.length, b.length)) * 100
    );
    return Math.round(coverage * (0.35 + 0.65 * recall));
  }

  const lev = Math.round(levenshteinRatio(a, b) * 100);
  const tokenScore = Math.round(tokenF1 * 100);
  const blended = Math.max(lev, tokenScore);
  return Math.round(blended * (0.3 + 0.7 * recall));
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Score a single (expected, spoken) pair. Tries the raw expected phrase
 * + every accepted variant, in both raw and number-canonicalised form,
 * and returns the best score.
 */
function scorePronunciation(expected, spoken, opts = {}) {
  const variants = Array.isArray(opts.variants) ? opts.variants : [];
  const lang = opts.lang || 'de-DE';
  const candidates = [expected, ...variants]
    .map((t) => String(t || '').trim())
    .filter(Boolean);

  if (!candidates.length || !String(spoken || '').trim()) {
    return {
      score: 0,
      matchedAgainst: '',
      normalizedExpected: normalizeText(expected || ''),
      normalizedSpoken: normalizeText(spoken || ''),
    };
  }

  let best = 0;
  let matchedAgainst = candidates[0];
  for (const cand of candidates) {
    const direct = calculateSimilarity(cand, spoken);
    const canonical = calculateSimilarity(
      canonicaliseNumbers(cand, lang),
      canonicaliseNumbers(spoken, lang),
    );
    const s = Math.max(direct, canonical);
    if (s > best) {
      best = s;
      matchedAgainst = cand;
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(best))),
    matchedAgainst,
    normalizedExpected: normalizeText(matchedAgainst),
    normalizedSpoken: normalizeText(spoken),
  };
}

function evaluateThreshold(score, threshold) {
  const t = Number.isFinite(Number(threshold))
    ? Math.max(0, Math.min(100, Math.round(Number(threshold))))
    : DEFAULT_THRESHOLD;
  return { isCorrect: score >= t, threshold: t };
}

/**
 * Surface a coarse-grained confidence tier derived from the numeric score.
 * Used by the frontend to pick a human-friendly tone without having to
 * duplicate our thresholds.
 *
 *   score > 80        → 'high'    ("Great job!")
 *   50 ≤ score ≤ 80   → 'medium'  ("Almost there!")
 *   score < 50        → 'low'     ("We might not have heard you clearly.")
 */
function computeConfidence(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'low';
  if (s > 80) return 'high';
  if (s >= 50) return 'medium';
  return 'low';
}

module.exports = {
  DEFAULT_THRESHOLD,
  normalizeText,
  canonicaliseNumbers,
  calculateSimilarity,
  scorePronunciation,
  evaluateThreshold,
  computeConfidence,
};
