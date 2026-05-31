// models/ArenaClassroom.js — teacher classrooms for GlückArena

const mongoose = require('mongoose');

const ArenaClassroomSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true },
  classCode: { type: String, required: true, unique: true, index: true },
  description: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('ArenaClassroom', ArenaClassroomSchema);
