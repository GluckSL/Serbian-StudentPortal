const scoringService = require('./scoring');
const { germanWordsEqual } = require('../../utils/germanText');

function shuffleWords(words) {
  if (!words || !words.length) return [];
  const arr = [...words];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const original = [...words];
  let attempts = 0;
  while (arr.join(',') === original.join(',') && attempts < 5) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    attempts++;
  }
  return arr;
}

function evaluateMatch(question, word, pairIndex) {
  if (!question || !question.pairs || !word || pairIndex == null) {
    return { isCorrect: false, points: 0, pairIndex: -1 };
  }
  const submittedWord = String(word).trim();
  const pair = question.pairs[pairIndex];
  if (!pair || !pair.word || !germanWordsEqual(pair.word, submittedWord)) {
    return { isCorrect: false, points: 0, pairIndex: -1 };
  }
  return { isCorrect: true, points: scoringService.basePoints('image_matching'), pairIndex };
}

function evaluateAnswer(questions, matches) {
  if (!questions || !matches || questions.length !== matches.length) {
    return { isCorrect: false, score: 0, accuracy: 0 };
  }
  let correct = 0;
  let totalScore = 0;
  let totalPairs = 0;
  questions.forEach((q, i) => {
    const match = matches[i] || {};
    const pairs = q.pairs || [];
    totalPairs += pairs.length;
    pairs.forEach((pair, pIdx) => {
      const submittedWord = String(match[pIdx] || '').trim();
      if (pair.word && germanWordsEqual(pair.word, submittedWord)) {
        correct++;
        totalScore += scoringService.basePoints('image_matching');
      }
    });
  });
  const accuracy = totalPairs > 0 ? Math.round((correct / totalPairs) * 100) : 0;
  return {
    isCorrect: correct === totalPairs,
    score: totalScore,
    accuracy,
    correctCount: correct,
    totalCount: totalPairs,
  };
}

function groupIntoPages(questions, pageSize = 8) {
  if (!questions || !questions.length) return [];
  const pages = [];
  for (let i = 0; i < questions.length; i += pageSize) {
    pages.push(questions.slice(i, i + pageSize));
  }
  return pages;
}

function getPageWords(pageQuestions) {
  if (!pageQuestions || !pageQuestions.length) return [];
  const words = [];
  pageQuestions.forEach(q => {
    if (q.pairs) {
      q.pairs.forEach(p => {
        if (p.word) words.push(p.word);
      });
    }
  });
  return words;
}

module.exports = {
  shuffleWords,
  evaluateMatch,
  evaluateAnswer,
  groupIntoPages,
  getPageWords,
};
