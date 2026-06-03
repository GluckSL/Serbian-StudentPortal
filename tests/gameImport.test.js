/**
 * Unit tests for GlückArena bulk import (all game types).
 * Run: node --test tests/gameImport.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseRows,
  getImportTemplate,
  SUPPORTED_GAME_TYPES,
} = require('../services/interactiveGames/import');

describe('getImportTemplate', () => {
  it('returns non-empty templates for every supported game type', () => {
    for (const gameType of SUPPORTED_GAME_TYPES) {
      const template = getImportTemplate(gameType);
      assert.ok(Array.isArray(template), `${gameType} template should be an array`);
      assert.ok(template.length > 0, `${gameType} should have sample rows`);
    }
  });
});

describe('parseRows — per-row game types', () => {
  it('validates scramble_rush words', () => {
    const results = parseRows([
      { word: 'HAUS', hint: 'house', order: 0 },
      { word: 'BAUM', hint: 'tree', order: 1 },
    ], 'scramble_rush');
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.valid));
    assert.equal(results[0].doc.word, 'HAUS');
  });

  it('rejects scramble words with spaces', () => {
    const results = parseRows([{ word: 'guten tag' }], 'scramble_rush');
    assert.equal(results[0].valid, false);
  });

  it('validates sentence_builder', () => {
    const results = parseRows([
      { correct_sentence: 'Ich bin müde.', translation: 'I am tired.' },
    ], 'sentence_builder');
    assert.ok(results[0].valid);
    assert.equal(results[0].doc.correctSentence, 'Ich bin müde.');
  });

  it('validates matching pairs', () => {
    const results = parseRows([{ left: 'Hund', right: 'Dog' }], 'matching');
    assert.ok(results[0].valid);
    assert.equal(results[0].doc.word, 'Hund');
    assert.equal(results[0].doc.hint, 'Dog');
  });

  it('validates flashcards', () => {
    const results = parseRows([{ front: 'Apfel', back: 'Apple' }], 'flashcards');
    assert.ok(results[0].valid);
  });

  it('validates gender_stack', () => {
    const results = parseRows([
      { word: 'Tisch', translation: 'table', article_gender: 'der' },
    ], 'gender_stack');
    assert.ok(results[0].valid);
    assert.equal(results[0].doc.articleGender, 'der');
  });

  it('validates flapjugation with all conjugations', () => {
    const results = parseRows([{
      word: 'spielen',
      translation: 'to play',
      ich: 'spiele',
      du: 'spielst',
      er_sie_es: 'spielt',
      wir: 'spielen',
      ihr: 'spielt',
      sie_formal: 'spielen',
    }], 'flapjugation');
    assert.ok(results[0].valid);
    assert.equal(results[0].doc.tokens.length, 6);
  });

  it('validates whackawort', () => {
    const results = parseRows([
      { word: 'Apfel', translation: 'apple', category: 'Food' },
    ], 'whackawort');
    assert.ok(results[0].valid);
    assert.equal(results[0].doc.category, 'Food');
  });

  it('validates jumbled_words', () => {
    const results = parseRows([{ word: 'haus', hint: 'house' }], 'jumbled_words');
    assert.ok(results[0].valid);
    assert.equal(results[0].doc.word, 'HAUS');
  });

  it('requires hint or image for jumbled_words', () => {
    const results = parseRows([{ word: 'HAUS' }], 'jumbled_words');
    assert.equal(results[0].valid, false);
  });
});

describe('parseRows — pair-based game types', () => {
  it('groups image_matching rows by question_index', () => {
    const results = parseRows([
      { question_index: 0, word: 'Hund', hint: 'Dog', order: 0 },
      { question_index: 0, word: 'Katze', hint: 'Cat', order: 1 },
      { question_index: 1, word: 'Apfel', hint: 'Apple', order: 0 },
    ], 'image_matching');
    assert.equal(results.length, 2);
    assert.ok(results.every(r => r.valid));
    assert.equal(results[0].doc.pairs.length, 2);
    assert.equal(results[1].doc.pairs.length, 1);
  });

  it('groups memory rows by question_index', () => {
    const results = parseRows([
      { question_index: 0, word: 'Hund', order: 0 },
      { question_index: 0, word: 'Katze', order: 1 },
    ], 'memory');
    assert.equal(results.length, 1);
    assert.ok(results[0].valid);
    assert.equal(results[0].doc.pairs.length, 2);
  });

  it('rejects more than 8 pairs per image_matching question', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      question_index: 0,
      word: `Wort${i}`,
      hint: `hint${i}`,
    }));
    const results = parseRows(rows, 'image_matching');
    assert.equal(results[0].valid, false);
  });
});

describe('parseRows — column name normalization', () => {
  it('accepts headers with spaces and BOM', () => {
    const results = parseRows([
      { '\ufeffCorrect Sentence': 'Ich esse.', Translation: 'I eat.' },
    ], 'sentence_builder');
    assert.ok(results[0].valid);
  });
});
