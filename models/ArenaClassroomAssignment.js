const mongoose = require('mongoose');

const ArenaClassroomAssignmentSchema = new mongoose.Schema({
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArenaClassroom', required: true, index: true },
  gameSetId: { type: mongoose.Schema.Types.ObjectId, ref: 'GameSet', required: true },
  title: { type: String, required: true },
  dueAt: { type: Date, default: null },
  minAccuracy: { type: Number, default: null },
  xpBonus: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('ArenaClassroomAssignment', ArenaClassroomAssignmentSchema);
