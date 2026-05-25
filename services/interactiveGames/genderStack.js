const scoringService = require('./scoring');

const VALID_GENDERS = ['der', 'die', 'das'];

function normalizeGender(value) {
  const g = String(value || '').trim().toLowerCase();
  return VALID_GENDERS.includes(g) ? g : '';
}

function evaluateAnswer(question, submittedGender) {
  const expected = normalizeGender(question?.articleGender);
  const actual = normalizeGender(submittedGender);
  if (!expected || !actual) {
    return { isCorrect: false, points: 0, articleGender: expected };
  }
  const isCorrect = expected === actual;
  return {
    isCorrect,
    points: isCorrect ? scoringService.basePoints('gender_stack') : 0,
    articleGender: expected,
  };
}

module.exports = {
  VALID_GENDERS,
  normalizeGender,
  evaluateAnswer,
};
