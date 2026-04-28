const DEFAULT_THRESHOLD = 70;

const EN_CONTRACTIONS = {
  "can't": 'cannot',
  "won't": 'will not',
  "don't": 'do not',
  "didn't": 'did not',
  "it's": 'it is',
  "i'm": 'i am',
  "you're": 'you are',
  "we're": 'we are',
  "they're": 'they are',
  "i've": 'i have',
  "we've": 'we have',
  "they've": 'they have',
  "isn't": 'is not',
  "aren't": 'are not',
  "wasn't": 'was not',
  "weren't": 'were not',
  "shouldn't": 'should not',
  "wouldn't": 'would not',
  "couldn't": 'could not',
};

const FILLER_WORDS = new Set([
  'uh', 'um', 'erm', 'er', 'ah', 'hmm', 'mm', 'mmm', 'like',
]);

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

// German articles and minor words that should receive near-zero missing penalty
const GERMAN_ARTICLES = new Set(['der', 'die', 'das', 'den', 'dem', 'ein', 'eine']);
const GERMAN_MINOR_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'ein', 'eine',
  'in', 'an', 'auf', 'zu', 'mit', 'von', 'bei', 'und', 'oder',
]);
const GERMAN_IMPORTANT_WORDS_WEIGHT = 1.0;
const GERMAN_MINOR_WORDS_WEIGHT = 0.3;

// Fuzzy matching threshold — words are considered equivalent at or above this
const FUZZY_MATCH_THRESHOLD = 0.8;

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function stripDiacritics(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeUmlauts(s) {
  return String(s || '')
    .replace(/[Ää]/g, 'a')
    .replace(/[Öö]/g, 'o')
    .replace(/[Üü]/g, 'u')
    .replace(/ß/g, 'ss');
}

function normalizeText(raw) {
  const withUmlauts = normalizeUmlauts(String(raw || ''));
  return stripDiacritics(withUmlauts)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandContractions(text, lang) {
  const lowerLang = String(lang || '').toLowerCase();
  if (!lowerLang.startsWith('en')) return String(text || '');
  return String(text || '').replace(/\b[\w']+\b/g, (token) => EN_CONTRACTIONS[token.toLowerCase()] || token);
}

function canonicaliseNumbers(text, lang) {
  const map = NUMBER_MAPS[lang] || NUMBER_MAPS['en-US'];
  const reverse = {};
  Object.entries(map).forEach(([digit, words]) => {
    reverse[digit] = digit;
    words.forEach((w) => { reverse[w] = digit; });
  });
  return normalizeText(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => reverse[tok] || tok)
    .join(' ')
    .trim();
}

function tokenizeAndNormalize(raw, lang) {
  const expanded = expandContractions(raw, lang);
  const canonical = canonicaliseNumbers(expanded, lang);
  return normalizeText(canonical)
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !FILLER_WORDS.has(t));
}

// --- Fuzzy matching helpers ---

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/**
 * Returns similarity in [0, 1] between two normalized words.
 * 1.0 = identical, 0.0 = completely different.
 */
function getSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const na = String(a).toLowerCase().trim();
  const nb = String(b).toLowerCase().trim();
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

/**
 * Guards against false-positive fuzzy matches by requiring:
 * - similarity ≥ threshold
 * - word length difference ≤ 2 (avoids "bin" matching "beginnen")
 * - same two-letter prefix (avoids "erste" matching "andere")
 */
function isValidFuzzyMatch(a, b, similarity) {
  if (similarity < FUZZY_MATCH_THRESHOLD) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  const minLen = Math.min(a.length, b.length);
  if (minLen >= 2 && a.slice(0, 2) !== b.slice(0, 2)) return false;
  return true;
}

/**
 * Finds the best valid fuzzy match for expToken in the spoken token list.
 * Returns the index of the match or -1.
 */
function findBestFuzzyMatch(expToken, spokenTokens, usedFlags) {
  let bestIdx = -1;
  let bestSim = 0;
  for (let i = 0; i < spokenTokens.length; i++) {
    if (usedFlags[i]) continue;
    const sim = getSimilarity(expToken, spokenTokens[i]);
    if (isValidFuzzyMatch(expToken, spokenTokens[i], sim) && sim > bestSim) {
      bestSim = sim;
      bestIdx = i;
    }
  }
  return bestIdx;
}

// --- Token comparison ---

function findMatchedWords(expectedTokens, spokenTokens) {
  const spokenUsed = new Array(spokenTokens.length).fill(false);
  const matched = [];
  for (const expToken of expectedTokens) {
    const idx = findBestFuzzyMatch(expToken, spokenTokens, spokenUsed);
    if (idx !== -1) {
      spokenUsed[idx] = true;
      matched.push(expToken);
    }
  }
  return matched;
}

function buildFeedbackFromTokens(expectedTokens, spokenTokens) {
  const spokenUsed = new Array(spokenTokens.length).fill(false);
  const matchedWords = [];
  const missingWords = [];

  for (const expToken of expectedTokens) {
    const idx = findBestFuzzyMatch(expToken, spokenTokens, spokenUsed);
    if (idx !== -1) {
      spokenUsed[idx] = true;
      matchedWords.push(expToken);
    } else {
      missingWords.push(expToken);
    }
  }

  const extraWords = spokenTokens.filter((_, i) => !spokenUsed[i]);
  return { matchedWords, missingWords, extraWords };
}

function computeOrderPenalty(expectedTokens, spokenTokens) {
  if (expectedTokens.length <= 1 || spokenTokens.length <= 1) return 0;
  const used = new Array(spokenTokens.length).fill(false);
  let lastIdx = -1;
  let inOrder = 0;
  let matchedTotal = 0;

  for (const expected of expectedTokens) {
    const chosen = findBestFuzzyMatch(expected, spokenTokens, used);
    if (chosen === -1) continue;
    used[chosen] = true;
    matchedTotal += 1;
    if (chosen >= lastIdx) {
      inOrder += 1;
      lastIdx = chosen;
    }
  }

  if (matchedTotal <= 1) return 0;
  const inOrderRatio = inOrder / matchedTotal;
  return clamp(1 - inOrderRatio, 0, 1);
}

// --- Boost safety guard ---

/**
 * Returns true when the meaning-preserving boost should be suppressed.
 *
 * Boost is unsafe when:
 * - Any major (non-minor) expected word is missing from spoken
 * - Word order is significantly disrupted (orderPenalty ≥ 0.25)
 * - The first two structural words (subject / verb position) are absent
 */
function shouldDisableBoost(expectedTokens, spokenTokens, missingWords, orderPenalty) {
  // Major words missing → sentence meaning is incomplete
  const missingMajorWords = missingWords.filter((w) => !GERMAN_MINOR_WORDS.has(w));
  if (missingMajorWords.length > 0) return true;

  // Significant word-order disruption → do not mask with a boost
  if (orderPenalty >= 0.25) return true;

  // Verify the first two major expected words (subject + verb pattern) are spoken
  const majorExpected = expectedTokens.filter((w) => !GERMAN_MINOR_WORDS.has(w));
  for (const word of majorExpected.slice(0, 2)) {
    const present = spokenTokens.some((s) => isValidFuzzyMatch(word, s, getSimilarity(word, s)));
    if (!present) return true;
  }

  return false;
}

// --- Dynamic thresholds ---

function getDynamicThresholds(sentenceLength) {
  if (sentenceLength <= 4) return { correct: 70, almostCorrect: 50 };
  if (sentenceLength <= 8) return { correct: 75, almostCorrect: 55 };
  return { correct: 80, almostCorrect: 60 };
}

// --- Similarity (public) ---

function calculateSimilarity(expected, spoken, lang = 'de-DE') {
  const e = tokenizeAndNormalize(expected, lang);
  const s = tokenizeAndNormalize(spoken, lang);
  if (!e.length || !s.length) return 0;
  const matched = findMatchedWords(e, s).length;
  return Math.round((matched / e.length) * 100);
}

// --- Core scoring ---

function scoreCandidate(expectedPhrase, spoken, opts = {}) {
  const lang = opts.lang || 'de-DE';
  const attemptCount = Number(opts.attemptCount || 0);
  const expectedTokens = tokenizeAndNormalize(expectedPhrase, lang);
  const spokenTokens = tokenizeAndNormalize(spoken, lang);
  const expectedJoined = expectedTokens.join(' ');
  const spokenJoined = spokenTokens.join(' ');

  console.log('[PronunciationScoring] Expected tokens:', expectedTokens);
  console.log('[PronunciationScoring] Spoken tokens  :', spokenTokens);

  if (!expectedTokens.length) {
    return {
      score: 0,
      expectedTokens,
      spokenTokens,
      normalizedExpected: expectedJoined,
      normalizedSpoken: spokenJoined,
      wordCoverage: 0,
      missingWordsPenalty: 1,
      extraWordsPenalty: 1,
      orderPenalty: 1,
      feedback: { missingWords: [], extraWords: spokenTokens, matchedWords: [], suggestion: 'Please try saying the expected phrase clearly.' },
    };
  }

  const feedback = buildFeedbackFromTokens(expectedTokens, spokenTokens);
  const matchedCount = feedback.matchedWords.length;
  const missingCount = feedback.missingWords.length;
  const extraCount = feedback.extraWords.length;
  let totalWeight = 0;
  let matchedWeight = 0;
  const matchedRemaining = Object.create(null);
  for (const word of feedback.matchedWords) {
    matchedRemaining[word] = (matchedRemaining[word] || 0) + 1;
  }

  for (const token of expectedTokens) {
    const isMinor = GERMAN_MINOR_WORDS.has(token);
    const weight = isMinor ? GERMAN_MINOR_WORDS_WEIGHT : GERMAN_IMPORTANT_WORDS_WEIGHT;
    totalWeight += weight;
    if ((matchedRemaining[token] || 0) > 0) {
      matchedWeight += weight;
      matchedRemaining[token] -= 1;
    }
  }
  const wordCoverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;

  // Article-aware missing penalty: German articles receive near-zero weight
  const effectiveMissingCount = feedback.missingWords.reduce((acc, word) => {
    if (GERMAN_ARTICLES.has(word)) return acc + 0.05;
    if (GERMAN_MINOR_WORDS.has(word)) return acc + 0.2;
    return acc + 1;
  }, 0);

  // Reduced penalty weights: missing ~60% less, extra ~50% less
  let missingWordsPenalty = effectiveMissingCount / expectedTokens.length;
  let extraWordsPenalty = (extraCount / expectedTokens.length) * 0.5;
  const orderPenalty = computeOrderPenalty(expectedTokens, spokenTokens);

  if (attemptCount >= 3) {
    missingWordsPenalty *= 0.5;
    extraWordsPenalty *= 0.5;
  }

  console.log('[PronunciationScoring] Match ratio    :', wordCoverage.toFixed(3));

  // Word coverage is the primary driver; penalties are light corrections
  let score = wordCoverage * 100
    - missingWordsPenalty * 10
    - extraWordsPenalty * 7
    - orderPenalty * 5;

  if (attemptCount >= 2) score += 5;

  // Word order sanity check: heavily jumbled responses should not pass
  // inOrderRatio < 0.5 means fewer than half the matched words were in sequence
  const inOrderRatio = 1 - orderPenalty;
  if (inOrderRatio <= 0.5) {
    score *= 0.8;
  }

  // Meaning-preserving boost: only when sentence structure is intact
  const allMissingAreMinor = missingCount > 0 && feedback.missingWords.every((w) => GERMAN_MINOR_WORDS.has(w));
  const missingImportantWords = feedback.missingWords.filter((w) => !GERMAN_MINOR_WORDS.has(w));
  let disableBoost = shouldDisableBoost(expectedTokens, spokenTokens, feedback.missingWords, orderPenalty);
  if (missingImportantWords.length > 0) {
    disableBoost = true;
  }

  if (!disableBoost && wordCoverage >= 0.8 && allMissingAreMinor && missingCount <= 2) {
    const boost = missingCount === 1 ? 10 : 5;
    score += boost;
    console.log('[PronunciationScoring] Meaning-preserving boost applied: +' + boost);
  }

  // Minimum score floor: prevent unfair low scores for genuine good attempts
  if (wordCoverage > 0.7 && score < 65) {
    score = 65;
  }

  score = clamp(Math.round(score), 0, 100);
  console.log('[PronunciationScoring] Final score    :', score);

  let suggestion = 'Good attempt. Try matching the target phrase word by word.';
  if (feedback.missingWords.length) {
    suggestion = `Try including: ${Array.from(new Set(feedback.missingWords)).join(', ')}.`;
  } else if (feedback.extraWords.length) {
    suggestion = `Avoid adding: ${Array.from(new Set(feedback.extraWords)).join(', ')}.`;
  }

  return {
    score,
    expectedTokens,
    spokenTokens,
    normalizedExpected: expectedJoined,
    normalizedSpoken: spokenJoined,
    wordCoverage,
    missingWordsPenalty,
    extraWordsPenalty,
    orderPenalty,
    feedback: {
      missingWords: feedback.missingWords,
      extraWords: feedback.extraWords,
      matchedWords: feedback.matchedWords,
      suggestion,
    },
  };
}

function scorePronunciation(expected, spoken, opts = {}) {
  const variants = Array.isArray(opts.variants) ? opts.variants : [];
  const candidates = [expected, ...variants].map((t) => String(t || '').trim()).filter(Boolean);
  const lowAudioQuality = !!opts.lowAudioQuality;
  if (!candidates.length) {
    return {
      score: 0,
      matchedAgainst: '',
      normalizedExpected: '',
      normalizedSpoken: normalizeText(spoken || ''),
      wordCoverage: 0,
      feedback: { missingWords: [], extraWords: [], matchedWords: [], suggestion: 'Please try saying the expected phrase clearly.' },
      flags: { lowAudioQuality },
    };
  }

  let best = null;
  for (const candidate of candidates) {
    const current = scoreCandidate(candidate, spoken, opts);
    if (!best || current.score > best.score) {
      best = { ...current, matchedAgainst: candidate };
    }
  }

  return {
    score: best.score,
    matchedAgainst: best.matchedAgainst,
    normalizedExpected: best.normalizedExpected,
    normalizedSpoken: best.normalizedSpoken,
    wordCoverage: best.wordCoverage,
    missingWordsPenalty: best.missingWordsPenalty,
    extraWordsPenalty: best.extraWordsPenalty,
    orderPenalty: best.orderPenalty,
    feedback: best.feedback,
    flags: { lowAudioQuality },
  };
}

// --- Threshold evaluation (dynamic) ---

function evaluateThreshold(score, _threshold, sentenceLength = 7) {
  const { correct } = getDynamicThresholds(sentenceLength);
  return { isCorrect: Number(score) >= correct, threshold: correct };
}

function evaluateThresholdAdvanced(score, _threshold, opts = {}) {
  const s = clamp(Number(score) || 0, 0, 100);
  const sentenceLength = Number(opts.sentenceLength || 7);
  const { correct, almostCorrect } = getDynamicThresholds(sentenceLength);
  return {
    isCorrect: s >= correct,
    isAlmostCorrect: s >= almostCorrect && s < correct,
    threshold: correct,
    wordCoverage: Number(opts.wordCoverage || 0),
  };
}

function computeConfidence(score, opts = {}) {
  const s = clamp(Number(score) || 0, 0, 100);
  const lowAudioQuality = !!opts.lowAudioQuality;
  const wordCoverage = Number(opts.wordCoverage || 0);
  if ((lowAudioQuality && s < 70) || wordCoverage < 0.35) return 'low';
  if (!lowAudioQuality && wordCoverage >= 0.8 && s >= 75) return 'high';
  return 'medium';
}

// --- Word analysis for response ---

function buildDetailedWordAnalysis(expectedTokens, spokenTokens) {
  const expected = Array.isArray(expectedTokens) ? expectedTokens : [];
  const spoken = Array.isArray(spokenTokens) ? spokenTokens : [];
  const usedSpoken = new Array(spoken.length).fill(false);
  const analysis = [];

  for (const expectedWord of expected) {
    let bestIdx = -1;
    let bestSimilarity = 0;
    for (let i = 0; i < spoken.length; i += 1) {
      if (usedSpoken[i]) continue;
      const similarity = getSimilarity(expectedWord, spoken[i]);
      if (!isValidFuzzyMatch(expectedWord, spoken[i], similarity)) continue;
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIdx = i;
      }
    }

    const weight = GERMAN_MINOR_WORDS.has(expectedWord) ? 'low' : 'high';
    if (bestIdx === -1 || bestSimilarity < 0.75) {
      analysis.push({ word: expectedWord, status: 'missing', weight });
      continue;
    }

    usedSpoken[bestIdx] = true;
    if (bestSimilarity >= 0.9) {
      analysis.push({ word: expectedWord, status: 'correct', weight });
    } else {
      analysis.push({
        word: expectedWord,
        status: 'partial',
        weight,
        similarity: Number(bestSimilarity.toFixed(2)),
      });
    }
  }

  for (let i = 0; i < spoken.length; i += 1) {
    if (!usedSpoken[i]) {
      analysis.push({ word: spoken[i], status: 'extra' });
    }
  }

  return analysis;
}

const compareWords = buildDetailedWordAnalysis;

function buildWordAnalysis(scoreRes, transcript, lang) {
  const expectedTokens = tokenizeAndNormalize(scoreRes?.matchedAgainst || '', lang);
  const spokenTokens = tokenizeAndNormalize(transcript || '', lang);
  return buildDetailedWordAnalysis(expectedTokens, spokenTokens);
}

function generatePronunciationHints(wordAnalysis, _lang) {
  if (!Array.isArray(wordAnalysis) || !wordAnalysis.length) return [];
  const missing = wordAnalysis.filter((w) => w.status === 'missing').map((w) => w.word);
  const partial = wordAnalysis.filter((w) => w.status === 'partial').map((w) => w.word);
  const extra = wordAnalysis.filter((w) => w.status === 'extra').map((w) => w.word);
  if (missing.length) return [`You missed: ${Array.from(new Set(missing)).join(', ')}.`];
  if (partial.length) return [`Pronunciation needs improvement: ${Array.from(new Set(partial)).join(', ')}.`];
  if (extra.length) return [`Extra word detected: ${Array.from(new Set(extra)).join(', ')}.`];
  return ['Good pronunciation. Keep your pace steady and clear.'];
}

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
  evaluateThresholdAdvanced,
  computeConfidence,
  compareWords,
  buildWordAnalysis,
  generatePronunciationHints,
  explainPronunciationFromScore,
  tokenizeAndNormalize,
  getSimilarity,
  getDynamicThresholds,
};
