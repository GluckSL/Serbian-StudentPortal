// models/ArenaRoom.js — multiplayer battle rooms

const mongoose = require('mongoose');

const ArenaRoomPlayerSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, default: '' },
  score: { type: Number, default: 0 },
  isReady: { type: Boolean, default: false },
  isConnected: { type: Boolean, default: true },
  lastAnswerAt: { type: Date, default: null },
  lastHeartbeatAt: { type: Date, default: null },
  socketId: { type: String, default: null },
  correctAnswers: { type: Number, default: 0 },
  totalAnswers: { type: Number, default: 0 },
}, { _id: false });

const ArenaRoomSchema = new mongoose.Schema({
  inviteCode: { type: String, required: true, unique: true, index: true },
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  gameSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSet', required: true },
  gameType: { type: String, required: true },
  status: {
    type: String,
    enum: ['lobby', 'countdown', 'playing', 'finished', 'cancelled'],
    default: 'lobby',
  },
  players: { type: [ArenaRoomPlayerSchema], default: [] },
  maxPlayers: { type: Number, default: 8 },
  currentQuestionIndex: { type: Number, default: 0 },
  startedAt: { type: Date, default: null },
  endsAt: { type: Date, default: null },
  rematchRequestedBy: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  region: { type: String, default: 'global' },
  matchmakingMode: { type: String, enum: ['private', 'casual', 'ranked'], default: 'private' },
  /** Authoritative realtime battle state (questions sanitized — no answers on wire) */
  battle: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  spectatorCount: { type: Number, default: 0 },
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArenaTournament', default: null },
  // Battlefield fields
  roomName: { type: String, maxlength: 60, default: '' },
  isPublic: { type: Boolean, default: false },
  password: { type: String, default: null },
  teamMode: { type: Boolean, default: false },
  teams: { type: mongoose.Schema.Types.Mixed, default: null },
  teamBattleId: { type: mongoose.Schema.Types.ObjectId, ref: 'BattlefieldTeamBattle', default: null },
}, { timestamps: true });

ArenaRoomSchema.index({ status: 1, endsAt: 1 });
ArenaRoomSchema.index({ hostId: 1, createdAt: -1 });

module.exports = mongoose.model('ArenaRoom', ArenaRoomSchema);
