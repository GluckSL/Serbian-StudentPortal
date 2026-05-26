const crypto = require('crypto');
const GameQuestion = require('../../models/GameQuestion');
const GameSet = require('../../models/GameSet');
const BattlefieldStats = require('../../models/BattlefieldStats');
const config = require('../../config/glueckArena');
const { attachScrambled, evaluateAnswer: evalScramble } = require('./scrambleRush');
const { getShuffledTokens, evaluateAnswer: evalSentence } = require('./sentenceBuilder');
const { basePoints } = require('./scoring');
const battlefieldElo = require('./battlefieldElo');

const rooms = new Map();
const roundTimers = new Map();

const DEFAULT_ROUNDS = 10;
const FAST_ANSWER_BONUS = 5;
const COMBO_STREAK_BONUS = 3;
const COMBO_THRESHOLD = 3;

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function sanitizeRoom(room) {
  if (!room) return null;
  return {
    _id: room._id,
    inviteCode: room.inviteCode,
    status: room.status,
    gameType: room.gameType,
    gameSetId: room.gameSetId,
    hostId: room.hostId,
    hostName: room.hostName || '',
    players: (room.players || []).map(p => ({
      studentId: p.studentId,
      name: p.name,
      score: p.score,
      isReady: p.isReady,
      isConnected: p.isConnected,
      correctAnswers: p.correctAnswers || 0,
      totalAnswers: p.totalAnswers || 0,
    })),
    maxPlayers: room.maxPlayers,
    currentRound: room.battle?.currentRound ?? 0,
    totalRounds: room.battle?.totalRounds ?? 0,
    roundStartedAt: room.battle?.roundStartedAt ?? null,
    roundEndsAt: room.battle?.roundEndsAt ?? null,
    startedAt: room.startedAt,
    endsAt: room.endsAt,
    rematchVotes: (room.rematchVotes || []).length,
    roomName: room.roomName || '',
    isPublic: !!room.isPublic,
    teamMode: !!room.teamMode,
  };
}

function buildLeaderboard(room) {
  return [...(room.players || [])]
    .map(p => ({
      rank: 0,
      studentId: p.studentId,
      name: p.name,
      score: p.score,
      isConnected: p.isConnected,
    }))
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, rank: i + 1 }));
}

async function createRoom(hostId, hostName, gameSetId, gameType, opts = {}) {
  const set = await GameSet.findById(gameSetId).lean();
  if (!set) return { ok: false, message: 'Game set not found' };

  const code = generateCode();
  const room = {
    _id: `bf_${code}`,
    inviteCode: code,
    hostId,
    hostName,
    gameSetId,
    gameType: gameType || set.gameType,
    status: 'lobby',
    players: [{
      studentId: hostId,
      name: hostName,
      score: 0,
      isReady: false,
      isConnected: true,
      socketId: null,
      correctAnswers: 0,
      totalAnswers: 0,
      lastHeartbeatAt: Date.now(),
    }],
    maxPlayers: opts.maxPlayers || config.multiplayer?.maxPlayers || 8,
    roomName: opts.roomName || `${hostName}'s Battlefield`,
    isPublic: !!opts.isPublic,
    password: opts.password || null,
    teamMode: !!opts.teamMode,
    startedAt: null,
    endsAt: Date.now() + (config.multiplayer?.roomTtlMinutes || 30) * 60000,
    rematchVotes: [],
    battle: null,
    currentQuestionIndex: 0,
  };

  rooms.set(code, room);
  return { ok: true, room: sanitizeRoom(room) };
}

function joinRoom(code, studentId, studentName, socketId) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return { ok: false, message: 'Room not found' };
  if (room.status !== 'lobby' && room.status !== 'countdown') {
    return { ok: false, message: 'Room is not accepting players' };
  }

  const existing = room.players.find(p => String(p.studentId) === String(studentId));
  if (existing) {
    existing.isConnected = true;
    existing.lastHeartbeatAt = Date.now();
    if (socketId) existing.socketId = socketId;
    return { ok: true, room: sanitizeRoom(room), isReconnect: true };
  }

  if (room.players.length >= room.maxPlayers) {
    return { ok: false, message: 'Room full' };
  }

  room.players.push({
    studentId,
    name: studentName,
    score: 0,
    isReady: false,
    isConnected: true,
    socketId: socketId || null,
    correctAnswers: 0,
    totalAnswers: 0,
    lastHeartbeatAt: Date.now(),
  });

  return { ok: true, room: sanitizeRoom(room) };
}

function leaveRoom(code, studentId) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return null;
  const idx = room.players.findIndex(p => String(p.studentId) === String(studentId));
  if (idx === -1) return null;
  room.players.splice(idx, 1);
  if (room.players.length === 0) {
    cleanupRoom(code);
    return null;
  }
  return sanitizeRoom(room);
}

function getRoom(code) {
  const room = rooms.get(code?.toUpperCase());
  return room ? sanitizeRoom(room) : null;
}

function setPlayerReady(code, studentId, ready) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return null;
  const player = room.players.find(p => String(p.studentId) === String(studentId));
  if (!player) return null;
  player.isReady = !!ready;
  player.lastHeartbeatAt = Date.now();
  return sanitizeRoom(room);
}

function startCountdown(code, hostId) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return { ok: false, message: 'Room not found' };
  if (String(room.hostId) !== String(hostId)) return { ok: false, message: 'Only host can start' };
  if (room.status !== 'lobby') return { ok: false, message: 'Cannot start' };
  if (!room.players.every(p => p.isReady)) return { ok: false, message: 'Not all players ready' };
  if (room.players.length < 1) return { ok: false, message: 'Need at least one player' };

  room.status = 'countdown';
  room.startedAt = Date.now();
  return { ok: true, room: sanitizeRoom(room) };
}

async function beginPlaying(code, io) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return { ok: false, message: 'Room not found' };

  const questions = await GameQuestion.find({
    gameSetId: room.gameSetId,
    gameType: room.gameType,
    isDeleted: false,
  })
    .sort({ order: 1 })
    .limit(DEFAULT_ROUNDS)
    .lean();

  if (!questions.length) {
    return { ok: false, message: 'No questions in game set' };
  }

  const sanitizedQuestions = questions.map((q, idx) =>
    sanitizeQuestionForClient(q, room.gameType, idx)
  );

  const duration = config.multiplayer?.answerWindowMs || 15000;
  room.status = 'playing';
  room.battle = {
    totalRounds: sanitizedQuestions.length,
    roundDurationMs: duration,
    questions: sanitizedQuestions,
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
    })),
  };
  room.currentQuestionIndex = 0;

  startRound(code, io);
  return { ok: true, room: sanitizeRoom(room) };
}

function startRound(code, io) {
  clearRoundTimer(code);
  const room = rooms.get(code?.toUpperCase());
  if (!room?.battle) return;

  const b = room.battle;
  if (b.currentRound >= b.totalRounds) {
    return finishGame(code, io);
  }

  const now = Date.now();
  b.roundStartedAt = now;
  b.roundEndsAt = now + b.roundDurationMs;
  b.roundAnsweredBy = [];
  b.roundResults = [];
  room.currentQuestionIndex = b.currentRound;

  const roundPayload = {
    roundIndex: b.currentRound,
    totalRounds: b.totalRounds,
    question: b.questions[b.currentRound],
    roundStartedAt: b.roundStartedAt,
    roundEndsAt: b.roundEndsAt,
    serverTime: Date.now(),
    roundDurationMs: b.roundDurationMs,
  };

  broadcastToRoom(code, io, 'arena:battle_round', { round: roundPayload, room: sanitizeRoom(room) });
  broadcastToRoom(code, io, 'arena:leaderboard', { players: buildLeaderboard(room) });

  const timer = setTimeout(() => endRound(code, io), b.roundDurationMs);
  roundTimers.set(code.toUpperCase(), timer);
}

function endRound(code, io) {
  clearRoundTimer(code);
  const room = rooms.get(code?.toUpperCase());
  if (!room?.battle) return;

  room.battle.currentRound += 1;

  broadcastToRoom(code, io, 'arena:battle_round_end', {
    roundIndex: room.battle.currentRound - 1,
    results: room.battle.roundResults || [],
    room: sanitizeRoom(room),
  });

  if (room.battle.currentRound >= room.battle.totalRounds) {
    finishGame(code, io);
  } else {
    startRound(code, io);
  }
}

function submitAnswer(code, studentId, payload, io) {
  const room = rooms.get(code?.toUpperCase());
  if (!room || room.status !== 'playing' || !room.battle) {
    return { ok: false, message: 'Battle not active' };
  }

  const b = room.battle;
  const roundIndex = parseInt(payload.roundIndex, 10);
  if (roundIndex !== b.currentRound) return { ok: false, message: 'Stale round' };

  if (b.roundAnsweredBy.some(id => String(id) === String(studentId))) {
    return { ok: false, message: 'Already answered' };
  }

  if (Date.now() > b.roundEndsAt + 500) {
    return { ok: false, message: 'Round ended' };
  }

  const question = b.questions[roundIndex];
  if (!question) return { ok: false, message: 'Invalid question' };

  const qDoc = b.questionDocs?.find(d => d.questionId === question.questionId);
  if (!qDoc) return { ok: false, message: 'Question data missing' };

  const responseTimeMs = Math.max(0, Date.now() - b.roundStartedAt);

  let evalResult;
  let revealCorrect = null;

  if (room.gameType === 'scramble_rush') {
    evalResult = evalScramble({ word: qDoc.word }, payload.typedWord || '');
    if (!evalResult.isCorrect) revealCorrect = { word: qDoc.word };
  } else if (room.gameType === 'sentence_builder') {
    evalResult = evalSentence(
      { correctSentence: qDoc.correctSentence, tokens: qDoc.tokens },
      payload.orderedTokens || []
    );
    if (!evalResult.isCorrect) revealCorrect = { sentence: qDoc.correctSentence };
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
    const pronounIndex = { ich: 0, du: 1, 'er/sie/es': 2, wir: 3, ihr: 4, Sie: 5 }[payload.pronoun || ''];
    const correctForm = (qDoc.tokens || [])[pronounIndex];
    const userForm = (payload.typedWord || '').toLowerCase().trim();
    const isCorrect = pronounIndex != null && correctForm && userForm === correctForm.toLowerCase().trim();
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: correctForm || qDoc.word || '' };
  } else {
    return { ok: false, message: 'Unsupported game type' };
  }

  let points = evalResult.isCorrect ? (evalResult.points || basePoints(room.gameType)) : 0;
  let fastest = false;
  let comboStreak = 0;
  const sid = String(studentId);

  if (evalResult.isCorrect) {
    const priorCorrect = b.roundResults.some(r => r.isCorrect);
    if (!priorCorrect) {
      fastest = true;
      points += FAST_ANSWER_BONUS;
    }
    b.comboStreaks[sid] = (b.comboStreaks[sid] || 0) + 1;
    comboStreak = b.comboStreaks[sid];
    if (comboStreak >= COMBO_THRESHOLD) {
      points += COMBO_STREAK_BONUS;
    }
  } else {
    b.comboStreaks[sid] = 0;
  }

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
  player.lastAnswerAt = Date.now();
  player.lastHeartbeatAt = Date.now();

  const answerResult = {
    isCorrect: evalResult.isCorrect,
    points: evalResult.isCorrect ? points : 0,
    fastest,
    comboStreak,
    correctAnswer: revealCorrect,
    responseTimeMs,
  };

  const connectedPlayers = room.players.filter(p => p.isConnected !== false);
  const answeredCount = b.roundAnsweredBy.length;
  if (answeredCount >= Math.max(1, connectedPlayers.length)) {
    setImmediate(() => endRound(code, io));
  }

  return {
    ok: true,
    result: answerResult,
    leaderboard: buildLeaderboard(room),
  };
}

function finishGame(code, io) {
  clearRoundTimer(code);
  const room = rooms.get(code?.toUpperCase());
  if (!room) return null;

  room.status = 'finished';
  const leaderboard = buildLeaderboard(room);

  broadcastToRoom(code, io, 'arena:battle_complete', { results: leaderboard, room: sanitizeRoom(room) });
  broadcastToRoom(code, io, 'arena:finished', { results: leaderboard, room: sanitizeRoom(room) });

  persistResults(room, leaderboard).catch(err => {
    console.error('[battlefieldRoomManager] persist error:', err.message);
  });

  return { ok: true, results: leaderboard, room: sanitizeRoom(room) };
}

function handleDisconnect(studentId, socketId) {
  for (const [code, room] of rooms.entries()) {
    const p = room.players.find(x => String(x.studentId) === String(studentId));
    if (p && (!socketId || p.socketId === socketId)) {
      p.isConnected = false;
    }
    const anyConnected = room.players.some(x => x.isConnected);
    if (!anyConnected && room.status !== 'playing') {
      cleanupRoom(code);
    }
  }
}

function heartbeat(code, studentId, socketId) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return null;
  const p = room.players.find(x => String(x.studentId) === String(studentId));
  if (!p) return null;
  p.isConnected = true;
  p.lastHeartbeatAt = Date.now();
  if (socketId) p.socketId = socketId;
  return sanitizeRoom(room);
}

function requestRematch(code, studentId) {
  const room = rooms.get(code?.toUpperCase());
  if (!room || room.status !== 'finished') return { ok: false, message: 'Cannot rematch' };
  if (!room.rematchVotes.includes(studentId)) {
    room.rematchVotes.push(studentId);
  }
  const votes = room.rematchVotes.length;
  const needed = Math.ceil(room.players.length / 2);
  if (votes >= needed) {
    room.status = 'lobby';
    room.rematchVotes = [];
    room.players.forEach(p => {
      p.score = 0;
      p.correctAnswers = 0;
      p.totalAnswers = 0;
      p.isReady = false;
    });
    room.battle = null;
    room.currentQuestionIndex = 0;
    return { ok: true, rematchAccepted: true, room: sanitizeRoom(room) };
  }
  return { ok: true, rematchAccepted: false, votes, needed };
}

function listPublicRooms() {
  const result = [];
  for (const room of rooms.values()) {
    if (room.isPublic && (room.status === 'lobby' || room.status === 'playing')) {
      result.push({
        inviteCode: room.inviteCode,
        roomName: room.roomName || '',
        gameType: room.gameType,
        hostName: room.hostName || 'Unknown',
        hostId: room.hostId,
        playerCount: room.players.filter(p => p.isConnected).length,
        maxPlayers: room.maxPlayers,
        status: room.status,
        isPublic: true,
        hasPassword: !!room.password,
      });
    }
  }
  return result.sort((a, b) => b.playerCount - a.playerCount);
}

function getSnapshot(code) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return null;
  return {
    room: sanitizeRoom(room),
    snapshot: room.battle ? {
      battle: {
        totalRounds: room.battle.totalRounds,
        currentRound: room.battle.currentRound,
        roundDurationMs: room.battle.roundDurationMs,
        roundStartedAt: room.battle.roundStartedAt,
        roundEndsAt: room.battle.roundEndsAt,
        serverTime: Date.now(),
      },
      round: {
        roundIndex: room.battle.currentRound,
        totalRounds: room.battle.totalRounds,
        question: room.battle.questions[room.battle.currentRound],
        roundStartedAt: room.battle.roundStartedAt,
        roundEndsAt: room.battle.roundEndsAt,
        serverTime: Date.now(),
        roundDurationMs: room.battle.roundDurationMs,
      },
    } : null,
  };
}

function cancelRoom(code, userId) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return { ok: false, message: 'Room not found' };
  if (String(room.hostId) !== String(userId)) {
    return { ok: false, message: 'Only the host can cancel the room' };
  }
  cleanupRoom(code);
  return { ok: true, room: sanitizeRoom(room) };
}

function cleanupRoom(code) {
  clearRoundTimer(code);
  rooms.delete(code?.toUpperCase());
}

function clearRoundTimer(code) {
  const key = code?.toUpperCase();
  const t = roundTimers.get(key);
  if (t) clearTimeout(t);
  roundTimers.delete(key);
}

function broadcastToRoom(code, io, event, payload) {
  if (io) {
    io.to(`room:${code.toUpperCase()}`).emit(event, payload);
  }
}

async function persistResults(room, leaderboard) {
  for (const p of room.players) {
    try {
      await BattlefieldStats.findOneAndUpdate(
        { studentId: p.studentId },
        {
          $inc: {
            gamesPlayed: 1,
            correctAnswers: p.correctAnswers || 0,
            totalAnswers: p.totalAnswers || 0,
          },
          $set: {
            totalScore: p.score || 0,
            lastPlayedAt: new Date(),
          },
        },
        { upsert: true }
      );
    } catch (e) {
      console.error(`[battlefieldRoomManager] persist stats for ${p.studentId}:`, e.message);
    }
  }

  if (leaderboard?.length >= 2) {
    const winner = leaderboard[0];
    const runnerUp = leaderboard[1];
    try {
      await battlefieldElo.recordMatch(winner.studentId, runnerUp.studentId);
    } catch (e) {
      console.error('[battlefieldRoomManager] ELO recordMatch error:', e.message);
    }
  }
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
      const options = getShuffledOptions(q);
      return { ...base, imageUrl: q.imageUrl, options };
    }
    if (q.pairs?.length) {
      const pair = q.pairs[0];
      const options = getShuffledOptions(q);
      return { ...base, imageUrl: pair.imageUrl || null, options };
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
  return { questionId: String(q._id), index };
}

function getShuffledOptions(q) {
  const correct = q.word || (q.pairs?.[0]?.word) || '';
  const distractors = q.distractors || [];
  if (!distractors.length) {
    return [correct].sort(() => Math.random() - 0.5);
  }
  return [correct, ...distractors].sort(() => Math.random() - 0.5);
}

module.exports = {
  createRoom,
  joinRoom,
  leaveRoom,
  getRoom,
  setPlayerReady,
  startCountdown,
  beginPlaying,
  submitAnswer,
  finishGame,
  handleDisconnect,
  heartbeat,
  requestRematch,
  listPublicRooms,
  getSnapshot,
  cancelRoom,
  cleanupRoom,
  sanitizeRoom,
  buildLeaderboard,
};
