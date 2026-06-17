const { Server } = require('socket.io');
const gluckRoomService = require('../services/gluckRoomService');
const GluckRoomParticipant = require('../models/GluckRoomParticipant');

function initGluckRoomControls(httpServer, app) {
  console.log('[gluckRoom] initGluckRoomControls called');
  console.log('[gluckRoom] httpServer request listeners before:', httpServer.listeners('request').length);

  const io = new Server(httpServer, {
    cors: {
      origin: function (origin, callback) {
        callback(null, true);
      },
      credentials: true,
    },
    path: '/ws/gluckroom',
    connectionStateRecovery: {},
  });

  console.log('[gluckRoom] io created, eio path:', io.eio.opts.path);
  console.log('[gluckRoom] httpServer request listeners after:', httpServer.listeners('request').length);

  // Listen for ANY engine.io error
  io.engine.on('connection_error', (err) => {
    console.error('[gluckRoom] ENGINE ERROR:', err.code, err.message, JSON.stringify(err.context));
  });

  // Listen on default namespace (NO auth middleware)
  io.on('connection', (socket) => {
    console.log('[gluckRoom] DEFAULT NSP CONNECT:', socket.id, 'auth:', JSON.stringify(socket.handshake.auth));
    socket.on('disconnect', () => {
      console.log('[gluckRoom] DEFAULT NSP DISCONNECT:', socket.id);
    });
  });

  const roomNamespace = io.of('/gluckroom');
  if (app) app.set('gluckRoomNamespace', roomNamespace);

  roomNamespace.on('connection', (socket) => {
    try {
      const auth = socket.handshake.auth || {};
      console.log('[gluckRoom] NSP CONNECT:', socket.id, 'auth:', JSON.stringify({ hasToken: !!auth.token, roomName: auth.roomName, role: auth.role }));

      const roomName = auth.roomName;
      const role = auth.role;
      if (!roomName) {
        console.warn('[gluckRoom] missing roomName in auth, disconnecting');
        socket.disconnect();
        return;
      }
      socket.roomName = roomName;
      socket.userId = auth.userId;

      socket.join(roomName);
      if (socket.userId) socket.join(socket.userId);

    const isStudent = role === 'student';
    const canModerate = !isStudent;

    socket.on('mute-participant', async ({ targetUserId }) => {
      if (!canModerate) return;
      roomNamespace.to(roomName).emit('participant-muted', { targetUserId });
    });

    socket.on('disable-participant-camera', async ({ targetUserId }) => {
      if (!canModerate) return;
      roomNamespace.to(roomName).emit('participant-camera-disabled', { targetUserId });
    });

    socket.on('mute-all', async () => {
      if (!canModerate) return;
      roomNamespace.to(roomName).emit('all-muted');
    });

    socket.on('disable-all-cams', async () => {
      if (!canModerate) return;
      roomNamespace.to(roomName).emit('all-cameras-disabled');
    });

    socket.on('mic-toggled', async ({ userId, on, sessionId }) => {
      roomNamespace.to(roomName).emit('participant-mic-state', { userId, on });
      if (!sessionId) return;
      try {
        await GluckRoomParticipant.updateOne(
          { sessionId, userId },
          { isMuted: !on }
        );
      } catch (err) {
        console.warn('Failed to update mic state:', err.message);
      }
    });

    socket.on('cam-toggled', async ({ userId, on, sessionId }) => {
      roomNamespace.to(roomName).emit('participant-cam-state', { userId, on });
      if (!sessionId) return;
      try {
        await GluckRoomParticipant.updateOne(
          { sessionId, userId },
          { isCameraDisabled: !on }
        );
      } catch (err) {
        console.warn('Failed to update cam state:', err.message);
      }
    });

    socket.on('remove-participant', async ({ targetUserId }) => {
      if (!canModerate) return;
      try {
        await gluckRoomService.removeParticipant(roomName, targetUserId);
        roomNamespace.to(roomName).emit('participant-removed', { targetUserId });
      } catch (err) {
        socket.emit('error', { message: 'Failed to remove participant' });
      }
    });

    socket.on('disconnect', () => {
      socket.leave(roomName);
    });

    // ── Breakout room events ──

    socket.on('breakout-assign', async ({ breakoutId, participantId }) => {
      if (!canModerate) return;
      try {
        const GluckRoomBreakout = require('../models/GluckRoomBreakout');
        const breakout = await GluckRoomBreakout.findById(breakoutId);
        if (!breakout) return;
        if (!breakout.assignedParticipants.some(p => p.toString() === participantId)) {
          breakout.assignedParticipants.push(participantId);
          await breakout.save();
        }
        roomNamespace.to(roomName).emit('breakout-assigned', {
          breakoutId, breakoutName: breakout.name, participantId,
        });
        roomNamespace.to(roomName).emit('breakouts-updated');
      } catch (err) {
        console.warn('breakout-assign error:', err.message);
      }
    });

    socket.on('breakout-assign-batch', async ({ breakoutId, participantIds }) => {
      if (!canModerate) return;
      try {
        const GluckRoomBreakout = require('../models/GluckRoomBreakout');
        const breakout = await GluckRoomBreakout.findById(breakoutId);
        if (!breakout) return;
        breakout.assignedParticipants = participantIds || [];
        await breakout.save();
        // Emit directly to each assigned participant's personal room
        for (const pid of participantIds || []) {
          roomNamespace.to(pid).emit('breakout-assigned', {
            breakoutId,
            breakoutName: breakout.name,
          });
        }
        roomNamespace.to(roomName).emit('breakouts-updated');
      } catch (err) {
        console.warn('breakout-assign-batch error:', err.message);
      }
    });

    socket.on('breakout-unassign', async ({ breakoutId, participantId }) => {
      if (!canModerate) return;
      try {
        const GluckRoomBreakout = require('../models/GluckRoomBreakout');
        const breakout = await GluckRoomBreakout.findById(breakoutId);
        if (!breakout) return;
        breakout.assignedParticipants = breakout.assignedParticipants.filter(
          p => p.toString() !== participantId
        );
        await breakout.save();
        roomNamespace.to(roomName).emit('breakout-unassigned', {
          breakoutId, participantId,
        });
        roomNamespace.to(roomName).emit('breakouts-updated');
      } catch (err) {
        console.warn('breakout-unassign error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      socket.leave(roomName);
    });
  } catch (err) {
    console.error('[gluckRoom] connection handler error:', err.message);
  }
  });
}

module.exports = { initGluckRoomControls };
