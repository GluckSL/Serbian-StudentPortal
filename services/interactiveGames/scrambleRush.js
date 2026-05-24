// services/interactiveGames/scrambleRush.js
// GlückArena: Scramble Rush game logic — shuffle, evaluate, shuffle display

const { basePoints } = require('./scoring');
const { germanUppercase, germanWordsEqual } = require('../../utils/germanText');

/**
 * Shuffle an array using Fisher-Yates (in-place copy).
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
 * Generate a display string of shuffled letters for a word.
 * Returns the individual letters shuffled (shown on the falling tile).
 * Ensures the shuffled version is never equal to the original word
 * (unless it's a single letter).
 */
function scrambleWord(word) {
  const letters = germanUppercase(word).split('');
  if (letters.length <= 1) return letters;
  let shuffled;
  let attempts = 0;
  do {
    shuffled = shuffle(letters);
    attempts++;
  } while (shuffled.join('') === word && attempts < 20);
  return shuffled;
}

/**
 * Evaluate a student's typed answer against the question's correct word.
 * Returns { isCorrect, points }.
 */
function evaluateAnswer(question, typedWord) {
  if (!typedWord || !question.word) return { isCorrect: false, points: 0 };

  const normalise = (str) => String(str || '').trim().replace(/\s+/g, '');
  const isCorrect = germanWordsEqual(normalise(typedWord), normalise(question.word));

  return {
    isCorrect,
    points: isCorrect ? basePoints('scramble_rush') : 0,
  };
}

/**
 * Attach scrambled display letters to a list of questions.
 * Used by startAttempt to provide the visual tiles without revealing the word.
 */
function attachScrambled(questions) {
  return questions.map(q => ({
    ...q,
    scrambledLetters: scrambleWord(q.word || ''),
    letterCount: (q.word || '').length,
  }));
}

module.exports = { scrambleWord, evaluateAnswer, attachScrambled };
