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
//  - explainPronunciationFromScore  → { wordAnalysis, hints } for teaching UI

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

// ── Word-level explainable feedback (lightweight, no NLP deps) ─────────────

/**
 * Classify a single token pair after normalization.
 * Allows small typos (short words, edit distance 1) while still flagging
 * clearly different words.
 */
function classifyTokenPair(expectedTok, spokenTok) {
  if (!expectedTok) {
    return { status: 'incorrect', spoken: spokenTok || '' };
  }
  if (!spokenTok) {
    return { status: 'missing', spoken: '' };
  }
  if (expectedTok === spokenTok) {
    return { status: 'correct', spoken: spokenTok };
  }
  const r = levenshteinRatio(expectedTok, spokenTok);
  const d = editDistance(expectedTok, spokenTok);
  const maxLen = Math.max(expectedTok.length, spokenTok.length);
  const shortWord = maxLen <= 5;
  // Dropped ending syllable / cut short (e.g. "name" vs "nam") — still teachable as incorrect.
  if (
    spokenTok.length >= 2
    && expectedTok.startsWith(spokenTok)
    && expectedTok.length > spokenTok.length
    && expectedTok.length - spokenTok.length <= 2
    && r < 0.9
  ) {
    return { status: 'incorrect', spoken: spokenTok };
  }
  if (r >= 0.86 || (shortWord && d <= 1 && r >= 0.62)) {
    return { status: 'correct', spoken: spokenTok };
  }
  if (r >= 0.38 || d <= Math.max(2, Math.floor(maxLen * 0.4))) {
    return { status: 'incorrect', spoken: spokenTok };
  }
  return { status: 'incorrect', spoken: spokenTok };
}

/**
 * Align expected tokens to spoken tokens (sequential + one-token lookahead)
 * so insertions like an extra "uh" do not throw off the whole line.
 */
function compareWords(expectedTokens, spokenTokens) {
  const E = Array.isArray(expectedTokens) ? expectedTokens : [];
  const S = Array.isArray(spokenTokens) ? spokenTokens : [];
  const rows = [];
  let j = 0;
  for (let i = 0; i < E.length; i += 1) {
    const exp = E[i];
    if (j >= S.length) {
      rows.push({ expected: exp, spoken: '', status: 'missing' });
      continue;
    }

    let matchJ = j;
    let ratioHere = levenshteinRatio(exp, S[j]);
    if (ratioHere < 0.4 && j + 1 < S.length) {
      const ratioNext = levenshteinRatio(exp, S[j + 1]);
      if (ratioNext > ratioHere + 0.12) {
        j += 1;
        matchJ = j;
        ratioHere = ratioNext;
      }
    }

    const spokenTok = S[matchJ];
    const { status, spoken } = classifyTokenPair(exp, spokenTok);
    rows.push({ expected: exp, spoken, status });
    j = matchJ + 1;
  }
  return rows;
}

/**
 * Build wordAnalysis from the winning scoring candidate (matchedAgainst)
 * and the transcript, using the same number-canonicalisation as scoring.
 */
function buildWordAnalysis(scoreRes, transcript, lang) {
  const expectedPhrase = scoreRes?.matchedAgainst || '';
  const eCanon = canonicaliseNumbers(expectedPhrase, lang);
  const sCanon = canonicaliseNumbers(transcript || '', lang);
  const E = normalizeText(eCanon).split(/\s+/).filter(Boolean);
  const S = normalizeText(sCanon).split(/\s+/).filter(Boolean);
  if (!E.length) return [];
  return compareWords(E, S);
}

const CONSONANT_END = /[bcdfghjklmnpqrstvwxyzß]$/i;

function hintVwConflict(expected, spoken) {
  const hasV = (s) => /v/.test(s);
  const hasW = (s) => /w/.test(s);
  if (!expected || !spoken) return null;
  if (hasV(expected) && hasW(spoken) && !hasV(spoken)) {
    return 'Notice "v" and "w": take a moment to match the consonant in the target word.';
  }
  if (hasW(expected) && hasV(spoken) && !hasW(spoken)) {
    return 'Notice "v" and "w": take a moment to match the consonant in the target word.';
  }
  return null;
}

function hintTh(expected, spoken, lang) {
  if (!lang.startsWith('en')) return null;
  if (!expected.includes('th')) return null;
  if (spoken.includes('th')) return null;
  if (levenshteinRatio(expected, spoken) >= 0.92) return null;
  return 'The "th" sound needs a soft tongue-between-the-teeth airflow — try that word again slowly.';
}

/** e.g. "name" vs "nam" — word was cut short before the full ending. */
function hintTruncatedWord(row) {
  if (row.status !== 'incorrect') return null;
  const exp = row.expected || '';
  const sp = row.spoken || '';
  if (sp.length < 2 || !exp.startsWith(sp) || exp.length <= sp.length) return null;
  const tail = exp.slice(sp.length);
  if (tail.length > 2) return null;
  const lastExp = exp.slice(-1);
  if (/[mnlr]/.test(lastExp)) {
    return `Focus on the '${lastExp}' sound at the end of '${exp}'.`;
  }
  return `The word sounds a bit short — aim for '${exp}' (you said '${sp}').`;
}

function hintMissingEnding(row) {
  if (row.status !== 'incorrect' && row.status !== 'missing') return null;
  const exp = row.expected || '';
  const sp = row.spoken || '';
  if (!exp) return null;
  if (row.status === 'missing') {
    if (CONSONANT_END.test(exp)) {
      return `The word '${exp}' was missing — pay attention to the ending sound.`;
    }
    return `The word '${exp}' did not come through — try saying it clearly.`;
  }
  if (sp && exp.length >= sp.length + 1 && exp.startsWith(sp) && CONSONANT_END.test(exp)) {
    return `Focus on the ending of '${exp}' — the last sound needs to be clearer.`;
  }
  if (sp && CONSONANT_END.test(exp) && !CONSONANT_END.test(sp) && exp.slice(0, sp.length) === sp) {
    return `Focus on the ending of '${exp}' — try the final consonant a bit stronger.`;
  }
  return null;
}

/**
 * Rule-based hints from wordAnalysis (max a few, student-friendly).
 */
function generatePronunciationHints(wordAnalysis, lang) {
  const bcp = String(lang || 'de-DE');
  const hints = [];
  const seen = new Set();
  const push = (h) => {
    if (!h || seen.has(h)) return;
    seen.add(h);
    hints.push(h);
  };

  for (const row of wordAnalysis) {
    if (row.status === 'correct') continue;
    push(hintMissingEnding(row));
    push(hintTruncatedWord(row));
    push(hintVwConflict(row.expected, row.spoken));
    push(hintTh(row.expected, row.spoken, bcp.toLowerCase()));
    if (hints.length >= 5) break;
  }

  if (!hints.length && wordAnalysis.some((r) => r.status !== 'correct')) {
    push('Say the line again slowly, word by word, matching the rhythm you hear.');
  }
  return hints.slice(0, 4);
}

/**
 * Full explainable payload for API responses.
 */
function explainPronunciationFromScore(scoreRes, transcript, lang) {
  const wordAnalysis = buildWordAnalysis(scoreRes, transcript, lang);
  const hints = generatePronunciationHints(wordAnalysis, lang);
  return { wordAnalysis, hints };
}

module.exports = {
  DEFAULT_THRESHOLD,
  normalizeText,
  canonicaliseNumbers,
  calculateSimilarity,
  scorePronunciation,
  evaluateThreshold,
  computeConfidence,
  compareWords,
  buildWordAnalysis,
  generatePronunciationHints,
  explainPronunciationFromScore,
};
