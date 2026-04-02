// routes/digitalExercises.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const DigitalExercise = require('../models/DigitalExercise');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');
const OpenAI = require('openai');

/** Fields the admin/teacher client may send on PUT; avoids stripping nested arrays or applying unsafe full-document spreads. */
const DIGITAL_EXERCISE_ASSIGNABLE_KEYS = [
  'title',
  'description',
  'targetLanguage',
  'nativeLanguage',
  'level',
  'category',
  'difficulty',
  'estimatedDuration',
  'questions',
  'sharedAudioUrl',
  'videoSuccessFeedback',
  'videoRetryFeedback',
  'tags',
  'courseDay',
  'visibleToStudents'
];

// ─── AI answer grader ─────────────────────────────────────────────────────────
// Returns { score: 0-100 } representing how correct the student's answer is.
async function aiGradeAnswer(question, sampleAnswers, studentAnswer) {
  if (!studentAnswer || !studentAnswer.trim()) return { score: 0 };

  if (!process.env.OPENAI_API_KEY) {
    // Fallback: rough word-overlap heuristic
    const words = studentAnswer.trim().toLowerCase().split(/\s+/).filter(w => w.length > 1);
    return { score: words.length >= 4 ? 75 : words.length >= 2 ? 50 : 20 };
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const context = sampleAnswers && sampleAnswers.length > 0
    ? `Question: "${question}"\nCorrect answer(s): ${sampleAnswers.map(s => `"${s}"`).join(' | ')}\n\nJudge whether the student's answer matches the correct meaning, even if it is shorter or uses different wording.`
    : `Question: "${question}"\n\nJudge whether the student's answer correctly answers the question, even if it is a short or informal response.`;

  const systemPrompt = `You are a teacher grading a student's short answer.
Focus ONLY on whether the student's answer conveys the correct meaning or key fact — NOT on sentence completeness, grammar, or word count.
A short answer like "jupiter" is fully correct if the question asks which planet is biggest and the accepted answer mentions jupiter.
Score 0–100:
  100 = correct meaning/fact, even if brief
  70  = mostly correct, minor misunderstanding
  50  = partially correct
  0   = wrong or blank
Reply with ONLY this JSON: {"score": <number 0-100>}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${context}\n\nStudent's answer: "${studentAnswer}"` }
      ],
      max_tokens: 30,
      temperature: 0
    });

    const raw = (completion.choices[0].message.content || '').trim();
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const result = JSON.parse(cleaned);
    const score = Math.max(0, Math.min(100, parseInt(result.score) || 0));
    return { score };
  } catch (err) {
    console.error('AI grading error:', err.message);
    const words = studentAnswer.trim().split(/\s+/).filter(w => w.length > 1);
    return { score: words.length >= 4 ? 75 : words.length >= 2 ? 50 : 20 };
  }
}

// ─── HELPER ──────────────────────────────────────────────────────────────────

function normalizeListeningAnswer(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function parseTrueFalse(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  // Accept values from UI, admin selection, and worksheet generator.
  if (/\b(true|richtig|wahr|ja|yes)\b/.test(s)) return true;
  if (/\b(false|falsch|unwahr|nein|no|incorrect)\b/.test(s)) return false;
  return null;
}

function getAccessibleLevels(studentLevel) {
  const levelOrder = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const idx = levelOrder.indexOf(studentLevel);
  if (idx === -1) return ['A1'];
  return levelOrder.slice(0, idx + 1);
}

/**
 * One DB read: journey day + allowed CEFR levels for digital exercises.
 * Non-students get full ladder (unused for filtering in those routes).
 */
async function getStudentExerciseAccess(userId) {
  const u = await User.findById(userId).select('currentCourseDay role level').lean();
  if (!u || u.role !== 'STUDENT') {
    return {
      courseDay: 1,
      accessibleLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
      studentLevel: null
    };
  }
  const d = u.currentCourseDay;
  const courseDay = (d == null || !Number.isFinite(Number(d)))
    ? 1
    : Math.min(200, Math.max(1, Math.floor(Number(d))));
  const studentLevel = u.level || 'A1';
  const accessibleLevels = getAccessibleLevels(studentLevel);
  return { courseDay, accessibleLevels, studentLevel };
}

function exerciseLevelAllowedForStudent(exerciseLevel, accessibleLevels) {
  if (!exerciseLevel || !accessibleLevels?.length) return false;
  return accessibleLevels.includes(exerciseLevel);
}

/** Students: exercise has no day lock, or lock is satisfied. */
function exerciseUnlockedForStudentDay(exercise, studentDay) {
  const cd = exercise.courseDay;
  if (cd == null || cd === undefined) return true;
  const n = Number(cd);
  if (!Number.isFinite(n)) return true;
  return n <= studentDay;
}

// ─── PUBLIC (STUDENT/TEACHER/ADMIN) ROUTES ───────────────────────────────────

// GET /api/digital-exercises  — Browse exercises
router.get('/', verifyToken, async (req, res) => {
  try {
    const {
      level, category, difficulty, targetLanguage, search,
      page = 1, limit = 12
    } = req.query;

    const andClauses = [
      { isActive: true },
      { isDeleted: { $ne: true } }
    ];

    let studentExerciseAccess = null;
    if (req.user.role === 'STUDENT') {
      andClauses.push({ visibleToStudents: true });
      studentExerciseAccess = await getStudentExerciseAccess(req.user.id);
      const studentCourseDay = studentExerciseAccess.courseDay;
      const todayOnly = String(req.query.todayOnly) === 'true' || String(req.query.todayOnly) === '1';
      if (todayOnly) {
        andClauses.push({ courseDay: studentCourseDay });
      } else {
        andClauses.push({
          $or: [
            { courseDay: null },
            { courseDay: { $exists: false } },
            { courseDay: { $lte: studentCourseDay } }
          ]
        });
      }
      andClauses.push({ level: { $in: studentExerciseAccess.accessibleLevels } });
    }

    // Only filter by level when user explicitly selects one (e.g. B1); ignore empty / "All Levels"
    // Students cannot request a level above their profile (server still applies $in accessibleLevels)
    const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    if (level && typeof level === 'string' && validLevels.includes(level.trim())) {
      const want = level.trim();
      if (req.user.role === 'STUDENT') {
        if (studentExerciseAccess && studentExerciseAccess.accessibleLevels.includes(want)) {
          andClauses.push({ level: want });
        }
      } else {
        andClauses.push({ level: want });
      }
    }
    if (category) andClauses.push({ category });
    if (difficulty) andClauses.push({ difficulty });
    if (targetLanguage) andClauses.push({ targetLanguage });
    if (search) {
      andClauses.push({
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ]
      });
    }

    const filter = { $and: andClauses };

    const total = await DigitalExercise.countDocuments(filter);
    const exercises = await DigitalExercise.find(filter)
      .populate('createdBy', 'name email')
      .select('-questions.correctAnswerIndex -questions.answers -questions.pairs') // hide answers for student browsing
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // For students: attach attempt summary
    if (req.user.role === 'STUDENT') {
      const exerciseIds = exercises.map(e => e._id);
      const attempts = await ExerciseAttempt.find({
        studentId: req.user.id,
        exerciseId: { $in: exerciseIds },
        status: 'completed'
      }).select('exerciseId scorePercentage completedAt attemptNumber').lean();

      const attemptMap = {};
      attempts.forEach(a => {
        const key = a.exerciseId.toString();
        if (!attemptMap[key] || a.scorePercentage > attemptMap[key].scorePercentage) {
          attemptMap[key] = a;
        }
      });

      exercises.forEach(ex => {
        ex.studentAttempt = attemptMap[ex._id.toString()] || null;
      });
    }

    const payload = {
      exercises,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit))
    };
    if (req.user.role === 'STUDENT' && studentExerciseAccess) {
      payload.studentCourseDay = studentExerciseAccess.courseDay;
      payload.studentLevel = studentExerciseAccess.studentLevel;
      payload.accessibleLevels = studentExerciseAccess.accessibleLevels;
    }
    res.json(payload);
  } catch (err) {
    console.error('GET /digital-exercises error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digital-exercises/:id  — Get full exercise (with answers for non-students, or for playing)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const exercise = await DigitalExercise.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).populate('createdBy', 'name email').lean();

    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    // Students can only see published exercises
    if (req.user.role === 'STUDENT' && !exercise.visibleToStudents) {
      return res.status(403).json({ error: 'Exercise not available' });
    }

    // "Student view" used by the player UI: it strips correct answers and
    // shuffles matching right options so the exercise feels like it does for
    // real students (even when staff are testing).
    const studentView = req.user.role === 'STUDENT' || String(req.query.asStudent) === 'true';

    if (req.user.role === 'STUDENT') {
      const access = await getStudentExerciseAccess(req.user.id);
      if (!exerciseUnlockedForStudentDay(exercise, access.courseDay)) {
        return res.status(403).json({
          error: 'This exercise unlocks on a later day of your course.',
          code: 'COURSE_DAY_LOCKED',
          studentCourseDay: access.courseDay,
          exerciseCourseDay: exercise.courseDay
        });
      }
      if (!exerciseLevelAllowedForStudent(exercise.level, access.accessibleLevels)) {
        return res.status(403).json({
          error: 'This exercise is above your current language level.',
          code: 'LEVEL_NOT_ALLOWED',
          studentLevel: access.studentLevel,
          exerciseLevel: exercise.level
        });
      }
    }

    // For student view (real students + staff testing), keep answers but strip
    // correct indices. (Client will verify against server on submit.)
    if (studentView) {
      exercise.questions = exercise.questions.map(q => {
        const stripped = { ...q };
        delete stripped.correctAnswerIndex;
        delete stripped.answers;
        // For matching, shuffle the right column
        if (q.type === 'matching' && q.pairs) {
          stripped.shuffledRight = [...q.pairs.map(p => p.right)].sort(() => Math.random() - 0.5);
          stripped.pairs = q.pairs.map(p => ({ left: p.left }));
        }
        return stripped;
      });
    }

    // Attach student's best attempt if student
    if (req.user.role === 'STUDENT') {
      const bestAttempt = await ExerciseAttempt.findOne({
        studentId: req.user.id,
        exerciseId: exercise._id,
        status: 'completed'
      }).sort({ scorePercentage: -1 }).lean();
      exercise.studentAttempt = bestAttempt;
    }

    res.json(exercise);
  } catch (err) {
    console.error('GET /digital-exercises/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── TEACHER/ADMIN MANAGEMENT ROUTES ─────────────────────────────────────────

// GET /api/digital-exercises/admin/all  — Admin list with full details
router.get('/admin/all', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { page = 1, limit = 20, status, level, category, search, courseDay } = req.query;
    const adminAnd = [{ isDeleted: { $ne: true } }];

    if (status === 'active') adminAnd.push({ isActive: true });
    else if (status === 'inactive') adminAnd.push({ isActive: false });
    if (level) adminAnd.push({ level });
    if (category) adminAnd.push({ category });

    const cdRaw = courseDay !== undefined && courseDay !== null ? String(courseDay) : '';
    if (cdRaw === 'unassigned') {
      adminAnd.push({ $or: [{ courseDay: null }, { courseDay: { $exists: false } }] });
    } else if (cdRaw && cdRaw !== 'all') {
      const d = parseInt(cdRaw, 10);
      if (Number.isFinite(d) && d >= 1 && d <= 200) adminAnd.push({ courseDay: d });
    }

    if (search) {
      adminAnd.push({
        $or: [
          { title: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } }
        ]
      });
    }

    // Teachers only see their own exercises (unless ADMIN/TEACHER_ADMIN)
    if (req.user.role === 'TEACHER') {
      adminAnd.push({ createdBy: req.user.id });
    }

    const filter = { $and: adminAnd };

    const total = await DigitalExercise.countDocuments(filter);
    const exercises = await DigitalExercise.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // Attach attempt counts
    const exerciseIds = exercises.map(e => e._id);
    const attemptCounts = await ExerciseAttempt.aggregate([
      { $match: { exerciseId: { $in: exerciseIds }, status: 'completed' } },
      { $group: { _id: '$exerciseId', count: { $sum: 1 }, avgScore: { $avg: '$scorePercentage' }, uniqueStudents: { $addToSet: '$studentId' } } }
    ]);

    const statsMap = {};
    attemptCounts.forEach(a => {
      statsMap[a._id.toString()] = {
        completions: a.count,
        avgScore: Math.round(a.avgScore),
        uniqueStudents: a.uniqueStudents.length
      };
    });

    exercises.forEach(ex => {
      ex.stats = statsMap[ex._id.toString()] || { completions: 0, avgScore: 0, uniqueStudents: 0 };
    });

    res.json({ exercises, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('GET /digital-exercises/admin/all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/digital-exercises  — Create exercise
router.post('/', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exerciseData = {
      ...req.body,
      createdBy: req.user.id
    };
    const exercise = new DigitalExercise(exerciseData);
    await exercise.save();
    res.status(201).json(exercise);
  } catch (err) {
    console.error('POST /digital-exercises error:', err);
    res.status(400).json({ error: err.message });
  }
});

// PATCH /api/digital-exercises/:id/visibility  — Toggle student visibility (must be before PUT /:id)
router.patch('/:id/visibility', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const visibleToStudents = req.body.visibleToStudents === true || String(req.body.visibleToStudents) === 'true';
    const update = {
      visibleToStudents,
      updatedAt: new Date()
    };
    if (visibleToStudents) {
      const current = await DigitalExercise.findById(req.params.id).select('publishedAt').lean();
      if (current && !current.publishedAt) update.publishedAt = new Date();
    }
    const exercise = await DigitalExercise.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true, runValidators: false }
    );
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });
    res.json({ success: true, visibleToStudents: exercise.visibleToStudents });
  } catch (err) {
    console.error('PATCH /digital-exercises/:id/visibility error:', err);
    res.status(500).json({ error: err.message || 'Failed to update visibility' });
  }
});

// PATCH /api/digital-exercises/:id/toggle-active  — Toggle active state (must be before PUT /:id)
router.patch('/:id/toggle-active', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findById(req.params.id);
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });
    exercise.isActive = !exercise.isActive;
    await exercise.save();
    res.json({ success: true, isActive: exercise.isActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/digital-exercises/:id  — Update exercise
router.put('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findById(req.params.id);
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    // Teachers can only edit their own exercises
    if (req.user.role === 'TEACHER' && exercise.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to edit this exercise' });
    }

    for (const key of DIGITAL_EXERCISE_ASSIGNABLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        exercise[key] = req.body[key];
      }
    }
    exercise.lastUpdatedBy = req.user.id;
    exercise.updatedAt = new Date();

    await exercise.save();
    const updated = await DigitalExercise.findById(exercise._id).populate('createdBy', 'name email');

    res.json(updated);
  } catch (err) {
    console.error('PUT /digital-exercises/:id error:', err);
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/digital-exercises/:id  — Soft delete
router.delete('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findByIdAndUpdate(
      req.params.id,
      { isDeleted: true, deletedAt: new Date(), isActive: false },
      { new: true }
    );
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });
    res.json({ success: true, message: 'Exercise deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STUDENT ATTEMPT ROUTES ───────────────────────────────────────────────────

// POST /api/digital-exercises/:id/start  — Start a new attempt (students + admin/teacher for testing)
router.post('/:id/start', verifyToken, checkRole(['STUDENT', 'ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const isStaff = ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'].includes(req.user.role);
    const exercise = await DigitalExercise.findOne({
      _id: req.params.id,
      isActive: true,
      ...(isStaff ? {} : { visibleToStudents: true }),
      isDeleted: { $ne: true }
    });
    if (!exercise) return res.status(404).json({ error: 'Exercise not found or not available' });

    if (!isStaff) {
      const access = await getStudentExerciseAccess(req.user.id);
      if (!exerciseUnlockedForStudentDay(exercise, access.courseDay)) {
        return res.status(403).json({
          error: 'This exercise unlocks on a later day of your course.',
          code: 'COURSE_DAY_LOCKED'
        });
      }
      if (!exerciseLevelAllowedForStudent(exercise.level, access.accessibleLevels)) {
        return res.status(403).json({
          error: 'This exercise is above your current language level.',
          code: 'LEVEL_NOT_ALLOWED'
        });
      }
    }

    // Count previous attempts
    const prevAttempts = await ExerciseAttempt.countDocuments({
      studentId: req.user.id,
      exerciseId: req.params.id
    });

    const attempt = new ExerciseAttempt({
      studentId: req.user.id,
      exerciseId: req.params.id,
      attemptNumber: prevAttempts + 1,
      totalPoints: exercise.questions.reduce((sum, q) => sum + (q.points || 1), 0)
    });
    await attempt.save();

    // Update exercise attempt count
    await DigitalExercise.findByIdAndUpdate(req.params.id, { $inc: { totalAttempts: 1 } });

    res.status(201).json({ attemptId: attempt._id, attemptNumber: attempt.attemptNumber });
  } catch (err) {
    console.error('POST /digital-exercises/:id/start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/digital-exercises/:id/submit-question  — Submit a single question (per-question feedback)
router.post('/:id/submit-question', verifyToken, checkRole(['STUDENT', 'ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { attemptId, questionIndex, response, timeSpentSeconds } = req.body;

    const exercise = await DigitalExercise.findById(req.params.id).lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    const attempt = await ExerciseAttempt.findOne({
      _id: attemptId,
      studentId: req.user.id,
      exerciseId: req.params.id
    });
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
    if (attempt.status === 'completed') return res.status(400).json({ error: 'Attempt already submitted' });

    const idx = parseInt(questionIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= exercise.questions.length) {
      return res.status(400).json({ error: 'Invalid question index' });
    }

    const q = exercise.questions[idx];
    const resp = response || { questionIndex: idx };
    let isCorrect = false;
    let pointsEarned = 0;
    let correctAnswer = null;

    if (q.type === 'mcq') {
      const correctIdx = typeof q.correctAnswerIndex === 'number' ? q.correctAnswerIndex : 0;
      isCorrect = resp.selectedOptionIndex === correctIdx;
      correctAnswer = { correctAnswerIndex: correctIdx, explanation: q.explanation };
    } else if (q.type === 'matching') {
      const pairs = q.pairs || [];
      if (resp.matchingResponse && resp.matchingResponse.length === pairs.length) {
        let allCorrect = true;
        for (const match of resp.matchingResponse) {
          const expectedRight = pairs[match.leftIndex]?.right;
          const givenRight = match.rightValue != null ? match.rightValue : pairs[match.rightIndex]?.right;
          if (expectedRight === undefined || givenRight === undefined || String(expectedRight) !== String(givenRight)) {
            allCorrect = false;
            break;
          }
        }
        isCorrect = allCorrect;
      }
      correctAnswer = { pairs: pairs.map((p, i) => ({ leftIndex: i, rightValue: p.right })) };
    } else if (q.type === 'fill-blank') {
      const answers = q.answers || [];
      if (resp.fillBlankResponses && resp.fillBlankResponses.length === answers.length) {
        isCorrect = resp.fillBlankResponses.every((ans, i) => {
          const correct = answers[i];
          return q.caseSensitive
            ? ans.trim() === correct.trim()
            : ans.trim().toLowerCase() === correct.trim().toLowerCase();
        });
      }
      correctAnswer = { answers };
    } else if (q.type === 'pronunciation') {
      const score = resp.pronunciationScore || 0;
      isCorrect = score >= 70;
      pointsEarned = isCorrect ? q.points : Math.round(q.points * score / 100);
      correctAnswer = { word: q.word, phonetic: q.phonetic, acceptedVariants: q.acceptedVariants };
    } else if (q.type === 'video-pronunciation') {
      const score = resp.pronunciationScore || 0;
      isCorrect = score >= 70;
      pointsEarned = isCorrect ? q.points : Math.round(q.points * score / 100);
      correctAnswer = { caption: q.caption, acceptedVariants: q.acceptedVariants };
    } else if (q.type === 'question-answer') {
      const studentAns = (resp.qaResponse || '').trim();

      const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
      const expectedRaw = samples.find(s => parseTrueFalse(s) !== null) ?? null;
      const isTrueFalse = q.worksheetKind === 'true-false' || expectedRaw !== null;

      if (isTrueFalse) {
        const expected = parseTrueFalse(expectedRaw);
        const given = parseTrueFalse(studentAns);
        isCorrect = expected !== null && given !== null && given === expected;
        pointsEarned = isCorrect ? (q.points || 1) : 0;
        correctAnswer = { sampleAnswers: Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [] };
      } else if (studentAns) {
        const aiResult = await aiGradeAnswer(q.prompt || '', Array.isArray(q.sampleAnswers) ? q.sampleAnswers.filter(Boolean) : [], studentAns);
        const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers.filter(Boolean) : [];
        const threshold = typeof q.similarityThreshold === 'number' ? q.similarityThreshold : 70;
        const scoringMode = q.scoringMode || 'full';
        const { score } = aiResult;
        isCorrect = score >= threshold;
        pointsEarned = scoringMode === 'proportional'
          ? parseFloat(((score / 100) * (q.points || 1)).toFixed(2))
          : (isCorrect ? (q.points || 1) : 0);
        correctAnswer = { sampleAnswers: samples, threshold, scoringMode };
      }
    } else if (q.type === 'listening') {
      const studentText = normalizeListeningAnswer(resp.listeningText || resp.qaResponse || '');
      const expected = normalizeListeningAnswer(q.expectedTranscript || '');
      if (expected && studentText) {
        isCorrect = studentText === expected;
      }
      correctAnswer = { expectedTranscript: q.expectedTranscript };
    }

    if (q.type !== 'pronunciation' && q.type !== 'video-pronunciation' && q.type !== 'question-answer') {
      pointsEarned = isCorrect ? (q.points || 1) : 0;
    }

    const gradedResp = {
      questionIndex: idx,
      questionType: q.type,
      selectedOptionIndex: resp.selectedOptionIndex,
      matchingResponse: resp.matchingResponse,
      fillBlankResponses: resp.fillBlankResponses,
      spokenText: resp.spokenText,
      pronunciationScore: resp.pronunciationScore,
      qaResponse: resp.qaResponse,
      listeningText: resp.listeningText,
      isCorrect,
      pointsEarned
    };

    const existing = Array.isArray(attempt.responses) ? attempt.responses : [];
    const responsesByIndex = {};
    existing.forEach(r => { responsesByIndex[r.questionIndex] = r; });
    responsesByIndex[idx] = gradedResp;

    const gradedResponses = exercise.questions
      .map((_, i) => responsesByIndex[i])
      .filter(Boolean)
      .sort((a, b) => a.questionIndex - b.questionIndex);

    let earnedPoints = 0;
    gradedResponses.forEach(r => {
      if (typeof r.pointsEarned === 'number') earnedPoints += r.pointsEarned;
    });

    const totalPoints = exercise.questions.reduce((sum, qq) => sum + (qq.points || 1), 0);
    const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    const allSubmitted = gradedResponses.length >= exercise.questions.length;

    attempt.responses = gradedResponses;
    attempt.earnedPoints = earnedPoints;
    attempt.totalPoints = totalPoints;
    attempt.scorePercentage = scorePercentage;
    attempt.timeSpentSeconds = timeSpentSeconds ?? attempt.timeSpentSeconds ?? 0;

    if (allSubmitted) {
      attempt.completedAt = new Date();
      attempt.status = 'completed';

      const completedCount = await ExerciseAttempt.countDocuments({ exerciseId: req.params.id, status: 'completed' });
      const avgResult = await ExerciseAttempt.aggregate([
        { $match: { exerciseId: exercise._id, status: 'completed' } },
        { $group: { _id: null, avg: { $avg: '$scorePercentage' } } }
      ]);
      await DigitalExercise.findByIdAndUpdate(req.params.id, {
        totalCompletions: completedCount,
        averageScore: avgResult[0]?.avg ? Math.round(avgResult[0].avg) : 0
      });
    }
    await attempt.save();

    res.json({
      questionIndex: idx,
      isCorrect,
      pointsEarned,
      correctAnswer,
      earnedPoints,
      totalPoints,
      scorePercentage,
      allSubmitted,
      passed: scorePercentage >= 60
    });
  } catch (err) {
    console.error('POST /digital-exercises/:id/submit-question error:', err);
    res.status(500).json({ error: err?.message || 'Server error while grading' });
  }
});

// POST /api/digital-exercises/:id/submit  — Final submit (all questions)
router.post('/:id/submit', verifyToken, checkRole(['STUDENT', 'ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { attemptId, responses, timeSpentSeconds } = req.body;

    const exercise = await DigitalExercise.findById(req.params.id).lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    const attempt = await ExerciseAttempt.findOne({
      _id: attemptId,
      studentId: req.user.id,
      exerciseId: req.params.id
    });
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });
    if (attempt.status === 'completed') return res.status(400).json({ error: 'Attempt already submitted' });

    // ── Fire all AI grading calls in parallel first ──────────────────────────
    // Pre-compute AI scores for every Q/A question simultaneously so we don't
    // block the loop waiting for each one sequentially.
    const qaScoreMap = {}; // questionIndex → { score }
    const qaPromises = exercise.questions.map((q, i) => {
      if (q.type !== 'question-answer') return Promise.resolve();
      const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
      const expectedRaw = samples.find(s => parseTrueFalse(s) !== null) ?? null;
      const isTrueFalse = q.worksheetKind === 'true-false' || expectedRaw !== null;
      if (isTrueFalse) return Promise.resolve();
      const resp = (responses || []).find(r => r.questionIndex === i) || {};
      const studentAns = (resp.qaResponse || '').trim();
      if (!studentAns) return Promise.resolve();
      return aiGradeAnswer(q.prompt || '', Array.isArray(q.sampleAnswers) ? q.sampleAnswers.filter(Boolean) : [], studentAns)
        .then(result => { qaScoreMap[i] = result; });
    });
    await Promise.all(qaPromises);

    // ── Grade each response (now synchronous — AI results already in map) ───
    let earnedPoints = 0;
    const gradedResponses = [];
    const answerDetails = [];

    for (let i = 0; i < exercise.questions.length; i++) {
      const q = exercise.questions[i];
      const resp = (responses || []).find(r => r.questionIndex === i) || { questionIndex: i };
      let isCorrect = false;
      let pointsEarned = 0;
      let correctAnswer = null;

      if (q.type === 'mcq') {
        isCorrect = resp.selectedOptionIndex === q.correctAnswerIndex;
        correctAnswer = { correctAnswerIndex: q.correctAnswerIndex, explanation: q.explanation };
      } else if (q.type === 'matching') {
        if (resp.matchingResponse && resp.matchingResponse.length === q.pairs.length) {
          let allCorrect = true;
          for (const match of resp.matchingResponse) {
            const expectedRight = q.pairs[match.leftIndex]?.right;
            const givenRight = match.rightValue != null ? match.rightValue : q.pairs[match.rightIndex]?.right;
            if (expectedRight === undefined || givenRight === undefined || String(expectedRight) !== String(givenRight)) {
              allCorrect = false;
              break;
            }
          }
          isCorrect = allCorrect;
        }
        correctAnswer = { pairs: q.pairs.map((p, idx) => ({ leftIndex: idx, rightValue: p.right })) };
      } else if (q.type === 'fill-blank') {
        if (resp.fillBlankResponses && resp.fillBlankResponses.length === q.answers.length) {
          isCorrect = resp.fillBlankResponses.every((ans, idx) => {
            const correct = q.answers[idx];
            return q.caseSensitive
              ? ans.trim() === correct.trim()
              : ans.trim().toLowerCase() === correct.trim().toLowerCase();
          });
        }
        correctAnswer = { answers: q.answers };
      } else if (q.type === 'pronunciation') {
        const score = resp.pronunciationScore || 0;
        isCorrect = score >= 70;
        pointsEarned = isCorrect ? q.points : Math.round(q.points * score / 100);
        correctAnswer = { word: q.word, phonetic: q.phonetic, acceptedVariants: q.acceptedVariants };
      } else if (q.type === 'video-pronunciation') {
        const score = resp.pronunciationScore || 0;
        isCorrect = score >= 70;
        pointsEarned = isCorrect ? q.points : Math.round(q.points * score / 100);
        correctAnswer = { caption: q.caption, acceptedVariants: q.acceptedVariants };
      } else if (q.type === 'question-answer') {
        const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
        const expectedRaw = samples.find(s => parseTrueFalse(s) !== null) ?? null;
        const isTrueFalse = q.worksheetKind === 'true-false' || expectedRaw !== null;
        if (isTrueFalse) {
          const expected = parseTrueFalse(expectedRaw);
          const given = parseTrueFalse(resp.qaResponse);
          isCorrect = expected !== null && given !== null && given === expected;
          pointsEarned = isCorrect ? (q.points || 1) : 0;
          correctAnswer = { sampleAnswers: Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [] };
        } else {
          const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers.filter(Boolean) : [];
          const threshold = typeof q.similarityThreshold === 'number' ? q.similarityThreshold : 70;
          const scoringMode = q.scoringMode || 'full';
          const aiResult = qaScoreMap[i];

          if (aiResult) {
            const { score } = aiResult;
            isCorrect = score >= threshold;
            pointsEarned = scoringMode === 'proportional'
              ? parseFloat(((score / 100) * (q.points || 1)).toFixed(2))
              : (isCorrect ? (q.points || 1) : 0);
          }
          correctAnswer = { sampleAnswers: samples, threshold, scoringMode };
        }
      } else if (q.type === 'listening') {
        const studentText = normalizeListeningAnswer(resp.listeningText || resp.qaResponse || '');
        const expected = normalizeListeningAnswer(q.expectedTranscript || '');
        if (expected && studentText) {
          isCorrect = studentText === expected;
        }
        correctAnswer = { expectedTranscript: q.expectedTranscript };
      }

      if (q.type !== 'pronunciation' && q.type !== 'video-pronunciation' && q.type !== 'question-answer') {
        pointsEarned = isCorrect ? (q.points || 1) : 0;
      }
      earnedPoints += pointsEarned;

      gradedResponses.push({
        questionIndex: i,
        questionType: q.type,
        selectedOptionIndex: resp.selectedOptionIndex,
        matchingResponse: resp.matchingResponse,
        fillBlankResponses: resp.fillBlankResponses,
        spokenText: resp.spokenText,
        pronunciationScore: resp.pronunciationScore,
        qaResponse: resp.qaResponse,
        listeningText: resp.listeningText,
        isCorrect,
        pointsEarned
      });

      answerDetails.push({
        questionIndex: i,
        type: q.type,
        isCorrect,
        pointsEarned,
        correctAnswer
      });
    }

    const totalPoints = exercise.questions.reduce((sum, q) => sum + (q.points || 1), 0);
    const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

    // Save graded attempt
    attempt.responses = gradedResponses;
    attempt.earnedPoints = earnedPoints;
    attempt.totalPoints = totalPoints;
    attempt.scorePercentage = scorePercentage;
    attempt.timeSpentSeconds = timeSpentSeconds || 0;
    attempt.completedAt = new Date();
    attempt.status = 'completed';
    await attempt.save();

    // Update exercise stats
    const completedCount = await ExerciseAttempt.countDocuments({ exerciseId: req.params.id, status: 'completed' });
    const avgResult = await ExerciseAttempt.aggregate([
      { $match: { exerciseId: exercise._id, status: 'completed' } },
      { $group: { _id: null, avg: { $avg: '$scorePercentage' } } }
    ]);
    await DigitalExercise.findByIdAndUpdate(req.params.id, {
      totalCompletions: completedCount,
      averageScore: avgResult[0]?.avg ? Math.round(avgResult[0].avg) : 0
    });

    res.json({
      scorePercentage,
      earnedPoints,
      totalPoints,
      passed: scorePercentage >= 60,
      answerDetails
    });
  } catch (err) {
    console.error('POST /digital-exercises/:id/submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digital-exercises/:id/my-attempts  — Student: view own attempt history
router.get('/:id/my-attempts', verifyToken, async (req, res) => {
  try {
    const attempts = await ExerciseAttempt.find({
      studentId: req.user.id,
      exerciseId: req.params.id
    }).sort({ createdAt: -1 }).lean();
    res.json(attempts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TEACHER/ADMIN ANALYTICS ROUTES ──────────────────────────────────────────

// GET /api/digital-exercises/:id/completions  — All completions for an exercise
router.get('/:id/completions', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { date, studentId, page = 1, limit = 50 } = req.query;
    const filter = { exerciseId: req.params.id, status: 'completed' };
    if (studentId) filter.studentId = studentId;
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      filter.completedAt = { $gte: start, $lte: end };
    }

    const total = await ExerciseAttempt.countDocuments(filter);
    const attempts = await ExerciseAttempt.find(filter)
      .populate('studentId', 'name email batch level')
      .sort({ completedAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    res.json({ attempts, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digital-exercises/analytics/daily-overview  — Daily completion overview for teachers
router.get('/analytics/daily-overview', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const { date, exerciseId } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    targetDate.setHours(0, 0, 0, 0);
    const endDate = new Date(targetDate);
    endDate.setHours(23, 59, 59, 999);

    const matchFilter = {
      status: 'completed',
      completedAt: { $gte: targetDate, $lte: endDate }
    };
    if (exerciseId) matchFilter.exerciseId = new mongoose.Types.ObjectId(exerciseId);

    const overview = await ExerciseAttempt.aggregate([
      { $match: matchFilter },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      { $unwind: '$student' },
      {
        $lookup: {
          from: 'digitalexercises',
          localField: 'exerciseId',
          foreignField: '_id',
          as: 'exercise'
        }
      },
      { $unwind: '$exercise' },
      {
        $project: {
          studentName: '$student.name',
          studentEmail: '$student.email',
          studentBatch: '$student.batch',
          exerciseTitle: '$exercise.title',
          exerciseLevel: '$exercise.level',
          scorePercentage: 1,
          earnedPoints: 1,
          totalPoints: 1,
          timeSpentSeconds: 1,
          completedAt: 1
        }
      },
      { $sort: { completedAt: -1 } }
    ]);

    res.json({ date: targetDate, completions: overview, total: overview.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digital-exercises/analytics/student/:studentId  — All exercise completions for a student
router.get('/analytics/student/:studentId', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const attempts = await ExerciseAttempt.find({
      studentId: req.params.studentId,
      status: 'completed'
    })
      .populate('exerciseId', 'title level category')
      .sort({ completedAt: -1 })
      .lean();

    const summary = {
      totalCompleted: attempts.length,
      averageScore: attempts.length > 0
        ? Math.round(attempts.reduce((s, a) => s + a.scorePercentage, 0) / attempts.length)
        : 0,
      attempts
    };

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
