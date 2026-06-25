const crypto = require('crypto');
const GameQuestion = require('../../models/GameQuestion');
const GameSet = require('../../models/GameSet');
const BattlefieldStats = require('../../models/BattlefieldStats');
const ArenaRoom = require('../../models/ArenaRoom');
const config = require('../../config/glueckArena');
const { attachScrambled, evaluateAnswer: evalScramble } = require('./scrambleRush');
const { getShuffledTokens, tokenize, evaluateAnswer: evalSentence } = require('./sentenceBuilder');
const { basePoints } = require('./scoring');
const battlefieldElo = require('./battlefieldElo');

const rooms = new Map();
const autoStartTimers = new Map();

const COMBO_STREAK_BONUS = 3;
const COMBO_THRESHOLD = 3;

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function loadRoomFromMongo(code) {
  const doc = await ArenaRoom.findOne({ inviteCode: code?.toUpperCase() }).lean();
  if (!doc) return null;
  const bfRoom = {
    _id: doc._id?.toString() || `bf_${doc.inviteCode}`,
    inviteCode: doc.inviteCode,
    hostId: doc.hostId || '',
    hostName: doc.hostName || '',
    gameSetId: doc.gameSetId,
    gameType: doc.gameType,
    status: doc.status || 'lobby',
    players: (doc.players || []).map(p => ({
      studentId: String(p.studentId),
      name: p.name || '',
      score: p.score || 0,
      isReady: p.isReady || false,
      isConnected: p.isConnected || false,
      correctAnswers: p.correctAnswers || 0,
      totalAnswers: p.totalAnswers || 0,
      socketId: p.socketId || null,
      lastHeartbeatAt: p.lastHeartbeatAt || Date.now(),
    })),
    maxPlayers: doc.maxPlayers || 8,
    roomName: doc.roomName || '',
    isPublic: !!doc.isPublic,
    password: doc.password || null,
    teamMode: !!doc.teamMode,
    startedAt: doc.startedAt || null,
    endsAt: doc.endsAt || Date.now() + 3600000,
    rematchVotes: [],
    battle: null,
    _mongoId: doc._id,
  };
  rooms.set(code?.toUpperCase(), bfRoom);
  return bfRoom;
}

function sanitizeRoom(room) {
  if (!room) return null;
  return {
    _id: room._id,
    inviteCode: room.inviteCode,
    status: room.status,
    gameType: room.gameType,
    gameSetId: room.gameSetId,
    hostId: String(room.hostId || ''),
    hostName: room.hostName || '',
    players: (room.players || []).map(p => ({
      studentId: String(p.studentId || ''),
      name: p.name,
      score: p.score,
      isReady: p.isReady,
      isConnected: p.isConnected,
      correctAnswers: p.correctAnswers || 0,
      totalAnswers: p.totalAnswers || 0,
    })),
    maxPlayers: room.maxPlayers,
    currentRound: 0,
    totalRounds: room.battle?.totalRounds ?? 0,
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
    hostId: String(hostId),
    hostName,
    gameSetId,
    gameType: gameType || set.gameType,
    status: 'lobby',
    players: [{
      studentId: String(hostId),
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
    studentId: String(studentId),
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
  return sanitizeRoom(rooms.get(code?.toUpperCase()));
}

function getRawRoom(code) {
  return rooms.get(code?.toUpperCase()) || null;
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

function allPlayersReady(code) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return false;
  const connected = room.players.filter(p => p.isConnected);
  return connected.length >= 2 && connected.every(p => p.isReady);
}

function canStartRoom(room) {
  if (!room) return false;
  if (room.status !== 'lobby') return false;
  if (room.players.length < 2) return false;
  return room.players.every(p => p.isReady);
}

function tryAutoStart(code, io, seconds = 5) {
  const key = code?.toUpperCase();
  const room = rooms.get(key);
  if (!room || room.status !== 'lobby') return false;
  if (!allPlayersReady(code)) return false;

  room.status = 'countdown';
  room.startedAt = Date.now();

  io.to(`room:${key}`).emit('arena:countdown', { seconds, autoStart: true });

  let sec = seconds;
  const timer = setInterval(() => {
    sec -= 1;
    if (sec <= 0) {
      clearInterval(timer);
      autoStartTimers.delete(key);
      beginPlaying(code, io).then((playing) => {
        if (playing?.error) {
          io.to(`room:${key}`).emit('arena:error', { message: playing.error });
          return;
        }
        io.to(`room:${key}`).emit('arena:playing', { room: playing.room });
      });
    } else {
      io.to(`room:${key}`).emit('arena:countdown_tick', { seconds: sec });
    }
  }, 1000);

  autoStartTimers.set(key, timer);
  return true;
}

function clearAutoStartTimer(code) {
  const key = code?.toUpperCase();
  const timer = autoStartTimers.get(key);
  if (timer) {
    clearInterval(timer);
    autoStartTimers.delete(key);
  }
}

function cancelAutoStart(code) {
  clearAutoStartTimer(code);
  const room = rooms.get(code?.toUpperCase());
  if (room && room.status === 'countdown') {
    room.status = 'lobby';
    room.startedAt = null;
    return sanitizeRoom(room);
  }
  return null;
}

function isAutoStarting(code) {
  return autoStartTimers.has(code?.toUpperCase());
}

function startCountdown(code, hostId) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return { ok: false, message: 'Room not found' };
  if (String(room.hostId) !== String(hostId)) return { ok: false, message: 'Only host can start' };
  if (!canStartRoom(room)) return { ok: false, message: 'Not all players ready' };

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
    .lean();

  if (!questions.length) {
    return { ok: false, message: 'No questions in game set' };
  }

  const sanitizedQuestions = questions.map((q, idx) =>
    sanitizeQuestionForClient(q, room.gameType, idx)
  );

  room.status = 'playing';
  room.battle = {
    totalRounds: sanitizedQuestions.length,
    questions: sanitizedQuestions,
    currentRound: 0,
    comboStreaks: {},
    playerProgress: {},
    questionDocs: questions.map(q => ({
      questionId: String(q._id),
      word: q.word,
      correctSentence: q.correctSentence,
      tokens: q.tokens,
      articleGender: q.articleGender || null,
      pairs: q.pairs || [],
      imageUrl: q.imageUrl || null,
      translation: q.translation || '',
      category: q.category || '',
      hint: q.hint || '',
      questionText: q.questionText || '',
      options: (q.options || []).map((o) => ({ text: o.text, isCorrect: o.isCorrect })),
      searchWords: q.searchWords || [],
    })),
  };

  // Initialize per-player progress
  for (const player of room.players) {
    const sid = String(player.studentId);
    room.battle.playerProgress[sid] = { answeredIds: {}, answeredCount: 0, completed: false };
  }

  broadcastToRoom(code, io, 'arena:battle_round', {
    round: {
      roundIndex: 0,
      totalRounds: sanitizedQuestions.length,
      question: sanitizedQuestions,
      serverTime: Date.now(),
    },
    room: sanitizeRoom(room),
  });
  broadcastToRoom(code, io, 'arena:leaderboard', { players: buildLeaderboard(room) });

  return { ok: true, room: sanitizeRoom(room) };
}

function submitAnswer(code, studentId, payload, io) {
  const room = rooms.get(code?.toUpperCase());
  if (!room || room.status !== 'playing' || !room.battle) {
    return { ok: false, message: 'Battle not active' };
  }

  const b = room.battle;
  const sid = String(studentId);
  const progress = b.playerProgress[sid];
  if (!progress) return { ok: false, message: 'Player not in battle' };
  if (progress.completed) return { ok: false, message: 'Already completed' };

  const questionIndex = parseInt(payload?.roundIndex, 10);
  if (!Number.isFinite(questionIndex) || questionIndex < 0) {
    return { ok: false, message: 'Invalid question index' };
  }
  const question = b.questions[questionIndex];
  if (!question) return { ok: false, message: 'Invalid question' };

  // Verify client's questionId matches the question at this index
  if (payload.questionId && question.questionId !== payload.questionId) {
    return { ok: false, message: 'Question mismatch' };
  }

  const isPairGame = ['word_picture_match', 'image_matching', 'memory'].includes(room.gameType);

  // For pair-based games, track per-pair; for others, track per-question
  if (isPairGame) {
    if (!progress.answeredPairs) progress.answeredPairs = {};
    const qPairs = progress.answeredPairs[question.questionId] || [];
    if (payload.pairIndex != null && qPairs.includes(payload.pairIndex)) {
      return { ok: false, message: 'Already answered this pair' };
    }
  } else {
    if (progress.answeredIds?.[question.questionId]) {
      return { ok: false, message: 'Already answered' };
    }
  }

  const qDoc = b.questionDocs?.find(d => d.questionId === question.questionId);
  if (!qDoc) return { ok: false, message: 'Question data missing' };

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
    const pair = qDoc.pairs?.[payload.pairIndex];
    const correctWord = pair?.word || qDoc.word || '';
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
  } else if (room.gameType === 'jumbled_words') {
    const submitted = (payload.typedWord || '').toLowerCase().trim();
    const correct = (qDoc.word || '').toLowerCase().trim();
    const isCorrect = submitted === correct;
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: qDoc.word || '' };
  } else if (room.gameType === 'hangman') {
    const submitted = (payload.typedWord || '').toLowerCase().trim();
    const correct = (qDoc.word || '').toLowerCase().trim();
    const isCorrect = submitted === correct;
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: qDoc.word || '' };
  } else if (room.gameType === 'word_picture_match') {
    const pair = qDoc.pairs?.[payload.pairIndex];
    const expected = (pair?.word || '').toLowerCase().trim();
    const received = (payload.typedWord || '').toLowerCase().trim();
    console.log(`[battlefield] wp_match: pairIndex=${payload.pairIndex}, qDoc.pairs=${JSON.stringify(qDoc.pairs)}, expected="${expected}", received="${received}", match=${expected === received}`);
    const isCorrect = !!(pair && expected === received);
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: pair?.word || qDoc.word || '' };
  } else if (room.gameType === 'multiple_choice') {
    const selectedIndex = parseInt(payload.selectedIndex ?? payload.slotIndex, 10);
    const correctIdx = (qDoc.options || []).findIndex((o) => o.isCorrect);
    const isCorrect = selectedIndex === correctIdx;
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { correctIndex: correctIdx };
  } else if (room.gameType === 'spin_wheel' || room.gameType === 'tap_boxes') {
    const submitted = (payload.typedWord || '').toLowerCase().trim();
    const correct = (qDoc.word || '').toLowerCase().trim();
    const isCorrect = correct ? submitted === correct : true;
    evalResult = { isCorrect, points: isCorrect ? basePoints(room.gameType) : 0 };
    if (!isCorrect) revealCorrect = { word: qDoc.word || '' };
  } else if (room.gameType === 'word_search') {
    evalResult = { isCorrect: true, points: basePoints(room.gameType) };
  } else {
    evalResult = { isCorrect: true, points: basePoints(room.gameType) };
    revealCorrect = null;
  }

  console.log(`[battlefield] answer: student=${sid}, gameType=${room.gameType}, qIdx=${questionIndex}, pairIdx=${payload.pairIndex}, typedWord="${payload.typedWord}", isCorrect=${evalResult.isCorrect}`);

  let points = evalResult.isCorrect ? (evalResult.points || basePoints(room.gameType)) : 0;
  let comboStreak = 0;

  if (evalResult.isCorrect) {
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

  player.totalAnswers = (player.totalAnswers || 0) + 1;
  if (evalResult.isCorrect) {
    player.correctAnswers = (player.correctAnswers || 0) + 1;
    player.score += points;
  }
  player.lastAnswerAt = Date.now();
  player.lastHeartbeatAt = Date.now();

  let completed = false;
  // Track answered questions/pairs (any order)
  if (isPairGame) {
    if (payload.pairIndex != null && !(progress.answeredPairs[question.questionId] || []).includes(payload.pairIndex)) {
      if (!progress.answeredPairs[question.questionId]) progress.answeredPairs[question.questionId] = [];
      progress.answeredPairs[question.questionId].push(payload.pairIndex);
    }
    const totalPairs = b.questions.reduce((sum, q) => sum + (q.pairs?.length || 0), 0);
    progress.answeredCount = Object.values(progress.answeredPairs || {}).reduce((sum, arr) => sum + arr.length, 0);
    completed = progress.answeredCount >= totalPairs;
    if (completed) progress.completed = true;
  } else {
    if (!progress.answeredIds) progress.answeredIds = {};
    if (!progress.answeredIds[question.questionId]) {
      progress.answeredIds[question.questionId] = true;
      progress.answeredCount = (progress.answeredCount || 0) + 1;
    }
    completed = progress.answeredCount >= b.totalRounds;
    if (completed) progress.completed = true;
  }

  const answerResult = {
    isCorrect: evalResult.isCorrect,
    points: evalResult.isCorrect ? points : 0,
    comboStreak,
    correctAnswer: revealCorrect,
  };

  // Check if all connected players completed
  const connectedPlayers = room.players.filter(p => p.isConnected !== false);
  const completionStatus = connectedPlayers.map(p => {
    const prog = b.playerProgress[String(p.studentId)];
    return { studentId: p.studentId, answeredCount: prog?.answeredCount, completed: prog?.completed };
  });
  console.log(`[battlefield] allCompleted check: connected=${connectedPlayers.length}, status=${JSON.stringify(completionStatus)}, totalPairs=${b.questions?.reduce((s, q) => s + (q.pairs?.length || 0), 0)}, totalRounds=${b.totalRounds}`);
  const allCompleted = connectedPlayers.every(p => {
    const prog = b.playerProgress[String(p.studentId)];
    return prog?.completed;
  });

  if (allCompleted) {
    console.log('[battlefield] ALL COMPLETED — calling finishGame');
    setImmediate(() => finishGame(code, io));
  }

  return {
    ok: true,
    result: answerResult,
    leaderboard: buildLeaderboard(room),
    completed,
  };
}

function finishGame(code, io) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return null;

  room.status = 'finished';
  const leaderboard = buildLeaderboard(room);

  broadcastToRoom(code, io, 'arena:battle_complete', { results: leaderboard, room: sanitizeRoom(room) });
  broadcastToRoom(code, io, 'arena:finished', { results: leaderboard, room: sanitizeRoom(room) });

  persistResults(room, leaderboard).catch(err => {
    console.error('[battlefieldRoomManager] persist error:', err.message);
  });

  if (room._mongoId) {
    ArenaRoom.findByIdAndUpdate(room._mongoId, {
      $set: {
        status: 'finished',
        players: room.players.map(p => ({
          studentId: p.studentId,
          name: p.name,
          score: p.score || 0,
          isReady: p.isReady,
          isConnected: p.isConnected,
          correctAnswers: p.correctAnswers || 0,
          totalAnswers: p.totalAnswers || 0,
          lastAnswerAt: p.lastAnswerAt || new Date(),
        })),
      },
    }).catch(err => console.error('[battlefieldRoomManager] ArenaRoom save error:', err.message));
  }

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
        teamMode: !!room.teamMode,
      });
    }
  }
  return result.sort((a, b) => b.playerCount - a.playerCount);
}

function getSnapshot(code, studentId) {
  const room = rooms.get(code?.toUpperCase());
  if (!room) return null;
  const sid = studentId ? String(studentId) : null;
  const progress = sid ? room.battle?.playerProgress?.[sid] : null;
  return {
    room: sanitizeRoom(room),
    snapshot: room.battle ? {
      battle: {
        totalRounds: room.battle.totalRounds,
        currentRound: progress?.answeredCount ?? 0,
        serverTime: Date.now(),
      },
      round: {
        roundIndex: 0,
        totalRounds: room.battle.totalRounds,
        question: room.battle.questions,
        serverTime: Date.now(),
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
  clearAutoStartTimer(code);
  rooms.delete(code?.toUpperCase());
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
            totalScore: p.score || 0,
            correctAnswers: p.correctAnswers || 0,
            totalAnswers: p.totalAnswers || 0,
          },
          $set: {
            lastGameAt: new Date(),
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
      answerWord: q.word || '',
      hint: q.hint || '',
      audioUrl: q.audioUrl || null,
      imageUrl: q.imageUrl || null,
      letterCount: scrambled.letterCount,
    };
  }
  if (gameType === 'sentence_builder') {
    const correctTokens = q.tokens?.length ? q.tokens : tokenize(q.correctSentence || '');
    return {
      questionId: String(q._id),
      index,
      shuffledTokens: getShuffledTokens(q),
      correctTokens,
      correctSentence: q.correctSentence || '',
      translation: q.translation || '',
      sentenceAudioUrl: q.sentenceAudioUrl || null,
    };
  }
  if (gameType === 'image_matching') {
    return {
      _id: String(q._id),
      questionId: String(q._id),
      gameType: 'image_matching',
      order: index,
      pairs: (q.pairs || []).map(p => ({
        hint: p.hint || '',
        imageUrl: p.imageUrl || null,
        audioUrl: p.audioUrl || null,
      })),
      word: q.word || '',
      words: (q.pairs || []).map(p => p.word).filter(Boolean),
    };
  }
  if (gameType === 'gender_stack') {
    return {
      questionId: String(q._id),
      index,
      word: q.word || '',
      translation: q.translation || '',
      articleGender: q.articleGender || null,
    };
  }
  if (gameType === 'flashcards') {
    return {
      questionId: String(q._id),
      index,
      prompt: q.hint || q.word || 'Translate this word',
      hint: q.translation || '',
      answerWord: q.word || '',
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
      tokens,
    };
  }
  if (gameType === 'flapjugation') {
    return {
      _id: String(q._id),
      questionId: String(q._id),
      gameType: 'flapjugation',
      order: index,
      word: q.word || '',
      tokens: q.tokens || [],
      translation: q.translation || '',
    };
  }
  if (gameType === 'whackawort') {
    return {
      questionId: String(q._id),
      index,
      word: q.word || '',
      category: q.category || '',
    };
  }
  if (gameType === 'jumbled_words') {
    return {
      questionId: String(q._id),
      index,
      jumbledLetters: q.jumbledLetters || [],
      letterCount: q.letterCount || 0,
      hint: q.hint || '',
      answerWord: q.word || '',
    };
  }
  if (gameType === 'hangman') {
    return {
      questionId: String(q._id),
      index,
      hint: q.hint || q.translation || '',
      word: q.word || '',
      answerWord: q.word || '',
      imageUrl: q.imageUrl || null,
    };
  }
  if (gameType === 'word_picture_match') {
    return {
      questionId: String(q._id),
      index,
      word: q.word || '',
      imageUrl: q.imageUrl || null,
      answerWord: q.word || '',
      pairs: q.pairs || [],
    };
  }
  if (gameType === 'memory') {
    return {
      questionId: String(q._id),
      index,
      pairs: q.pairs || [],
      answerWord: q.word || '',
    };
  }
  if (gameType === 'multiple_choice') {
    const shuffled = [...(q.options || [])].sort(() => Math.random() - 0.5);
    return {
      questionId: String(q._id),
      index,
      questionText: q.questionText || '',
      options: shuffled.map(o => ({ text: o.text, isCorrect: o.isCorrect })),
      imageUrl: q.imageUrl || null,
      audioUrl: q.audioUrl || null,
      correctIndex: shuffled.findIndex(o => o.isCorrect),
      answerWord: q.word || '',
    };
  }
  if (gameType === 'spin_wheel') {
    return { questionId: String(q._id), index, phrase: q.word || q.hint || '' };
  }
  if (gameType === 'tap_boxes') {
    return { questionId: String(q._id), index, phrase: q.word || q.hint || '' };
  }
  if (gameType === 'word_search') {
    return { questionId: String(q._id), index, searchWords: q.searchWords || [] };
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
  getRawRoom,
  setPlayerReady,
  allPlayersReady,
  tryAutoStart,
  clearAutoStartTimer,
  cancelAutoStart,
  isAutoStarting,
  startCountdown,
  canStartRoom,
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
  loadRoomFromMongo,
};
