// services/interactiveGames/import.js — CSV/Excel bulk import validation

const GameQuestion = require('../../models/GameQuestion');
const GameLevel = require('../../models/GameLevel');
const GameSet = require('../../models/GameSet');

function normalizeRow(row) {
  const r = {};
  Object.keys(row).forEach(k => {
    r[k.trim().toLowerCase().replace(/\s+/g, '_')] = row[k];
  });
  return r;
}

function validateScrambleRow(row, index) {
  const errors = [];
  const word = String(row.word || '').trim().toUpperCase();
  if (!word) errors.push(`Row ${index + 1}: "word" column is required for Scramble Rush`);
  
  // Anti-cross-contamination check: if it looks like a sentence, it's probably the wrong file
  if (word.includes(' ')) errors.push(`Row ${index + 1}: "word" should not contain spaces in Scramble Rush`);

  return {
    valid: errors.length === 0,
    errors,
    doc: {
      word,
      hint: String(row.hint || '').trim(),
      imageUrl: String(row.image_url || row.imageurl || '').trim() || null,
      audioUrl: String(row.audio_url || row.audiourl || '').trim() || null,
      difficultyLevel: Math.min(5, Math.max(1, parseInt(row.difficulty_level || row.difficultylevel, 10) || 1)),
      fallDurationSeconds: Math.min(30, Math.max(2, parseInt(row.fall_duration_seconds || row.falldurationseconds, 10) || 5)),
      order: parseInt(row.order, 10) || index,
    },
  };
}

function validateSentenceRow(row, index) {
  const errors = [];
  const sentence = String(row.correct_sentence || row.sentence || '').trim();
  if (!sentence) errors.push(`Row ${index + 1}: "correct_sentence" column is required for Sentence Builder`);
  
  const tokens = sentence ? sentence.split(/\s+/).filter(Boolean) : [];
  return {
    valid: errors.length === 0,
    errors,
    doc: {
      correctSentence: sentence,
      translation: String(row.translation || '').trim(),
      sentenceAudioUrl: String(row.sentence_audio_url || row.sentenceaudiourl || '').trim() || null,
      randomizeWords: String(row.randomize_words ?? 'true').toLowerCase() !== 'false',
      tokens,
      order: parseInt(row.order, 10) || index,
    },
  };
}

function validateMatchingRow(row, index) {
  const errors = [];
  const left = String(row.left || '').trim();
  const right = String(row.right || '').trim();
  
  if (!left) errors.push(`Row ${index + 1}: "left" column is required for Matching`);
  if (!right) errors.push(`Row ${index + 1}: "right" column is required for Matching`);

  return {
    valid: errors.length === 0,
    errors,
    doc: {
      word: left.toUpperCase(), 
      hint: right,
      imageUrl: String(row.image_url || row.imageurl || '').trim() || null,
      order: parseInt(row.order, 10) || index,
    },
  };
}

function validateFlashcardRow(row, index) {
  const errors = [];
  const front = String(row.front || '').trim();
  const back = String(row.back || '').trim();

  if (!front) errors.push(`Row ${index + 1}: "front" column is required for Flashcards`);
  if (!back) errors.push(`Row ${index + 1}: "back" column is required for Flashcards`);

  return {
    valid: errors.length === 0,
    errors,
    doc: {
      word: front.toUpperCase(),
      hint: back,
      imageUrl: String(row.image_url || row.imageurl || '').trim() || null,
      audioUrl: String(row.audio_url || row.audiourl || '').trim() || null,
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

function parseRows(rows, gameType, importType) {
  const normalized = rows.map(r => normalizeRow(r));
  const results = [];
  const seen = new Set();

  normalized.forEach((row, i) => {
    let type = 'question';
    let parsed;

    // Detect if this row is a level or a question
    if (importType === 'levels' || (gameType === 'scramble_rush' && (row.level_number || row.level))) {
      type = 'level';
      parsed = validateLevelRow(row, i);
    } else {
      // Strict validation according to gameType
      if (gameType === 'sentence_builder') {
        parsed = validateSentenceRow(row, i);
        if (parsed.valid) {
          const key = parsed.doc?.correctSentence?.toLowerCase();
          if (key) {
            if (seen.has(key)) parsed.errors.push(`Row ${i + 1}: duplicate sentence`);
            else seen.add(key);
          }
        }
      } else if (gameType === 'matching') {
        parsed = validateMatchingRow(row, i);
        if (parsed.valid) {
          const key = `${parsed.doc?.word}|${parsed.doc?.hint}`.toLowerCase();
          if (key && seen.has(key)) parsed.errors.push(`Row ${i + 1}: duplicate pair`);
          else if (key) seen.add(key);
        }
      } else if (gameType === 'flashcards') {
        parsed = validateFlashcardRow(row, i);
        if (parsed.valid) {
          const key = parsed.doc?.word?.toLowerCase();
          if (key && seen.has(key)) parsed.errors.push(`Row ${i + 1}: duplicate front`);
          else if (key) seen.add(key);
        }
      } else if (gameType === 'scramble_rush') {
        parsed = validateScrambleRow(row, i);
        if (parsed.valid) {
          const key = parsed.doc?.word;
          if (key) {
            if (seen.has(key)) parsed.errors.push(`Row ${i + 1}: duplicate word "${key}"`);
            else seen.add(key);
          }
        }
      } else {
        parsed = { valid: false, errors: [`Row ${i + 1}: unsupported game type "${gameType}"`], doc: null };
      }
    }

    results.push({ ...parsed, type });
  });

  return results;
}

async function previewImport(gameSetId, rows, importType, gameType) {
  const set = await GameSet.findById(gameSetId).lean();
  if (!set) return { ok: false, message: 'Game set not found' };

  const activeGameType = gameType || set.gameType;
  const parsedResults = parseRows(rows, activeGameType, importType);
  const allErrors = parsedResults.flatMap(r => r.errors);

  return {
    ok: allErrors.length === 0,
    validCount: parsedResults.filter(r => r.valid).length,
    errorCount: allErrors.length,
    errors: allErrors.slice(0, 50),
    preview: parsedResults.filter(r => r.valid).map(r => ({ ...r.doc, _importType: r.type })).slice(0, 20),
  };
}

async function commitImport(gameSetId, rows, importType, gameType) {
  const set = await GameSet.findById(gameSetId);
  if (!set) return { ok: false, message: 'Game set not found' };

  const activeGameType = gameType || set.gameType;
  const parsedResults = parseRows(rows, activeGameType, importType);
  const allErrors = parsedResults.flatMap(r => r.errors);

  if (allErrors.length > 0) {
    return { ok: false, errors: allErrors.slice(0, 50), message: 'Validation failed' };
  }

  const levelDocs = parsedResults.filter(r => r.type === 'level').map(r => ({ ...r.doc, gameSetId: set._id }));
  const questionDocs = parsedResults.filter(r => r.type === 'question').map(r => ({ ...r.doc, gameSetId: set._id, gameType: activeGameType }));

  let importedCount = 0;

  if (levelDocs.length > 0) {
    await GameLevel.deleteMany({ gameSetId: set._id });
    const insertedLevels = await GameLevel.insertMany(levelDocs);
    importedCount += insertedLevels.length;
  }

  if (questionDocs.length > 0) {
    // Delete existing questions for this set before inserting new ones,
    // so the CSV upload fully replaces (not appends to) the current data.
    await GameQuestion.deleteMany({ gameSetId: set._id, isDeleted: { $ne: true } });
    const insertedQuestions = await GameQuestion.insertMany(questionDocs);
    const count = await GameQuestion.countDocuments({ gameSetId: set._id, isDeleted: { $ne: true } });
    await GameSet.findByIdAndUpdate(set._id, { questionCount: count });
    importedCount += insertedQuestions.length;
  }

  return {
    ok: true,
    imported: importedCount,
    counts: {
      levels: levelDocs.length,
      questions: questionDocs.length
    }
  };
}

function getImportTemplate(gameType) {
  if (gameType === 'sentence_builder') {
    return [{
      correct_sentence: 'Ich esse gern Eier.',
      translation: 'I like to eat eggs.',
      sentence_audio_url: '',
      order: 0,
      randomize_words: true
    }];
  }
  if (gameType === 'scramble_rush') {
    return [
      {
        word: 'HAUS',
        hint: 'Place to live',
        image_url: '',
        audio_url: '',
        difficulty_level: 1,
        fall_duration_seconds: 5,
        order: 0
      },
      {
        word: 'BUCH',
        hint: 'You read it',
        image_url: '',
        audio_url: '',
        difficulty_level: 1,
        fall_duration_seconds: 5,
        order: 1
      },
    ];
  }
  if (gameType === 'matching') {
    return [
      { left: 'Hund', right: 'Dog', image_url: '', order: 0 },
      { left: 'Katze', right: 'Cat', image_url: '', order: 1 },
    ];
  }
  if (gameType === 'flashcards') {
    return [
      { front: 'Apfel', back: 'Apple', image_url: '', audio_url: '', order: 0 },
      { front: 'Banane', back: 'Banana', image_url: '', audio_url: '', order: 1 },
    ];
  }
  return [];
}

module.exports = { previewImport, commitImport, getImportTemplate };
