// models/ArenaTournament.js — scheduled knockout tournaments

const mongoose = require('mongoose');

const BracketMatchSchema = new mongoose.Schema({
  round: { type: Number, default: 1 },
  playerAId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  playerBId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  winnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  roomCode: { type: String, default: null },
  status: { type: String, enum: ['pending', 'live', 'finished'], default: 'pending' },
}, { _id: false });

const ArenaTournamentSchema = new mongoose.Schema({
  title: { type: String, required: true },
  gameSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSet', required: true },
  gameType: { type: String, required: true },
  status: {
    type: String,
    enum: ['draft', 'scheduled', 'registration', 'active', 'finished', 'cancelled'],
    default: 'draft',
  },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, default: null },
  maxParticipants: { type: Number, default: 32 },
  entryRules: {
    minLevel: { type: Number, default: 1 },
    premiumOnly: { type: Boolean, default: false },
    inviteOnly: { type: Boolean, default: false },
  },
  rewards: {
    xpFirst: { type: Number, default: 200 },
    xpSecond: { type: Number, default: 100 },
    xpThird: { type: Number, default: 50 },
    badgeKey: { type: String, default: null },
  },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  bracket: { type: [BracketMatchSchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

ArenaTournamentSchema.index({ status: 1, startsAt: 1 });

module.exports = mongoose.model('ArenaTournament', ArenaTournamentSchema);
