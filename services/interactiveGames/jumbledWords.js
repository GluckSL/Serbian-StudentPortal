const { basePoints } = require('./scoring');
const { germanUppercase, germanWordsEqual } = require('../../utils/germanText');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

function evaluateAnswer(question, submittedLetters) {
  if (!submittedLetters || !question.word) return { isCorrect: false, points: 0 };
  const submitted = String(submittedLetters).trim();
  const correct = String(question.word).trim();
  const isCorrect = germanWordsEqual(submitted, correct);
  return {
    isCorrect,
    points: isCorrect ? basePoints('jumbled_words') : 0,
  };
}

function attachJumbled(questions) {
  return questions.map(q => ({
    ...q,
    jumbledLetters: scrambleWord(q.word || ''),
    letterCount: (q.word || '').length,
  }));
}

module.exports = { scrambleWord, evaluateAnswer, attachJumbled };
