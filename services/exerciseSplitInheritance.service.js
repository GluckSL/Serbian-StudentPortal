/**
 * Resolves student completion for exercises created via "split selected questions"
 * from a source exercise, using completed attempts on the source.
 */

const ExerciseAttempt = require('../models/ExerciseAttempt');
const DigitalExercise = require('../models/DigitalExercise');

const PASS_SCORE_PERCENT = 40;

function questionTotalPoints(q) {
  const subs = Array.isArray(q?.subQuestions) ? q.subQuestions : [];
  const subPts = subs.reduce((sum, sq) => sum + (sq?.points || 1), 0);
  return (q?.points || 1) + subPts;
}

function exerciseTotalPoints(questions) {
  return (questions || []).reduce((sum, q) => sum + questionTotalPoints(q), 0);
}

/**
 * @param {object} exercise — lean or mongoose doc with splitLineage
 * @returns {number[]|null}
 */
function getSourceIndices(exercise) {
  const lineage = exercise?.splitLineage;
  const sources = lineage?.questionSources;
  if (!lineage?.sourceExerciseId || !Array.isArray(sources) || !sources.length) {
    return null;
  }
  return sources.map((s) => Number(s.sourceQuestionIndex));
}

/**
 * Build splitLineage for a full v1→v2 copy so v1 completions inherit on the v2 exercise.
 * @param {object} sourceExercise — lean v1 exercise with _id and questions
 * @returns {object|undefined}
 */
function buildFullCopySplitLineage(sourceExercise) {
  const sourceId = sourceExercise?._id;
  const questions = Array.isArray(sourceExercise?.questions) ? sourceExercise.questions : [];
  if (!sourceId || !questions.length) return undefined;

  const questionSources = questions.map((q, i) => ({
    sourceQuestionIndex: i,
    ...(q?._id ? { sourceQuestionId: q._id } : {}),
  }));

  return {
    sourceExerciseId: sourceId,
    questionSources,
  };
}

function responseByIndex(responses, index) {
  const idx = Number(index);
  if (!Array.isArray(responses)) return null;
  return responses.find((r) => Number(r.questionIndex) === idx) || null;
}

function hasNonEmptyString(v) {
  return String(v ?? '').trim().length > 0;
}

/**
 * Whether a stored response counts as "attempted" for inheritance (per question type).
 * @param {object} q — question definition from the split exercise (B)
 * @param {object|null} resp — response from source attempt at sourceQuestionIndex
 */
function hasResponseForQuestion(q, resp) {
  if (!resp || !q) return false;

  switch (q.type) {
    case 'mcq':
      return resp.selectedOptionIndex != null && Number.isFinite(Number(resp.selectedOptionIndex));
    case 'matching':
      return Array.isArray(resp.matchingResponse) && resp.matchingResponse.length > 0;
    case 'fill-blank':
      return Array.isArray(resp.fillBlankResponses) && resp.fillBlankResponses.some(hasNonEmptyString);
    case 'word_bank_fill':
      return Array.isArray(resp.wordBankAnswers) && resp.wordBankAnswers.some(
        (e) => hasNonEmptyString(e?.value)
      );
    case 'pronunciation':
    case 'video-pronunciation':
      return hasNonEmptyString(resp.spokenText) || (resp.pronunciationScore != null && Number.isFinite(Number(resp.pronunciationScore)));
    case 'question-answer':
      return hasNonEmptyString(resp.qaResponse);
    case 'listening':
      return hasNonEmptyString(resp.listeningText);
    case 'singular_plural':
      return Array.isArray(resp.singularPluralResponses) && resp.singularPluralResponses.some(hasNonEmptyString);
    case 'jumble-word':
      return hasNonEmptyString(resp.jumbleWordResponse);
    case 'rearrange':
      return hasNonEmptyString(resp.rearrangeTextResponse)
        || (Array.isArray(resp.rearrangeTokensResponse) && resp.rearrangeTokensResponse.some(hasNonEmptyString));
    case 'image_pin_match':
      return Array.isArray(resp.imagePinAnswers) && resp.imagePinAnswers.length > 0;
    default:
      return resp.isCorrect != null
        || (resp.pointsEarned != null && Number(resp.pointsEarned) > 0)
        || hasNonEmptyString(resp.qaResponse)
        || hasNonEmptyString(resp.listeningText);
  }
}

/**
 * Score split exercise from mapped source responses (uses stored pointsEarned when present).
 */
function scoreFromMappedResponses(exercise, sourceAttempt) {
  const sources = exercise.splitLineage.questionSources;
  const responses = sourceAttempt.responses || [];
  let earnedPoints = 0;
  let correctCount = 0;
  let wrongCount = 0;

  for (let i = 0; i < sources.length; i++) {
    const srcIdx = Number(sources[i].sourceQuestionIndex);
    const q = exercise.questions[i];
    if (!q) continue;
    const resp = responseByIndex(responses, srcIdx);
    const maxPts = questionTotalPoints(q);
    const pts = resp != null && resp.pointsEarned != null
      ? Math.max(0, Math.min(maxPts, Number(resp.pointsEarned) || 0))
      : 0;
    earnedPoints += pts;
    if (resp?.isCorrect) correctCount += 1;
    else wrongCount += 1;
  }

  const totalPoints = exerciseTotalPoints(exercise.questions);
  const scorePercentage = totalPoints > 0
    ? Math.round((earnedPoints / totalPoints) * 100)
    : 0;

  return {
    earnedPoints,
    totalPoints,
    scorePercentage,
    correctCount,
    wrongCount,
    totalQuestions: sources.length
  };
}

/**
 * @param {string|import('mongoose').Types.ObjectId} studentId
 * @param {object} exercise — lean exercise with questions + splitLineage
 * @param {object|null} [sourceAttempt] — optional preloaded best completed attempt on source
 * @returns {Promise<object|null>} synthetic studentAttempt summary or null
 */
async function resolveInheritedAttempt(studentId, exercise, sourceAttempt = undefined) {
  const sourceIndices = getSourceIndices(exercise);
  if (!sourceIndices) return null;

  const sourceId = exercise.splitLineage.sourceExerciseId;
  let attempt = sourceAttempt;
  if (!attempt) {
    attempt = await ExerciseAttempt.findOne({
      studentId,
      exerciseId: sourceId,
      status: 'completed'
    })
      .sort({ scorePercentage: -1, completedAt: -1, attemptNumber: -1, _id: -1 })
      .lean();
  }

  if (!attempt || attempt.status !== 'completed') return null;

  const responses = attempt.responses || [];
  const questions = exercise.questions || [];

  for (let i = 0; i < sourceIndices.length; i++) {
    const srcIdx = sourceIndices[i];
    const q = questions[i];
    const resp = responseByIndex(responses, srcIdx);
    if (!hasResponseForQuestion(q, resp)) {
      return null;
    }
  }

  const scored = scoreFromMappedResponses(exercise, attempt);

  return {
    _id: null,
    exerciseId: exercise._id,
    scorePercentage: scored.scorePercentage,
    completedAt: attempt.completedAt || attempt.updatedAt || new Date(),
    attemptNumber: attempt.attemptNumber || 1,
    timeSpentSeconds: Number(attempt.timeSpentSeconds) || 0,
    wrongCount: scored.wrongCount,
    correctCount: scored.correctCount,
    totalQuestions: scored.totalQuestions,
    inheritedFromSource: true,
    sourceExerciseId: sourceId,
    sourceAttemptId: attempt._id
  };
}

function isInheritedPassing(synthetic) {
  return synthetic != null && Number(synthetic.scorePercentage) >= PASS_SCORE_PERCENT;
}

/**
 * Attach synthetic studentAttempt on list/detail payloads when no direct attempt exists.
 * @param {string|import('mongoose').Types.ObjectId} studentId
 * @param {object[]} exercises — mutates items in place
 */
async function attachInheritedAttemptsForStudent(studentId, exercises) {
  const candidates = (exercises || []).filter(
    (ex) => ex?.splitLineage?.sourceExerciseId && !ex.studentAttempt
  );
  if (!candidates.length) return;

  const missingQuestionIds = candidates
    .filter((ex) => !Array.isArray(ex.questions) || !ex.questions.length)
    .map((ex) => ex._id)
    .filter(Boolean);
  if (missingQuestionIds.length) {
    const questionRows = await DigitalExercise.find({ _id: { $in: missingQuestionIds } })
      .select('questions.type questions.points questions.subQuestions.points')
      .lean();
    const questionsByExercise = new Map(questionRows.map((row) => [String(row._id), row.questions || []]));
    candidates.forEach((ex) => {
      if (Array.isArray(ex.questions) && ex.questions.length) return;
      ex.questions = questionsByExercise.get(String(ex._id)) || [];
    });
  }

  const sourceIds = [
    ...new Set(candidates.map((ex) => String(ex.splitLineage.sourceExerciseId)))
  ];

  const attempts = await ExerciseAttempt.find({
    studentId,
    exerciseId: { $in: sourceIds },
    status: 'completed'
  })
    .sort({ scorePercentage: -1, completedAt: -1, attemptNumber: -1, _id: -1 })
    .lean();

  const bestBySource = new Map();
  for (const att of attempts) {
    const key = String(att.exerciseId);
    if (!bestBySource.has(key)) bestBySource.set(key, att);
  }

  await Promise.all(
    candidates.map(async (ex) => {
      const srcKey = String(ex.splitLineage.sourceExerciseId);
      const srcAttempt = bestBySource.get(srcKey);
      if (!srcAttempt) return;
      const synthetic = await resolveInheritedAttempt(studentId, ex, srcAttempt);
      if (synthetic) ex.studentAttempt = synthetic;
    })
  );
}

/**
 * Whether a student has passed an exercise (direct attempt or inherited).
 */
async function studentHasPassedExercise(studentId, exercise) {
  const direct = await ExerciseAttempt.findOne({
    studentId,
    exerciseId: exercise._id,
    status: 'completed',
    scorePercentage: { $gte: PASS_SCORE_PERCENT }
  })
    .select('_id')
    .lean();
  if (direct) return true;

  const inherited = await resolveInheritedAttempt(studentId, exercise);
  return isInheritedPassing(inherited);
}

module.exports = {
  PASS_SCORE_PERCENT,
  getSourceIndices,
  buildFullCopySplitLineage,
  hasResponseForQuestion,
  resolveInheritedAttempt,
  attachInheritedAttemptsForStudent,
  studentHasPassedExercise,
  isInheritedPassing,
  questionTotalPoints,
  exerciseTotalPoints,
  scoreFromMappedResponses
};
