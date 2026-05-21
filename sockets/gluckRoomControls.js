const { Server } = require('socket.io');
const gluckRoomService = require('../services/gluckRoomService');

function initGluckRoomControls(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: function (origin, callback) {
        callback(null, true);
      },
      credentials: true,
    },
    path: '/ws/gluckroom',
  });

  const roomNamespace = io.of('/gluckroom');

  roomNamespace.use((socket, next) => {
    const { token, roomName } = socket.handshake.auth || {};
    if (!token || !roomName) {
      return next(new Error('Missing token or roomName'));
    }
    socket.roomName = roomName;
    next();
  });

  roomNamespace.on('connection', (socket) => {
    const { roomName, role } = socket.handshake.auth;

    socket.join(roomName);

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
  });
}

module.exports = { initGluckRoomControls };
