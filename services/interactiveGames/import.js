// services/interactiveGames/import.js — CSV/Excel bulk import validation

const GameQuestion = require('../../models/GameQuestion');
const GameLevel = require('../../models/GameLevel');
const GameSet = require('../../models/GameSet');

function normalizeRow(row, gameType) {
  const r = {};
  Object.keys(row).forEach(k => {
    r[k.trim().toLowerCase().replace(/\s+/g, '_')] = row[k];
  });
  return r;
}

function validateScrambleRow(row, index) {
  const errors = [];
  const word = String(row.word || '').trim().toUpperCase();
  if (!word) errors.push(`Row ${index + 1}: word is required`);
  return {
    valid: errors.length === 0,
    errors,
    doc: {
      word,
      hint: String(row.hint || '').trim(),
      difficultyLevel: Math.min(5, Math.max(1, parseInt(row.difficulty_level || row.difficultylevel, 10) || 1)),
      fallDurationSeconds: Math.min(30, Math.max(2, parseInt(row.fall_duration_seconds || row.falldurationseconds, 10) || 5)),
      order: parseInt(row.order, 10) || index,
    },
  };
}

function validateSentenceRow(row, index) {
  const errors = [];
  const sentence = String(row.correct_sentence || row.sentence || '').trim();
  if (!sentence) errors.push(`Row ${index + 1}: correct_sentence is required`);
  const tokens = sentence ? sentence.split(/\s+/).filter(Boolean) : [];
  return {
    valid: errors.length === 0,
    errors,
    doc: {
      correctSentence: sentence,
      translation: String(row.translation || '').trim(),
      randomizeWords: String(row.randomize_words ?? 'true').toLowerCase() !== 'false',
      tokens,
      order: parseInt(row.order, 10) || index,
    },
  };
}

function validateLevelRow(row, index) {
  const errors = [];
  const levelNumber = parseInt(row.level_number || row.level, 10);
  if (!levelNumber) errors.push(`Row ${index + 1}: level_number required`);
  return {
    valid: errors.length === 0,
    errors,
    doc: {
      levelNumber,
      lives: parseInt(row.lives, 10) || 3,
      timeLimitSeconds: parseInt(row.time_limit_seconds || row.time_limit, 10) || 60,
      fallSpeedMs: parseInt(row.fall_speed_ms, 10) || 8000,
      spawnIntervalMs: parseInt(row.spawn_interval_ms, 10) || 3000,
      wordsRequired: parseInt(row.words_required, 10) || 5,
      scoreMultiplier: parseFloat(row.score_multiplier) || 1,
    },
  };
}

async function previewImport(gameSetId, rows, importType) {
  const set = await GameSet.findById(gameSetId).lean();
  if (!set) return { ok: false, message: 'Game set not found' };

  const normalized = rows.map((row, i) => normalizeRow(row, set.gameType));
  const results = [];
  const allErrors = [];
  const seen = new Set();

  for (let i = 0; i < normalized.length; i++) {
    const row = normalized[i];
    let parsed;
    if (importType === 'levels' || set.gameType === 'scramble_rush' && row.level_number) {
      parsed = validateLevelRow(row, i);
    } else if (set.gameType === 'sentence_builder') {
      parsed = validateSentenceRow(row, i);
      const key = parsed.doc?.correctSentence?.toLowerCase();
      if (key && seen.has(key)) allErrors.push(`Row ${i + 1}: duplicate sentence`);
      else if (key) seen.add(key);
    } else {
      parsed = validateScrambleRow(row, i);
      const key = parsed.doc?.word;
      if (key && seen.has(key)) allErrors.push(`Row ${i + 1}: duplicate word "${key}"`);
      else if (key) seen.add(key);
    }
    results.push(parsed);
    allErrors.push(...parsed.errors);
  }

  return {
    ok: allErrors.length === 0,
    validCount: results.filter(r => r.valid).length,
    errorCount: allErrors.length,
    errors: allErrors.slice(0, 50),
    preview: results.filter(r => r.valid).map(r => r.doc).slice(0, 20),
  };
}

async function commitImport(gameSetId, rows, importType) {
  const preview = await previewImport(gameSetId, rows, importType);
  if (!preview.ok) return preview;

  const set = await GameSet.findById(gameSetId);
  const normalized = rows.map((row, i) => normalizeRow(row, set.gameType));

  if (importType === 'levels') {
    const levels = normalized.map((row, i) => validateLevelRow(row, i).doc).filter(Boolean);
    await GameLevel.deleteMany({ gameSetId });
    await GameLevel.insertMany(levels.map(l => ({ ...l, gameSetId })));
    return { ok: true, imported: levels.length, type: 'levels' };
  }

  const docs = normalized.map((row, i) => {
    const parsed = set.gameType === 'sentence_builder'
      ? validateSentenceRow(row, i)
      : validateScrambleRow(row, i);
    return { ...parsed.doc, gameSetId, gameType: set.gameType };
  }).filter(d => d.word || d.correctSentence);

  await GameQuestion.insertMany(docs);
  const count = await GameQuestion.countDocuments({ gameSetId, isDeleted: { $ne: true } });
  await GameSet.findByIdAndUpdate(gameSetId, { questionCount: count });

  return { ok: true, imported: docs.length, type: 'questions' };
}

function getImportTemplate(gameType) {
  if (gameType === 'sentence_builder') {
    return [{ correct_sentence: 'Ich esse gern Eier.', translation: 'I like to eat eggs.', order: 0, randomize_words: true }];
  }
  if (gameType === 'scramble_rush') {
    return [
      { word: 'HAUS', hint: 'Place to live', difficulty_level: 1, order: 0 },
      { word: 'BUCH', hint: 'You read it', difficulty_level: 1, order: 1 },
    ];
  }
  return [];
}

module.exports = { previewImport, commitImport, getImportTemplate };
