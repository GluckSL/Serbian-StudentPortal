const scoringService = require('./scoring');
const { germanWordsEqual } = require('../../utils/germanText');

function evaluateMatch(question, word, pairIndex) {
  if (!question || !question.pairs || !word || pairIndex == null) {
    return { isCorrect: false, points: 0, pairIndex: -1 };
  }
  const submittedWord = String(word).trim();
  const pair = question.pairs[pairIndex];
  if (!pair || !pair.word || !germanWordsEqual(pair.word, submittedWord)) {
    return { isCorrect: false, points: 0, pairIndex: -1 };
  }
  return { isCorrect: true, points: scoringService.basePoints('word_picture_match'), pairIndex };
}

module.exports = {
  evaluateMatch,
};
