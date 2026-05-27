const mongoose = require('mongoose');

const TeamMemberSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, default: '' },
  score: { type: Number, default: 0 },
}, { _id: false });

const TeamSchema = new mongoose.Schema({
  name: { type: String, required: true },
  type: { type: String, enum: ['classroom', 'manual'], default: 'manual' },
  classroomId: { type: String, default: null },
  members: [TeamMemberSchema],
  score: { type: Number, default: 0 },
}, { _id: false });

const BattlefieldTeamBattleSchema = new mongoose.Schema({
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  gameSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSet', required: true },
  gameType: { type: String, required: true },
  status: { type: String, enum: ['pending', 'active', 'finished', 'cancelled'], default: 'pending' },
  teamA: { type: TeamSchema, required: true },
  teamB: { type: TeamSchema, required: true },
  rounds: { type: Number, default: 5 },
  currentRound: { type: Number, default: 0 },
  winner: { type: String, enum: ['teamA', 'teamB', null], default: null },
  roomCode: { type: String, default: null },
  startsAt: { type: Date, default: null },
}, { timestamps: true });

BattlefieldTeamBattleSchema.index({ status: 1, startsAt: 1 });
BattlefieldTeamBattleSchema.index({ createdBy: 1 });

module.exports = mongoose.model('BattlefieldTeamBattle', BattlefieldTeamBattleSchema);
