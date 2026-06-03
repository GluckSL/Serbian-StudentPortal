const scoringService = require('./scoring');
const { germanWordsEqual } = require('../../utils/germanText');

function evaluateMatch(question, pairIndex, word) {
  if (!question || !question.pairs || !word || pairIndex == null) {
    return { isCorrect: false, points: 0, pairIndex: -1 };
  }
  const submittedWord = String(word).trim();
  const pair = question.pairs[pairIndex];
  if (!pair || !pair.word || !germanWordsEqual(pair.word, submittedWord)) {
    return { isCorrect: false, points: 0, pairIndex: -1 };
  }
  return { isCorrect: true, points: scoringService.basePoints('memory'), pairIndex };
}

function shuffleCards(pairs) {
  if (!pairs || !pairs.length) return [];
  const cards = pairs.map((p, i) => ({ pairIndex: i, type: 'image', id: `img-${i}` }));
  const wordCards = pairs.map((p, i) => ({ pairIndex: i, type: 'word', word: p.word, id: `word-${i}` }));
  const all = [...cards, ...wordCards];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

function getSanitizedPairs(question) {
  if (!question || !question.pairs) return [];
  return question.pairs.map(p => {
    const { word: _w, ...safe } = p;
    return safe;
  });
}

module.exports = {
  evaluateMatch,
  shuffleCards,
  getSanitizedPairs,
};
