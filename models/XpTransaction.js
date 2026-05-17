// models/XpTransaction.js
// GlückArena: immutable XP ledger — one record per XP award event

const mongoose = require('mongoose');

const XpTransactionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  // Source of the XP award
  source: {
    type: String,
    enum: ['answer_correct', 'game_completed', 'bonus'],
    required: true,
  },

  // Reference to the game session
  attemptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GameAttempt',
    default: null,
  },

  gameSetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GameSet',
    default: null,
  },

  amount: { type: Number, required: true, min: 0 },

  description: { type: String, default: '' },
}, { timestamps: true });

XpTransactionSchema.index({ studentId: 1, createdAt: -1 });
XpTransactionSchema.index({ gameSetId: 1, createdAt: -1 });
// Daily/weekly leaderboard aggregation
XpTransactionSchema.index({ studentId: 1, source: 1, createdAt: -1 });

module.exports = mongoose.model('XpTransaction', XpTransactionSchema);
