// models/ArenaBattleReplay.js — compressed battle event timeline

const mongoose = require('mongoose');

const ReplayEventSchema = new mongoose.Schema({
  t: { type: Number, required: true },
  type: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const ArenaBattleReplaySchema = new mongoose.Schema({
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArenaRoom', index: true },
  inviteCode: { type: String, index: true },
  gameType: { type: String, required: true },
  gameSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSet' },
  tournamentId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArenaTournament', default: null },
  shareToken: { type: String, unique: true, sparse: true, index: true },
  durationMs: { type: Number, default: 0 },
  playerCount: { type: Number, default: 0 },
  winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  highlights: [{ type: String }],
  events: { type: [ReplayEventSchema], default: [] },
  compressedSize: { type: Number, default: 0 },
  expiresAt: { type: Date, index: true },
}, { timestamps: true });

ArenaBattleReplaySchema.index({ createdAt: -1 });

module.exports = mongoose.model('ArenaBattleReplay', ArenaBattleReplaySchema);
