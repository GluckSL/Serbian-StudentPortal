/**
 * Unit tests for split-exercise completion inheritance.
 * Run: node --test tests/exerciseSplitInheritance.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  getSourceIndices,
  hasResponseForQuestion,
  resolveInheritedAttempt,
  scoreFromMappedResponses,
  isInheritedPassing
} = require('../services/exerciseSplitInheritance.service');

const studentId = '507f1f77bcf86cd799439011';

function makeExercise(overrides = {}) {
  return {
    _id: '507f1f77bcf86cd799439012',
    questions: [
      { type: 'fill-blank', points: 2, sentence: 'a _ b', answers: ['x'] },
      { type: 'mcq', points: 1, options: ['a', 'b'], correctAnswerIndex: 0 }
    ],
    splitLineage: {
      sourceExerciseId: '507f1f77bcf86cd799439013',
      questionSources: [
        { sourceQuestionIndex: 2 },
        { sourceQuestionIndex: 3 }
      ]
    },
    ...overrides
  };
}

function makeSourceAttempt(responses, scorePercentage = 80) {
  return {
    _id: '507f1f77bcf86cd799439014',
    studentId,
    exerciseId: '507f1f77bcf86cd799439013',
    status: 'completed',
    scorePercentage,
    completedAt: new Date('2025-01-01'),
    attemptNumber: 1,
    timeSpentSeconds: 120,
    responses
  };
}

describe('getSourceIndices', () => {
  it('returns indices from lineage', () => {
    assert.deepEqual(getSourceIndices(makeExercise()), [2, 3]);
  });

  it('returns null without lineage', () => {
    assert.equal(getSourceIndices({ questions: [] }), null);
  });
});

describe('hasResponseForQuestion', () => {
  it('detects fill-blank response', () => {
    const q = { type: 'fill-blank' };
    assert.equal(hasResponseForQuestion(q, { fillBlankResponses: ['hello'] }), true);
    assert.equal(hasResponseForQuestion(q, { fillBlankResponses: [''] }), false);
  });

  it('detects mcq response', () => {
    const q = { type: 'mcq' };
    assert.equal(hasResponseForQuestion(q, { selectedOptionIndex: 1 }), true);
    assert.equal(hasResponseForQuestion(q, {}), false);
  });
});

describe('resolveInheritedAttempt', () => {
  it('returns null when a source index has no response', async () => {
    const ex = makeExercise();
    const attempt = makeSourceAttempt([
      { questionIndex: 2, fillBlankResponses: ['x'], pointsEarned: 2, isCorrect: true },
      { questionIndex: 0, selectedOptionIndex: 0, pointsEarned: 1, isCorrect: true }
    ]);
    const result = await resolveInheritedAttempt(studentId, ex, attempt);
    assert.equal(result, null);
  });

  it('returns null when source attempt is not completed', async () => {
    const ex = makeExercise();
    const attempt = {
      ...makeSourceAttempt([
        { questionIndex: 2, fillBlankResponses: ['x'], pointsEarned: 2, isCorrect: true },
        { questionIndex: 3, selectedOptionIndex: 0, pointsEarned: 1, isCorrect: true }
      ]),
      status: 'in-progress'
    };
    const result = await resolveInheritedAttempt(studentId, ex, attempt);
    assert.equal(result, null);
  });

  it('returns synthetic attempt when all source questions answered', async () => {
    const ex = makeExercise();
    const attempt = makeSourceAttempt([
      { questionIndex: 2, fillBlankResponses: ['x'], pointsEarned: 2, isCorrect: true },
      { questionIndex: 3, selectedOptionIndex: 0, pointsEarned: 1, isCorrect: true }
    ], 90);
    const result = await resolveInheritedAttempt(studentId, ex, attempt);
    assert.ok(result);
    assert.equal(result.inheritedFromSource, true);
    assert.equal(result.scorePercentage, 100);
    assert.equal(result.correctCount, 2);
    assert.equal(isInheritedPassing(result), true);
  });

  it('returns null when source passed overall but subset indices missing', async () => {
    const ex = makeExercise();
    const attempt = makeSourceAttempt([
      { questionIndex: 0, selectedOptionIndex: 0, pointsEarned: 1, isCorrect: true },
      { questionIndex: 1, selectedOptionIndex: 0, pointsEarned: 1, isCorrect: true }
    ], 100);
    const result = await resolveInheritedAttempt(studentId, ex, attempt);
    assert.equal(result, null);
  });
});

describe('scoreFromMappedResponses', () => {
  it('computes percentage from stored points', () => {
    const ex = makeExercise();
    const attempt = makeSourceAttempt([
      { questionIndex: 2, fillBlankResponses: ['x'], pointsEarned: 1, isCorrect: false },
      { questionIndex: 3, selectedOptionIndex: 0, pointsEarned: 1, isCorrect: true }
    ]);
    const scored = scoreFromMappedResponses(ex, attempt);
    assert.equal(scored.totalPoints, 3);
    assert.equal(scored.earnedPoints, 2);
    assert.equal(scored.scorePercentage, 67);
  });
});
