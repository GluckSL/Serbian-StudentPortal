/**
 * Unit tests for batch type exercise version filtering.
 * Run: node --test tests/batchType.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  exerciseVersionClauseForBatch,
  exerciseVersionAllowedForStudent,
  dgModuleVersionClauseForBatch,
  dgModuleVersionAllowedForStudent,
} = require('../utils/batchType');

describe('exerciseVersionClauseForBatch', () => {
  it('new2 students only see v2 exercises assigned to their batch', () => {
    const clause = exerciseVersionClauseForBatch('new2', ['39', 'Batch 39']);
    assert.equal(clause.version, 'v2');
    assert.ok(Array.isArray(clause.targetBatches.$in));
    assert.ok(clause.targetBatches.$in.includes('39'));
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

describe('dgModuleVersionClauseForBatch', () => {
  it('new2 students only see v2 modules assigned to their batch', () => {
    const clause = dgModuleVersionClauseForBatch('new2', ['43']);
    assert.equal(clause.version, 'v2');
    assert.ok(Array.isArray(clause.targetBatchKeys.$in));
    assert.ok(clause.targetBatchKeys.$in.includes('43'));
  });

  it('new2 students with no batch keys see no v2 modules', () => {
    const clause = dgModuleVersionClauseForBatch('new2', []);
    assert.equal(clause.version, 'v2');
    assert.deepEqual(clause.targetBatchKeys, { $in: ['__no_batch__'] });
  });

  it('new students see v1 modules only', () => {
    const clause = dgModuleVersionClauseForBatch('new', ['43']);
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

describe('dgModuleVersionAllowedForStudent', () => {
  it('rejects v2 module with empty targetBatchKeys', () => {
    const allowed = dgModuleVersionAllowedForStudent('new2', { version: 'v2', targetBatchKeys: [] }, ['43']);
    assert.equal(allowed, false);
  });

  it('allows v2 module when batch is in targetBatchKeys', () => {
    const allowed = dgModuleVersionAllowedForStudent('new2', { version: 'v2', targetBatchKeys: ['43'] }, ['43']);
    assert.equal(allowed, true);
  });

  it('rejects v2 module for new batch students', () => {
    const allowed = dgModuleVersionAllowedForStudent('new', { version: 'v2', targetBatchKeys: ['43'] }, ['43']);
    assert.equal(allowed, false);
  });
});
