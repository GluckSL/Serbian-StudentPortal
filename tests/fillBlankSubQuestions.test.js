/**
 * Fill-blank sub-question grading helpers.
 * Run: node --test tests/fillBlankSubQuestions.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeQuestionPlainText } = require('../utils/sanitizeHtml');

function countFillBlankRuns(sentence) {
  return (String(sentence || '').match(/_+/g) || []).length;
}

function fillBlankSlotCount(q) {
  if (!q || q.type !== 'fill-blank') return 0;
  const fromAnswers = Array.isArray(q.answers) ? q.answers.length : 0;
  const fromSentence = countFillBlankRuns(q.sentence || '');
  return Math.max(fromAnswers, fromSentence);
}

function parseTrueFalse(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/\b(true|richtig|wahr|ja|yes|correct)\b/.test(s)) return true;
  if (/\b(false|falsch|unwahr|nein|no|incorrect)\b/.test(s)) return false;
  return null;
}

function parentHasAnswerablePart(q) {
  if (!q || typeof q !== 'object') return false;
  const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];
  if (!subs.length) return true;

  const type = String(q.type || '').toLowerCase();
  if (type === 'mcq') {
    const hasQuestion = !!sanitizeQuestionPlainText(q.question || '');
    const hasOptions = Array.isArray(q.options)
      && q.options.some((o) => !!sanitizeQuestionPlainText(o || ''));
    return hasQuestion || hasOptions;
  }
  if (type === 'question-answer') {
    const hasPrompt = !!sanitizeQuestionPlainText(q.prompt || '');
    const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
    const expectedRaw = samples.find((s) => parseTrueFalse(s) !== null) ?? null;
    const isTrueFalse = q.worksheetKind === 'true-false' || expectedRaw !== null;
    return hasPrompt || isTrueFalse;
  }
  if (type === 'fill-blank') {
    return fillBlankSlotCount(q) > 0;
  }
  return true;
}

function gradeFillBlankRawScore(q, fillBlankResponses) {
  const answers = q.answers || [];
  const total = fillBlankSlotCount(q);
  if (total <= 0 || !Array.isArray(fillBlankResponses)) {
    return { rawScore: 0 };
  }
  let correctCount = 0;
  for (let i = 0; i < total; i++) {
    const ans = sanitizeQuestionPlainText(String(fillBlankResponses[i] ?? ''));
    const corr = sanitizeQuestionPlainText(answers[i]);
    if (ans.toLowerCase() === corr.toLowerCase()) correctCount += 1;
  }
  return { rawScore: correctCount === total ? 100 : 0 };
}

describe('parentHasAnswerablePart', () => {
  it('treats fill-blank parent with only context as non-answerable', () => {
    const q = {
      type: 'fill-blank',
      sentence: '',
      answers: [],
      subQuestions: [{ type: 'fill-blank', sentence: 'I _ happy', answers: ['am'] }]
    };
    assert.equal(parentHasAnswerablePart(q), false);
  });

  it('treats question-answer parent with only passage as non-answerable', () => {
    const q = {
      type: 'question-answer',
      prompt: '',
      subQuestions: [
        { type: 'fill-blank', sentence: 'A _', answers: ['x'] },
        { type: 'fill-blank', sentence: 'B _', answers: ['y'] }
      ]
    };
    assert.equal(parentHasAnswerablePart(q), false);
  });
});

describe('gradeFillBlankRawScore for sub-questions', () => {
  it('uses admin answers for fill-blank sub-parts', () => {
    const sq = { type: 'fill-blank', sentence: 'She _ well', answers: ['sings'] };
    const graded = gradeFillBlankRawScore(sq, ['sings']);
    assert.equal(graded.rawScore, 100);
  });

  it('marks wrong when student answer differs from admin answer', () => {
    const sq = { type: 'fill-blank', sentence: 'She _ well', answers: ['sings'] };
    const graded = gradeFillBlankRawScore(sq, ['sing']);
    assert.equal(graded.rawScore, 0);
  });
});
