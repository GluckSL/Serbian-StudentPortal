const { basePoints } = require('./scoring');

function evaluateAnswer(question, selectedIndex) {
  if (!question.options || !Array.isArray(question.options)) {
    return { isCorrect: false, points: 0 };
  }
  const idx = parseInt(selectedIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= question.options.length) {
    return { isCorrect: false, points: 0 };
  }
  const isCorrect = !!question.options[idx].isCorrect;
  return {
    isCorrect,
    points: isCorrect ? basePoints('multiple_choice') : 0,
    correctIndex: question.options.findIndex(o => o.isCorrect),
  };
}

function sanitizeQuestions(questions) {
  return questions.map(q => {
    const safe = { ...q };
    if (safe.options) {
      safe.options = safe.options.map(o => {
        const { isCorrect: _c, ...rest } = o;
        return rest;
      });
    }
    const { isCorrect: _c, ...rest } = safe;
    return rest;
  });
}

module.exports = { evaluateAnswer, sanitizeQuestions };

