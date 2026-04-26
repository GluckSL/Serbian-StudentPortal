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

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function stripDiacritics(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function expandContractions(text, lang) {
  const lowerLang = String(lang || '').toLowerCase();
  if (!lowerLang.startsWith('en')) return String(text || '');
  return String(text || '').replace(/\b[\w']+\b/g, (token) => EN_CONTRACTIONS[token.toLowerCase()] || token);
}

function normalizeText(raw) {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function findMatchedWords(expectedTokens, spokenTokens) {
  const spokenCounts = Object.create(null);
  for (const token of spokenTokens) spokenCounts[token] = (spokenCounts[token] || 0) + 1;
  const matched = [];
  for (const token of expectedTokens) {
    if (spokenCounts[token] > 0) {
      matched.push(token);
      spokenCounts[token] -= 1;
    }
  }
  return matched;
}

function buildFeedbackFromTokens(expectedTokens, spokenTokens) {
  const spokenCounts = Object.create(null);
  const expectedCounts = Object.create(null);
  for (const token of spokenTokens) spokenCounts[token] = (spokenCounts[token] || 0) + 1;
  for (const token of expectedTokens) expectedCounts[token] = (expectedCounts[token] || 0) + 1;

  const matchedWords = [];
  const missingWords = [];
  const extraWords = [];

  for (const token of expectedTokens) {
    if ((spokenCounts[token] || 0) > 0) {
      matchedWords.push(token);
      spokenCounts[token] -= 1;
      expectedCounts[token] -= 1;
    } else {
      missingWords.push(token);
      expectedCounts[token] = Math.max(0, (expectedCounts[token] || 0) - 1);
    }
  }

  for (const token of spokenTokens) {
    if ((expectedCounts[token] || 0) > 0) {
      expectedCounts[token] -= 1;
    } else {
      extraWords.push(token);
    }
  }

  return { matchedWords, missingWords, extraWords };
}

function computeOrderPenalty(expectedTokens, spokenTokens) {
  if (expectedTokens.length <= 1 || spokenTokens.length <= 1) return 0;
  const used = new Array(spokenTokens.length).fill(false);
  let lastIdx = -1;
  let inOrder = 0;
  let matchedTotal = 0;

  for (const expected of expectedTokens) {
    let chosen = -1;
    for (let i = 0; i < spokenTokens.length; i += 1) {
      if (!used[i] && spokenTokens[i] === expected) {
        chosen = i;
        break;
      }
    }
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

function calculateSimilarity(expected, spoken, lang = 'de-DE') {
  const e = tokenizeAndNormalize(expected, lang);
  const s = tokenizeAndNormalize(spoken, lang);
  if (!e.length || !s.length) return 0;
  const matched = findMatchedWords(e, s).length;
  return Math.round((matched / e.length) * 100);
}

function scoreCandidate(expectedPhrase, spoken, opts = {}) {
  const lang = opts.lang || 'de-DE';
  const attemptCount = Number(opts.attemptCount || 0);
  const expectedTokens = tokenizeAndNormalize(expectedPhrase, lang);
  const spokenTokens = tokenizeAndNormalize(spoken, lang);
  const expectedJoined = expectedTokens.join(' ');
  const spokenJoined = spokenTokens.join(' ');

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
  const wordCoverage = matchedCount / expectedTokens.length;
  let missingWordsPenalty = missingCount / expectedTokens.length;
  let extraWordsPenalty = extraCount / expectedTokens.length;
  const orderPenalty = computeOrderPenalty(expectedTokens, spokenTokens);

  if (attemptCount >= 3) {
    missingWordsPenalty *= 0.5;
    extraWordsPenalty *= 0.5;
  }

  let score = (wordCoverage * 70)
    - (missingWordsPenalty * 15)
    - (extraWordsPenalty * 10)
    - (orderPenalty * 5);

  if (attemptCount >= 2) score += 5;
  score = clamp(Math.round(score), 0, 100);

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

function evaluateThreshold(score, _threshold) {
  return { isCorrect: Number(score) >= 85, threshold: 85 };
}

function evaluateThresholdAdvanced(score, _threshold, opts = {}) {
  const s = clamp(Number(score) || 0, 0, 100);
  return {
    isCorrect: s >= 85,
    isAlmostCorrect: s >= 60 && s <= 84,
    threshold: 85,
    wordCoverage: Number(opts.wordCoverage || 0),
  };
}

function computeConfidence(score, opts = {}) {
  const s = clamp(Number(score) || 0, 0, 100);
  const lowAudioQuality = !!opts.lowAudioQuality;
  const wordCoverage = Number(opts.wordCoverage || 0);
  if ((lowAudioQuality && s < 70) || wordCoverage < 0.35) return 'low';
  if (!lowAudioQuality && wordCoverage >= 0.8 && s >= 85) return 'high';
  return 'medium';
}

function compareWords(expectedTokens, spokenTokens) {
  const expected = Array.isArray(expectedTokens) ? expectedTokens : [];
  const spoken = Array.isArray(spokenTokens) ? spokenTokens : [];
  const feedback = buildFeedbackFromTokens(expected, spoken);
  return expected.map((exp, i) => {
    const spokenTok = spoken[i] || '';
    if (feedback.matchedWords.includes(exp)) return { expected: exp, spoken: exp, status: 'correct' };
    if (feedback.missingWords.includes(exp)) return { expected: exp, spoken: '', status: 'missing' };
    return { expected: exp, spoken: spokenTok, status: 'incorrect' };
  });
}

function buildWordAnalysis(scoreRes, transcript, lang) {
  const expectedTokens = tokenizeAndNormalize(scoreRes?.matchedAgainst || '', lang);
  const spokenTokens = tokenizeAndNormalize(transcript || '', lang);
  return compareWords(expectedTokens, spokenTokens);
}

function generatePronunciationHints(wordAnalysis, _lang) {
  if (!Array.isArray(wordAnalysis) || !wordAnalysis.length) return [];
  const missing = wordAnalysis.filter((w) => w.status === 'missing').map((w) => w.expected);
  const incorrect = wordAnalysis.filter((w) => w.status === 'incorrect').map((w) => w.expected);
  if (missing.length) return [`Try including: ${Array.from(new Set(missing)).join(', ')}.`];
  if (incorrect.length) return [`Focus on these words: ${Array.from(new Set(incorrect)).join(', ')}.`];
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
};
