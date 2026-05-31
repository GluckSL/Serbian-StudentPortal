// services/interactiveGames/teacherAnalytics.js

const mongoose = require('mongoose');
const User = require('../../models/User');
const GameAnswer = require('../../models/GameAnswer');
const GameAttempt = require('../../models/GameAttempt');
const GameQuestion = require('../../models/GameQuestion');
const { getJourneyAccessForStudent } = require('../../utils/studentJourneyAccess');

async function getTeacherDashboard(query = {}) {
  const { batch, courseDay, dateFrom, dateTo } = query;
  const from = dateFrom ? new Date(dateFrom) : new Date(Date.now() - 30 * 86400000);
  const to = dateTo ? new Date(dateTo) : new Date();
  to.setUTCHours(23, 59, 59, 999);

  const studentFilter = { role: 'STUDENT' };
  if (batch) studentFilter.batch = batch;

  const students = await User.find(studentFilter).select('_id name batch currentCourseDay').lean();
  const studentIds = students.map(s => s._id);

  const attemptMatch = {
    studentId: { $in: studentIds },
    createdAt: { $gte: from, $lte: to },
  };
  if (courseDay) attemptMatch['$expr'] = { $lte: ['$currentLevel', Number(courseDay)] };

  const [classRankings, struggling, accuracyByDay, weakWords, weakSentences] = await Promise.all([
    GameAttempt.aggregate([
      { $match: { ...attemptMatch, status: 'completed' } },
      { $group: { _id: '$studentId', avgAccuracy: { $avg: '$accuracy' }, games: { $sum: 1 }, totalScore: { $sum: '$score' } } },
      { $sort: { avgAccuracy: -1 } },
      { $limit: 30 },
    ]),
    GameAttempt.aggregate([
      { $match: { ...attemptMatch, status: { $in: ['abandoned', 'in-progress'] } } },
      { $group: { _id: '$studentId', abandonCount: { $sum: 1 } } },
      { $sort: { abandonCount: -1 } },
      { $limit: 15 },
    ]),
    GameAttempt.aggregate([
      { $match: { ...attemptMatch, status: 'completed' } },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student',
        },
      },
      { $unwind: '$student' },
      {
        $group: {
          _id: '$student.currentCourseDay',
          avgAccuracy: { $avg: '$accuracy' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    GameAnswer.aggregate([
      { $match: { studentId: { $in: studentIds }, submittedAt: { $gte: from, $lte: to }, isCorrect: false } },
      { $lookup: { from: 'gamequestions', localField: 'questionId', foreignField: '_id', as: 'q' } },
      { $unwind: '$q' },
      { $match: { 'q.word': { $exists: true, $ne: '' } } },
      { $group: { _id: '$q.word', misses: { $sum: 1 } } },
      { $sort: { misses: -1 } },
      { $limit: 15 },
    ]),
    GameAnswer.aggregate([
      { $match: { studentId: { $in: studentIds }, submittedAt: { $gte: from, $lte: to }, isCorrect: false } },
      { $lookup: { from: 'gamequestions', localField: 'questionId', foreignField: '_id', as: 'q' } },
      { $unwind: '$q' },
      { $match: { 'q.correctSentence': { $exists: true, $ne: '' } } },
      { $group: { _id: '$q.correctSentence', misses: { $sum: 1 } } },
      { $sort: { misses: -1 } },
      { $limit: 15 },
    ]),
  ]);

  const nameMap = new Map(students.map(s => [String(s._id), s.name]));

  return {
    dateRange: { from, to },
    classRankings: classRankings.map((r, i) => ({
      rank: i + 1,
      studentId: r._id,
      name: nameMap.get(String(r._id)) || 'Student',
      avgAccuracy: Math.round(r.avgAccuracy || 0),
      gamesCompleted: r.games,
      totalScore: r.totalScore,
    })),
    strugglingStudents: struggling.map(s => ({
      studentId: s._id,
      name: nameMap.get(String(s._id)) || 'Student',
      abandonCount: s.abandonCount,
    })),
    accuracyByCourseDay: accuracyByDay.map(d => ({
      courseDay: d._id,
      avgAccuracy: Math.round(d.avgAccuracy || 0),
      attempts: d.count,
    })),
    weakestVocabulary: weakWords.map(w => ({ word: w._id, misses: w.misses })),
    weakestSentences: weakSentences.map(w => ({ sentence: w._id, misses: w.misses })),
  };
}

module.exports = { getTeacherDashboard };
