// services/interactiveGames/adaptiveLearning.js — personalized learning paths

const StudentLearningProfile = require('../../models/StudentLearningProfile');
const GameAnswer = require('../../models/GameAnswer');
const GameQuestion = require('../../models/GameQuestion');
const GameSet = require('../../models/GameSet');
const GameAttempt = require('../../models/GameAttempt');

async function analyzeStudent(studentId) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const wrongAnswers = await GameAnswer.find({
    studentId,
    isCorrect: false,
    submittedAt: { $gte: since },
  }).limit(200).populate('questionId').lean();

  const vocabMap = new Map();
  const grammarMap = new Map();

  for (const a of wrongAnswers) {
    const q = a.questionId;
    if (!q) continue;
    if (q.word) {
      const k = q.word.toUpperCase();
      vocabMap.set(k, (vocabMap.get(k) || 0) + 1);
    }
    if (q.correctSentence) {
      const k = q.correctSentence.slice(0, 40);
      grammarMap.set(k, (grammarMap.get(k) || 0) + 1);
    }
  }

  const weakVocabulary = [...vocabMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([key, errorCount]) => ({ key, label: key, errorCount }));

  const weakGrammar = [...grammarMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, errorCount]) => ({ key, label: key, errorCount }));

  const totalAnswers = await GameAnswer.countDocuments({ studentId, submittedAt: { $gte: since } });
  const correct = await GameAnswer.countDocuments({ studentId, isCorrect: true, submittedAt: { $gte: since } });
  const masteryScore = totalAnswers ? Math.round((correct / totalAnswers) * 100) : 0;

  const recentAttempts = await GameAttempt.countDocuments({
    studentId,
    startedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  });
  let retentionRisk = 'low';
  if (recentAttempts === 0) retentionRisk = 'high';
  else if (recentAttempts < 3) retentionRisk = 'medium';

  const recommended = await GameSet.find({
    isPublished: true,
    visibleToStudents: true,
    isArchived: false,
  }).sort({ updatedAt: -1 }).limit(5).select('_id title gameType').lean();

  const profile = await StudentLearningProfile.findOneAndUpdate(
    { studentId },
    {
      $set: {
        weakVocabulary,
        weakGrammar,
        masteryScore,
        retentionRisk,
        recommendedGameSetIds: recommended.map(r => r._id),
        lastAnalyzedAt: new Date(),
      },
    },
    { upsert: true, new: true }
  ).lean();

  return {
    profile,
    weakVocabulary,
    weakGrammar,
    masteryScore,
    retentionRisk,
    recommendations: recommended,
    spacedRepetitionDue: profile.spacedRepetitionDue || [],
  };
}

async function getStudentInsights(studentId) {
  let profile = await StudentLearningProfile.findOne({ studentId }).lean();
  if (!profile || !profile.lastAnalyzedAt || Date.now() - new Date(profile.lastAnalyzedAt).getTime() > 6 * 60 * 60 * 1000) {
    return analyzeStudent(studentId);
  }
  const recommendations = await GameSet.find({ _id: { $in: profile.recommendedGameSetIds || [] } })
    .select('title gameType icon xpReward').lean();
  return { profile, recommendations, weakVocabulary: profile.weakVocabulary, weakGrammar: profile.weakGrammar };
}

async function getClassroomAdaptiveInsights(studentIds) {
  const profiles = await StudentLearningProfile.find({ studentId: { $in: studentIds } }).lean();
  const struggling = profiles.filter(p => p.retentionRisk === 'high' || p.masteryScore < 50);
  return { strugglingCount: struggling.length, struggling };
}

module.exports = { analyzeStudent, getStudentInsights, getClassroomAdaptiveInsights };
