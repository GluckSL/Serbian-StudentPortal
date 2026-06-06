'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractBracketMarkers,
  applyBracketMarkersToExercise
} = require('../utils/worksheetBracketMarkers');

describe('worksheetBracketMarkers', () => {
  it('extracts instruction from curly braces and example from square brackets', () => {
    const text = '{Wählen Sie die richtige Antwort.}\n[Ich gehe in die Schule.]\n1. Das ist ___';
    const parsed = extractBracketMarkers(text);

    assert.equal(parsed.instruction_de, 'Wählen Sie die richtige Antwort.');
    assert.equal(parsed.instruction_en, '');
    assert.equal(parsed.example, 'Ich gehe in die Schule.');
    assert.equal(parsed.cleanedContent, '1. Das ist ___');
  });

  it('splits bilingual instruction inside one brace pair on slash', () => {
    const parsed = extractBracketMarkers('{Wählen Sie die richtige Antwort. / Choose the correct answer.}');

    assert.equal(parsed.instruction_de, 'Wählen Sie die richtige Antwort.');
    assert.equal(parsed.instruction_en, 'Choose the correct answer.');
  });

  it('uses second brace pair as English when two pairs exist', () => {
    const parsed = extractBracketMarkers('{Wählen Sie.} {Choose the correct answer.}');

    assert.equal(parsed.instruction_de, 'Wählen Sie.');
    assert.equal(parsed.instruction_en, 'Choose the correct answer.');
  });

  it('applyBracketMarkersToExercise prefers bracket instruction over existing fields', () => {
    const block = applyBracketMarkersToExercise({
      exerciseId: '1',
      instruction_de: 'Heuristic DE',
      content: '{Bracket DE / Bracket EN} [Example line]\n1. Question'
    });

    assert.equal(block.instruction_de, 'Bracket DE');
    assert.equal(block.instruction_en, 'Bracket EN');
    assert.equal(block.example, 'Example line');
    assert.equal(block.content, '1. Question');
  });
});
