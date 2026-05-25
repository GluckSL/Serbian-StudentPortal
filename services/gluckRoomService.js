const {
  RoomServiceClient,
  AccessToken,
} = require('livekit-server-sdk');

class GluckRoomService {
  _ensureClients() {
    if (!this.roomService) {
      this.roomService = new RoomServiceClient(
        process.env.LIVEKIT_URL,
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET
      );
    }
  }

  async createRoom(sessionId) {
    this._ensureClients();
    const room = await this.roomService.createRoom({
      name: sessionId,
      emptyTimeout: 300,
      maxParticipants: 100,
    });
    return room.name;
  }

  async deleteRoom(roomName) {
    this._ensureClients();
    try {
      await this.roomService.deleteRoom(roomName);
    } catch (err) {
      console.warn('Could not delete room (already removed):', err.message);
    }
  }

  async generateToken(roomName, userId, userName, canPublish = false, canPublishSources = []) {
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: userId.toString(),
        name: userName,
      }
    );

    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: canPublish,
      canSubscribe: true,
      canPublishData: true,
      ...(canPublishSources.length > 0 ? { canPublishSources } : {}),
    });

    return await token.toJwt();
  }

  async getRoom(roomName) {
    this._ensureClients();
    return await this.roomService.getRoom(roomName);
  }

  async getParticipants(roomName) {
    this._ensureClients();
    return await this.roomService.listParticipants(roomName);
  }

  async removeParticipant(roomName, identity) {
    this._ensureClients();
    await this.roomService.removeParticipant(roomName, identity);
  }

  // ── Breakout rooms ──

  async createBreakoutRoom(roomName) {
    this._ensureClients();
    return await this.roomService.createRoom({
      name: roomName,
      emptyTimeout: 300,
      maxParticipants: 50,
    });
  }

  async generateBreakoutToken(roomName, userId, userName) {
    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity: userId.toString(), name: userName }
    );
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return await token.toJwt();
  }

  async deleteBreakoutRoom(roomName) {
    this._ensureClients();
    try {
      await this.roomService.deleteRoom(roomName);
    } catch (err) {
      console.warn('Could not delete breakout room:', err.message);
    }
  }
}

module.exports = new GluckRoomService();
