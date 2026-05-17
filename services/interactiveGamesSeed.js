// services/interactiveGamesSeed.js
// GlückArena: idempotent demo data — runs once on server start.
// Mirrors pattern from services/dgCharacterSeed.js.

const GameSet = require('../models/GameSet');
const GameQuestion = require('../models/GameQuestion');
const GameLevel = require('../models/GameLevel');

const SCRAMBLE_SEED = {
  set: {
    title: 'German A1 Vocabulary Rush',
    description: 'Unscramble everyday German A1 words before they fall!',
    icon: 'bolt',
    gameType: 'scramble_rush',
    difficulty: 'Beginner',
    level: 'A1',
    category: 'Vocabulary',
    targetLanguage: 'German',
    xpReward: 60,
    visibleToStudents: true,
    timerSettings: { sessionLimitSeconds: 120, perQuestionSeconds: null },
    isPublished: true,
    questionCount: 8,
    estimatedDurationMinutes: 5,
  },
  words: [
    { word: 'HAUS',    hint: 'A place where people live', difficultyLevel: 1, fallDurationSeconds: 5 },
    { word: 'BUCH',    hint: 'You read it', difficultyLevel: 1, fallDurationSeconds: 5 },
    { word: 'HUND',    hint: 'A common pet animal', difficultyLevel: 1, fallDurationSeconds: 5 },
    { word: 'WASSER',  hint: 'You drink it', difficultyLevel: 2, fallDurationSeconds: 6 },
    { word: 'SCHULE',  hint: 'Where students learn', difficultyLevel: 2, fallDurationSeconds: 6 },
    { word: 'KAFFEE',  hint: 'Popular morning drink', difficultyLevel: 2, fallDurationSeconds: 7 },
    { word: 'FENSTER', hint: 'You look through it', difficultyLevel: 3, fallDurationSeconds: 8 },
    { word: 'FREUNDE', hint: 'People you like a lot', difficultyLevel: 3, fallDurationSeconds: 8 },
  ],
  levels: [
    { levelNumber: 1, lives: 3, timeLimitSeconds: 90,  fallSpeedMs: 9000, spawnIntervalMs: 4000, wordsRequired: 3, scoreMultiplier: 1.0 },
    { levelNumber: 2, lives: 3, timeLimitSeconds: 75,  fallSpeedMs: 7000, spawnIntervalMs: 3000, wordsRequired: 3, scoreMultiplier: 1.5 },
    { levelNumber: 3, lives: 2, timeLimitSeconds: 60,  fallSpeedMs: 5000, spawnIntervalMs: 2500, wordsRequired: 2, scoreMultiplier: 2.0 },
  ],
};

const SENTENCE_SEED = {
  set: {
    title: 'German Food Sentences',
    description: 'Arrange the words to build correct German food sentences.',
    icon: 'restaurant',
    gameType: 'sentence_builder',
    difficulty: 'Beginner',
    level: 'A1',
    category: 'Vocabulary',
    targetLanguage: 'German',
    xpReward: 50,
    visibleToStudents: true,
    timerSettings: { sessionLimitSeconds: null, perQuestionSeconds: 30 },
    isPublished: true,
    questionCount: 5,
    estimatedDurationMinutes: 7,
  },
  sentences: [
    { correctSentence: 'Ich esse gern Eier.', translation: 'I like to eat eggs.', randomizeWords: true },
    { correctSentence: 'Er trinkt jeden Morgen Kaffee.', translation: 'He drinks coffee every morning.', randomizeWords: true },
    { correctSentence: 'Wir essen heute Pizza.', translation: 'We eat pizza today.', randomizeWords: true },
    { correctSentence: 'Das Brot ist sehr lecker.', translation: 'The bread is very tasty.', randomizeWords: true },
    { correctSentence: 'Sie kauft Äpfel im Supermarkt.', translation: 'She buys apples at the supermarket.', randomizeWords: true },
  ],
};

/** Tokenize sentence into words (strips trailing punctuation for tokens). */
function tokenize(sentence) {
  return sentence.trim().split(/\s+/).filter(Boolean);
}

async function ensureInteractiveGamesSeeded() {
  try {
    const anySet = await GameSet.exists({ isDeleted: { $ne: true } });
    if (anySet) return;  // already seeded

    // ── Scramble Rush ──────────────────────────────────────────────────────
    const srSet = await GameSet.create(SCRAMBLE_SEED.set);
    const srQuestions = SCRAMBLE_SEED.words.map((w, i) => ({
      ...w,
      gameSetId: srSet._id,
      gameType: 'scramble_rush',
      order: i,
    }));
    await GameQuestion.insertMany(srQuestions);

    const srLevels = SCRAMBLE_SEED.levels.map(l => ({ ...l, gameSetId: srSet._id }));
    await GameLevel.insertMany(srLevels);

    // ── Sentence Builder ───────────────────────────────────────────────────
    const sbSet = await GameSet.create(SENTENCE_SEED.set);
    const sbQuestions = SENTENCE_SEED.sentences.map((s, i) => ({
      ...s,
      tokens: tokenize(s.correctSentence),
      gameSetId: sbSet._id,
      gameType: 'sentence_builder',
      order: i,
    }));
    await GameQuestion.insertMany(sbQuestions);

    console.log('[glueck-arena] Seeded demo game sets (Scramble Rush + Sentence Builder)');
  } catch (e) {
    console.warn('[glueck-arena] ensureInteractiveGamesSeeded:', e.message || e);
  }
}

module.exports = { ensureInteractiveGamesSeeded };
