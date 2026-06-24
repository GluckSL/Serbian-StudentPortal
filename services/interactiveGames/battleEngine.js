// services/interactiveGames/battleEngine.js
// Authoritative realtime battle state — synchronized rounds, server validation

const ArenaRoom = require('../../models/ArenaRoom');
const GameQuestion = require('../../models/GameQuestion');
const config = require('../../config/glueckArena');
const { attachScrambled, evaluateAnswer: evalScramble } = require('./scrambleRush');
const { getShuffledTokens, evaluateAnswer: evalSentence } = require('./sentenceBuilder');
const { basePoints } = require('./scoring');
const antiCheat = require('./antiCheat');
const auditLog = require('./auditLog');
const replayService = require('./replays');

const FAST_ANSWER_BONUS = 5;
const COMBO_STREAK_BONUS = 3;
const COMBO_THRESHOLD = 3;

/** @type {Map<string, NodeJS.Timeout>} */
const roundTimers = new Map();
/** @type {Map<string, { emit: Function }>} */
const roomEmitters = new Map();

const battleMetrics = {
  battlesStarted: 0,
  roundsCompleted: 0,
  answersValidated: 0,
  cheatBlocked: 0,
};

function roundDurationMs() {
  return config.multiplayer?.answerWindowMs || 15_000;
}

function sanitizeQuestionForClient(q, gameType, index) {
  if (gameType === 'scramble_rush') {
    const scrambled = attachScrambled([q])[0];
    return {
      questionId: String(q._id),
      index,
      scrambledLetters: scrambled.scrambledLetters,
      hint: q.hint || '',
      audioUrl: q.audioUrl || null,
      imageUrl: q.imageUrl || null,
      letterCount: scrambled.letterCount,
    };
  }
  if (gameType === 'sentence_builder') {
    return {
      questionId: String(q._id),
      index,
      shuffledTokens: getShuffledTokens(q),
      translation: q.translation || '',
      sentenceAudioUrl: q.sentenceAudioUrl || null,
    };
  }
  if (gameType === 'image_matching') {
    const base = { questionId: String(q._id), index, word: q.word || '' };
    if (q.imageUrl) {
      return { ...base, imageUrl: q.imageUrl, options: getShuffledOptions(q) };
    }
    if (q.pairs?.length) {
      const pair = q.pairs[0];
      return { ...base, imageUrl: pair.imageUrl || null, options: getShuffledOptions(q) };
    }
    return { ...base, options: [q.word, '…'] };
  }
  if (gameType === 'gender_stack') {
    return {
      questionId: String(q._id),
      index,
      word: q.word || '',
      translation: q.translation || '',
    };
  }
  if (gameType === 'flashcards') {
    return {
      questionId: String(q._id),
      index,
      prompt: q.hint || q.word || 'Translate this word',
      hint: q.translation || '',
    };
  }
  if (gameType === 'matching') {
    const tokens = (q.tokens?.length ? q.tokens : (q.word || '').split(',').filter(Boolean));
    const translation = q.translation || '';
    const pairs = tokens.map((t, i) => ({
      id: String(i),
      left: t.trim(),
      right: translation ? (translation.split(',').filter(Boolean)[i] || translation) : '…',
    }));
    const allRight = pairs.map(p => p.right);
    const shuffledRight = [...allRight].sort(() => Math.random() - 0.5);
    return {
      questionId: String(q._id),
      index,
      pairs,
      shuffledLeft: tokens.map(t => t.trim()),
      shuffledRight,
    };
  }
  if (gameType === 'flapjugation') {
    return {
      questionId: String(q._id),
      index,
      infinitive: q.word || '',
      forms: q.tokens || [],
      translation: q.translation || '',
    };
  }
  if (gameType === 'whackawort') {
    return {
      questionId: String(q._id),
      index,
      targetCategory: q.category || '',
      words: [
        { word: q.word || '', translation: q.translation || '', category: q.category || '' },
      ],
      duration: 60,
    };
  }
  return { questionId: String(q._id), index };
}

function getShuffledOptions(q) {
  const correct = q.word || (q.pairs?.[0]?.word) || '';
  const distractors = q.distractors || [];
  // If no distractors, generate some
  if (!distractors.length) {
    return [correct].sort(() => Math.random() - 0.5);
  }
  return [correct, ...distractors].sort(() => Math.random() - 0.5);
}

function sanitizeBattlePublic(battle) {
  if (!battle) return null;
  return {
    totalRounds: battle.totalRounds,
    currentRound: battle.currentRound,
    roundDurationMs: battle.roundDurationMs,
    roundStartedAt: battle.roundStartedAt,
    roundEndsAt: battle.roundEndsAt,
    serverTime: Date.now(),
  };
}

function getRoundPayload(room) {
  const b = room.battle;
  if (!b || b.currentRound >= b.totalRounds) return null;
  const question = b.questions[b.currentRound];
  return {
    roundIndex: b.currentRound,
    totalRounds: b.totalRounds,
    question,
    roundStartedAt: b.roundStartedAt,
    roundEndsAt: b.roundEndsAt,
    serverTime: Date.now(),
    roundDurationMs: b.roundDurationMs,
  };
}

function registerRoomEmitter(roomId, emitFn) {
  roomEmitters.set(String(roomId), { emit: emitFn });
}

function unregisterRoomEmitter(roomId) {
  roomEmitters.delete(String(roomId));
  clearRoundTimer(roomId);
}

function clearRoundTimer(roomId) {
  const key = String(roomId);
  const t = roundTimers.get(key);
  if (t) clearTimeout(t);
  roundTimers.delete(key);
}

function emitToRoom(roomId, event, payload) {
  const reg = roomEmitters.get(String(roomId));
  if (reg?.emit) reg.emit(event, payload);
}

async function initBattle(roomId, sanitizeRoomFn, buildLeaderboardFn) {
  const room = await ArenaRoom.findById(roomId);
  if (!room) return { ok: false, message: 'Room not found' };

  const questions = await GameQuestion.find({
    gameSetId: room.gameSetId,
    gameType: room.gameType,
    isDeleted: false,
  })
    .sort({ order: 1 })
    .lean();

  if (!questions.length) {
    return { ok: false, message: 'No questions in game set' };
  }

  const sanitized = questions.map((q, idx) =>
    sanitizeQuestionForClient(q, room.gameType, idx)
  );

  // For whackawort, enrich each round with distractors from other questions
  if (room.gameType === 'whackawort') {
    const allWords = questions.map(q => ({
      word: q.word || '',
      translation: q.translation || '',
      category: q.category || '',
    }));
    for (let i = 0; i < sanitized.length; i++) {
      const sq = sanitized[i];
      const correctWord = { word: sq.words[0].word, translation: sq.words[0].translation, category: sq.words[0].category };
      const distractors = allWords
        .filter(w => w.category !== correctWord.category)
        .sort(() => Math.random() - 0.5)
        .slice(0, 8);
      const grid = [correctWord, ...distractors].sort(() => Math.random() - 0.5);
      sq.words = grid;
    }
  }

  const duration = roundDurationMs();
  room.battle = {
    totalRounds: sanitized.length,
    roundDurationMs: duration,
    questions: sanitized,
    currentRound: 0,
    roundStartedAt: null,
    roundEndsAt: null,
    roundAnsweredBy: [],
    roundResults: [],
    comboStreaks: {},
    questionDocs: questions.map(q => ({
      questionId: String(q._id),
      word: q.word,
      correctSentence: q.correctSentence,
      tokens: q.tokens,
      articleGender: q.articleGender || null,
      pairs: q.pairs || [],
      imageUrl: q.imageUrl || null,
      translation: q.translation || '',
      category: q.category || null,
    })),
    snapshotVersion: 1,
  };
  room.currentQuestionIndex = 0;
  room.markModified('battle');
  await room.save();

  battleMetrics.battlesStarted += 1;
  replayService.startRecording(roomId, {
    inviteCode: room.inviteCode,
    gameType: room.gameType,
    gameSetId: room.gameSetId,
    tournamentId: room.tournamentId,
  });
  replayService.recordEvent(roomId, 'battle_start', { totalRounds: sanitized.length });
  return { ok: true, room: sanitizeRoomFn(room), battle: sanitizeBattlePublic(room.battle) };
}

async function startBattleLoop(roomId, sanitizeRoomFn, buildLeaderboardFn) {
  await startRound(roomId, sanitizeRoomFn, buildLeaderboardFn);
}

async function startRound(roomId, sanitizeRoomFn, buildLeaderboardFn) {
  clearRoundTimer(roomId);
  const room = await ArenaRoom.findById(roomId);
  if (!room?.battle) return null;

  const b = room.battle;
  if (b.currentRound >= b.totalRounds) {
    return finishBattle(roomId, sanitizeRoomFn, buildLeaderboardFn);
  }

  const now = Date.now();
  b.roundStartedAt = new Date(now);
  b.roundEndsAt = new Date(now + b.roundDurationMs);
  b.roundAnsweredBy = [];
  b.roundResults = [];
  b.snapshotVersion = (b.snapshotVersion || 0) + 1;
  room.currentQuestionIndex = b.currentRound;
  room.markModified('battle');
  await room.save();

  const round = getRoundPayload(room);
  const sanitized = sanitizeRoomFn(room);

  replayService.recordEvent(roomId, 'round_start', { roundIndex: b.currentRound });
  emitToRoom(roomId, 'arena:battle_round', { round, room: sanitized });
  emitToRoom(roomId, 'arena:leaderboard', { players: buildLeaderboardFn(room) });

  const timer = setTimeout(() => {
    endRound(roomId, sanitizeRoomFn, buildLeaderboardFn).catch(err => {
      console.error('[battleEngine] endRound error', err);
    });
  }, b.roundDurationMs);
  roundTimers.set(String(roomId), timer);

  return { round, room: sanitized };
}

async function endRound(roomId, sanitizeRoomFn, buildLeaderboardFn) {
  clearRoundTimer(roomId);
  const room = await ArenaRoom.findById(roomId);
  if (!room?.battle) return null;

  battleMetrics.roundsCompleted += 1;
  room.battle.currentRound += 1;
  room.markModified('battle');
  await room.save();

  emitToRoom(roomId, 'arena:battle_round_end', {
    roundIndex: room.battle.currentRound - 1,
    results: room.battle.roundResults || [],
    room: sanitizeRoomFn(room),
  });

  if (room.battle.currentRound >= room.battle.totalRounds) {
    return finishBattle(roomId, sanitizeRoomFn, buildLeaderboardFn);
  }

  return startRound(roomId, sanitizeRoomFn, buildLeaderboardFn);
}

async function submitBattleAnswer(roomId, studentId, payload, buildLeaderboardFn, sanitizeRoomFn) {
  const cheat = antiCheat.validateBattleAnswer(studentId, payload);
  if (!cheat.ok) {
    battleMetrics.cheatBlocked += 1;
    await auditLog.log({
      actorId: studentId,
      action: 'multiplayer_cheat_blocked',
      resourceId: roomId,
      metadata: { reason: cheat.message, source: 'battle' },
      severity: 'warn',
    });
    return { ok: false, message: cheat.message };
  }

  const room = await ArenaRoom.findById(roomId);
  if (!room || room.status !== 'playing' || !room.battle) {
    return { ok: false, message: 'Battle not active' };
  }

  const b = room.battle;
  const roundIndex = parseInt(payload.roundIndex, 10);
  if (roundIndex !== b.currentRound) {
    return { ok: false, message: 'Stale round' };
  }

  if (b.roundAnsweredBy.some(id => String(id) === String(studentId))) {
    return { ok: false, message: 'Already answered this round' };
  }

  if (Date.now() > new Date(b.roundEndsAt).getTime() + 500) {
    return { ok: false, message: 'Round ended' };
  }

  const question = b.questions[roundIndex];
  if (!question) return { ok: false, message: 'Invalid question' };

  const qDoc = b.questionDocs?.find(d => d.questionId === question.questionId);
  if (!qDoc) return { ok: false, message: 'Question data missing' };

  const roundStart = new Date(b.roundStartedAt).getTime();
  const responseTimeMs = Math.max(0, Date.now() - roundStart);

  let evalResult;
  let revealCorrect = null;

  if (room.gameType === 'scramble_rush') {
    evalResult = evalScramble(
      { word: qDoc.word },
      payload.typedWord || ''
    );
    if (!evalResult.isCorrect) {
      revealCorrect = { word: qDoc.word };
    }
  } else if (room.gameType === 'sentence_builder') {
    evalResult = evalSentence(
      { correctSentence: qDoc.correctSentence, tokens: qDoc.tokens },
      payload.orderedTokens || []
    );
    if (!evalResult.isCorrect) {
      revealCorrect = { sentence: qDoc.correctSentence };
    }
  } else if (room.gameType === 'image_matching') {
    const correctWord = qDoc.word || (qDoc.pairs?.[0]?.word) || '';
    const isCorrect = (payload.typedWord || '').toLowerCase().trim() === correctWord.toLowerCase().trim();
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: correctWord };
  } else if (room.gameType === 'gender_stack') {
    const correctGender = (qDoc.articleGender || '').toLowerCase();
    const isCorrect = (payload.typedWord || '').toLowerCase().trim() === correctGender;
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: correctGender + ' ' + (qDoc.word || '') };
  } else if (room.gameType === 'flashcards') {
    const correctWord = (qDoc.word || '').toLowerCase().trim();
    const userWord = (payload.typedWord || '').toLowerCase().trim();
    const isCorrect = userWord === correctWord || userWord.includes(correctWord) || correctWord.includes(userWord);
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: qDoc.word || '' };
  } else if (room.gameType === 'matching') {
    const ordered = payload.orderedTokens || [];
    const pairs = qDoc.pairs || [];
    const tokens = qDoc.tokens || [];
    let correctCount = 0;
    for (let i = 0; i < ordered.length && i < tokens.length; i++) {
      if ((ordered[i] || '').toLowerCase().trim() === (tokens[i] || '').toLowerCase().trim()) {
        correctCount++;
      }
    }
    const isCorrect = correctCount === tokens.length;
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : Math.max(0, correctCount * 2) };
    if (!isCorrect) revealCorrect = { sentence: tokens.join(' | ') };
  } else if (room.gameType === 'flapjugation') {
    const pronounIndex = { ich: 0, du: 1, er: 2, sie: 2, es: 2, wir: 3, ihr: 4, Sie: 5 }[payload.pronoun || ''];
    const correctForm = (qDoc.tokens || [])[pronounIndex];
    const userForm = (payload.typedWord || '').toLowerCase().trim();
    const isCorrect = pronounIndex != null && correctForm && userForm === correctForm.toLowerCase().trim();
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: correctForm || qDoc.word || '' };
  } else if (room.gameType === 'whackawort') {
    const targetCategory = (qDoc.category || '').toLowerCase().trim();
    const tappedWord = (payload.word || '').toLowerCase().trim();
    const tappedCategory = (payload.category || '').toLowerCase().trim();
    const isCorrect = tappedCategory === targetCategory;
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: `Category: ${qDoc.category || ''}` };
  } else {
    return { ok: false, message: 'Unsupported game type' };
  }

  let points = evalResult.isCorrect ? (evalResult.points || basePoints(room.gameType)) : 0;
  let fastest = false;
  let comboStreak = 0;

  if (!b.comboStreaks) b.comboStreaks = {};
  const sid = String(studentId);

  if (evalResult.isCorrect) {
    const priorCorrect = (b.roundResults || []).some(r => r.isCorrect);
    if (!priorCorrect) {
      fastest = true;
      points += FAST_ANSWER_BONUS;
      replayService.recordEvent(roomId, 'fastest_answer', { studentId: sid, roundIndex });
    }
    b.comboStreaks[sid] = (b.comboStreaks[sid] || 0) + 1;
    comboStreak = b.comboStreaks[sid];
    if (comboStreak >= COMBO_THRESHOLD) {
      points += COMBO_STREAK_BONUS;
      replayService.recordEvent(roomId, 'combo_streak', { studentId: sid, comboStreak });
    }
  } else {
    b.comboStreaks[sid] = 0;
  }

  replayService.recordEvent(roomId, 'answer', {
    studentId: sid,
    roundIndex,
    isCorrect: evalResult.isCorrect,
    points: evalResult.isCorrect ? points : 0,
  });

  const player = room.players.find(p => String(p.studentId) === sid);
  if (!player) return { ok: false, message: 'Not in room' };

  b.roundAnsweredBy.push(studentId);
  b.roundResults.push({
    studentId,
    isCorrect: evalResult.isCorrect,
    points,
    responseTimeMs,
    fastest,
    comboStreak,
  });

  player.totalAnswers = (player.totalAnswers || 0) + 1;
  if (evalResult.isCorrect) {
    player.correctAnswers = (player.correctAnswers || 0) + 1;
    player.score += points;
  }
  player.lastAnswerAt = new Date();
  player.lastHeartbeatAt = new Date();

  room.markModified('battle');
  await room.save();

  battleMetrics.answersValidated += 1;

  const leaderboard = buildLeaderboardFn(room);
  const answerResult = {
    isCorrect: evalResult.isCorrect,
    points: evalResult.isCorrect ? points : 0,
    fastest,
    comboStreak,
    correctAnswer: revealCorrect,
    responseTimeMs,
  };

  emitToRoom(roomId, 'arena:battle_answer_result', {
    studentId: sid,
    roundIndex,
    result: answerResult,
  });
  emitToRoom(roomId, 'arena:leaderboard', { players: leaderboard });

  const connectedPlayers = room.players.filter(p => p.isConnected !== false);
  const answeredCount = b.roundAnsweredBy.length;
  if (answeredCount >= Math.max(1, connectedPlayers.length)) {
    setImmediate(() => {
      endRound(roomId, sanitizeRoomFn, buildLeaderboardFn).catch(() => {});
    });
  }

  return {
    ok: true,
    result: answerResult,
    leaderboard,
    room: sanitizeRoomFn(room),
  };
}

async function finishBattle(roomId, sanitizeRoomFn, buildLeaderboardFn) {
  clearRoundTimer(roomId);
  unregisterRoomEmitter(roomId);

  const room = await ArenaRoom.findByIdAndUpdate(
    roomId,
    { $set: { status: 'finished' } },
    { new: true }
  );
  if (!room) return { ok: false, message: 'Room not found' };

  const results = buildLeaderboardFn(room);
  replayService.recordEvent(roomId, 'battle_finish', { results: results.map(r => ({ id: r.studentId, score: r.score })) });
  const replay = await replayService.finalizeRecording(roomId, {
    inviteCode: room.inviteCode,
    gameType: room.gameType,
    gameSetId: room.gameSetId,
    tournamentId: room.tournamentId,
    playerCount: room.players.length,
    winnerId: results[0]?.studentId,
  });
  emitToRoom(roomId, 'arena:battle_complete', { results, room: sanitizeRoomFn(room), replayId: replay?._id, shareToken: replay?.shareToken });
  emitToRoom(roomId, 'arena:finished', { results, room: sanitizeRoomFn(room), replayId: replay?._id });

  if (room.matchmakingMode === 'ranked' && results.length >= 2) {
    try {
      const ranked = require('./ranked');
      await ranked.recordMatchResult(results[0].studentId, results[1].studentId);
    } catch (e) {
      console.warn('[battleEngine] ranked update failed', e.message);
    }
  }

  return { ok: true, results, room: sanitizeRoomFn(room) };
}

function getBattleSnapshot(room) {
  if (!room?.battle) return null;
  return {
    battle: sanitizeBattlePublic(room.battle),
    round: getRoundPayload(room),
    room: room,
  };
}

function resetBattleState(room) {
  room.battle = undefined;
  room.currentQuestionIndex = 0;
  room.markModified('battle');
}

function getMetrics() {
  return { ...battleMetrics, activeTimers: roundTimers.size };
}

/** Batch emit helper for production hardening */
function batchEmit(roomId, events) {
  const reg = roomEmitters.get(String(roomId));
  if (!reg?.emit) return;
  reg.emit('arena:batch', { events, serverTime: Date.now() });
}

module.exports = {
  initBattle,
  startBattleLoop,
  startRound,
  endRound,
  submitBattleAnswer,
  finishBattle,
  getBattleSnapshot,
  getRoundPayload,
  sanitizeBattlePublic,
  registerRoomEmitter,
  unregisterRoomEmitter,
  resetBattleState,
  getMetrics,
  batchEmit,
};
