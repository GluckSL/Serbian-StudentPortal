/**
 * Unit tests for batch type exercise version filtering.
 * Run: node --test tests/batchType.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  exerciseVersionClauseForBatch,
  exerciseVersionAllowedForStudent,
} = require('../utils/batchType');

describe('exerciseVersionClauseForBatch', () => {
  it('new2 students only see v2 exercises assigned to their batch', () => {
    const clause = exerciseVersionClauseForBatch('new2', ['39', 'Batch 39']);
    assert.deepEqual(clause, {
      version: 'v2',
      targetBatches: { $in: ['39', 'Batch 39'] },
    });
  });

  it('new2 students with no batch keys see no v2 exercises', () => {
    const clause = exerciseVersionClauseForBatch('new2', []);
    assert.equal(clause.version, 'v2');
    assert.deepEqual(clause.targetBatches, { $in: ['__no_batch__'] });
  });

  it('new students see v1 only', () => {
    const clause = exerciseVersionClauseForBatch('new', ['39']);
    assert.ok(clause.$or);
  });
});

describe('exerciseVersionAllowedForStudent', () => {
  it('rejects v2 exercise with empty targetBatches', () => {
    const allowed = exerciseVersionAllowedForStudent('new2', { version: 'v2', targetBatches: [] }, ['39']);
    assert.equal(allowed, false);
  });

  it('allows v2 exercise when batch is in targetBatches', () => {
    const allowed = exerciseVersionAllowedForStudent('new2', { version: 'v2', targetBatches: ['39'] }, ['39']);
    assert.equal(allowed, true);
  });
});
