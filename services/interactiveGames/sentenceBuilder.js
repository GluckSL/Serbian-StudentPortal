// services/interactiveGames/sentenceBuilder.js
// GlückArena: Sentence Builder game logic — tokenize, shuffle tokens, evaluate

const { basePoints, slotPoints } = require('./scoring');

/**
 * Split a sentence into display tokens.
 * Tokens preserve punctuation attached to words (e.g. "Eier." stays as-is).
 */
function tokenize(sentence) {
  return sentence.trim().split(/\s+/).filter(Boolean);
}

/**
 * Shuffle an array using Fisher-Yates.
 */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Get shuffled token array for a question.
 * Ensures shuffled version is not identical to the original order.
 */
function getShuffledTokens(question) {
  const tokens = question.tokens && question.tokens.length
    ? question.tokens
    : tokenize(question.correctSentence || '');

  if (tokens.length <= 1) return tokens;

  let shuffled;
  let attempts = 0;
  do {
    shuffled = shuffle(tokens);
    attempts++;
  } while (shuffled.join(' ') === tokens.join(' ') && attempts < 20);
  return shuffled;
}

/**
 * Normalise a sentence for comparison:
 * - trim whitespace, collapse multiple spaces
 * - case-insensitive compare
 */
function normalise(str) {
  return (str || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Compare tokens — ignores trailing punctuation differences (e.g. Eier vs Eier.) */
function tokensMatch(submitted, expected) {
  const a = normalise(submitted);
  const b = normalise(expected);
  if (a === b) return true;
  const strip = (s) => s.replace(/[.!?,;:]+$/g, '').trim();
  return strip(a) === strip(b);
}

/**
 * Evaluate the student's submitted token order against the correct sentence.
 * Returns { isCorrect, points }.
 */
function getCorrectTokens(question) {
  if (question.tokens && question.tokens.length) return question.tokens;
  return tokenize(question.correctSentence || '');
}

/**
 * Validate a single word placed in a fixed slot (instant feedback mode).
 */
function evaluateSlot(question, slotIndex, token) {
  const tokens = getCorrectTokens(question);
  const idx = parseInt(slotIndex, 10);
  if (!Number.isFinite(idx) || idx < 0 || idx >= tokens.length) {
    return { isCorrect: false, points: 0, totalSlots: tokens.length };
  }
  const isCorrect = tokensMatch(token, tokens[idx]);
  return {
    isCorrect,
    points: isCorrect ? slotPoints('sentence_builder') : 0,
    totalSlots: tokens.length,
  };
}

function evaluateAnswer(question, orderedTokens) {
  if (!Array.isArray(orderedTokens) || !orderedTokens.length) {
    return { isCorrect: false, points: 0 };
  }

  const submitted = normalise(orderedTokens.join(' '));
  const correct = normalise(question.correctSentence || '');

  const isCorrect = submitted === correct;

  return {
    isCorrect,
    points: isCorrect ? basePoints('sentence_builder') : 0,
  };
}

module.exports = {
  tokenize, getShuffledTokens, getCorrectTokens, evaluateSlot, evaluateAnswer,
};
