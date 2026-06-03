const { basePoints } = require('./scoring');
const { germanUppercase, germanWordsEqual } = require('../../utils/germanText');

function evaluateAnswer(question, submittedWord) {
  if (!submittedWord || !question.word) return { isCorrect: false, points: 0 };
  const submitted = String(submittedWord).trim();
  const correct = String(question.word).trim();
  const isCorrect = germanWordsEqual(submitted, correct);
  return {
    isCorrect,
    points: isCorrect ? basePoints('hangman') : 0,
  };
}

module.exports = { evaluateAnswer };
