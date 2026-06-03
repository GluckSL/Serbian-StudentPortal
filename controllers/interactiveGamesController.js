// controllers/interactiveGamesController.js
// GlückArena — delegates to service layer in services/interactiveGames/

const mongoose = require('mongoose');
const GameSet = require('../models/GameSet');
const GameQuestion = require('../models/GameQuestion');
const GameLevel = require('../models/GameLevel');
const GameAttempt = require('../models/GameAttempt');
const GameAnswer = require('../models/GameAnswer');
const XpTransaction = require('../models/XpTransaction');
const StudentGameStats = require('../models/StudentGameStats');

const journeyFilterService = require('../services/interactiveGames/journeyFilter');
const scoringService = require('../services/interactiveGames/scoring');
const scrambleRushService = require('../services/interactiveGames/scrambleRush');
const sentenceBuilderService = require('../services/interactiveGames/sentenceBuilder');
const imageMatchingService = require('../services/interactiveGames/imageMatching');
const genderStackService = require('../services/interactiveGames/genderStack');
const memoryService = require('../services/interactiveGames/memory');
const jumbledWordsService = require('../services/interactiveGames/jumbledWords');
const hangmanService = require('../services/interactiveGames/hangman');
const wordPictureMatchService = require('../services/interactiveGames/wordPictureMatch');
const multipleChoiceService = require('../services/interactiveGames/multipleChoice');
const leaderboardService = require('../services/interactiveGames/leaderboard');
const xpService = require('../services/interactiveGames/xp');
const { uploadThumbnail, uploadQuestionAudio, uploadQuestionImage, uploadPairImage } = require('../services/interactiveGames/mediaUpload');
const { presignMediaUrl, resignMediaInObject, resignMediaInObjects } = require('../config/presign');
const analyticsService = require('../services/interactiveGames/analytics');
const securityService = require('../services/interactiveGames/security');
const dailyChallengesService = require('../services/interactiveGames/dailyChallenges');
const achievementsService = require('../services/interactiveGames/achievements');
const teacherAnalyticsService = require('../services/interactiveGames/teacherAnalytics');
const importService = require('../services/interactiveGames/import');
const cacheService = require('../services/interactiveGames/cache');
const questsService = require('../services/interactiveGames/quests');
const { normalizeBatchKeys } = require('../utils/batchTargeting');
const { germanUppercase, trimGermanWord } = require('../utils/germanText');

const VALID_GAME_TYPES = ['scramble_rush', 'sentence_builder', 'matching', 'flashcards', 'image_matching', 'gender_stack', 'flapjugation', 'whackawort', 'memory', 'jumbled_words', 'hangman', 'word_picture_match', 'multiple_choice'];
const VALID_DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];
const VALID_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const VALID_CATEGORIES = ['Grammar', 'Vocabulary', 'Conversation', 'Reading', 'Writing', 'Listening', 'Pronunciation'];
const ARENA_STAFF_ROLES = ['ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN'];

function isArenaStaff(role) {
  return ARENA_STAFF_ROLES.includes(role);
}

function requestUserId(req) {
  const u = req.user;
  return String(u?.id || u?._id || u?.userId || '');
}

function ownsAttempt(attempt, req) {
  const uid = requestUserId(req);
  return !!uid && String(attempt.studentId) === uid;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampPage(p) { return Math.max(1, parseInt(p, 10) || 1); }
function clampLimit(l) { return Math.min(Math.max(parseInt(l, 10) || 12, 1), 50); }

function normalizeGenderStackSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    spawnIntervalSeconds: Math.min(5, Math.max(3, parseInt(src.spawnIntervalSeconds, 10) || 4)),
    fallDurationSeconds: Math.min(3, Math.max(0.5, parseFloat(src.fallDurationSeconds) || 1.2)),
  };
}

function badRequest(res, msg) { return res.status(400).json({ success: false, message: msg }); }
function notFound(res, msg = 'Not found') { return res.status(404).json({ success: false, message: msg }); }
function serverError(res, err) {
  console.error('[glueck-arena]', err);
  return res.status(500).json({ success: false, message: err.message || 'Server error' });
}

/** Count total image-word pairs across all questions in a game set */
async function getTotalImageMatchPairs(gameSetId) {
  const questions = await GameQuestion.find({
    gameSetId, gameType: 'image_matching', isDeleted: { $ne: true },
  }).lean();
  let count = 0;
  questions.forEach(q => {
    if (q.pairs) count += q.pairs.length;
  });
  return count;
}

// ── STUDENT — Arena access (nav visibility) ───────────────────────────────────

exports.getArenaAccess = async (req, res) => {
  try {
    const result = await journeyFilterService.hasArenaAccess(req.user.id);
    res.json({ success: true, ...result });
  } catch (err) {
    serverError(res, err);
  }
};

/** Attach best score + play count for a student across game sets. */
async function attachStudentProgressToSets(studentId, sets) {
  if (!studentId || !sets.length) return sets;
  const setIds = sets.map((s) => s._id);
  const studentObjId = new mongoose.Types.ObjectId(String(studentId));
  const bestAttempts = await GameAttempt.aggregate([
    { $match: { studentId: studentObjId, gameSetId: { $in: setIds }, status: 'completed' } },
    { $sort: { score: -1 } },
    { $group: { _id: '$gameSetId', bestScore: { $max: '$score' }, count: { $sum: 1 } } },
  ]);
  const studentStats = {};
  bestAttempts.forEach((a) => {
    studentStats[String(a._id)] = { bestScore: a.bestScore, timesPlayed: a.count };
  });
  return sets.map((s) => ({
    ...s,
    studentProgress: studentStats[String(s._id)] || { bestScore: null, timesPlayed: 0 },
  }));
}

// ── STUDENT — Journey day map (My Course → Journey to Germany) ───────────────

exports.getJourneyGames = async (req, res) => {
  try {
    if (req.user.role !== 'STUDENT') {
      return res.status(403).json({ success: false, message: 'Students only' });
    }
    const access = await journeyFilterService.hasArenaAccess(req.user.id);
    const filter = await journeyFilterService.buildStudentFilter(req.user.id);
    Object.assign(filter, {
      courseDay: { $ne: null, $gte: 1, $lte: 200 },
      targetLanguage: 'German',
    });

    const sets = await GameSet.find(filter)
      .select('-__v')
      .sort({ courseDay: 1, sequenceLetter: 1, title: 1 })
      .lean();

    let items = await attachStudentProgressToSets(req.user.id, sets);
    await resignMediaInObjects(items);

    res.json({
      success: true,
      items,
      hasArenaAccess: access.hasAccess,
      gameCount: access.gameCount,
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Catalog ─────────────────────────────────────────────────────────

exports.getCatalog = async (req, res) => {
  try {
    const page = clampPage(req.query.page);
    const limit = clampLimit(req.query.limit);
    const skip = (page - 1) * limit;

    const filter = { isPublished: true, isDeleted: { $ne: true } };

    if (req.query.gameType && VALID_GAME_TYPES.includes(req.query.gameType)) {
      filter.gameType = req.query.gameType;
    }
    if (req.query.difficulty && VALID_DIFFICULTIES.includes(req.query.difficulty)) {
      filter.difficulty = req.query.difficulty;
    }
    if (req.query.level && VALID_LEVELS.includes(req.query.level)) {
      filter.level = req.query.level;
    }
    if (req.query.search) {
      filter.title = { $regex: req.query.search.trim(), $options: 'i' };
    }

    // Apply journey gating for students (same approach as digital exercises)
    if (req.user.role === 'STUDENT') {
      const journeyFilter = await journeyFilterService.buildStudentFilter(req.user.id);
      Object.assign(filter, journeyFilter);
    }

    const [sets, total] = await Promise.all([
      GameSet.find(filter)
        .select('-__v')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      GameSet.countDocuments(filter),
    ]);

    let items = sets;
    if (req.user.role === 'STUDENT' && sets.length) {
      items = await attachStudentProgressToSets(req.user.id, sets);
    }

    await resignMediaInObjects(items);

    res.json({
      success: true,
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Detail ──────────────────────────────────────────────────────────

exports.getGameDetail = async (req, res) => {
  try {
    const set = await GameSet.findOne({
      _id: req.params.id,
      isPublished: true,
      isDeleted: { $ne: true },
    }).select('-__v').lean();

    if (!set) return notFound(res, 'Game not found');

    // Attach leaderboard preview (top 3)
    const top3 = await leaderboardService.getPerGameLeaderboard(set._id, { limit: 3 });

    await resignMediaInObject(set);

    res.json({ success: true, set, leaderboardPreview: top3 });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Start attempt ────────────────────────────────────────────────────

exports.startAttempt = async (req, res) => {
  try {
    const staffPreview = isArenaStaff(req.user.role);
    const setFilter = { _id: req.params.id, isDeleted: { $ne: true } };
    if (!staffPreview) setFilter.isPublished = true;

    const set = await GameSet.findOne(setFilter).lean();

    if (!set) return notFound(res, 'Game not found');

    // Check journey gate for students only
    if (req.user.role === 'STUDENT') {
      const gated = await journeyFilterService.isGated(req.user.id, set);
      if (gated) return res.status(403).json({ success: false, message: 'This game is not yet unlocked for your level.' });
    }

    // Determine attempt number
    const prevCount = await GameAttempt.countDocuments({ studentId: req.user.id, gameSetId: set._id });

    const initialLives = set.gameType === 'gender_stack' || set.gameType === 'flapjugation' || set.gameType === 'whackawort' || set.gameType === 'memory' ? 5 : set.gameType === 'jumbled_words' || set.gameType === 'hangman' ? 99 : 3;
    const attempt = await GameAttempt.create({
      studentId: req.user.id,
      gameSetId: set._id,
      gameType: set.gameType,
      status: 'in-progress',
      livesRemaining: initialLives,
      totalQuestions: set.questionCount,
      attemptNumber: prevCount + 1,
    });

    // Fetch questions WITH answers (server-side only) to build sanitized view
    const questions = await GameQuestion.find({
      gameSetId: set._id,
      isDeleted: { $ne: true },
    }).sort({ order: 1 }).lean();

    // Build sanitized questions — never expose the answer fields to the client
    const sanitized = questions.map(q => {
      if (set.gameType === 'scramble_rush') {
        // Expose scrambled letters + letter count; hide the actual word
        const scrambled = scrambleRushService.attachScrambled([q])[0];
        const { word: _w, __v: _v, ...safe } = scrambled;
        return safe;
      }
      if (set.gameType === 'sentence_builder') {
        // Shuffled order for play; correctTokens enables instant per-slot feedback (rearrange mode)
        const shuffledTokens = sentenceBuilderService.getShuffledTokens(q);
        const correctTokens = sentenceBuilderService.getCorrectTokens(q);
        const { correctSentence: _cs, tokens: _t, __v: _v, ...safe } = q;
        return { ...safe, shuffledTokens, correctTokens };
      }
      if (set.gameType === 'image_matching') {
        // Hide pair word from client; expose sanitized pairs with imageUrl/hint only
        const safe = { ...q };
        if (safe.pairs) {
          safe.pairs = safe.pairs.map(p => {
            const { word: _w, ...safePair } = p;
            return safePair;
          });
        }
        // Strip legacy root-level fields that existed before pairs schema
        const { word: _w, imageUrl: _img, hint: _h, audioUrl: _au, difficultyLevel: _dl, fallDurationSeconds: _fds, correctSentence: _cs, translation: _tr, sentenceAudioUrl: _sau, randomizeWords: _rw, tokens: _tk, __v: _v, ...rest } = safe;
        return rest;
      }
      if (set.gameType === 'gender_stack') {
        const { articleGender: _ag, hint: _h, imageUrl: _img, audioUrl: _au, difficultyLevel: _dl, fallDurationSeconds: _fds, correctSentence: _cs, sentenceAudioUrl: _sau, randomizeWords: _rw, tokens: _tk, pairs: _p, __v: _v, ...safe } = q;
        return safe;
      }
      if (set.gameType === 'flapjugation') {
        const { articleGender: _ag, hint: _h, imageUrl: _img, audioUrl: _au, difficultyLevel: _dl, fallDurationSeconds: _fds, correctSentence: _cs, sentenceAudioUrl: _sau, randomizeWords: _rw, pairs: _p, __v: _v, ...safe } = q;
        return safe;
      }
      if (set.gameType === 'whackawort') {
        const { articleGender: _ag, hint: _h, imageUrl: _img, audioUrl: _au, difficultyLevel: _dl, fallDurationSeconds: _fds, correctSentence: _cs, sentenceAudioUrl: _sau, randomizeWords: _rw, pairs: _p, tokens: _tk, __v: _v, ...safe } = q;
        return safe;
      }
      if (set.gameType === 'memory') {
        // Word is needed for display on word cards — include it
        const { articleGender: _ag, hint: _h, imageUrl: _img, audioUrl: _au, difficultyLevel: _dl, fallDurationSeconds: _fds, correctSentence: _cs, translation: _tr, sentenceAudioUrl: _sau, randomizeWords: _rw, tokens: _tk, __v: _v, ...safe } = q;
        return safe;
      }
      if (set.gameType === 'jumbled_words') {
        // Expose jumbled letters + word for per-slot validation; hide rest
        const jumbled = jumbledWordsService.attachJumbled([q])[0];
        const { articleGender: _ag, hint: _h, audioUrl: _au, difficultyLevel: _dl, fallDurationSeconds: _fds, correctSentence: _cs, translation: _tr, sentenceAudioUrl: _sau, randomizeWords: _rw, tokens: _tk, pairs: _p, __v: _v, ...safe } = jumbled;
        return safe;
      }
      if (set.gameType === 'hangman') {
        // Expose word + hint + letter count for client-side hangman game
        const { articleGender: _ag, difficultyLevel: _dl, fallDurationSeconds: _fds, correctSentence: _cs, translation: _tr, sentenceAudioUrl: _sau, randomizeWords: _rw, tokens: _tk, pairs: _p, __v: _v, ...safe } = q;
        return { ...safe, letterCount: (q.word || '').length };
      }
      if (set.gameType === 'word_picture_match') {
        // Expose pairs with word + imageUrl for client-side display; word is shown to student
        const { articleGender: _ag, hint: _h, imageUrl: _img, audioUrl: _au, difficultyLevel: _dl, fallDurationSeconds: _fds, correctSentence: _cs, translation: _tr, sentenceAudioUrl: _sau, randomizeWords: _rw, tokens: _tk, __v: _v, ...safe } = q;
        return safe;
      }
      if (set.gameType === 'multiple_choice') {
        // Strip isCorrect from options — never expose correct answers to client
        return multipleChoiceService.sanitizeQuestions([q])[0];
      }
      const { __v: _v, ...safe } = q;
      return safe;
    });

    // For scramble rush, also send level configs
    let levels = [];
    if (set.gameType === 'scramble_rush') {
      levels = await GameLevel.find({ gameSetId: set._id }).sort({ levelNumber: 1 }).lean();
    }

    // For image_matching and memory, send shuffled words for drag-drop/card UI
    let shuffledWords = [];
    if (set.gameType === 'image_matching' || set.gameType === 'memory' || set.gameType === 'word_picture_match') {
      const allWords = [];
      questions.forEach(q => {
        if (q.pairs) {
          q.pairs.forEach(p => {
            if (p.word) allWords.push(p.word);
          });
        }
      });
      shuffledWords = imageMatchingService.shuffleWords(allWords);
    } else if (set.gameType === 'matching' || set.gameType === 'flashcards') {
      const hints = questions.map(q => q.hint).filter(Boolean);
      shuffledWords = imageMatchingService.shuffleWords(hints);
    }

    res.json({
      success: true,
      attempt,
      questions: sanitized,
      shuffledWords,
      levels,
      set,
      preview: staffPreview,
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Sentence builder slot (instant per-word) ───────────────────────

exports.submitSentenceSlot = async (req, res) => {
  try {
    const attempt = await GameAttempt.findById(req.params.attemptId).lean();
    if (!attempt) return notFound(res, 'Attempt not found');
    if (!ownsAttempt(attempt, req)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (attempt.gameType !== 'sentence_builder') {
      return badRequest(res, 'Invalid game type for slot submission');
    }

    const { questionId, slotIndex, token, responseTimeMs, questionElapsedMs } = req.body;
    if (!questionId || slotIndex === undefined || !token) {
      return badRequest(res, 'questionId, slotIndex, and token required');
    }

    const validation = await securityService.validateSlotSubmission(attempt, questionId, slotIndex);
    if (!validation.ok) {
      return res.status(validation.duplicate ? 409 : 400).json({ success: false, message: validation.message });
    }

    const question = await GameQuestion.findOne({
      _id: questionId, gameSetId: attempt.gameSetId, isDeleted: { $ne: true },
    }).lean();
    if (!question) return notFound(res, 'Question not found');

    const result = sentenceBuilderService.evaluateSlot(question, slotIndex, token);
    let pointsEarned = 0;
    let speedBonus = 0;
    let questionComplete = false;

    if (!result.isCorrect) {
      return res.json({
        success: true,
        isCorrect: false,
        pointsEarned: 0,
        speedBonus: 0,
        questionComplete: false,
        totalSlots: result.totalSlots,
        correctSlots: await GameAnswer.countDocuments({
          attemptId: attempt._id, questionId: question._id, isCorrect: true,
        }),
      });
    }

    pointsEarned = result.points;
    const slotIdx = parseInt(slotIndex, 10);

    await GameAnswer.create({
      attemptId: attempt._id,
      questionId: question._id,
      studentId: req.user.id,
      orderedTokens: [String(token)],
      slotIndex: slotIdx,
      responseTimeMs: responseTimeMs || 0,
      isCorrect: true,
      pointsEarned,
    });

    const correctSlots = await GameAnswer.countDocuments({
      attemptId: attempt._id, questionId: question._id, isCorrect: true,
    });
    questionComplete = correctSlots >= result.totalSlots;

    if (questionComplete) {
      await GameAttempt.findByIdAndUpdate(attempt._id, {
        $inc: { score: pointsEarned, correctAnswers: 1, wordsCompleted: 1 },
      });

      const xpAmount = scoringService.perAnswerXp('sentence_builder');
      await xpService.award(req.user.id, attempt._id, attempt.gameSetId, 'answer_correct', xpAmount);
    } else {
      await GameAttempt.findByIdAndUpdate(attempt._id, { $inc: { score: pointsEarned } });
    }

    res.json({
      success: true,
      isCorrect: true,
      pointsEarned,
      speedBonus,
      questionComplete,
      totalSlots: result.totalSlots,
      correctSlots,
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Image matching slot (instant per-match) ─────────────────────────

exports.submitImageMatchSlot = async (req, res) => {
  try {
    const attempt = await GameAttempt.findById(req.params.attemptId).lean();
    if (!attempt) return notFound(res, 'Attempt not found');
    if (!ownsAttempt(attempt, req)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (attempt.gameType !== 'image_matching') {
      return badRequest(res, 'Invalid game type for image matching');
    }

    const { questionId, pairIndex, word, responseTimeMs } = req.body;
    if (!questionId || pairIndex === undefined || pairIndex === null || !word) {
      return badRequest(res, 'questionId, pairIndex and word required');
    }

    const active = securityService.validateAttemptActive(attempt);
    if (!active.ok) {
      return res.status(400).json({ success: false, message: active.message });
    }

    const question = await GameQuestion.findOne({
      _id: questionId, gameSetId: attempt.gameSetId, isDeleted: { $ne: true },
    }).lean();
    if (!question) return notFound(res, 'Question not found');

    const result = imageMatchingService.evaluateMatch(question, word, pairIndex);
    const staffPreview = isArenaStaff(req.user.role);
    const totalPairs = await getTotalImageMatchPairs(attempt.gameSetId);
    let pointsEarned = 0;
    let questionComplete = false;

    if (!result.isCorrect) {
      const correctMatches = staffPreview ? 0 : await GameAnswer.countDocuments({
        attemptId: attempt._id, isCorrect: true,
      });
      return res.json({
        success: true,
        isCorrect: false,
        pointsEarned: 0,
        questionComplete: false,
        correctMatches,
        totalMatches: totalPairs,
        preview: staffPreview,
      });
    }

    pointsEarned = result.points;

    if (!staffPreview) {
      const existingAnswer = await GameAnswer.findOne({
        attemptId: attempt._id,
        questionId: question._id,
        slotIndex: pairIndex,
      }).lean();
      if (existingAnswer) {
        const correctMatches = await GameAnswer.countDocuments({
          attemptId: attempt._id, isCorrect: true,
        });
        return res.json({
          success: true,
          isCorrect: true,
          alreadyMatched: true,
          pointsEarned: 0,
          questionComplete: false,
          correctMatches,
          totalMatches: totalPairs,
        });
      }

      await GameAnswer.create({
        attemptId: attempt._id,
        questionId: question._id,
        studentId: req.user.id,
        typedWord: String(word).trim(),
        slotIndex: pairIndex,
        responseTimeMs: responseTimeMs || 0,
        isCorrect: true,
        pointsEarned,
      });

      const correctMatches = await GameAnswer.countDocuments({
        attemptId: attempt._id, isCorrect: true,
      });
      questionComplete = correctMatches >= totalPairs;

      if (questionComplete) {
        await GameAttempt.findByIdAndUpdate(attempt._id, {
          $inc: { score: pointsEarned, correctAnswers: 1, wordsCompleted: 1 },
        });
        const xpAmount = scoringService.perAnswerXp('image_matching');
        await xpService.award(req.user.id, attempt._id, attempt.gameSetId, 'answer_correct', xpAmount);
      } else {
        await GameAttempt.findByIdAndUpdate(attempt._id, { $inc: { score: pointsEarned } });
      }

      return res.json({
        success: true,
        isCorrect: true,
        pointsEarned,
        questionComplete,
        correctMatches,
        totalMatches: totalPairs,
      });
    }

    res.json({
      success: true,
      isCorrect: true,
      pointsEarned,
      questionComplete: false,
      correctMatches: 0,
      totalMatches: totalPairs,
      preview: true,
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Word-Picture Match (instant per-match) ───────────────────────────

exports.submitWordPictureMatchSlot = async (req, res) => {
  try {
    const attempt = await GameAttempt.findById(req.params.attemptId).lean();
    if (!attempt) return notFound(res, 'Attempt not found');
    if (!ownsAttempt(attempt, req)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (attempt.gameType !== 'word_picture_match') {
      return badRequest(res, 'Invalid game type for word-picture match');
    }

    const { questionId, pairIndex, word, responseTimeMs } = req.body;
    if (!questionId || pairIndex === undefined || pairIndex === null || !word) {
      return badRequest(res, 'questionId, pairIndex and word required');
    }

    const active = securityService.validateAttemptActive(attempt);
    if (!active.ok) {
      return res.status(400).json({ success: false, message: active.message });
    }

    const question = await GameQuestion.findOne({
      _id: questionId, gameSetId: attempt.gameSetId, isDeleted: { $ne: true },
    }).lean();
    if (!question) return notFound(res, 'Question not found');

    const result = wordPictureMatchService.evaluateMatch(question, word, pairIndex);
    const staffPreview = isArenaStaff(req.user.role);

    if (!result.isCorrect) {
      return res.json({
        success: true,
        isCorrect: false,
        pointsEarned: 0,
      });
    }

    const pointsEarned = result.points;

    if (!staffPreview) {
      const existingAnswer = await GameAnswer.findOne({
        attemptId: attempt._id,
        questionId: question._id,
        slotIndex: pairIndex,
      }).lean();
      if (existingAnswer) {
        return res.json({
          success: true,
          isCorrect: true,
          alreadyMatched: true,
          pointsEarned: 0,
        });
      }

      await GameAnswer.create({
        attemptId: attempt._id,
        questionId: question._id,
        studentId: req.user.id,
        typedWord: String(word).trim(),
        slotIndex: pairIndex,
        responseTimeMs: responseTimeMs || 0,
        isCorrect: true,
        pointsEarned,
      });

      const totalPairs = await GameAnswer.countDocuments({
        attemptId: attempt._id, isCorrect: true,
      });
      const questionCount = attempt.totalQuestions || 1;

      await GameAttempt.findByIdAndUpdate(attempt._id, {
        $inc: { score: pointsEarned, correctAnswers: 1, wordsCompleted: 1 },
      });
      const xpAmount = scoringService.perAnswerXp('word_picture_match');
      await xpService.award(req.user.id, attempt._id, attempt.gameSetId, 'answer_correct', xpAmount);
    }

    res.json({
      success: true,
      isCorrect: true,
      pointsEarned,
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Memory game match (per-pair instant feedback) ────────────────────

exports.submitMemoryMatch = async (req, res) => {
  try {
    const attempt = await GameAttempt.findById(req.params.attemptId).lean();
    if (!attempt) return notFound(res, 'Attempt not found');
    if (!ownsAttempt(attempt, req)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (attempt.gameType !== 'memory') {
      return badRequest(res, 'Invalid game type for memory match');
    }

    const { questionId, pairIndex, word, responseTimeMs } = req.body;
    if (!questionId || pairIndex === undefined || pairIndex === null || !word) {
      return badRequest(res, 'questionId, pairIndex and word required');
    }

    const active = securityService.validateAttemptActive(attempt);
    if (!active.ok) {
      return res.status(400).json({ success: false, message: active.message });
    }

    const question = await GameQuestion.findOne({
      _id: questionId, gameSetId: attempt.gameSetId, isDeleted: { $ne: true },
    }).lean();
    if (!question) return notFound(res, 'Question not found');

    const result = memoryService.evaluateMatch(question, pairIndex, word);
    const staffPreview = isArenaStaff(req.user.role);

    if (!result.isCorrect) {
      return res.json({
        success: true,
        isCorrect: false,
        pointsEarned: 0,
      });
    }

    const pointsEarned = result.points;

    if (!staffPreview) {
      const existingAnswer = await GameAnswer.findOne({
        attemptId: attempt._id,
        questionId: question._id,
        slotIndex: pairIndex,
      }).lean();
      if (existingAnswer) {
        return res.json({
          success: true,
          isCorrect: true,
          alreadyMatched: true,
          pointsEarned: 0,
        });
      }

      await GameAnswer.create({
        attemptId: attempt._id,
        questionId: question._id,
        studentId: req.user.id,
        typedWord: String(word).trim(),
        slotIndex: pairIndex,
        responseTimeMs: responseTimeMs || 0,
        isCorrect: true,
        pointsEarned,
      });

      const totalPairs = question.pairs ? question.pairs.length : 0;
      const correctMatches = await GameAnswer.countDocuments({
        attemptId: attempt._id, isCorrect: true,
      });
      const questionComplete = correctMatches >= totalPairs;

      if (questionComplete) {
        await GameAttempt.findByIdAndUpdate(attempt._id, {
          $inc: { score: pointsEarned, correctAnswers: 1, wordsCompleted: 1 },
        });
        const xpAmount = scoringService.perAnswerXp('memory');
        await xpService.award(req.user.id, attempt._id, attempt.gameSetId, 'answer_correct', xpAmount);
      } else {
        await GameAttempt.findByIdAndUpdate(attempt._id, { $inc: { score: pointsEarned } });
      }

      return res.json({
        success: true,
        isCorrect: true,
        pointsEarned,
        questionComplete,
        correctMatches,
        totalPairs,
      });
    }

    res.json({
      success: true,
      isCorrect: true,
      pointsEarned,
      preview: true,
    });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Submit answer ────────────────────────────────────────────────────

exports.submitAnswer = async (req, res) => {
  try {
    const attempt = await GameAttempt.findById(req.params.attemptId).lean();
    if (!attempt) return notFound(res, 'Attempt not found');
    if (!ownsAttempt(attempt, req)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const staffPreview = isArenaStaff(req.user.role);
    const { questionId, typedWord, orderedTokens, articleGender, selectedIndex, responseTimeMs, questionElapsedMs } = req.body;
    if (!questionId) return badRequest(res, 'questionId required');

    const validation = await securityService.validateAnswerSubmission(attempt, questionId, responseTimeMs);
    if (!validation.ok) {
      if (validation.expired) {
        await GameAttempt.findByIdAndUpdate(attempt._id, { status: 'abandoned', completedAt: new Date() });
      }
      return res.status(validation.duplicate ? 409 : 400).json({ success: false, message: validation.message });
    }

    const question = await GameQuestion.findOne({ _id: questionId, gameSetId: attempt.gameSetId, isDeleted: { $ne: true } }).lean();
    if (!question) return notFound(res, 'Question not found');

    // Sentence builder: allow retries after a wrong full-sentence check
    if (attempt.gameType === 'sentence_builder') {
      await GameAnswer.deleteMany({
        attemptId: attempt._id,
        questionId: question._id,
        isCorrect: false,
      });
    }

    let isCorrect = false;
    let pointsEarned = 0;
    let speedBonus = 0;
    const correctAnswer = {};

    if (attempt.gameType === 'scramble_rush') {
      const result = scrambleRushService.evaluateAnswer(question, typedWord);
      isCorrect = result.isCorrect;
      pointsEarned = result.points;
      correctAnswer.word = question.word;
    } else if (attempt.gameType === 'sentence_builder') {
      const result = sentenceBuilderService.evaluateAnswer(question, orderedTokens);
      isCorrect = result.isCorrect;
      pointsEarned = result.points;
      correctAnswer.sentence = question.correctSentence;
      correctAnswer.tokens = question.tokens;
      if (isCorrect) {
        const set = await GameSet.findById(attempt.gameSetId).lean();
        const limitSec = set?.timerSettings?.perQuestionSeconds || 30;
        speedBonus = scoringService.sentenceSpeedBonus(questionElapsedMs || responseTimeMs || 0, limitSec);
        pointsEarned += speedBonus;
      }
    } else if (attempt.gameType === 'image_matching') {
      // Image matching uses submitImageMatchSlot for instant feedback; this is fallback
      const result = imageMatchingService.evaluateMatch(question, typedWord);
      isCorrect = result.isCorrect;
      pointsEarned = result.points;
      if (result.pairIndex >= 0 && question.pairs && question.pairs[result.pairIndex]) {
        correctAnswer.word = question.pairs[result.pairIndex].word;
      }
    } else if (attempt.gameType === 'jumbled_words') {
      // Student typed word formed by arranging jumbled letters
      const letters = Array.isArray(orderedTokens) ? orderedTokens.join('') : (typedWord || '');
      const result = jumbledWordsService.evaluateAnswer(question, letters);
      isCorrect = result.isCorrect;
      pointsEarned = result.points;
      correctAnswer.word = question.word;
    } else if (attempt.gameType === 'hangman') {
      const result = hangmanService.evaluateAnswer(question, typedWord);
      isCorrect = result.isCorrect;
      pointsEarned = result.points;
      correctAnswer.word = question.word;
    } else if (attempt.gameType === 'word_picture_match') {
      const result = wordPictureMatchService.evaluateMatch(question, typedWord);
      isCorrect = result.isCorrect;
      pointsEarned = result.points;
      if (result.pairIndex >= 0 && question.pairs && question.pairs[result.pairIndex]) {
        correctAnswer.word = question.pairs[result.pairIndex].word;
      }
    } else if (attempt.gameType === 'multiple_choice') {
      const result = multipleChoiceService.evaluateAnswer(question, selectedIndex);
      isCorrect = result.isCorrect;
      pointsEarned = result.points;
      correctAnswer.correctIndex = result.correctIndex;
      if (result.correctIndex >= 0 && question.options && question.options[result.correctIndex]) {
        correctAnswer.text = question.options[result.correctIndex].text;
      }
    } else if (attempt.gameType === 'gender_stack') {
      if (!articleGender) return badRequest(res, 'articleGender required');
      const result = genderStackService.evaluateAnswer(question, articleGender);
      isCorrect = result.isCorrect;
      pointsEarned = result.points;
      correctAnswer.articleGender = result.articleGender;
      correctAnswer.word = question.word;

      if (staffPreview) {
        return res.json({
          success: true,
          isCorrect,
          pointsEarned,
          speedBonus: 0,
          correctAnswer,
          preview: true,
        });
      }
    } else if (attempt.gameType === 'matching') {
      const selected = String(typedWord || '').trim().toLowerCase();
      const expected = String(question.hint || '').trim().toLowerCase();
      isCorrect = !!expected && selected === expected;
      pointsEarned = isCorrect ? scoringService.basePoints('matching') : 0;
      correctAnswer.hint = question.hint;
    } else if (attempt.gameType === 'flashcards') {
      const selected = String(typedWord || '').trim().toLowerCase();
      const expected = String(question.word || '').trim().toLowerCase();
      isCorrect = !!expected && selected === expected;
      pointsEarned = isCorrect ? scoringService.basePoints('flashcards') : 0;
      correctAnswer.word = question.word;
    }

    // Save answer record - update existing if wrong answer exists, else create new
    const answerData = {
      attemptId: attempt._id,
      questionId: question._id,
      studentId: req.user.id,
      typedWord: typedWord || '',
      orderedTokens: orderedTokens || [],
      articleGender: articleGender || '',
      responseTimeMs: responseTimeMs || 0,
      isCorrect,
      pointsEarned,
    };

    if (validation.existingAnswer) {
      await GameAnswer.findByIdAndUpdate(validation.existingAnswer._id, answerData);
    } else {
      await GameAnswer.create(answerData);
    }

    const attemptInc = {
      score: pointsEarned,
      correctAnswers: isCorrect ? 1 : 0,
    };
    if (isCorrect || (attempt.gameType !== 'sentence_builder' && attempt.gameType !== 'gender_stack')) {
      attemptInc.wordsCompleted = 1;
    }

    await GameAttempt.findByIdAndUpdate(attempt._id, { $inc: attemptInc });

    if (isCorrect && !isArenaStaff(req.user.role)) {
      const xpAmount = scoringService.perAnswerXp(attempt.gameType);
      await xpService.award(req.user.id, attempt._id, attempt.gameSetId, 'answer_correct', xpAmount);
    }

    res.json({ success: true, isCorrect, pointsEarned, speedBonus, correctAnswer });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Complete attempt ─────────────────────────────────────────────────

exports.completeAttempt = async (req, res) => {
  try {
    const attempt = await GameAttempt.findById(req.params.attemptId).lean();
    if (!attempt) return notFound(res, 'Attempt not found');
    if (!ownsAttempt(attempt, req)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    if (attempt.status !== 'in-progress') return badRequest(res, 'Attempt already finalized');

    const { timeSpentSeconds, livesRemaining, currentLevel } = req.body;

    const completedAt = new Date();
    const spent = parseInt(timeSpentSeconds, 10) || 0;

    // Calculate accuracy
    const accuracy = attempt.totalQuestions > 0
      ? Math.round((attempt.correctAnswers / attempt.totalQuestions) * 100)
      : 0;

    const set = await GameSet.findById(attempt.gameSetId).lean();
    const staffPreview = isArenaStaff(req.user.role);
    const xpBonus = staffPreview ? 0 : scoringService.completionXpBonus(set, accuracy);

    const updated = await GameAttempt.findByIdAndUpdate(attempt._id, {
      status: 'completed',
      completedAt,
      timeSpentSeconds: spent,
      livesRemaining: livesRemaining ?? attempt.livesRemaining,
      currentLevel: currentLevel ?? attempt.currentLevel,
      accuracy,
      xpEarned: staffPreview ? 0 : (attempt.xpEarned + xpBonus),
    }, { new: true });

    let newAchievements = [];
    if (!staffPreview) {
      // Award completion bonus XP
      if (xpBonus > 0) {
        await xpService.award(req.user.id, attempt._id, attempt.gameSetId, 'game_completed', xpBonus);
      }

      // Update student stats
      await xpService.updateStudentStats(req.user.id, updated, set);

      await dailyChallengesService.updateProgressFromAttempt(req.user.id, updated, updated.xpEarned);
      await questsService.updateFromAttempt(req.user.id, updated, updated.xpEarned);
      newAchievements = await achievementsService.checkAndUnlock(req.user.id, { attempt: updated });

      try {
        const antiCheatService = require('../services/interactiveGames/antiCheat');
        const adaptiveLearningService = require('../services/interactiveGames/adaptiveLearning');
        await antiCheatService.detectXpFraud(req.user.id);
        adaptiveLearningService.analyzeStudent(req.user.id).catch(() => {});
      } catch { /* non-blocking */ }

      await cacheService.del('ga:lb:*');
    }

    res.json({ success: true, attempt: updated, xpBonus, accuracy, newAchievements, preview: staffPreview });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Abandon attempt ──────────────────────────────────────────────────

exports.abandonAttempt = async (req, res) => {
  try {
    const attempt = await GameAttempt.findOneAndUpdate(
      { _id: req.params.attemptId, studentId: req.user.id, status: 'in-progress' },
      { status: 'abandoned', completedAt: new Date() },
      { new: true }
    );
    if (!attempt) return notFound(res, 'Active attempt not found');
    res.json({ success: true, attempt });
  } catch (err) {
    serverError(res, err);
  }
};

// ── STUDENT — Stats ────────────────────────────────────────────────────────────

exports.getMyStats = async (req, res) => {
  try {
    const stats = await StudentGameStats.findOne({ studentId: req.user.id }).lean();
    if (stats) {
      stats.accuracy = stats.totalAnswers
        ? Math.round((stats.totalCorrectAnswers / stats.totalAnswers) * 100)
        : 0;
    }
    res.json({ success: true, stats: stats || null });
  } catch (err) {
    serverError(res, err);
  }
};

// ── LEADERBOARD ────────────────────────────────────────────────────────────────

exports.getGlobalLeaderboard = async (req, res) => {
  try {
    const period = ['daily', 'weekly', 'all'].includes(req.query.period) ? req.query.period : 'all';
    const data = await leaderboardService.getGlobalLeaderboard(period, req.user.id);
    res.json({ success: true, ...data });
  } catch (err) {
    serverError(res, err);
  }
};

exports.getGameLeaderboard = async (req, res) => {
  try {
    const data = await leaderboardService.getPerGameLeaderboard(req.params.id, { limit: 20, studentId: req.user.id });
    res.json({ success: true, ...data });
  } catch (err) {
    serverError(res, err);
  }
};

// ── ADMIN — Game set CRUD ──────────────────────────────────────────────────────

exports.adminListSets = async (req, res) => {
  try {
    const page = clampPage(req.query.page);
    const limit = clampLimit(req.query.limit);
    const skip = (page - 1) * limit;

    const filter = { isDeleted: { $ne: true } };
    if (req.query.gameType && VALID_GAME_TYPES.includes(req.query.gameType)) filter.gameType = req.query.gameType;
    if (req.query.isPublished !== undefined) filter.isPublished = req.query.isPublished === 'true';
    if (req.query.search) filter.title = { $regex: req.query.search.trim(), $options: 'i' };

    const [sets, total] = await Promise.all([
      GameSet.find(filter).select('-__v').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      GameSet.countDocuments(filter),
    ]);

    const enriched = sets.map(s => ({
      ...s,
      targetBatches: s.targetBatchKeys || [],
      batchLabel: !(s.targetBatchKeys || []).length
        ? 'All batches'
        : (s.targetBatchKeys || []).join(', '),
    }));

    await resignMediaInObjects(enriched);

    res.json({
      success: true,
      sets: enriched,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminCreateSet = async (req, res) => {
  try {
    const { title, description, gameType, difficulty, level, category, tags, xpReward,
            timerSettings, genderStackSettings, visibleToStudents, courseDay, sequenceLetter, targetLanguage,
            icon, estimatedDurationMinutes, targetBatches } = req.body;

    if (!title || !title.trim()) return badRequest(res, 'title required');
    if (!VALID_GAME_TYPES.includes(gameType)) return badRequest(res, 'Invalid gameType');
    if (!VALID_DIFFICULTIES.includes(difficulty)) return badRequest(res, 'Invalid difficulty');

    const set = await GameSet.create({
      title: title.trim(),
      description: description || '',
      gameType,
      difficulty,
      level: VALID_LEVELS.includes(level) ? level : null,
      category: VALID_CATEGORIES.includes(category) ? category : 'Vocabulary',
      tags: Array.isArray(tags) ? tags.map(t => String(t).trim()).filter(Boolean) : [],
      xpReward: Math.max(0, parseInt(xpReward, 10) || 50),
      timerSettings: timerSettings || {},
      genderStackSettings: normalizeGenderStackSettings(genderStackSettings),
      visibleToStudents: !!visibleToStudents,
      courseDay: courseDay ? Number(courseDay) : null,
      sequenceLetter: sequenceLetter || null,
      targetLanguage: ['English', 'German'].includes(targetLanguage) ? targetLanguage : 'German',
      icon: icon || 'sports_esports',
      estimatedDurationMinutes: parseInt(estimatedDurationMinutes, 10) || 10,
      targetBatchKeys: normalizeBatchKeys(targetBatches),
      createdBy: req.user.id,
      updatedBy: req.user.id,
    });

    const plain = set.toObject();
    plain.targetBatches = plain.targetBatchKeys || [];
    res.status(201).json({ success: true, set: plain });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminGetSet = async (req, res) => {
  try {
    const set = await GameSet.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!set) return notFound(res);

    const [questions, levels] = await Promise.all([
      GameQuestion.find({ gameSetId: set._id, isDeleted: { $ne: true } }).sort({ order: 1 }).lean(),
      GameLevel.find({ gameSetId: set._id }).sort({ levelNumber: 1 }).lean(),
    ]);

    set.targetBatches = set.targetBatchKeys || [];
    await resignMediaInObject(set);

    res.json({ success: true, set, questions, levels });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminUpdateSet = async (req, res) => {
  try {
    const allowedFields = ['title', 'description', 'difficulty', 'level', 'category', 'tags',
      'xpReward', 'timerSettings', 'genderStackSettings', 'visibleToStudents', 'courseDay', 'sequenceLetter',
      'targetLanguage', 'icon', 'estimatedDurationMinutes', 'isPublished', 'isArchived'];

    const updates = {};
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) {
        updates[f] = f === 'genderStackSettings'
          ? normalizeGenderStackSettings(req.body[f])
          : req.body[f];
      }
    }
    if (req.body.targetBatches !== undefined) {
      updates.targetBatchKeys = normalizeBatchKeys(req.body.targetBatches);
    }
    updates.updatedBy = req.user.id;

    if (updates.difficulty && !VALID_DIFFICULTIES.includes(updates.difficulty)) return badRequest(res, 'Invalid difficulty');
    if (updates.level && !VALID_LEVELS.includes(updates.level)) return badRequest(res, 'Invalid level');

    const set = await GameSet.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: updates },
      { new: true }
    );
    if (!set) return notFound(res);

    const plain = set.toObject();
    plain.targetBatches = plain.targetBatchKeys || [];
    res.json({ success: true, set: plain });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminDeleteSet = async (req, res) => {
  try {
    const set = await GameSet.findOneAndUpdate(
      { _id: req.params.id, isDeleted: { $ne: true } },
      { $set: { isDeleted: true, isPublished: false, updatedBy: req.user.id } },
      { new: true }
    );
    if (!set) return notFound(res);
    res.json({ success: true, message: 'Game set deleted' });
  } catch (err) {
    serverError(res, err);
  }
};

// ── ADMIN — Thumbnail ──────────────────────────────────────────────────────────

exports.adminUploadThumbnail = async (req, res) => {
  try {
    const canonicalUrl = await uploadThumbnail(req, res);
    if (!canonicalUrl) return;  // uploadThumbnail sends response on error

    const set = await GameSet.findByIdAndUpdate(
      req.params.id,
      { thumbnailUrl: canonicalUrl, updatedBy: req.user.id },
      { new: true }
    );
    if (!set) return notFound(res);

    const thumbnailUrl = await presignMediaUrl(canonicalUrl);
    res.json({ success: true, thumbnailUrl, canonicalUrl });
  } catch (err) {
    serverError(res, err);
  }
};

// ── ADMIN — Questions ──────────────────────────────────────────────────────────

exports.adminGetQuestions = async (req, res) => {
  try {
    const questions = await GameQuestion.find({ gameSetId: req.params.id, isDeleted: { $ne: true } })
      .sort({ order: 1 }).lean();
    await resignMediaInObject(questions);
    res.json({ success: true, questions });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminUpsertQuestions = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
      return badRequest(res, 'Save the game set in Game Details first, then add questions.');
    }
    const set = await GameSet.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!set) return notFound(res);

    const { questions } = req.body;
    if (!Array.isArray(questions) || questions.length === 0) return badRequest(res, 'questions array required');

    if (set.gameType === 'gender_stack') {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!trimGermanWord(q.word)) return badRequest(res, `Question ${i + 1}: German noun required`);
        if (!genderStackService.normalizeGender(q.articleGender)) {
          return badRequest(res, `Question ${i + 1}: articleGender must be der, die, or das`);
        }
      }
    }

    if (set.gameType === 'flapjugation') {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!trimGermanWord(q.word)) return badRequest(res, `Question ${i + 1}: infinitive required`);
        if (!Array.isArray(q.tokens) || q.tokens.length < 6 || q.tokens.some(t => !String(t).trim())) {
          return badRequest(res, `Question ${i + 1}: all 6 conjugated forms are required`);
        }
      }
    }

    if (set.gameType === 'whackawort') {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!trimGermanWord(q.word)) return badRequest(res, `Question ${i + 1}: German word required`);
        if (!String(q.translation || '').trim()) return badRequest(res, `Question ${i + 1}: English translation required`);
        if (!String(q.category || '').trim()) return badRequest(res, `Question ${i + 1}: category required`);
      }
    }

    if (set.gameType === 'jumbled_words') {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!trimGermanWord(q.word)) return badRequest(res, `Question ${i + 1}: German word required`);
        if (!String(q.hint || '').trim() && !String(q.imageUrl || '').trim()) {
          return badRequest(res, `Question ${i + 1}: hint or imageUrl required`);
        }
      }
    }

    if (set.gameType === 'hangman') {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!trimGermanWord(q.word)) return badRequest(res, `Question ${i + 1}: German word required`);
        if (!String(q.hint || '').trim()) return badRequest(res, `Question ${i + 1}: hint required`);
      }
    }

    if (set.gameType === 'memory') {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!Array.isArray(q.pairs) || q.pairs.length === 0) {
          return badRequest(res, `Question ${i + 1}: at least one pair required`);
        }
        if (q.pairs.length > 8) {
          return badRequest(res, `Question ${i + 1}: maximum 8 pairs per board (4x4)`);
        }
        for (let j = 0; j < q.pairs.length; j++) {
          const p = q.pairs[j];
          if (!trimGermanWord(p.word)) return badRequest(res, `Question ${i + 1}, pair ${j + 1}: German word required`);
        }
      }
    }

    if (set.gameType === 'word_picture_match') {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!Array.isArray(q.pairs) || q.pairs.length === 0) {
          return badRequest(res, `Question ${i + 1}: at least one pair required`);
        }
        if (q.pairs.length > 6) {
          return badRequest(res, `Question ${i + 1}: maximum 6 pairs per board`);
        }
        for (let j = 0; j < q.pairs.length; j++) {
          const p = q.pairs[j];
          if (!trimGermanWord(p.word)) return badRequest(res, `Question ${i + 1}, pair ${j + 1}: German word required`);
        }
      }
    }

    if (set.gameType === 'multiple_choice') {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        if (!String(q.questionText || '').trim()) return badRequest(res, `Question ${i + 1}: question text required`);
        if (!Array.isArray(q.options) || q.options.length < 2) {
          return badRequest(res, `Question ${i + 1}: at least 2 options required`);
        }
        if (q.options.length > 6) {
          return badRequest(res, `Question ${i + 1}: maximum 6 options allowed`);
        }
        const correctCount = q.options.filter(o => o.isCorrect).length;
        if (correctCount !== 1) {
          return badRequest(res, `Question ${i + 1}: exactly one option must be marked as correct`);
        }
        for (let j = 0; j < q.options.length; j++) {
          if (!String(q.options[j].text || '').trim()) {
            return badRequest(res, `Question ${i + 1}, option ${j + 1}: text required`);
          }
        }
      }
    }

    const ops = questions.map((q, i) => {
      const doc = {
        gameSetId: set._id,
        gameType: set.gameType,
        order: q.order ?? i,
        isPlaceholder: false,
      };

      if (set.gameType === 'sentence_builder') {
        doc.correctSentence = String(q.correctSentence || '').trim();
        doc.translation = q.translation || '';
        doc.sentenceAudioUrl = q.sentenceAudioUrl || null;
        doc.randomizeWords = q.randomizeWords !== false;
        doc.tokens = doc.correctSentence.trim().split(/\s+/).filter(Boolean);
      } else if (set.gameType === 'image_matching') {
        // Store pairs array instead of single word/hint
        doc.pairs = (q.pairs || []).map(p => ({
          word: trimGermanWord(p.word),
          hint: p.hint || '',
          imageUrl: p.imageUrl || null,
          audioUrl: p.audioUrl || null,
        }));
      } else if (set.gameType === 'memory') {
        doc.pairs = (q.pairs || []).map(p => ({
          word: trimGermanWord(p.word),
          imageUrl: p.imageUrl || null,
        }));
      } else if (set.gameType === 'gender_stack') {
        doc.word = trimGermanWord(q.word);
        doc.translation = String(q.translation || q.hint || '').trim();
        doc.articleGender = genderStackService.normalizeGender(q.articleGender);
        doc.audioUrl = q.audioUrl || null;
      } else if (set.gameType === 'flapjugation') {
        doc.word = trimGermanWord(q.word);
        doc.translation = String(q.translation || '').trim();
        doc.tokens = Array.isArray(q.tokens) ? q.tokens.map(t => String(t).trim()).filter(Boolean) : [];
      } else if (set.gameType === 'whackawort') {
        doc.word = trimGermanWord(q.word);
        doc.translation = String(q.translation || '').trim();
        doc.category = String(q.category || '').trim();
      } else if (set.gameType === 'jumbled_words') {
        doc.word = germanUppercase(q.word);
        doc.hint = q.hint || '';
        doc.imageUrl = q.imageUrl || null;
        doc.audioUrl = q.audioUrl || null;
      } else if (set.gameType === 'hangman') {
        doc.word = germanUppercase(q.word);
        doc.hint = q.hint || '';
        doc.imageUrl = q.imageUrl || null;
        doc.audioUrl = q.audioUrl || null;
      } else if (set.gameType === 'word_picture_match') {
        doc.pairs = (q.pairs || []).map(p => ({
          word: trimGermanWord(p.word),
          hint: p.hint || '',
          imageUrl: p.imageUrl || null,
          audioUrl: p.audioUrl || null,
        }));
      } else if (set.gameType === 'multiple_choice') {
        doc.questionText = String(q.questionText || '').trim();
        doc.imageUrl = q.imageUrl || null;
        doc.audioUrl = q.audioUrl || null;
        doc.options = (q.options || []).map(o => ({
          text: String(o.text || '').trim(),
          isCorrect: !!o.isCorrect,
        }));
      } else {
        // scramble_rush, matching, flashcards all use word/hint
        doc.hint = q.hint || '';
        doc.imageUrl = q.imageUrl || null;
        doc.audioUrl = q.audioUrl || null;

        if (set.gameType === 'scramble_rush') {
          doc.word = germanUppercase(q.word);
        } else {
          doc.word = trimGermanWord(q.word);
        }

        if (set.gameType === 'scramble_rush') {
          doc.difficultyLevel = Math.min(5, Math.max(1, parseInt(q.difficultyLevel, 10) || 1));
          doc.fallDurationSeconds = Math.min(30, Math.max(2, parseInt(q.fallDurationSeconds, 10) || 5));
        }
      }

      if (q._id) {
        return {
          updateOne: {
            filter: { _id: q._id, gameSetId: set._id },
            update: { $set: doc },
            upsert: false,
          },
        };
      }
      return { insertOne: { document: doc } };
    });

    const result = await GameQuestion.bulkWrite(ops);

    // Soft-delete questions the client removed from the array
    const incomingIds = questions.filter(q => q._id).map(q => String(q._id));
    const inserted = result.insertedIds;
    const newIds = inserted instanceof Map
      ? [...inserted.values()].map((id) => String(id))
      : Object.values(inserted || {}).map((id) => String(id));
    const keepIds = [...incomingIds, ...newIds].filter(Boolean);
    if (keepIds.length > 0) {
      const keepObjectIds = keepIds.map(id => new mongoose.Types.ObjectId(id));
      await GameQuestion.updateMany(
        { gameSetId: set._id, _id: { $nin: keepObjectIds }, isDeleted: { $ne: true } },
        { $set: { isDeleted: true } }
      );
    }

    const count = await GameQuestion.countDocuments({ gameSetId: set._id, isDeleted: { $ne: true } });
    await GameSet.findByIdAndUpdate(set._id, { questionCount: count, updatedBy: req.user.id });

    const updated = await GameQuestion.find({ gameSetId: set._id, isDeleted: { $ne: true } })
      .sort({ order: 1 }).lean();

    await resignMediaInObject(updated);

    res.json({ success: true, questions: updated });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminUpdateQuestion = async (req, res) => {
  try {
    const q = await GameQuestion.findById(req.params.qid).lean();
    if (!q || q.isDeleted) return notFound(res);

    const allowed = ['order', 'hint', 'imageUrl', 'audioUrl', 'difficultyLevel', 'fallDurationSeconds',
      'word', 'correctSentence', 'translation', 'sentenceAudioUrl', 'randomizeWords'];
    const updates = {};
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    if (updates.word) {
      const qDoc = await GameQuestion.findById(req.params.qid).select('gameType').lean();
      updates.word = qDoc?.gameType === 'scramble_rush'
        ? germanUppercase(updates.word)
        : trimGermanWord(updates.word);
    }
    if (updates.correctSentence) {
      updates.correctSentence = String(updates.correctSentence).trim();
      updates.tokens = updates.correctSentence.split(/\s+/).filter(Boolean);
    }

    const updated = await GameQuestion.findByIdAndUpdate(req.params.qid, { $set: updates }, { new: true });
    res.json({ success: true, question: updated });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminDeleteQuestion = async (req, res) => {
  try {
    const q = await GameQuestion.findByIdAndUpdate(
      req.params.qid,
      { $set: { isDeleted: true } },
      { new: true }
    );
    if (!q) return notFound(res);

    // Recount
    const count = await GameQuestion.countDocuments({ gameSetId: q.gameSetId, isDeleted: { $ne: true } });
    await GameSet.findByIdAndUpdate(q.gameSetId, { questionCount: count });

    res.json({ success: true, message: 'Question deleted' });
  } catch (err) {
    serverError(res, err);
  }
};

// ── ADMIN — Levels ─────────────────────────────────────────────────────────────

exports.adminGetLevels = async (req, res) => {
  try {
    const levels = await GameLevel.find({ gameSetId: req.params.id }).sort({ levelNumber: 1 }).lean();
    res.json({ success: true, levels });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminUpsertLevels = async (req, res) => {
  try {
    const set = await GameSet.findOne({ _id: req.params.id, isDeleted: { $ne: true } }).lean();
    if (!set) return notFound(res);
    if (set.gameType !== 'scramble_rush') return badRequest(res, 'Levels only apply to scramble_rush sets');

    // Replace all levels for this set
    await GameLevel.deleteMany({ gameSetId: set._id });
    const docs = levels.map((l, i) => ({
      gameSetId: set._id,
      levelNumber: l.levelNumber ?? (i + 1),
      lives: Math.min(10, Math.max(1, parseInt(l.lives, 10) || 3)),
      timeLimitSeconds: Math.min(600, Math.max(10, parseInt(l.timeLimitSeconds, 10) || 60)),
      fallSpeedMs: (() => {
        const fromSec = parseInt(l.wordAttemptSeconds, 10);
        if (!Number.isNaN(fromSec) && fromSec > 0) {
          return Math.min(30000, Math.max(1000, fromSec * 1000));
        }
        return Math.min(30000, Math.max(1000, parseInt(l.fallSpeedMs, 10) || 8000));
      })(),
      spawnIntervalMs: Math.min(10000, Math.max(500, parseInt(l.spawnIntervalMs, 10) || 3000)),
      wordsRequired: Math.max(1, parseInt(l.wordsRequired, 10) || 5),
      scoreMultiplier: Math.min(10, Math.max(0.5, parseFloat(l.scoreMultiplier) || 1.0)),
    }));

    const created = await GameLevel.insertMany(docs);
    res.json({ success: true, levels: created });
  } catch (err) {
    serverError(res, err);
  }
};

// ── ANALYTICS (Admin) ───────────────────────────────────────────────────────────

exports.adminAnalytics = async (req, res) => {
  try {
    const data = await analyticsService.getAdminDashboard(req.query);
    res.json({ success: true, ...data });
  } catch (err) {
    serverError(res, err);
  }
};

exports.teacherAnalytics = async (req, res) => {
  try {
    const data = await teacherAnalyticsService.getTeacherDashboard(req.query);
    res.json({ success: true, ...data });
  } catch (err) {
    serverError(res, err);
  }
};

// ── DAILY CHALLENGES ────────────────────────────────────────────────────────────

exports.getDailyChallenges = async (req, res) => {
  try {
    const data = await dailyChallengesService.getOrCreateStudentChallenges(req.user.id);
    res.json({ success: true, ...data });
  } catch (err) {
    serverError(res, err);
  }
};

exports.claimDailyChallenge = async (req, res) => {
  try {
    const result = await dailyChallengesService.claimChallenge(req.user.id, req.params.progressId);
    if (!result.ok) return badRequest(res, result.message);
    res.json({ success: true, xpReward: result.xpReward });
  } catch (err) {
    serverError(res, err);
  }
};

// ── ACHIEVEMENTS ────────────────────────────────────────────────────────────────

exports.getAchievements = async (req, res) => {
  try {
    const achievements = await achievementsService.getStudentAchievements(req.user.id);
    res.json({ success: true, achievements });
  } catch (err) {
    serverError(res, err);
  }
};

// ── IMPORT ────────────────────────────────────────────────────────────────────────

exports.adminImportPreview = async (req, res) => {
  try {
    const { rows, importType, gameType } = req.body;
    if (!Array.isArray(rows)) return badRequest(res, 'rows array required');
    const result = await importService.previewImport(req.params.id, rows, importType, gameType);
    res.json({ success: true, ...result });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminImportCommit = async (req, res) => {
  try {
    const { rows, importType, gameType } = req.body;
    if (!Array.isArray(rows)) return badRequest(res, 'rows array required');
    const result = await importService.commitImport(req.params.id, rows, importType, gameType);
    if (!result.ok) return res.status(400).json(result);
    res.json({ success: true, ...result });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminImportTemplate = async (req, res) => {
  try {
    const set = await GameSet.findById(req.params.id).lean();
    if (!set) return notFound(res);
    const gType = req.query.gameType || set.gameType;
    const template = importService.getImportTemplate(gType);
    res.json({ success: true, template, gameType: gType });
  } catch (err) {
    serverError(res, err);
  }
};

// ── AUDIO UPLOAD ────────────────────────────────────────────────────────────────

exports.adminUploadQuestionAudio = async (req, res) => {
  try {
    const canonicalUrl = await uploadQuestionAudio(req, res);
    if (!canonicalUrl) return;

    const field = req.body.field === 'sentence' ? 'sentenceAudioUrl' : 'audioUrl';
    const question = await GameQuestion.findByIdAndUpdate(
      req.params.qid,
      { [field]: canonicalUrl },
      { new: true }
    );
    if (!question) return notFound(res, 'Question not found');
    const url = await presignMediaUrl(canonicalUrl);
    res.json({ success: true, url, canonicalUrl, question });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminUploadQuestionImage = async (req, res) => {
  try {
    const canonicalUrl = await uploadQuestionImage(req, res);
    if (!canonicalUrl) return;

    const question = await GameQuestion.findByIdAndUpdate(
      req.params.qid,
      { imageUrl: canonicalUrl },
      { new: true }
    );
    if (!question) return notFound(res, 'Question not found');
    const url = await presignMediaUrl(canonicalUrl);
    res.json({ success: true, url, canonicalUrl, question });
  } catch (err) {
    serverError(res, err);
  }
};

exports.adminUploadPairImage = async (req, res) => {
  try {
    const canonicalUrl = await uploadPairImage(req, res);
    if (!canonicalUrl) return;

    const pairIndex = parseInt(req.params.pairIndex, 10);
    if (isNaN(pairIndex) || pairIndex < 0) {
      return badRequest(res, 'Invalid pair index');
    }

    let question = await GameQuestion.findById(req.params.qid);
    if (!question || question.isDeleted) return notFound(res, 'Question not found');

    // Legacy rows stored word/image on the question root with an empty pairs[].
    if ((!question.pairs || question.pairs.length === 0) && pairIndex === 0) {
      question.pairs = [{
        word: question.word || '',
        hint: question.hint || '',
        imageUrl: question.imageUrl || null,
        audioUrl: question.audioUrl || null,
      }];
      await question.save();
    }

    if (!question.pairs || pairIndex >= question.pairs.length) {
      return badRequest(res, `Pair index out of range (question has ${question.pairs?.length || 0} pair(s); save questions first)`);
    }

    question.pairs[pairIndex].imageUrl = canonicalUrl;
    await question.save();

    const url = await presignMediaUrl(canonicalUrl);
    res.json({ success: true, url, canonicalUrl, pairIndex });
  } catch (err) {
    serverError(res, err);
  }
};
