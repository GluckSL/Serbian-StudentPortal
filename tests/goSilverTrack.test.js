const test = require('node:test');
const assert = require('node:assert/strict');
const {
  goBatchForStudent,
  goLanguageForStudent,
  silverGoRecordingBatchKeys,
  GO_BATCH_SINHALA,
  GO_BATCH_TAMIL
} = require('../utils/goSilverTrack');

test('goLanguageForStudent resolves Sinhala from medium when goLanguage is unset', () => {
  const lang = goLanguageForStudent({ medium: ['Sinhala'] });
  assert.equal(lang, 'Sinhala');
});

test('goBatchForStudent uses GO-SINHALA for Silver GO Sinhala students', () => {
  const batch = goBatchForStudent({
    goStatus: 'GO',
    subscription: 'SILVER',
    medium: ['Sinhala']
  });
  assert.equal(batch, GO_BATCH_SINHALA);
});

test('silverGoRecordingBatchKeys prefers legacy class batch over GO track batch', () => {
  const keys = silverGoRecordingBatchKeys({
    batch: 'Batch 38',
    goStatus: 'GO',
    subscription: 'SILVER',
    goLanguage: 'Sinhala'
  });
  assert.deepEqual(keys, ['Batch 38']);
});

test('silverGoRecordingBatchKeys falls back to GO-SILVER when no legacy batch', () => {
  const keys = silverGoRecordingBatchKeys({
    goStatus: 'GO',
    subscription: 'SILVER',
    goLanguage: 'Tamil'
  });
  assert.deepEqual(keys, [GO_BATCH_TAMIL]);
});
