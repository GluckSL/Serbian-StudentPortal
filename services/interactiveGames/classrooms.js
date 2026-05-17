// services/interactiveGames/classrooms.js — teacher classrooms

const crypto = require('crypto');
const ArenaClassroom = require('../../models/ArenaClassroom');
const ArenaClassroomMember = require('../../models/ArenaClassroomMember');
const ArenaClassroomAssignment = require('../../models/ArenaClassroomAssignment');
const GameAttempt = require('../../models/GameAttempt');
const GameAnswer = require('../../models/GameAnswer');
const auditLog = require('./auditLog');

function generateClassCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function createClassroom(teacherId, { name, description }) {
  let code = generateClassCode();
  for (let i = 0; i < 5; i++) {
    const exists = await ArenaClassroom.findOne({ classCode: code });
    if (!exists) break;
    code = generateClassCode();
  }
  const room = await ArenaClassroom.create({ teacherId, name, classCode: code, description });
  await auditLog.log({ actorId: teacherId, action: 'classroom_created', resourceId: room._id });
  return room;
}

async function joinByCode(studentId, classCode) {
  const room = await ArenaClassroom.findOne({ classCode: classCode.toUpperCase(), isActive: true });
  if (!room) return { ok: false, message: 'Invalid class code' };
  await ArenaClassroomMember.findOneAndUpdate(
    { classroomId: room._id, studentId },
    { $setOnInsert: { classroomId: room._id, studentId } },
    { upsert: true }
  );
  return { ok: true, classroom: room };
}

async function listTeacherClassrooms(teacherId) {
  return ArenaClassroom.find({ teacherId, isActive: true }).sort({ createdAt: -1 }).lean();
}

async function listStudentClassrooms(studentId) {
  const memberships = await ArenaClassroomMember.find({ studentId }).lean();
  const ids = memberships.map(m => m.classroomId);
  return ArenaClassroom.find({ _id: { $in: ids }, isActive: true }).lean();
}

async function assignGame(teacherId, classroomId, payload) {
  const room = await ArenaClassroom.findOne({ _id: classroomId, teacherId });
  if (!room) return { ok: false, message: 'Classroom not found' };
  const a = await ArenaClassroomAssignment.create({ classroomId, ...payload });
  return { ok: true, assignment: a };
}

async function getClassroomAnalytics(teacherId, classroomId) {
  const room = await ArenaClassroom.findOne({ _id: classroomId, teacherId });
  if (!room) return null;
  const members = await ArenaClassroomMember.find({ classroomId }).lean();
  const studentIds = members.map(m => m.studentId);

  const [attempts, weakAnswers] = await Promise.all([
    GameAttempt.aggregate([
      { $match: { studentId: { $in: studentIds }, status: 'completed' } },
      { $group: {
        _id: '$studentId',
        games: { $sum: 1 },
        avgAccuracy: { $avg: '$accuracy' },
        totalXp: { $sum: '$xpEarned' },
      } },
      { $sort: { totalXp: -1 } },
    ]),
    GameAnswer.aggregate([
      { $match: { studentId: { $in: studentIds }, isCorrect: false } },
      { $group: { _id: '$questionId', misses: { $sum: 1 } } },
      { $sort: { misses: -1 } },
      { $limit: 10 },
    ]),
  ]);

  return { classroom: room, memberCount: members.length, rankings: attempts, weakestQuestions: weakAnswers };
}

module.exports = {
  createClassroom,
  joinByCode,
  listTeacherClassrooms,
  listStudentClassrooms,
  assignGame,
  getClassroomAnalytics,
};
