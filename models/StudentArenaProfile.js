// models/StudentArenaProfile.js — avatar, frames, showcase

const mongoose = require('mongoose');

const StudentArenaProfileSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  displayName: { type: String, default: '' },
  avatarUrl: { type: String, default: null },
  frameKey: { type: String, default: 'default' },
  unlockedFrames: { type: [String], default: ['default'] },
  showcaseBadgeKeys: { type: [String], default: [] },
  favoriteGameSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSet', default: null },
  bio: { type: String, default: '', maxlength: 280 },
  isPublic: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('StudentArenaProfile', StudentArenaProfileSchema);
