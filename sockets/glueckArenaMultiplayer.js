// sockets/glueckArenaMultiplayer.js — production Socket.io multiplayer + realtime battles



const jwt = require('jsonwebtoken');

const multiplayerService = require('../services/interactiveGames/multiplayer');

const battleEngine = require('../services/interactiveGames/battleEngine');

const antiCheat = require('../services/interactiveGames/antiCheat');

const spectatorService = require('../services/interactiveGames/spectator');

const observability = require('../services/interactiveGames/observability');

const redisAdapter = require('../services/interactiveGames/redisAdapter');

const config = require('../config/glueckArena');



let ioInstance = null;

const socketToUser = new Map();



function emitToRoom(code, event, payload) {

  ioInstance?.to(`room:${code}`).emit(event, payload);

}



function initGlueckArenaSockets(httpServer) {

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

      if (code) await multiplayerService.heartbeat(code, socket.userId, socket.id);

      observability.recordLatency(Date.now() - t0);

      socket.emit('arena:pong', { t: Date.now() });

    });



    socket.on('arena:join', async ({ code }) => {

      if (!antiCheat.checkSocketRate(socket.userId)) {

        return socket.emit('arena:error', { message: 'Rate limit' });

      }

      const result = await multiplayerService.joinRoom(

        socket.userId, socket.userName, code, socket.id

      );

      if (!result.ok) return socket.emit('arena:error', { message: result.message });

      socket.join(`room:${result.room.inviteCode}`);

      socket.data.roomCode = result.room.inviteCode;

      io.to(`room:${result.room.inviteCode}`).emit('arena:room', { room: result.room });



      if (result.room.status === 'playing') {

        const snap = await multiplayerService.getBattleSnapshotByCode(code);

        if (snap?.snapshot) {

          socket.emit('arena:battle_snapshot', snap.snapshot);

        }

      }

    });



    socket.on('arena:ready', async ({ code, ready }) => {

      if (!antiCheat.checkSocketRate(socket.userId)) return;

      const room = await multiplayerService.getRoomByCode(code);

      if (!room) return;

      const updated = await multiplayerService.setPlayerReady(room._id, socket.userId, ready);

      io.to(`room:${code}`).emit('arena:room', { room: updated });

    });



    socket.on('arena:start', async ({ code }) => {

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

            if (playing?.error) {

              io.to(`room:${code}`).emit('arena:error', { message: playing.error });

              return;

            }

            io.to(`room:${code}`).emit('arena:playing', { room: playing });

          });

        }

      }, 1000);

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



    /** Realtime battle answer — server validates scramble/sentence */

    socket.on('arena:battle_answer', async (payload) => {

      const { code, roundIndex, typedWord, orderedTokens } = payload || {};

      if (!code) return;

      const room = await multiplayerService.getRoomByCode(code);

      if (!room) return;



      const result = await multiplayerService.submitBattleAnswer(room._id, socket.userId, {

        roundIndex,

        typedWord,

        orderedTokens,

      });

      if (!result.ok) {

        return socket.emit('arena:error', { message: result.message });

      }

      socket.emit('arena:battle_answer_ack', {

        roundIndex,

        result: result.result,

      });

    });



    socket.on('arena:finish', async ({ code }) => {

      const room = await multiplayerService.getRoomByCode(code);

      if (!room) return;

      const result = await multiplayerService.finishRoom(room._id, socket.userId);

      if (result.ok) {

        battleEngine.unregisterRoomEmitter(room._id);

        io.to(`room:${code}`).emit('arena:finished', { room: result.room, results: result.results });

      }

    });



    socket.on('arena:rematch', async ({ code }) => {

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

      if (socket.data.isSpectator && socket.data.roomCode) {

        spectatorService.removeSpectator(socket.data.roomCode, socket.userId);

      }

      await multiplayerService.handleDisconnect(socket.userId, socket.id);

      if (socket.data.roomCode) {

        const room = await multiplayerService.getRoomByCode(socket.data.roomCode);

        if (room) io.to(`room:${socket.data.roomCode}`).emit('arena:room', { room });

      }

    });

  });



  redisAdapter.attachRedisAdapter(io).catch(() => {});

  ioInstance = io;

  console.log('[glueck-arena] Socket.io multiplayer initialized (realtime battles)');

  return io;

}



function getIo() { return ioInstance; }



function getOnlineSocketCount() {

  return socketToUser.size;

}



module.exports = { initGlueckArenaSockets, getIo, getOnlineSocketCount, emitToRoom };

