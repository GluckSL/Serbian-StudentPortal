// sockets/glueckArenaMultiplayer.js — production Socket.io multiplayer + realtime battles

const jwt = require('jsonwebtoken');

const multiplayerService = require('../services/interactiveGames/multiplayer');
const battleEngine = require('../services/interactiveGames/battleEngine');
const antiCheat = require('../services/interactiveGames/antiCheat');
const spectatorService = require('../services/interactiveGames/spectator');
const observability = require('../services/interactiveGames/observability');
const redisAdapter = require('../services/interactiveGames/redisAdapter');
const battlefieldChat = require('../services/interactiveGames/battlefieldChat');
const battlefieldRoomManager = require('../services/interactiveGames/battlefieldRoomManager');
const teamBattleService = require('../services/interactiveGames/teamBattle');
const ArenaRoom = require('../models/ArenaRoom');
const config = require('../config/glueckArena');

let ioInstance = null;
const socketToUser = new Map();

function emitToRoom(code, event, payload) {
  ioInstance?.to(`room:${code}`).emit(event, payload);
}

function runBattlefieldCountdown(code) {
  const upper = code?.toUpperCase();
  emitToRoom(upper, 'arena:countdown', { seconds: 3 });
  let sec = 3;
  const tick = setInterval(() => {
    emitToRoom(upper, 'arena:countdown_tick', { seconds: sec });
    sec -= 1;
    if (sec <= 0) {
      clearInterval(tick);
      battlefieldRoomManager.beginPlaying(upper, ioInstance).then((playing) => {
        if (!playing?.ok) {
          emitToRoom(upper, 'arena:error', { message: playing?.message || 'Could not start battle' });
          return;
        }
        emitToRoom(upper, 'arena:playing', { room: playing.room });
      });
    }
  }, 1000);
}

function tryAutoStartBattlefield(code) {
  const result = battlefieldRoomManager.tryAutoStart(code);
  if (result?.ok) {
    emitToRoom(code, 'arena:room', { room: result.room });
    runBattlefieldCountdown(code);
  }
}

function initGlueckArenaSockets(httpServer) {
  if (ioInstance) {
    return ioInstance;
  }
  if (config.features?.multiplayer === false) return null;

  let Server;
  try {
    Server = require('socket.io').Server;
  } catch {
    console.warn('[glueck-arena] socket.io not installed — multiplayer disabled');
    return null;
  }

  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = String(decoded.id || decoded.userId || decoded._id);
      socket.userName = decoded.name || decoded.username || 'Player';
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socketToUser.set(socket.id, socket.userId);
    socket.emit('arena:connected', { userId: socket.userId });

    socket.on('arena:ping', async ({ code }) => {
      const t0 = Date.now();
      if (!antiCheat.checkSocketRate(socket.userId)) return;
      if (code) {
        if (battlefieldRoomManager.getRoom(code)) {
          battlefieldRoomManager.heartbeat(code, socket.userId, socket.id);
        } else {
          await multiplayerService.heartbeat(code, socket.userId, socket.id);
        }
      }
      observability.recordLatency(Date.now() - t0);
      socket.emit('arena:pong', { t: Date.now() });
    });

    socket.on('arena:join', async ({ code }) => {
      if (!antiCheat.checkSocketRate(socket.userId)) {
        return socket.emit('arena:error', { message: 'Rate limit' });
      }

      const bfRoom = battlefieldRoomManager.getRoom(code);
      if (bfRoom) {
        const result = battlefieldRoomManager.joinRoom(code, socket.userId, socket.userName, socket.id);
        if (!result.ok) return socket.emit('arena:error', { message: result.message });
        socket.join(`room:${result.room.inviteCode}`);
        socket.data.roomCode = result.room.inviteCode;
        io.to(`room:${result.room.inviteCode}`).emit('arena:room', { room: result.room });
        if (!result.isReconnect) {
          const sysMsg = battlefieldChat.addMessage(
            result.room.inviteCode, 'system', 'System', `${socket.userName} joined the room`, true
          );
          io.to(`room:${result.room.inviteCode}`).emit('arena:chat_message', sysMsg);
        }
        const chatHistory = battlefieldChat.getHistory(result.room.inviteCode);
        if (chatHistory.length) socket.emit('arena:chat_history', chatHistory);
        if (result.room.status === 'playing') {
          const snap = battlefieldRoomManager.getSnapshot(code);
          if (snap?.snapshot) socket.emit('arena:battle_snapshot', snap.snapshot);
        }
        return;
      }

      const result = await multiplayerService.joinRoom(
        socket.userId, socket.userName, code, socket.id
      );
      if (!result.ok) return socket.emit('arena:error', { message: result.message });
      socket.join(`room:${result.room.inviteCode}`);
      socket.data.roomCode = result.room.inviteCode;
      io.to(`room:${result.room.inviteCode}`).emit('arena:room', { room: result.room });
      if (!result.isReconnect) {
        const sysMsg = battlefieldChat.addMessage(
          result.room.inviteCode, 'system', 'System', `${socket.userName} joined the room`, true
        );
        io.to(`room:${result.room.inviteCode}`).emit('arena:chat_message', sysMsg);
      }
      const chatHistory = battlefieldChat.getHistory(result.room.inviteCode);
      if (chatHistory.length) socket.emit('arena:chat_history', chatHistory);
      if (result.room.status === 'playing') {
        const snap = await multiplayerService.getBattleSnapshotByCode(code);
        if (snap?.snapshot) socket.emit('arena:battle_snapshot', snap.snapshot);
      }
    });

    socket.on('arena:ready', async ({ code, ready }) => {
      if (!antiCheat.checkSocketRate(socket.userId)) return;

      const bfRoom = battlefieldRoomManager.getRoom(code);
      if (bfRoom) {
        const updated = battlefieldRoomManager.setPlayerReady(code, socket.userId, ready);
        if (updated) {
          io.to(`room:${code}`).emit('arena:room', { room: updated });
          tryAutoStartBattlefield(code);
        }
        return;
      }

      const room = await multiplayerService.getRoomByCode(code);
      if (!room) return;
      const updated = await multiplayerService.setPlayerReady(room._id, socket.userId, ready);
      io.to(`room:${code}`).emit('arena:room', { room: updated });
    });

    socket.on('arena:start', async ({ code }) => {
      const bfRoom = battlefieldRoomManager.getRoom(code);
      if (bfRoom) {
        const result = battlefieldRoomManager.startCountdown(code, socket.userId);
        if (!result.ok) return socket.emit('arena:error', { message: result.message });
        io.to(`room:${code}`).emit('arena:room', { room: result.room });
        runBattlefieldCountdown(code);
        return;
      }

      const room = await multiplayerService.getRoomByCode(code);
      if (!room || String(room.hostId) !== socket.userId) return;
      const result = await multiplayerService.startRoom(room._id, socket.userId);
      if (!result.ok) return socket.emit('arena:error', { message: result.message });
      io.to(`room:${code}`).emit('arena:countdown', { seconds: 3 });
      let sec = 3;
      const tick = setInterval(() => {
        io.to(`room:${code}`).emit('arena:countdown_tick', { seconds: sec });
        sec -= 1;
        if (sec <= 0) {
          clearInterval(tick);
          multiplayerService.beginPlaying(room._id, code).then((playing) => {
            if (!playing?.ok && playing?.error) {
              io.to(`room:${code}`).emit('arena:error', { message: playing.error });
              return;
            }
            if (playing?.message && !playing?.status) {
              io.to(`room:${code}`).emit('arena:error', { message: playing.message });
              return;
            }
            io.to(`room:${code}`).emit('arena:playing', { room: playing });
          });
        }
      }, 1000);
    });

    socket.on('arena:cancel', async ({ code }) => {
      const bfRoom = battlefieldRoomManager.getRoom(code);
      if (bfRoom) {
        const result = battlefieldRoomManager.cancelRoom(code, socket.userId);
        if (!result.ok) return socket.emit('arena:error', { message: result.message });
        io.to(`room:${code}`).emit('arena:room_cancelled', { room: result.room });
        return;
      }
      const room = await multiplayerService.getRoomByCode(code);
      if (!room || String(room.hostId) !== socket.userId) return;
      const cancelled = await multiplayerService.finishRoom(room._id, socket.userId);
      if (cancelled.ok) {
        battleEngine.unregisterRoomEmitter(room._id);
        io.to(`room:${code}`).emit('arena:room_cancelled', { room: cancelled.room });
      }
    });

    /** Legacy generic answer — kept for backward compatibility */
    socket.on('arena:answer', async (payload) => {
      const { code, questionIndex, isCorrect, points, responseTimeMs } = payload || {};
      const room = await multiplayerService.getRoomByCode(code);
      if (!room) return;
      const fullRoom = await require('../models/ArenaRoom').findOne({ inviteCode: code.toUpperCase() });
      if (fullRoom?.battle) {
        return socket.emit('arena:error', {
          message: 'Use arena:battle_answer for live battles',
        });
      }
      const result = await multiplayerService.recordAnswer(room._id, socket.userId, {
        questionIndex, isCorrect, points, responseTimeMs,
      });
      if (!result.ok) return socket.emit('arena:error', { message: result.message });
      io.to(`room:${code}`).emit('arena:leaderboard', { players: result.leaderboard });
    });

    /** Realtime battle answer — server validates all game types */
    socket.on('arena:battle_answer', async (payload) => {
      const { code, roundIndex } = payload || {};
      if (!code) return;

      const bfRoom = battlefieldRoomManager.getRoom(code);
      if (bfRoom) {
        const result = battlefieldRoomManager.submitAnswer(code, socket.userId, payload, io);
        if (!result.ok) return socket.emit('arena:error', { message: result.message });
        io.to(`room:${code}`).emit('arena:battle_answer_result', {
          studentId: socket.userId,
          roundIndex,
          result: result.result,
        });
        io.to(`room:${code}`).emit('arena:leaderboard', { players: result.leaderboard });
        socket.emit('arena:battle_answer_ack', {
          roundIndex,
          result: result.result,
        });
        return;
      }

      const room = await multiplayerService.getRoomByCode(code);
      if (!room) return;
      const result = await multiplayerService.submitBattleAnswer(room._id, socket.userId, payload);
      if (!result.ok) return socket.emit('arena:error', { message: result.message });
      socket.emit('arena:battle_answer_ack', {
        roundIndex,
        result: result.result,
      });

      // Propagate score to team battle if this is a team-mode room
      try {
        const fullRoom = await ArenaRoom.findOne({ inviteCode: code.toUpperCase() });
        if (fullRoom?.teamMode && fullRoom?.teamBattleId) {
          teamBattleService.submitTeamAnswer(fullRoom.teamBattleId, socket.userId, {
            points: result.result?.points || 0,
            roundIndex,
          }).catch(err => console.error('[teamBattle] submitTeamAnswer error:', err.message));
        }
      } catch (e) {
        console.error('[teamBattle] propagate error:', e.message);
      }
    });

    socket.on('arena:finish', async ({ code }) => {
      const bfRoom = battlefieldRoomManager.getRoom(code);
      if (bfRoom) {
        const result = battlefieldRoomManager.finishGame(code, io);
        if (result) {
          io.to(`room:${code}`).emit('arena:finished', { room: result.room, results: result.results });
        }
        return;
      }

      const room = await multiplayerService.getRoomByCode(code);
      if (!room) return;
      const result = await multiplayerService.finishRoom(room._id, socket.userId);
      if (result.ok) {
        battleEngine.unregisterRoomEmitter(room._id);
        io.to(`room:${code}`).emit('arena:finished', { room: result.room, results: result.results });
      }
    });

    socket.on('arena:rematch', async ({ code }) => {
      const bfRoom = battlefieldRoomManager.getRoom(code);
      if (bfRoom) {
        const result = battlefieldRoomManager.requestRematch(code, socket.userId);
        io.to(`room:${code}`).emit('arena:rematch_update', result);
        if (result.rematchAccepted) {
          io.to(`room:${code}`).emit('arena:room', { room: result.room });
        }
        return;
      }

      const room = await multiplayerService.getRoomByCode(code);
      if (!room) return;
      const result = await multiplayerService.requestRematch(room._id, socket.userId);
      io.to(`room:${code}`).emit('arena:rematch_update', result);
      if (result.rematchAccepted) {
        io.to(`room:${code}`).emit('arena:room', { room: result.room });
      }
    });

    socket.on('arena:share_invite', ({ code }) => {
      socket.emit('arena:invite_link', {
        code,
        url: `${process.env.PUBLIC_APP_URL || ''}/glueck-arena/multiplayer?code=${code}`,
      });
    });

    socket.on('arena:chat_message', async ({ code, message }) => {
      if (!code || !battlefieldChat.validateMessage(message)) return;
      if (!antiCheat.checkSocketRate(socket.userId)) {
        return socket.emit('arena:error', { message: 'Rate limit' });
      }
      const roomCode = code.toUpperCase();
      const exists = !!battlefieldRoomManager.getRoom(code) || !!(await multiplayerService.getRoomByCode(code));
      if (!exists) return;
      const msg = battlefieldChat.addMessage(roomCode, socket.userId, socket.userName, message);
      io.to(`room:${roomCode}`).emit('arena:chat_message', msg);
    });

    /** Spectator — read-only room subscription with optional delay */
    socket.on('arena:spectate', async ({ code }) => {
      const upper = (code || '').toUpperCase();
      const check = await spectatorService.canSpectate(upper, socket.userId);
      if (!check.ok) return socket.emit('arena:error', { message: check.message });
      socket.join(`spectate:${upper}`);
      socket.join(`room:${upper}`);
      socket.data.isSpectator = true;
      socket.data.roomCode = upper;
      const delay = check.delayMs || 0;
      setTimeout(async () => {
        const bfSnap = battlefieldRoomManager.getSnapshot(code);
        if (bfSnap) {
          socket.emit('arena:spectator_state', {
            room: bfSnap.room,
            snapshot: bfSnap.snapshot,
            delayed: delay > 0,
            spectatorCount: check.spectatorCount,
          });
          return;
        }
        const snap = await multiplayerService.getBattleSnapshotByCode(upper);
        socket.emit('arena:spectator_state', {
          room: snap?.room,
          snapshot: snap?.snapshot,
          delayed: delay > 0,
          spectatorCount: check.spectatorCount,
        });
      }, delay);
    });

    socket.on('disconnect', async () => {
      socketToUser.delete(socket.id);
      const wasSpectator = socket.data.isSpectator;
      const wasRoomCode = socket.data.roomCode;

      battlefieldRoomManager.handleDisconnect(socket.userId, socket.id);
      await multiplayerService.handleDisconnect(socket.userId, socket.id);

      if (wasSpectator && wasRoomCode) {
        spectatorService.removeSpectator(wasRoomCode, socket.userId);
      }
      if (wasRoomCode) {
        const bfRoom = battlefieldRoomManager.getRoom(wasRoomCode);
        if (bfRoom) {
          io.to(`room:${wasRoomCode}`).emit('arena:room', { room: bfRoom });
        } else {
          const room = await multiplayerService.getRoomByCode(wasRoomCode);
          if (room) io.to(`room:${wasRoomCode}`).emit('arena:room', { room });
        }
        if (!wasSpectator) {
          const dcMsg = battlefieldChat.addMessage(
            wasRoomCode, 'system', 'System', `${socket.userName} left the room`, true
          );
          io.to(`room:${wasRoomCode}`).emit('arena:chat_message', dcMsg);
        }
      }
    });
  });

  redisAdapter.attachRedisAdapter(io).catch(() => {});
  ioInstance = io;
  console.log('[glueck-arena] Socket.io multiplayer initialized (realtime battles + battlefield in-memory)');
  return io;
}

function getIo() { return ioInstance; }

function getOnlineSocketCount() {
  return socketToUser.size;
}

module.exports = { initGlueckArenaSockets, getIo, getOnlineSocketCount, emitToRoom };
