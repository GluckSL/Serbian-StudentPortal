// services/interactiveGames/import.js — CSV/Excel bulk import validation

const GameQuestion = require('../../models/GameQuestion');
const GameLevel = require('../../models/GameLevel');
const GameSet = require('../../models/GameSet');
const { germanUppercase, trimGermanWord } = require('../../utils/germanText');
const genderStackService = require('./genderStack');

function normalizeKey(key) {
  return String(key || '')
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function normalizeRow(row) {
  const r = {};
  Object.keys(row).forEach(k => {
    r[normalizeKey(k)] = row[k];
  });
  return r;
}

/** Scramble Rush level row — not a CEFR "level" column on word rows */
function isScrambleLevelRow(row, importType) {
  if (importType === 'levels') return true;
  const word = String(row.word || '').trim();
  if (word) return false;
  const levelNum = parseInt(row.level_number, 10);
  if (levelNum > 0) return true;
  const legacyLevel = parseInt(row.level, 10);
  return legacyLevel > 0;
}

function validateScrambleRow(row, index) {
  const errors = [];
  const word = germanUppercase(row.word);
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
      word: trimGermanWord(left), 
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
      word: trimGermanWord(front),
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

function validateGenderStackRow(row, index) {
  const errors = [];
  const word = trimGermanWord(row.word);
  const translation = String(row.translation || row.hint || '').trim();
  const articleGender = genderStackService.normalizeGender(
    row.article_gender || row.articlegender || row.gender
  );

  if (!word) errors.push(`Row ${index + 1}: "word" column is required for Gender Stack`);
  if (!translation) errors.push(`Row ${index + 1}: "translation" column is required for Gender Stack`);
  if (!articleGender) {
    errors.push(`Row ${index + 1}: "article_gender" must be der, die, or das`);
  }

  return {
    valid: errors.length === 0,
    errors,
    doc: {
      word,
      translation,
      articleGender,
      audioUrl: String(row.audio_url || row.audiourl || '').trim() || null,
      order: parseInt(row.order, 10) || index,
    },
  };
}

function flapjugationTokenColumns() {
  return ['ich', 'du', 'er_sie_es', 'wir', 'ihr', 'sie_formal'];
}

function readFlapjugationTokens(row) {
  const cols = flapjugationTokenColumns();
  const legacy = [
    row.conjugation_1, row.conjugation_2, row.conjugation_3,
    row.conjugation_4, row.conjugation_5, row.conjugation_6,
  ];
  return cols.map((col, i) => {
    const alt = col === 'er_sie_es' ? row['er/sie/es'] : null;
    return String(row[col] ?? alt ?? legacy[i] ?? '').trim();
  });
}

function validateFlapjugationRow(row, index) {
  const errors = [];
  const word = trimGermanWord(row.word || row.infinitive);
  const translation = String(row.translation || '').trim();
  const tokens = readFlapjugationTokens(row);

  if (!word) errors.push(`Row ${index + 1}: "word" (infinitive) is required for Flapjugation`);
  if (!translation) errors.push(`Row ${index + 1}: "translation" is required for Flapjugation`);
  tokens.forEach((t, i) => {
    if (!t) {
      const label = flapjugationTokenColumns()[i];
      errors.push(`Row ${index + 1}: "${label}" conjugation is required`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    doc: {
      word,
      translation,
      tokens,
      order: parseInt(row.order, 10) || index,
    },
  };
}

function validateWhackawortRow(row, index) {
  const errors = [];
  const word = trimGermanWord(row.word);
  const translation = String(row.translation || '').trim();
  const category = String(row.category || '').trim();

  if (!word) errors.push(`Row ${index + 1}: "word" column is required for Whack-a-Wort`);
  if (!translation) errors.push(`Row ${index + 1}: "translation" column is required for Whack-a-Wort`);
  if (!category) errors.push(`Row ${index + 1}: "category" column is required for Whack-a-Wort`);

  return {
    valid: errors.length === 0,
    errors,
    doc: {
      word,
      translation,
      category,
      order: parseInt(row.order, 10) || index,
    },
  };
}

function validateJumbledWordsRow(row, index) {
  const errors = [];
  const word = germanUppercase(row.word);
  const hint = String(row.hint || row.translation || '').trim();
  const imageUrl = String(row.image_url || row.imageurl || '').trim() || null;

  if (!word) errors.push(`Row ${index + 1}: "word" column is required for Jumbled Words`);
  if (!hint && !imageUrl) {
    errors.push(`Row ${index + 1}: "hint" (translation) or "image_url" is required for Jumbled Words`);
  }

  return {
    valid: errors.length === 0,
    errors,
    doc: {
      word,
      hint,
      imageUrl,
      audioUrl: String(row.audio_url || row.audiourl || '').trim() || null,
      order: parseInt(row.order, 10) || index,
    },
  };
}

/** Image Matching / Memory: one CSV row per pair; group by question_index */
function parsePairBasedRows(normalized, gameType) {
  const groups = new Map();

  normalized.forEach((row, i) => {
    const qIdx = parseInt(row.question_index ?? row.question_number ?? row.question ?? '0', 10);
    const questionIndex = Number.isFinite(qIdx) && qIdx >= 0 ? qIdx : 0;
    if (!groups.has(questionIndex)) groups.set(questionIndex, []);
    groups.get(questionIndex).push({ row, fileRow: i });
  });

  const results = [];
  const sortedKeys = [...groups.keys()].sort((a, b) => a - b);

  sortedKeys.forEach((questionIndex) => {
    const items = groups.get(questionIndex);
    const errors = [];
    const pairs = [];

    if (items.length > 8) {
      errors.push(`Question ${questionIndex + 1}: maximum 8 pairs per question`);
    }

    items.forEach(({ row, fileRow }, pairIdx) => {
      const word = trimGermanWord(row.word);
      const hint = String(row.hint || row.translation || '').trim();
      const imageUrl = String(row.image_url || row.imageurl || '').trim() || null;
      const audioUrl = String(row.audio_url || row.audiourl || '').trim() || null;
      const rowLabel = fileRow + 1;

      if (!word) {
        errors.push(`Row ${rowLabel}: "word" is required`);
        return;
      }

      pairs.push({
        word,
        hint: gameType === 'image_matching' ? hint : '',
        imageUrl,
        audioUrl: gameType === 'image_matching' ? audioUrl : null,
        order: parseInt(row.order, 10) ?? pairIdx,
      });
    });

    if (pairs.length === 0 && errors.length === 0) {
      errors.push(`Question ${questionIndex + 1}: at least one pair with a word is required`);
    }

    results.push({
      valid: errors.length === 0 && pairs.length > 0,
      errors,
      doc: { pairs, order: questionIndex },
      type: 'question',
    });
  });

  return results;
}
function parseRows(rows, gameType, importType) {
  const normalized = rows.map(r => normalizeRow(r));

  if (gameType === 'image_matching' || gameType === 'memory') {
    return parsePairBasedRows(normalized, gameType);
  }

  const results = [];
  const seen = new Set();

  normalized.forEach((row, i) => {
    let type = 'question';
    let parsed;

    // Detect if this row is a level or a question (word rows win over optional CEFR "level" column)
    if (gameType === 'scramble_rush' && isScrambleLevelRow(row, importType)) {
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
      } else if (gameType === 'gender_stack') {
        parsed = validateGenderStackRow(row, i);
        if (parsed.valid) {
          const key = parsed.doc?.word?.toLowerCase();
          if (key && seen.has(key)) parsed.errors.push(`Row ${i + 1}: duplicate word`);
          else if (key) seen.add(key);
        }
      } else if (gameType === 'flapjugation') {
        parsed = validateFlapjugationRow(row, i);
        if (parsed.valid) {
          const key = parsed.doc?.word?.toLowerCase();
          if (key && seen.has(key)) parsed.errors.push(`Row ${i + 1}: duplicate infinitive`);
          else if (key) seen.add(key);
        }
      } else if (gameType === 'whackawort') {
        parsed = validateWhackawortRow(row, i);
        if (parsed.valid) {
          const key = `${parsed.doc?.word}|${parsed.doc?.category}`.toLowerCase();
          if (key && seen.has(key)) parsed.errors.push(`Row ${i + 1}: duplicate word in category`);
          else if (key) seen.add(key);
        }
      } else if (gameType === 'jumbled_words') {
        parsed = validateJumbledWordsRow(row, i);
        if (parsed.valid) {
          const key = parsed.doc?.word;
          if (key && seen.has(key)) parsed.errors.push(`Row ${i + 1}: duplicate word "${key}"`);
          else if (key) seen.add(key);
          else if (key) seen.add(key);
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
  if (gameType === 'gender_stack') {
    return [
      { word: 'Tisch', translation: 'table', article_gender: 'der', audio_url: '', order: 0 },
      { word: 'Lampe', translation: 'lamp', article_gender: 'die', audio_url: '', order: 1 },
      { word: 'Buch', translation: 'book', article_gender: 'das', audio_url: '', order: 2 },
    ];
  }
  if (gameType === 'flapjugation') {
    return [
      {
        word: 'spielen',
        translation: 'to play',
        ich: 'spiele',
        du: 'spielst',
        er_sie_es: 'spielt',
        wir: 'spielen',
        ihr: 'spielt',
        sie_formal: 'spielen',
        order: 0,
      },
      {
        word: 'sein',
        translation: 'to be',
        ich: 'bin',
        du: 'bist',
        er_sie_es: 'ist',
        wir: 'sind',
        ihr: 'seid',
        sie_formal: 'sind',
        order: 1,
      },
    ];
  }
  if (gameType === 'whackawort') {
    return [
      { word: 'Apfel', translation: 'apple', category: 'Food', order: 0 },
      { word: 'Hund', translation: 'dog', category: 'Animals', order: 1 },
      { word: 'Auto', translation: 'car', category: 'Transport', order: 2 },
    ];
  }
  if (gameType === 'image_matching') {
    return [
      { question_index: 0, word: 'Hund', hint: 'Dog', image_url: '', order: 0 },
      { question_index: 0, word: 'Katze', hint: 'Cat', image_url: '', order: 1 },
      { question_index: 1, word: 'Apfel', hint: 'Apple', image_url: '', order: 0 },
      { question_index: 1, word: 'Banane', hint: 'Banana', image_url: '', order: 1 },
    ];
  }
  if (gameType === 'memory') {
    return [
      { question_index: 0, word: 'Hund', image_url: '', order: 0 },
      { question_index: 0, word: 'Katze', image_url: '', order: 1 },
      { question_index: 0, word: 'Vogel', image_url: '', order: 2 },
      { question_index: 0, word: 'Fisch', image_url: '', order: 3 },
    ];
  }
  if (gameType === 'jumbled_words') {
    return [
      { word: 'HAUS', hint: 'house', image_url: '', order: 0 },
      { word: 'BUCH', hint: 'book', image_url: '', order: 1 },
    ];
  }
  if (gameType === 'hangman') {
    return [
      { word: 'HAUS', hint: 'A place to live', image_url: '', order: 0 },
      { word: 'GARTEN', hint: 'Where flowers grow', image_url: '', order: 1 },
    ];
  }
  if (gameType === 'multiple_choice') {
    return [
      { question_text: 'Wie lautet der Imperativ von "essen"?', option_1: 'iss!', option_2: 'isst!', option_3: 'esse!', correct_option: '1', order: 0 },
      { question_text: 'Was ist der Plural von "Kind"?', option_1: 'Kind', option_2: 'Kinder', option_3: 'Kindern', correct_option: '2', order: 1 },
    ];
  }
  return [];
}

const SUPPORTED_GAME_TYPES = [
  'scramble_rush', 'sentence_builder', 'matching', 'flashcards',
  'image_matching', 'gender_stack', 'flapjugation', 'whackawort',
  'memory', 'jumbled_words',
];

module.exports = {
  previewImport,
  commitImport,
  getImportTemplate,
  parseRows,
  normalizeRow,
  SUPPORTED_GAME_TYPES,
};
