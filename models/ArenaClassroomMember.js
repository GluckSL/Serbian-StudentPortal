const mongoose = require('mongoose');

const ArenaClassroomMemberSchema = new mongoose.Schema({
  classroomId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArenaClassroom', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  joinedAt: { type: Date, default: Date.now },
}, { timestamps: true });

ArenaClassroomMemberSchema.index({ classroomId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('ArenaClassroomMember', ArenaClassroomMemberSchema);
