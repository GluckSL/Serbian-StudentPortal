// routes/digitalExercises.js

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');
const DigitalExercise = require('../models/DigitalExercise');
const ExerciseAttempt = require('../models/ExerciseAttempt');
const { sanitizeReportedTimeSpentSeconds } = require('../utils/exerciseAttemptMetrics');
const User = require('../models/User');
const { verifyToken, checkRole } = require('../middleware/auth');
const OpenAI = require('openai');
const s3Client = require('../config/s3');
const {
  resignExercise,
  resignExercises,
  presignS3Url,
  canonicalizeMediaUrl,
  canonicalizeExerciseForStorage,
  exerciseHasPresignedMedia,
  isS3Url
} = require('../config/presign');
const {
  preserveExistingQuestionMedia,
  preserveTopLevelMedia
} = require('../utils/exerciseMediaPreserve');
const { recoverExerciseMedia } = require('../utils/exerciseMediaRecover');
const { sanitizeQuestions, sanitizeQuestionPlainText } = require('../utils/sanitizeHtml');
const { EXCLUDE_TEST, EXCLUDE_TEST_LOOKUP } = require('../utils/analyticsFilters');
const { getJourneyAccessForStudent } = require('../utils/studentJourneyAccess');
const { isExerciseR2Configured, putExerciseMediaBuffer } = require('../services/exerciseMediaR2');
const { checkAndInstantlyAdvanceSilverGoStudent } = require('../services/journeyDayAdvance.service');

// ─── Attachment upload (per-question) ─────────────────────────────────────────
const ATTACHMENT_DIR = path.join(__dirname, '..', 'uploads', 'exercise-attachments');
function ensureAttachmentDir() {
  if (!fs.existsSync(ATTACHMENT_DIR)) fs.mkdirSync(ATTACHMENT_DIR, { recursive: true });
}

function isVideoOrImageMime(mt) {
  const m = String(mt || '').toLowerCase();
  return m.startsWith('video/') || m.startsWith('image/');
}

const attachmentFilter = (req, file, cb) => {
  const mt = String(file.mimetype || '').toLowerCase();
  const allowed =
    mt.startsWith('image/') ||
    mt.startsWith('audio/') ||
    mt.startsWith('video/') ||
    mt === 'application/pdf' ||
    mt === 'application/msword' ||
    mt === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (allowed) return cb(null, true);
  return cb(new Error(`File type not allowed: ${mt}`), false);
};

const attachmentDiskStorage = multer.diskStorage({
  destination: (req, file, cb) => { ensureAttachmentDir(); cb(null, ATTACHMENT_DIR); },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  }
});

const attachmentS3Storage = multerS3({
  s3: s3Client,
  bucket: process.env.S3_BUCKET,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: (req, file, cb) => {
    const prefix = process.env.S3_PREFIX || 'uploads';
    const ext = path.extname(file.originalname) || '.bin';
    cb(null, `${prefix}/exercise-attachments/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  }
});

/** Audio attachments never touch disk or S3 — only memory → R2 in the route handler. */
const attachmentMemoryStorage = multer.memoryStorage();

const attachmentHybridStorage = {
  _handleFile(req, file, cb) {
    const mt = String(file.mimetype || '').toLowerCase();
    if (mt.startsWith('audio/') || (mt.startsWith('image/') && isExerciseR2Configured())) {
      attachmentMemoryStorage._handleFile(req, file, cb);
    } else if (isVideoOrImageMime(file.mimetype)) {
      attachmentS3Storage._handleFile(req, file, cb);
    } else {
      attachmentDiskStorage._handleFile(req, file, cb);
    }
  },
  _removeFile(req, file, cb) {
    if (file.buffer) {
      cb(null);
    } else if (file.location) {
      cb(null);
    } else if (file.path) {
      fs.unlink(file.path, cb);
    } else {
      cb(null);
    }
  }
};

const attachmentUpload = multer({
  storage: attachmentHybridStorage,
  fileFilter: attachmentFilter,
  limits: { fileSize: 20 * 1024 * 1024 }
});

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
  'sequenceLetter',
  'visibleToStudents'
];

/** Min pronunciation similarity (0–100) to pass a video-pronunciation clip (must match player). */
const VIDEO_PRONUNCIATION_PASS_SCORE = 20;

function normalizeQuestionContexts(rawQuestions) {
  if (!Array.isArray(rawQuestions)) return rawQuestions;
  // Sanitize HTML in text fields, then normalise context whitespace
  const sanitized = sanitizeQuestions(rawQuestions);
  return sanitized.map((q) => {
    const out = {
      ...q,
      context: String(q?.context || '').trim()
    };
    if (q?.type === 'word_bank_fill') {
      out.wordBank = (Array.isArray(q.wordBank) ? q.wordBank : [])
        .map((x) => sanitizeQuestionPlainText(x))
        .filter(Boolean);
      out.items = sanitizeWordBankFillItems(q.items);
      out.reusableWords = q.reusableWords !== false;
    }
    if (q?.type === 'image_pin_match') {
      out.imageUrl = String(q?.imageUrl || '').trim();
      out.pins = (Array.isArray(q?.pins) ? q.pins : [])
        .map((p) => ({
          id: String(p?.id || '').trim(),
          x: Math.max(0, Math.min(100, Number(p?.x) || 0)),
          y: Math.max(0, Math.min(100, Number(p?.y) || 0)),
        }))
        .filter((p) => p.id);
      out.labels = (Array.isArray(q?.labels) ? q.labels : [])
        .map((l) => ({
          id: String(l?.id || '').trim(),
          text: sanitizeQuestionPlainText(l?.text || ''),
          correctPinId: String(l?.correctPinId || '').trim()
        }))
        .filter((l) => l.id && l.text);
      out.settings = {
        randomizeLabels: q?.settings?.randomizeLabels !== false,
        allowRetry: q?.settings?.allowRetry !== false
      };
    }
    return out;
  });
}

// ─── AI answer grader ─────────────────────────────────────────────────────────
// Returns { score: 0-100 } representing how correct the student's answer is.
async function aiGradeAnswer(question, sampleAnswers, studentAnswer) {
  if (!studentAnswer || !studentAnswer.trim()) return { score: 0 };

  if (!process.env.EXERCISES_OPENAI_API_KEY) {
    // Fallback: rough word-overlap heuristic
    const words = studentAnswer.trim().toLowerCase().split(/\s+/).filter(w => w.length > 1);
    return { score: words.length >= 4 ? 75 : words.length >= 2 ? 50 : 20 };
  }

  const openai = new OpenAI({ apiKey: process.env.EXERCISES_OPENAI_API_KEY });

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

function clipText(s, max = 120) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Uniform random permutation (Fisher–Yates). Does not mutate the input array. */
function shuffleArray(arr) {
  const a = Array.isArray(arr) ? [...arr] : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeThresholdForQuestion(q) {
  const raw = Number(q?.similarityThreshold);
  if (Number.isFinite(raw)) return Math.max(0, Math.min(100, Math.round(raw)));
  if (q?.type === 'video-pronunciation') return VIDEO_PRONUNCIATION_PASS_SCORE;
  return 70;
}

function normalizeScoringModeForQuestion(q) {
  return q?.scoringMode === 'proportional' ? 'proportional' : 'full';
}

function isAdvancedGradingEnabled(q) {
  return q?.aiGradingEnabled !== false;
}

function normalizeTextForExactCompare(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeWordBankValue(raw) {
  return sanitizeQuestionPlainText(String(raw ?? ''))
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, ' ');
}

/** Normalize word-bank-fill rows (prompt, answer, optional acceptedAnswers). */
function sanitizeWordBankFillItems(rawItems) {
  return (Array.isArray(rawItems) ? rawItems : [])
    .map((item) => {
      const prompt = sanitizeQuestionPlainText(item?.prompt || '');
      const answer = sanitizeQuestionPlainText(item?.answer || '');
      const primaryNorm = normalizeWordBankValue(answer);
      const rawAlts = Array.isArray(item?.acceptedAnswers) ? item.acceptedAnswers : [];
      const acceptedAnswers = [];
      const seen = new Set();
      if (primaryNorm) seen.add(primaryNorm);
      for (const a of rawAlts) {
        const s = sanitizeQuestionPlainText(String(a ?? '')).trim();
        if (!s) continue;
        const n = normalizeWordBankValue(s);
        if (!n || seen.has(n)) continue;
        seen.add(n);
        acceptedAnswers.push(s);
      }
      const out = { prompt, answer };
      if (acceptedAnswers.length) out.acceptedAnswers = acceptedAnswers;
      return out;
    })
    .filter((item) => item.prompt && item.answer);
}

function wordBankRowAcceptsGiven(givenNorm, row) {
  if (!givenNorm) return false;
  const primary = normalizeWordBankValue(row?.answer);
  if (primary && givenNorm === primary) return true;
  const alts = Array.isArray(row?.acceptedAnswers) ? row.acceptedAnswers : [];
  for (const a of alts) {
    if (normalizeWordBankValue(a) === givenNorm) return true;
  }
  return false;
}

function mapWordBankCorrectAnswerPayload(rows) {
  const cleaned = sanitizeWordBankFillItems(rows);
  return cleaned.map((item, index) => ({ index, ...item }));
}

function normalizeRearrangeToken(raw) {
  return sanitizeQuestionPlainText(String(raw ?? ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeRearrangeTokens(rawTokens) {
  return (Array.isArray(rawTokens) ? rawTokens : [])
    .map(normalizeRearrangeToken)
    .filter(Boolean);
}

function normalizeRearrangeSentence(raw) {
  return sanitizeQuestionPlainText(String(raw ?? ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function levenshteinDistance(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (!s.length) return t.length;
  if (!t.length) return s.length;
  const v0 = new Array(t.length + 1);
  const v1 = new Array(t.length + 1);
  for (let i = 0; i <= t.length; i++) v0[i] = i;
  for (let i = 0; i < s.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < t.length; j++) {
      const cost = s[i] === t[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= t.length; j++) v0[j] = v1[j];
  }
  return v0[t.length];
}

/** 0–100: exact match 100; with advanced grading, partial credit from edit distance. */
function jumbleWordRawScore(studentRaw, expectedRaw, useAdvanced) {
  const student = String(studentRaw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const expected = String(expectedRaw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!expected) return 0;
  if (student === expected) return 100;
  if (!useAdvanced || !student) return 0;
  const dist = levenshteinDistance(student, expected);
  const maxLen = Math.max(student.length, expected.length, 1);
  return Math.max(0, Math.min(100, Math.round(100 * (1 - dist / maxLen))));
}

function lcsTokenLength(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return 0;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[n][m];
}

/** 0–100: full token/sentence match 100; with advanced grading, token-order closeness via LCS. */
function rearrangeRawScore(q, resp, useAdvanced) {
  const expectedTokens = normalizeRearrangeTokens(q.rearrangeTokens);
  const givenTokens = normalizeRearrangeTokens(resp.rearrangeTokensResponse);
  const expectedSentence = normalizeRearrangeSentence(q.rearrangeAnswer);
  const givenSentence = normalizeRearrangeSentence(resp.rearrangeTextResponse);
  const tokensMatch =
    expectedTokens.length > 0 &&
    givenTokens.length === expectedTokens.length &&
    expectedTokens.every((tok, idx) => tok === givenTokens[idx]);
  const sentenceMatch = !!(expectedSentence && givenSentence && expectedSentence === givenSentence);
  if (tokensMatch || sentenceMatch) return 100;
  if (!useAdvanced) return 0;
  if (expectedTokens.length > 0 && givenTokens.length > 0) {
    const lcs = lcsTokenLength(expectedTokens, givenTokens);
    return Math.round((lcs / expectedTokens.length) * 100);
  }
  return 0;
}

/** Must match what students see (GET handler sanitizes pair rights before shuffle). */
function matchingRightsEqual(expectedRight, givenRight) {
  return sanitizeQuestionPlainText(expectedRight) === sanitizeQuestionPlainText(givenRight);
}

function applyThresholdScoring(q, rawScore) {
  const threshold = normalizeThresholdForQuestion(q);
  const scoringMode = normalizeScoringModeForQuestion(q);
  const score = Math.max(0, Math.min(100, Number(rawScore) || 0));
  const maxPoints = q?.points || 1;
  const isCorrect = score >= threshold;
  const pointsEarned = scoringMode === 'proportional'
    ? parseFloat(((score / 100) * maxPoints).toFixed(2))
    : (isCorrect ? maxPoints : 0);
  return { score, threshold, scoringMode, isCorrect, pointsEarned };
}

function questionTotalPoints(q) {
  const subs = Array.isArray(q?.subQuestions) ? q.subQuestions : [];
  const subPts = subs.reduce((sum, sq) => sum + (sq?.points || 1), 0);
  return (q?.points || 1) + subPts;
}

function exerciseTotalPoints(questions) {
  return (questions || []).reduce((sum, q) => sum + questionTotalPoints(q), 0);
}

function gradeFillBlankRawScore(q, fillBlankResponses) {
  const answers = q.answers || [];
  const total = answers.length;
  const sanitizedAnswers = (answers || []).map((a) => sanitizeQuestionPlainText(a));
  if (total <= 0 || !Array.isArray(fillBlankResponses)) {
    return { rawScore: 0, correctAnswer: { answers: sanitizedAnswers } };
  }
  let correctCount = 0;
  for (let i = 0; i < total; i++) {
    const ans = String(fillBlankResponses[i] ?? '');
    const correct = answers[i];
    const ansNorm = sanitizeQuestionPlainText(ans);
    const corrNorm = sanitizeQuestionPlainText(correct);
    const ok = q.caseSensitive
      ? ansNorm === corrNorm
      : ansNorm.toLowerCase() === corrNorm.toLowerCase();
    if (ok) correctCount += 1;
  }
  const useAdvanced = isAdvancedGradingEnabled(q);
  const rawScore = useAdvanced
    ? Math.round((correctCount / total) * 100)
    : (correctCount === total ? 100 : 0);
  return { rawScore, correctAnswer: { answers: sanitizedAnswers } };
}

function gradeSubQuestionPart(sq, subResp) {
  const sub = subResp || {};
  if (sq.type === 'fill-blank') {
    return gradeFillBlankRawScore(sq, sub.fillBlankResponses);
  }
  if (sq.type === 'mcq') {
    const correctIdx = typeof sq.correctAnswerIndex === 'number' ? sq.correctAnswerIndex : 0;
    const rawScore = sub.selectedOptionIndex === correctIdx ? 100 : 0;
    return {
      rawScore,
      correctAnswer: { correctAnswerIndex: correctIdx, explanation: sq.explanation }
    };
  }
  return { rawScore: 0, correctAnswer: null };
}

/** Grade sub-questions attached to a parent; merges points and isCorrect with parent result. */
function gradeAttachedSubQuestions(q, resp, parentIsCorrect, parentPointsEarned, parentCorrectAnswer) {
  let isCorrect = parentIsCorrect;
  let pointsEarned = parentPointsEarned;
  let correctAnswer = parentCorrectAnswer;
  const subResults = [];
  const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];
  if (!subs.length) {
    return { isCorrect, pointsEarned, correctAnswer, subResults };
  }

  const subResps = Array.isArray(resp.subQuestionResponses) ? resp.subQuestionResponses : [];
  for (let si = 0; si < subs.length; si++) {
    const sq = subs[si];
    const subResp = subResps.find((r) => r.questionIndex === si) || { questionIndex: si };
    const { rawScore, correctAnswer: subCorrectAnswer } = gradeSubQuestionPart(sq, subResp);
    let subIsCorrect;
    let subPoints;
    let subCorrectOut = subCorrectAnswer;

    if (isAdvancedGradingEnabled(sq)) {
      const subScoring = applyThresholdScoring(sq, rawScore);
      subIsCorrect = subScoring.isCorrect;
      subPoints = subScoring.pointsEarned;
      subCorrectOut = {
        ...(subCorrectAnswer || {}),
        threshold: subScoring.threshold,
        scoringMode: subScoring.scoringMode,
        score: subScoring.score,
        aiGradingEnabled: true
      };
    } else {
      subIsCorrect = rawScore >= 100;
      subPoints = subIsCorrect ? (sq.points || 1) : 0;
      subCorrectOut = { ...(subCorrectAnswer || {}), score: rawScore, aiGradingEnabled: false };
    }

    if (!subIsCorrect) isCorrect = false;
    pointsEarned += subPoints;
    subResults.push({
      questionIndex: si,
      isCorrect: subIsCorrect,
      pointsEarned: subPoints,
      correctAnswer: subCorrectOut
    });
  }

  const subQuestionGrades = subResults.map((sub) => ({
    questionIndex: sub.questionIndex,
    isCorrect: sub.isCorrect,
    pointsEarned: sub.pointsEarned,
    staffOverride: false
  }));

  if (subResults.length) {
    correctAnswer = { ...(correctAnswer || {}), subResults };
  }
  return { isCorrect, pointsEarned, correctAnswer, subResults, subQuestionGrades };
}

function countFillBlankRuns(sentence) {
  return (String(sentence || '').match(/_+/g) || []).length;
}

function getFillBlankPartsLayout(q) {
  const parts = [];
  if (q?.type === 'fill-blank' && countFillBlankRuns(q.sentence) > 0) {
    parts.push({ kind: 'parent', subIndex: null, blankCount: countFillBlankRuns(q.sentence) });
  }
  const subs = Array.isArray(q?.subQuestions) ? q.subQuestions : [];
  subs.forEach((sq, si) => {
    if (sq?.type === 'fill-blank' && countFillBlankRuns(sq.sentence) > 0) {
      parts.push({ kind: 'sub', subIndex: si, blankCount: countFillBlankRuns(sq.sentence) });
    }
  });
  return parts;
}

function exerciseHasMultipartFillBlank(exercise) {
  return (exercise?.questions || []).some((q) => {
    const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];
    return q.type === 'fill-blank' && subs.some((sq) => sq.type === 'fill-blank');
  });
}

/**
 * Map legacy stored answers onto parent + sub fillBlankResponses using global blank order
 * (Blank 1 = parent, Blank 2+ = sub-parts left-to-right).
 */
function migrateFillBlankResponsesForQuestion(q, resp) {
  const parts = getFillBlankPartsLayout(q);
  if (!parts.length || !resp) return resp;

  const out = { ...resp };
  let subResps = Array.isArray(out.subQuestionResponses)
    ? out.subQuestionResponses.map((s) => ({ ...s }))
    : [];

  const ensureSub = (si) => {
    let s = subResps.find((x) => Number(x.questionIndex) === si);
    if (!s) {
      s = { questionIndex: si };
      subResps.push(s);
    }
    return s;
  };

  for (const part of parts) {
    if (part.kind !== 'sub') continue;
    const sub = ensureSub(part.subIndex);
    if (!Array.isArray(sub.fillBlankResponses) || !sub.fillBlankResponses.length) {
      const text = String(sub.textAnswer ?? '').trim();
      if (text) sub.fillBlankResponses = [text];
    }
  }

  const totalBlanks = parts.reduce((sum, p) => sum + p.blankCount, 0);
  const flat = Array.isArray(out.fillBlankResponses)
    ? out.fillBlankResponses.map((x) => String(x ?? ''))
    : [];
  const parentPart = parts.find((p) => p.kind === 'parent');
  const parentCount = parentPart ? parentPart.blankCount : 0;
  const subsAlreadyFilled = parts
    .filter((p) => p.kind === 'sub')
    .some((p) => {
      const sub = ensureSub(p.subIndex);
      return Array.isArray(sub.fillBlankResponses) && sub.fillBlankResponses.some((x) => String(x).trim());
    });

  if (flat.length === totalBlanks && totalBlanks > 0 && !subsAlreadyFilled) {
    let offset = 0;
    if (parentPart) {
      out.fillBlankResponses = flat.slice(offset, offset + parentCount);
      offset += parentCount;
    } else {
      out.fillBlankResponses = [];
    }
    for (const part of parts) {
      if (part.kind !== 'sub') continue;
      const sub = ensureSub(part.subIndex);
      sub.fillBlankResponses = flat.slice(offset, offset + part.blankCount);
      offset += part.blankCount;
    }
  }

  out.subQuestionResponses = subResps;
  return out;
}

function migrateAttemptFillBlankResponses(exercise, responses) {
  const questions = exercise.questions || [];
  return (responses || []).map((resp) => {
    const i = Number(resp.questionIndex);
    const q = questions[i];
    if (!q) return resp;
    return migrateFillBlankResponsesForQuestion(q, resp);
  });
}

/** Grade one question response (same rules as POST /submit). */
function gradeQuestionResponseCore(q, resp, questionIndex, qaScoreMap) {
  const useAdvancedGrading = isAdvancedGradingEnabled(q);
  let isCorrect = false;
  let pointsEarned = 0;
  let rawScore = 0;
  let correctAnswer = null;

  if (q.type === 'mcq') {
    rawScore = resp.selectedOptionIndex === q.correctAnswerIndex ? 100 : 0;
    correctAnswer = { correctAnswerIndex: q.correctAnswerIndex, explanation: q.explanation };
  } else if (q.type === 'matching') {
    const pairs = q.pairs || [];
    const total = pairs.length;
    if (total > 0 && Array.isArray(resp.matchingResponse)) {
      const byLeft = {};
      for (const m of resp.matchingResponse) byLeft[m.leftIndex] = m;
      let correctCount = 0;
      for (let li = 0; li < total; li++) {
        const match = byLeft[li];
        if (!match) continue;
        const expectedRight = pairs[li]?.right;
        const givenRight = match.rightValue != null ? match.rightValue : pairs[match.rightIndex]?.right;
        if (expectedRight !== undefined && givenRight !== undefined && matchingRightsEqual(expectedRight, givenRight)) {
          correctCount += 1;
        }
      }
      rawScore = useAdvancedGrading
        ? Math.round((correctCount / total) * 100)
        : (correctCount === total ? 100 : 0);
    }
    correctAnswer = {
      pairs: pairs.map((p, idx) => ({ leftIndex: idx, rightValue: sanitizeQuestionPlainText(p.right) }))
    };
  } else if (q.type === 'fill-blank') {
    ({ rawScore, correctAnswer } = gradeFillBlankRawScore(q, resp.fillBlankResponses));
  } else if (q.type === 'word_bank_fill') {
    const rows = Array.isArray(q.items) ? q.items : [];
    const total = rows.length;
    if (total > 0 && Array.isArray(resp.wordBankAnswers)) {
      const byIndex = {};
      resp.wordBankAnswers.forEach((entry) => {
        const key = Number(entry?.index);
        if (Number.isInteger(key) && key >= 0 && key < total) byIndex[key] = entry?.value;
      });
      let correctCount = 0;
      for (let idx = 0; idx < total; idx++) {
        const given = normalizeWordBankValue(byIndex[idx]);
        if (wordBankRowAcceptsGiven(given, rows[idx])) correctCount += 1;
      }
      rawScore = useAdvancedGrading
        ? Math.round((correctCount / total) * 100)
        : (correctCount === total ? 100 : 0);
    }
    correctAnswer = {
      wordBank: (Array.isArray(q.wordBank) ? q.wordBank : []).map((w) => sanitizeQuestionPlainText(w)),
      reusableWords: q.reusableWords !== false,
      items: mapWordBankCorrectAnswerPayload(rows)
    };
  } else if (q.type === 'singular_plural') {
    const rows = (q.pairs || []).filter((p) => p.singular && p.plural);
    const total = rows.length;
    if (total > 0 && Array.isArray(resp.singularPluralResponses)) {
      let correctCount = 0;
      for (let idx = 0; idx < total; idx++) {
        const given = String(resp.singularPluralResponses[idx] ?? '').trim();
        const expected = String(rows[idx].plural || '').trim();
        if (
          given.toLowerCase().replace(/\s+/g, ' ') ===
          expected.toLowerCase().replace(/\s+/g, ' ')
        ) {
          correctCount += 1;
        }
      }
      rawScore = useAdvancedGrading
        ? Math.round((correctCount / total) * 100)
        : (correctCount === total ? 100 : 0);
    }
    correctAnswer = { plurals: rows.map((row) => row.plural) };
  } else if (q.type === 'pronunciation') {
    rawScore = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
    correctAnswer = { word: q.word, phonetic: q.phonetic, acceptedVariants: q.acceptedVariants };
  } else if (q.type === 'video-pronunciation') {
    rawScore = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
    correctAnswer = { caption: q.caption, acceptedVariants: q.acceptedVariants };
  } else if (q.type === 'question-answer') {
    const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
    const expectedRaw = samples.find((s) => parseTrueFalse(s) !== null) ?? null;
    const isTrueFalse = q.worksheetKind === 'true-false' || expectedRaw !== null;
    if (isTrueFalse) {
      const expected = parseTrueFalse(expectedRaw);
      const given = parseTrueFalse(resp.qaResponse);
      rawScore = expected !== null && given !== null && given === expected ? 100 : 0;
      correctAnswer = { sampleAnswers: Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [] };
    } else {
      const filtered = Array.isArray(q.sampleAnswers) ? q.sampleAnswers.filter(Boolean) : [];
      if (useAdvancedGrading) {
        const aiResult = qaScoreMap[questionIndex];
        rawScore = Math.max(0, Math.min(100, Number(aiResult?.score) || 0));
      } else {
        const normalizedStudent = normalizeTextForExactCompare(resp.qaResponse || '');
        const exact = filtered.some((s) => normalizeTextForExactCompare(s) === normalizedStudent);
        rawScore = exact ? 100 : 0;
      }
      correctAnswer = { sampleAnswers: filtered };
    }
  } else if (q.type === 'listening') {
    const studentText = normalizeListeningAnswer(resp.listeningText || resp.qaResponse || '');
    const expected = normalizeListeningAnswer(q.expectedTranscript || '');
    rawScore = (expected && studentText && studentText === expected) ? 100 : 0;
    correctAnswer = { expectedTranscript: q.expectedTranscript };
  } else if (q.type === 'jumble-word') {
    rawScore = jumbleWordRawScore(resp.jumbleWordResponse, q.expectedWord, useAdvancedGrading);
    correctAnswer = { expectedWord: q.expectedWord };
  } else if (q.type === 'rearrange') {
    rawScore = rearrangeRawScore(q, resp, useAdvancedGrading);
    correctAnswer = {
      rearrangeTokens: Array.isArray(q.rearrangeTokens) ? q.rearrangeTokens : [],
      rearrangeAnswer: q.rearrangeAnswer || ''
    };
  } else if (q.type === 'image_pin_match') {
    const labels = Array.isArray(q.labels) ? q.labels : [];
    const submitted = Array.isArray(resp.imagePinAnswers) ? resp.imagePinAnswers : [];
    const byLabel = {};
    submitted.forEach((entry) => {
      const lid = String(entry?.labelId || '');
      const pid = String(entry?.pinId || '');
      if (lid && pid) byLabel[lid] = pid;
    });
    let correctCount = 0;
    const total = labels.length;
    for (const l of labels) {
      if (String(byLabel[String(l.id)] || '') === String(l.correctPinId || '')) correctCount += 1;
    }
    rawScore = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    correctAnswer = {
      labels: labels.map((l) => ({ id: l.id, text: l.text, correctPinId: l.correctPinId })),
      pins: Array.isArray(q.pins) ? q.pins : []
    };
  }

  if (useAdvancedGrading) {
    const scoring = applyThresholdScoring(q, rawScore);
    isCorrect = scoring.isCorrect;
    pointsEarned = scoring.pointsEarned;
    correctAnswer = {
      ...(correctAnswer || {}),
      threshold: scoring.threshold,
      scoringMode: scoring.scoringMode,
      score: scoring.score,
      aiGradingEnabled: true
    };
  } else if (q.type === 'pronunciation') {
    const score = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
    isCorrect = score >= 70;
    pointsEarned = isCorrect ? (q.points || 1) : Math.round((q.points || 1) * score / 100);
    correctAnswer = { ...(correctAnswer || {}), score, aiGradingEnabled: false };
  } else if (q.type === 'video-pronunciation') {
    const score = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
    const threshold = normalizeThresholdForQuestion(q);
    isCorrect = score >= threshold;
    pointsEarned = isCorrect ? (q.points || 1) : Math.round((q.points || 1) * score / 100);
    correctAnswer = { ...(correctAnswer || {}), score, threshold, aiGradingEnabled: false };
  } else {
    isCorrect = rawScore >= 100;
    pointsEarned = isCorrect ? (q.points || 1) : 0;
    correctAnswer = { ...(correctAnswer || {}), score: rawScore, aiGradingEnabled: false };
  }

  let subQuestionGrades = [];
  ({
    isCorrect,
    pointsEarned,
    correctAnswer,
    subQuestionGrades
  } = gradeAttachedSubQuestions(q, resp, isCorrect, pointsEarned, correctAnswer));

  if (Array.isArray(q.subQuestions) && q.subQuestions.length) {
    subQuestionGrades = (subQuestionGrades || []).map((g) => {
      const prev = (resp.subQuestionGrades || []).find((x) => Number(x.questionIndex) === g.questionIndex);
      if (prev?.staffOverride) {
        return {
          ...g,
          isCorrect: !!prev.isCorrect,
          pointsEarned: Number(prev.pointsEarned) || 0,
          staffOverride: true
        };
      }
      return g;
    });
  }

  return {
    isCorrect,
    pointsEarned,
    correctAnswer,
    subQuestionGrades,
    gradedResp: {
      questionIndex,
      questionType: q.type,
      selectedOptionIndex: resp.selectedOptionIndex,
      matchingResponse: resp.matchingResponse,
      fillBlankResponses: resp.fillBlankResponses,
      wordBankAnswers: resp.wordBankAnswers,
      singularPluralResponses: resp.singularPluralResponses,
      spokenText: resp.spokenText,
      pronunciationScore: resp.pronunciationScore,
      qaResponse: resp.qaResponse,
      listeningText: resp.listeningText,
      jumbleWordResponse: resp.jumbleWordResponse,
      rearrangeTextResponse: resp.rearrangeTextResponse,
      rearrangeTokensResponse: resp.rearrangeTokensResponse,
      imagePinAnswers: resp.imagePinAnswers,
      subQuestionResponses: resp.subQuestionResponses,
      subQuestionGrades,
      isCorrect,
      pointsEarned
    }
  };
}

/** Human-readable student submission for analytics / review UIs */
function formatStudentAnswerForReview(q, r) {
  if (!r) return '—';
  if (q.type === 'mcq') {
    const i = r.selectedOptionIndex;
    if (i == null || i === undefined || !Array.isArray(q.options)) return '—';
    return q.options[i] != null ? String(q.options[i]) : `(Option ${i + 1})`;
  }
  if (q.type === 'matching') {
    const pairs = q.pairs || [];
    const mr = r.matchingResponse || [];
    if (!mr.length) return '—';
    return mr.map((m) => {
      const left = sanitizeQuestionPlainText(pairs[m.leftIndex]?.left ?? `L${(m.leftIndex ?? 0) + 1}`);
      const given = sanitizeQuestionPlainText(
        m.rightValue != null ? m.rightValue : (pairs[m.rightIndex]?.right ?? '—')
      );
      return `${left} → ${given}`;
    }).join(' · ');
  }
  if (q.type === 'fill-blank') {
    const arr = r.fillBlankResponses || [];
    return arr.length ? arr.map((x) => String(x || '—')).join(' / ') : '—';
  }
  if (q.type === 'word_bank_fill') {
    const answers = Array.isArray(r.wordBankAnswers) ? r.wordBankAnswers : [];
    if (!answers.length) return '—';
    const byIndex = {};
    answers.forEach((x) => {
      byIndex[Number(x?.index)] = String(x?.value ?? '').trim();
    });
    const rows = Array.isArray(q.items) ? q.items : [];
    return rows
      .map((item, idx) => `${sanitizeQuestionPlainText(item?.prompt || `Item ${idx + 1}`)} → ${byIndex[idx] || '—'}`)
      .join(' · ');
  }
  if (q.type === 'singular_plural') {
    const pairs = q.pairs || [];
    const resp = r.singularPluralResponses || [];
    if (!pairs.length) return '—';
    return pairs
      .map((p, i) =>
        `${sanitizeQuestionPlainText(p.singular || '—')} → ${sanitizeQuestionPlainText(String(resp[i] ?? '').trim() || '—')}`
      )
      .join(' · ');
  }
  if (q.type === 'pronunciation' || q.type === 'video-pronunciation') {
    const t = r.spokenText || '';
    const sc = r.pronunciationScore;
    const tail = sc != null && sc !== undefined ? ` (${sc}% similarity)` : '';
    return (t || '—') + tail;
  }
  if (q.type === 'question-answer') {
    return (r.qaResponse && String(r.qaResponse).trim()) ? String(r.qaResponse).trim() : '—';
  }
  if (q.type === 'listening') {
    const t = r.listeningText || r.qaResponse || '';
    return t ? String(t).trim() : '—';
  }
  if (q.type === 'jumble-word') {
    const t = r.jumbleWordResponse || '';
    return t ? String(t).trim() : '—';
  }
  if (q.type === 'rearrange') {
    const toks = Array.isArray(r.rearrangeTokensResponse) ? r.rearrangeTokensResponse : [];
    if (toks.length) return toks.map((t) => sanitizeQuestionPlainText(t)).join(' ');
    const text = String(r.rearrangeTextResponse || '').trim();
    return text || '—';
  }
  if (q.type === 'image_pin_match') {
    const pairs = Array.isArray(r.imagePinAnswers) ? r.imagePinAnswers : [];
    if (!pairs.length) return '—';
    const labels = Array.isArray(q.labels) ? q.labels : [];
    const pins = Array.isArray(q.pins) ? q.pins : [];
    const byLabel = {};
    pairs.forEach((p) => { byLabel[String(p?.labelId || '')] = String(p?.pinId || ''); });
    return labels.map((l) => {
      const givenPin = byLabel[String(l.id)] || '—';
      const pinObj = pins.find((p) => String(p.id) === givenPin);
      const pinText = pinObj ? `${pinObj.id} (${Number(pinObj.x).toFixed(1)}%,${Number(pinObj.y).toFixed(1)}%)` : givenPin;
      return `${sanitizeQuestionPlainText(l.text || l.id)} → ${pinText}`;
    }).join(' · ');
  }
  return '—';
}

function formatCorrectAnswerForReview(q) {
  if (q.type === 'mcq') {
    const i = q.correctAnswerIndex;
    if (i == null || !Array.isArray(q.options)) return '—';
    return q.options[i] != null ? String(q.options[i]) : `Option ${i + 1}`;
  }
  if (q.type === 'matching') {
    const pairs = q.pairs || [];
    return (
      pairs
        .map((p) => `${sanitizeQuestionPlainText(p.left)} → ${sanitizeQuestionPlainText(p.right ?? '—')}`)
        .join(' · ') || '—'
    );
  }
  if (q.type === 'fill-blank') {
    const a = q.answers || [];
    return a.length ? a.map((x) => String(x)).join(' / ') : '—';
  }
  if (q.type === 'word_bank_fill') {
    const rows = Array.isArray(q.items) ? q.items : [];
    return rows.length
      ? rows
          .map((item, idx) => {
            const alts = Array.isArray(item?.acceptedAnswers) ? item.acceptedAnswers.filter(Boolean) : [];
            const ans = sanitizeQuestionPlainText(item?.answer || '—');
            const altStr = alts.length
              ? ` (also: ${alts.map((a) => sanitizeQuestionPlainText(a)).join(', ')})`
              : '';
            return `${sanitizeQuestionPlainText(item?.prompt || `Item ${idx + 1}`)} → ${ans}${altStr}`;
          })
          .join(' · ')
      : '—';
  }
  if (q.type === 'singular_plural') {
    const pairs = q.pairs || [];
    return pairs.length
      ? pairs
          .map((p) => `${sanitizeQuestionPlainText(p.singular || '—')} → ${sanitizeQuestionPlainText(p.plural || '—')}`)
          .join(' · ')
      : '—';
  }
  if (q.type === 'pronunciation') {
    return [q.word, q.phonetic].filter(Boolean).join(' ') || '—';
  }
  if (q.type === 'video-pronunciation') {
    return q.caption ? String(q.caption) : '—';
  }
  if (q.type === 'question-answer') {
    const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers.filter(Boolean) : [];
    return samples.length ? samples.join(' · ') : '—';
  }
  if (q.type === 'listening') {
    return q.expectedTranscript ? String(q.expectedTranscript) : '—';
  }
  if (q.type === 'jumble-word') {
    return q.expectedWord ? String(q.expectedWord) : '—';
  }
  if (q.type === 'rearrange') {
    const toks = Array.isArray(q.rearrangeTokens) ? q.rearrangeTokens : [];
    if (toks.length) return toks.map((t) => sanitizeQuestionPlainText(t)).join(' ');
    return q.rearrangeAnswer ? String(q.rearrangeAnswer) : '—';
  }
  if (q.type === 'image_pin_match') {
    const labels = Array.isArray(q.labels) ? q.labels : [];
    return labels.length
      ? labels.map((l) => `${sanitizeQuestionPlainText(l.text || l.id)} → ${String(l.correctPinId || '—')}`).join(' · ')
      : '—';
  }
  return '—';
}

function questionPromptSnippet(q, idx) {
  if (!q) return `Question ${idx + 1}`;
  const sp0 = q.type === 'singular_plural' && Array.isArray(q.pairs) ? q.pairs[0]?.singular : '';
  const wb0 = q.type === 'word_bank_fill' && Array.isArray(q.items) ? q.items[0]?.prompt : '';
  const text =
    q.question || q.prompt || q.rearrangePrompt || wb0 || sp0 || q.instruction || q.sentence || q.word || q.caption ||
    (q.type === 'image_pin_match' ? `Image pin match (${Array.isArray(q.labels) ? q.labels.length : 0} labels)` : '');
  return clipText(sanitizeQuestionPlainText(text), 100) || `Question ${idx + 1}`;
}

function subResponseToReviewShape(sq, subResp) {
  const sub = subResp || {};
  if (sq.type === 'fill-blank') return { fillBlankResponses: sub.fillBlankResponses || [] };
  if (sq.type === 'mcq') return { selectedOptionIndex: sub.selectedOptionIndex };
  if (sq.type === 'listening') return { listeningText: sub.textAnswer };
  return { qaResponse: sub.textAnswer };
}

function gradeSubQuestionForReview(sq, subResp) {
  const { rawScore } = gradeSubQuestionPart(sq, subResp);
  if (isAdvancedGradingEnabled(sq)) {
    const scoring = applyThresholdScoring(sq, rawScore);
    return { isCorrect: scoring.isCorrect, pointsEarned: scoring.pointsEarned };
  }
  const isCorrect = rawScore >= 100;
  return { isCorrect, pointsEarned: isCorrect ? (sq.points || 1) : 0 };
}

function getSubQuestionReviewGrade(q, r, sq, si, subResp) {
  const stored = (r?.subQuestionGrades || []).find((g) => Number(g.questionIndex) === si);
  if (stored && typeof stored.isCorrect === 'boolean') {
    return {
      isCorrect: !!stored.isCorrect,
      pointsEarned: Number(stored.pointsEarned) || 0,
      staffOverride: !!stored.staffOverride
    };
  }
  const graded = gradeSubQuestionForReview(sq, subResp);
  return { ...graded, staffOverride: false };
}

function getParentPartReviewGrade(q, r) {
  if (!r) return { isCorrect: false, pointsEarned: 0 };
  const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];
  if (!subs.length) {
    return { isCorrect: !!r.isCorrect, pointsEarned: Number(r.pointsEarned) || 0 };
  }
  const subPts = (r.subQuestionGrades || []).reduce((sum, g) => sum + (Number(g.pointsEarned) || 0), 0);
  const parentPts = Math.max(0, (Number(r.pointsEarned) || 0) - subPts);
  const { rawScore } = q.type === 'fill-blank'
    ? gradeFillBlankRawScore(q, r.fillBlankResponses)
    : { rawScore: r.isCorrect ? 100 : 0 };
  let parentCorrect;
  if (isAdvancedGradingEnabled(q)) {
    parentCorrect = applyThresholdScoring(q, rawScore).isCorrect;
  } else if (q.type === 'pronunciation' || q.type === 'video-pronunciation') {
    parentCorrect = !!r.isCorrect;
  } else {
    parentCorrect = rawScore >= 100;
  }
  return { isCorrect: parentCorrect, pointsEarned: parentPts };
}

/**
 * @param {object} exercise — full DigitalExercise lean doc
 * @param {object} attempt — ExerciseAttempt lean doc with responses
 */
function buildPerQuestionReview(exercise, attempt) {
  const questions = exercise.questions || [];
  const responses = migrateAttemptFillBlankResponses(exercise, attempt.responses || []);
  const byIdx = {};
  responses.forEach((r) => { byIdx[r.questionIndex] = r; });
  const rows = [];
  let serial = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const r = byIdx[i];
    const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];
    serial++;
    const parentGrade = getParentPartReviewGrade(q, r);

    rows.push({
      questionIndex: i,
      subQuestionIndex: null,
      displayIndex: serial,
      type: q.type,
      promptSnippet: questionPromptSnippet(q, i),
      isCorrect: parentGrade.isCorrect,
      pointsEarned: parentGrade.pointsEarned,
      maxPoints: q.points || 1,
      studentAnswer: formatStudentAnswerForReview(q, r),
      expectedAnswer: formatCorrectAnswerForReview(q),
      isSubQuestion: false,
      staffOverride: false
    });

    if (subs.length) {
      const subResps = Array.isArray(r?.subQuestionResponses) ? r.subQuestionResponses : [];
      for (let si = 0; si < subs.length; si++) {
        const sq = subs[si];
        const subResp = subResps.find((s) => Number(s.questionIndex) === si) || { questionIndex: si };
        const subGrade = getSubQuestionReviewGrade(q, r, sq, si, subResp);
        serial++;
        rows.push({
          questionIndex: i,
          subQuestionIndex: si,
          displayIndex: `${i + 1}.${si + 1}`,
          type: sq.type,
          promptSnippet: questionPromptSnippet(sq, si),
          isCorrect: subGrade.isCorrect,
          pointsEarned: subGrade.pointsEarned,
          maxPoints: sq.points || 1,
          studentAnswer: formatStudentAnswerForReview(sq, subResponseToReviewShape(sq, subResp)),
          expectedAnswer: formatCorrectAnswerForReview(sq),
          isSubQuestion: true,
          staffOverride: !!subGrade.staffOverride
        });
      }
    }
  }

  return rows;
}

/** Recompute scores for a completed attempt (migrates legacy fill-blank layout, then full regrade). */
async function regradeCompletedAttempt(exercise, attemptDoc) {
  const migrated = migrateAttemptFillBlankResponses(exercise, attemptDoc.responses || []);
  const qaScoreMap = {};
  const qaPromises = exercise.questions.map((q, i) => {
    if (q.type !== 'question-answer') return Promise.resolve();
    if (!isAdvancedGradingEnabled(q)) return Promise.resolve();
    const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
    const expectedRaw = samples.find((s) => parseTrueFalse(s) !== null) ?? null;
    const isTrueFalse = q.worksheetKind === 'true-false' || expectedRaw !== null;
    if (isTrueFalse) return Promise.resolve();
    const resp = migrated.find((r) => Number(r.questionIndex) === i) || {};
    const studentAns = (resp.qaResponse || '').trim();
    if (!studentAns) return Promise.resolve();
    return aiGradeAnswer(q.prompt || '', samples.filter(Boolean), studentAns)
      .then((result) => { qaScoreMap[i] = result; });
  });
  await Promise.all(qaPromises);

  let earnedPoints = 0;
  const gradedResponses = [];

  for (let i = 0; i < exercise.questions.length; i++) {
    const q = exercise.questions[i];
    const resp = migrated.find((r) => Number(r.questionIndex) === i) || { questionIndex: i };
    const graded = gradeQuestionResponseCore(q, resp, i, qaScoreMap);
    earnedPoints += graded.pointsEarned;
    gradedResponses.push(graded.gradedResp);
  }

  attemptDoc.responses = gradedResponses;
  attemptDoc.earnedPoints = earnedPoints;
  attemptDoc.totalPoints = exerciseTotalPoints(exercise.questions);
  attemptDoc.scorePercentage = attemptDoc.totalPoints > 0
    ? Math.round((earnedPoints / attemptDoc.totalPoints) * 100)
    : 0;
  attemptDoc.markModified('responses');
  return attemptDoc;
}

async function refreshExerciseCompletionStats(exerciseId) {
  // Exclude test accounts from stats
  const testUserIds = await User.find({ isTestAccount: true }).distinct('_id');
  const studentFilter = testUserIds.length ? { $nin: testUserIds } : undefined;

  const baseFilter = { exerciseId, status: 'completed' };
  if (studentFilter) baseFilter.studentId = studentFilter;

  const oid = new mongoose.Types.ObjectId(exerciseId);
  const completedCount = await ExerciseAttempt.countDocuments(baseFilter);
  const avgResult = await ExerciseAttempt.aggregate([
    { $match: { ...baseFilter, exerciseId: oid } },
    { $group: { _id: null, avg: { $avg: '$scorePercentage' } } }
  ]);

  await DigitalExercise.findByIdAndUpdate(exerciseId, {
    totalCompletions: completedCount,
    averageScore: avgResult[0]?.avg ? Math.round(avgResult[0].avg) : 0
  });
}

function exerciseOwnerId(exercise) {
  const raw = exercise.createdBy;
  if (raw && typeof raw === 'object' && raw._id) return raw._id.toString();
  if (raw && raw.toString) return raw.toString();
  return String(raw || '');
}

async function assertTeacherOwnsExercise(user, exercise) {
  if (user.role === 'TEACHER') {
    const owner = exerciseOwnerId(exercise);
    if (owner !== String(user.id)) {
      const err = new Error('Forbidden');
      err.statusCode = 403;
      throw err;
    }
  }
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
const {
  isContentBlockedForStudent,
  getEffectiveAccessibleLevels,
  appendNotBlockedToAndClauses
} = require('../utils/journeyContentBlock');

async function getStudentExerciseAccess(userId) {
  const u = await User.findById(userId).select('currentCourseDay role level batch goStatus subscription blockedJourneyLevels').lean();
  if (!u || u.role !== 'STUDENT') {
    return {
      enabled: true,
      courseDay: 1,
      accessibleLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
      studentLevel: null
    };
  }
  const journeyAccess = await getJourneyAccessForStudent(u);
  const courseDay = journeyAccess.courseDay;
  const studentLevel = u.level || 'A1';
  const accessibleLevels = getEffectiveAccessibleLevels(studentLevel, u.blockedJourneyLevels);
  return {
    enabled: journeyAccess.enabled,
    learningEnabled: journeyAccess.learningEnabled !== false,
    courseDay,
    accessibleLevels,
    studentLevel,
    student: u
  };
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

/**
 * For a student, check if a sequenced exercise is locked because a prior
 * letter on the same courseDay hasn't been passed yet.
 *
 * @param {string} studentId
 * @param {object} exercise  — lean DigitalExercise doc
 * @returns {Promise<{locked: boolean, previousLetter: string|null, previousTitle: string|null}>}
 */
async function checkSequenceLock(studentId, exercise) {
  const sl = exercise.sequenceLetter;
  if (!sl || !exercise.courseDay) return { locked: false, previousLetter: null, previousTitle: null };

  // Find all exercises on the same day with a letter strictly before ours
  const priorExercises = await DigitalExercise.find({
    courseDay: exercise.courseDay,
    sequenceLetter: { $lt: sl, $ne: null, $exists: true },
    visibleToStudents: true,
    isDeleted: { $ne: true }
  }).select('_id sequenceLetter title').lean();

  if (!priorExercises.length) return { locked: false, previousLetter: null, previousTitle: null };

  // Check if each prior exercise has a passing attempt (≥60%) by this student
  const priorIds = priorExercises.map((e) => e._id);
  const completedAttempts = await ExerciseAttempt.find({
    studentId,
    exerciseId: { $in: priorIds },
    status: 'completed',
    scorePercentage: { $gte: 60 }
  }).select('exerciseId').lean();

  const passedIds = new Set(completedAttempts.map((a) => a.exerciseId.toString()));
  const unpassedPriors = priorExercises.filter((e) => !passedIds.has(e._id.toString()));

  if (!unpassedPriors.length) return { locked: false, previousLetter: null, previousTitle: null };

  // Return the first (alphabetically earliest) unpassed letter
  unpassedPriors.sort((a, b) => (a.sequenceLetter || '').localeCompare(b.sequenceLetter || ''));
  const firstUnpassed = unpassedPriors[0];
  return {
    locked: true,
    previousLetter: firstUnpassed.sequenceLetter,
    previousTitle: firstUnpassed.title || null
  };
}

/**
 * Batch sequence-lock calculation for list payloads to avoid N+1 queries.
 * Mutates `exercises` in-place by setting:
 *   - sequenceLocked: boolean
 *   - previousSequenceLetter: string | null
 */
async function attachSequenceLockStatusForList(studentId, exercises) {
  const sequenced = (exercises || []).filter(
    (ex) => ex?.sequenceLetter && ex?.courseDay != null && ex?.courseDay !== undefined
  );
  if (!sequenced.length) return;

  const courseDays = Array.from(
    new Set(
      sequenced
        .map((ex) => Number(ex.courseDay))
        .filter((n) => Number.isFinite(n))
    )
  );
  if (!courseDays.length) return;

  const dayExercises = await DigitalExercise.find({
    courseDay: { $in: courseDays },
    sequenceLetter: { $ne: null, $exists: true },
    visibleToStudents: true,
    isActive: true,
    isDeleted: { $ne: true }
  })
    .select('_id courseDay sequenceLetter title')
    .lean();

  if (!dayExercises.length) {
    sequenced.forEach((ex) => {
      ex.sequenceLocked = false;
      ex.previousSequenceLetter = null;
    });
    return;
  }

  const allDayExerciseIds = dayExercises.map((d) => d._id);
  const completedAttempts = await ExerciseAttempt.find({
    studentId,
    exerciseId: { $in: allDayExerciseIds },
    status: 'completed',
    scorePercentage: { $gte: 60 }
  })
    .select('exerciseId')
    .lean();
  const passedIds = new Set(completedAttempts.map((a) => String(a.exerciseId)));

  const byDay = {};
  dayExercises.forEach((item) => {
    const key = String(item.courseDay);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(item);
  });
  Object.keys(byDay).forEach((k) => {
    byDay[k].sort((a, b) => String(a.sequenceLetter || '').localeCompare(String(b.sequenceLetter || '')));
  });

  sequenced.forEach((ex) => {
    const key = String(ex.courseDay);
    const sameDay = byDay[key] || [];
    const currentLetter = String(ex.sequenceLetter || '').toLowerCase();
    const priors = sameDay.filter((item) => String(item.sequenceLetter || '').toLowerCase() < currentLetter);
    const firstUnpassed = priors.find((item) => !passedIds.has(String(item._id)));
    ex.sequenceLocked = !!firstUnpassed;
    ex.previousSequenceLetter = firstUnpassed ? firstUnpassed.sequenceLetter : null;
  });
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
      if (!studentExerciseAccess.enabled) {
        return res.json({
          exercises: [],
          total: 0,
          page: parseInt(page),
          pages: 0,
          studentCourseDay: studentExerciseAccess.courseDay,
          studentLevel: studentExerciseAccess.studentLevel,
          accessibleLevels: studentExerciseAccess.accessibleLevels
        });
      }
      if (studentExerciseAccess.learningEnabled === false) {
        return res.json({
          exercises: [],
          total: 0,
          page: parseInt(page),
          pages: 0,
          studentCourseDay: studentExerciseAccess.courseDay,
          studentLevel: studentExerciseAccess.studentLevel,
          accessibleLevels: studentExerciseAccess.accessibleLevels
        });
      }
      const studentCourseDay = studentExerciseAccess.courseDay;
      const todayOnly = String(req.query.todayOnly) === 'true' || String(req.query.todayOnly) === '1';
      if (todayOnly) {
        andClauses.push({ courseDay: studentCourseDay });
      } else {
        // General browse: no courseDay or only journey days reached (no future preview list).
        andClauses.push({
          $or: [
            { courseDay: null },
            { courseDay: { $exists: false } },
            { courseDay: { $lte: studentCourseDay } }
          ]
        });
      }
      andClauses.push({ level: { $in: studentExerciseAccess.accessibleLevels } });
      appendNotBlockedToAndClauses(
        andClauses,
        studentExerciseAccess.student?.blockedJourneyLevels
      );
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
      // Keep browse payload lightweight: include only question type metadata.
      .select(
        [
          'title',
          'description',
          'targetLanguage',
          'nativeLanguage',
          'level',
          'category',
          'difficulty',
          'estimatedDuration',
          'sharedAudioUrl',
          'tags',
          'isActive',
          'visibleToStudents',
          'publishedAt',
          'createdBy',
          'totalAttempts',
          'totalCompletions',
          'averageScore',
          'courseDay',
          'sequenceLetter',
          'createdAt',
          'updatedAt',
          'questions.type'
        ].join(' ')
      )
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .lean();

    // For students: attach attempt summary (best score) + wrong/correct counts for analytics
    if (req.user.role === 'STUDENT') {
      const exerciseIds = exercises.map(e => e._id);
      const studentIdForMatch = mongoose.Types.ObjectId.isValid(String(req.user.id))
        ? new mongoose.Types.ObjectId(String(req.user.id))
        : req.user.id;
      const attempts = await ExerciseAttempt.aggregate([
        {
          $match: {
            studentId: studentIdForMatch,
            exerciseId: { $in: exerciseIds },
            status: 'completed'
          }
        },
        {
          $addFields: {
            correctCount: {
              $size: {
                $filter: {
                  input: { $ifNull: ['$responses', []] },
                  as: 'r',
                  cond: { $eq: ['$$r.isCorrect', true] }
                }
              }
            },
            wrongCount: {
              $size: {
                $filter: {
                  input: { $ifNull: ['$responses', []] },
                  as: 'r',
                  cond: { $eq: ['$$r.isCorrect', false] }
                }
              }
            }
          }
        },
        { $sort: { exerciseId: 1, scorePercentage: -1, completedAt: -1, attemptNumber: -1, _id: -1 } },
        {
          $group: {
            _id: '$exerciseId',
            best: {
              $first: {
                _id: '$_id',
                exerciseId: '$exerciseId',
                scorePercentage: '$scorePercentage',
                completedAt: '$completedAt',
                attemptNumber: '$attemptNumber',
                timeSpentSeconds: '$timeSpentSeconds',
                wrongCount: '$wrongCount',
                correctCount: '$correctCount'
              }
            }
          }
        },
        { $replaceRoot: { newRoot: '$best' } }
      ]);

      const exerciseById = {};
      exercises.forEach((e) => { exerciseById[e._id.toString()] = e; });

      const attemptMap = {};
      attempts.forEach(a => {
        const key = a.exerciseId.toString();
        const ex = exerciseById[key];
        const totalQ = Array.isArray(ex?.questions) ? ex.questions.length : 0;
        const summary = {
          _id: a._id,
          exerciseId: a.exerciseId,
          scorePercentage: a.scorePercentage,
          completedAt: a.completedAt,
          attemptNumber: a.attemptNumber,
          timeSpentSeconds: Number(a.timeSpentSeconds) || 0,
          wrongCount: Number(a.wrongCount) || 0,
          correctCount: Number(a.correctCount) || 0,
          totalQuestions: totalQ
        };
        attemptMap[key] = summary;
      });

      exercises.forEach(ex => {
        ex.studentAttempt = attemptMap[ex._id.toString()] || null;
      });

      // Attach sequence lock status in one batched pass.
      await attachSequenceLockStatusForList(req.user.id, exercises);
    }

    await resignExercises(exercises);

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

    // Normalize pair labels to plain text for all clients (prevents visible HTML tags).
    if (Array.isArray(exercise.questions)) {
      exercise.questions = exercise.questions.map((q) => {
        if (!q || typeof q !== 'object') return q;
        if (q.type === 'matching' && Array.isArray(q.pairs)) {
          return {
            ...q,
            pairs: q.pairs.map((p) => ({
              ...p,
              left: sanitizeQuestionPlainText(p?.left),
              right: sanitizeQuestionPlainText(p?.right)
            }))
          };
        }
        if (q.type === 'singular_plural' && Array.isArray(q.pairs)) {
          return {
            ...q,
            pairs: q.pairs.map((p) => ({
              ...p,
              singular: sanitizeQuestionPlainText(p?.singular),
              plural: sanitizeQuestionPlainText(p?.plural)
            }))
          };
        }
        return q;
      });
    }

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
      if (!access.enabled) {
        return res.status(403).json({
          error: 'Journey content is not enabled for your batch yet.',
          code: 'JOURNEY_NOT_ACTIVE'
        });
      }
      if (access.learningEnabled === false) {
        return res.status(403).json({
          error: 'Exercises are not available for your batch.',
          code: 'LEARNING_CONTENT_DISABLED'
        });
      }
      if (!exerciseUnlockedForStudentDay(exercise, access.courseDay)) {
        return res.status(403).json({
          error: 'This exercise unlocks on a later day of your course.',
          code: 'COURSE_DAY_LOCKED',
          studentCourseDay: access.courseDay,
          exerciseCourseDay: exercise.courseDay
        });
      }
      if (isContentBlockedForStudent(access.student, { courseDay: exercise.courseDay, level: exercise.level })) {
        return res.status(403).json({
          error: 'This exercise is not available for your learning path.',
          code: 'CONTENT_LEVEL_BLOCKED'
        });
      }
      // Sequence gate: must complete prior letter(s) first
      const seqLock = await checkSequenceLock(req.user.id, exercise);
      if (seqLock.locked) {
        return res.status(403).json({
          error: `Complete exercise ${(seqLock.previousLetter || '').toUpperCase()} first before attempting this one.`,
          code: 'SEQUENCE_LOCKED',
          previousLetter: seqLock.previousLetter,
          previousTitle: seqLock.previousTitle
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
          stripped.shuffledRight = shuffleArray(q.pairs.map((p) => sanitizeQuestionPlainText(p.right)));
          stripped.pairs = q.pairs.map((p) => ({ left: sanitizeQuestionPlainText(p.left) }));
        }
        if (q.type === 'word_bank_fill') {
          stripped.wordBank = (Array.isArray(q.wordBank) ? q.wordBank : []).map((w) => sanitizeQuestionPlainText(w));
          stripped.items = (Array.isArray(q.items) ? q.items : []).map((item) => ({
            prompt: sanitizeQuestionPlainText(item?.prompt || '')
          }));
          stripped.reusableWords = q.reusableWords !== false;
        }
        if (q.type === 'singular_plural' && Array.isArray(q.pairs)) {
          stripped.pairs = q.pairs.map((p) => ({ singular: sanitizeQuestionPlainText(p.singular) }));
        }
        if (q.type === 'rearrange') {
          const cleanTokens = (arr) =>
            (Array.isArray(arr) ? arr : [])
              .map((t) => sanitizeQuestionPlainText(String(t ?? '')).trim())
              .filter((t) => t && t !== '/');

          const collapseSpacedLetters = (s) => {
            const parts = String(s || '').trim().split(/\s+/).filter(Boolean);
            if (parts.length >= 2 && parts.every((p) => p.length === 1)) {
              return parts.join('');
            }
            return String(s || '').trim();
          };

          const fromAnswer = (ans) =>
            sanitizeQuestionPlainText(String(ans ?? ''))
              .trim()
              .split(/\s+/)
              .map((t) => t.trim())
              .filter(Boolean);

          const fromPrompt = (prompt) => {
            const raw = sanitizeQuestionPlainText(String(prompt ?? '')).trim();
            if (!raw) return [];
            if (raw.includes('/')) {
              const parts = raw
                .split('/')
                .map((x) => collapseSpacedLetters(x))
                .filter((x) => x && x !== '/');
              if (parts.length >= 2) return parts;
            }
            // If prompt is written like "w e i c h i s t", collapse to "weichist"
            const collapsed = collapseSpacedLetters(raw);
            if (collapsed !== raw) return [collapsed];
            return raw.split(/\s+/).map((x) => x.trim()).filter(Boolean);
          };

          const expectedTokens = cleanTokens(q.rearrangeTokens);
          const baseTokens =
            expectedTokens.length
              ? expectedTokens
              : (String(q.rearrangeAnswer || '').trim()
                  ? fromAnswer(q.rearrangeAnswer).map(collapseSpacedLetters).filter(Boolean)
                  : fromPrompt(q.rearrangePrompt));

          stripped.shuffledTokens = shuffleArray(baseTokens);
          delete stripped.rearrangeTokens;
          delete stripped.rearrangeAnswer;
        }
        if (q.type === 'image_pin_match') {
          stripped.imageUrl = q.imageUrl || '';
          stripped.pins = (Array.isArray(q.pins) ? q.pins : [])
            .map((p) => ({
              id: String(p?.id || ''),
              x: Math.max(0, Math.min(100, Number(p?.x) || 0)),
              y: Math.max(0, Math.min(100, Number(p?.y) || 0)),
            }))
            .filter((p) => p.id);
          const baseLabels = (Array.isArray(q.labels) ? q.labels : [])
            .map((l) => ({ id: String(l?.id || ''), text: sanitizeQuestionPlainText(l?.text || '') }))
            .filter((l) => l.id && l.text);
          const randomize = q?.settings?.randomizeLabels !== false;
          stripped.labels = randomize ? shuffleArray(baseLabels) : baseLabels;
          stripped.settings = {
            randomizeLabels: randomize,
            allowRetry: q?.settings?.allowRetry !== false
          };
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

    // Repair legacy rows that stored presigned S3 URLs (they expire and break images).
    const staffRoles = ['ADMIN', 'TEACHER', 'TEACHER_ADMIN'];
    if (!studentView && staffRoles.includes(req.user.role) && exerciseHasPresignedMedia(exercise)) {
      const doc = await DigitalExercise.findById(req.params.id);
      if (doc) {
        canonicalizeExerciseForStorage(doc);
        doc.markModified('questions');
        if (doc.sharedAudioUrl) doc.markModified('sharedAudioUrl');
        if (doc.videoSuccessFeedback) doc.markModified('videoSuccessFeedback');
        if (doc.videoRetryFeedback) doc.markModified('videoRetryFeedback');
        await doc.save();
        const repaired = await DigitalExercise.findById(req.params.id)
          .populate('createdBy', 'name email')
          .lean();
        if (repaired) Object.assign(exercise, repaired);
      }
    }

    // Presign only for playback (students / staff preview). Admin editor must receive
    // canonical URLs so a save does not persist short-lived signed URLs to MongoDB.
    if (studentView) {
      await resignExercise(exercise);
    }
    res.json(exercise);
  } catch (err) {
    console.error('GET /digital-exercises/:id error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── TEACHER/ADMIN MANAGEMENT ROUTES ─────────────────────────────────────────

// GET /api/digital-exercises/admin/all  — Admin list (lightweight metadata only)
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
      .select(
        'title description targetLanguage difficulty level category courseDay visibleToStudents isActive createdBy createdAt updatedAt questions.type'
      )
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

      const typeCounts = {};
      const qArr = Array.isArray(ex.questions) ? ex.questions : [];
      qArr.forEach((q) => {
        const t = String(q?.type || '').trim();
        if (!t) return;
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });

      ex.questionCount = qArr.length;
      ex.questionTypeSummary = typeCounts;
      delete ex.questions;
    });

    await resignExercises(exercises);
    res.json({ exercises, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    console.error('GET /digital-exercises/admin/all error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Subset of fields safe for admin bulk metadata updates (no title/description/questions). */
const BULK_METADATA_KEYS = [
  'level',
  'category',
  'courseDay',
  'difficulty',
  'visibleToStudents',
  'targetLanguage',
  'nativeLanguage',
  'estimatedDuration'
];

// POST /api/digital-exercises/admin/bulk-delete  — Soft-delete many (ADMIN / TEACHER_ADMIN only)
router.post('/admin/bulk-delete', verifyToken, checkRole(['ADMIN', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    const objectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    if (objectIds.length === 0) {
      return res.status(400).json({ error: 'No valid exercise ids' });
    }
    const result = await DigitalExercise.updateMany(
      {
        _id: { $in: objectIds },
        isDeleted: { $ne: true }
      },
      { $set: { isDeleted: true, deletedAt: new Date(), isActive: false, updatedAt: new Date() } }
    );
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('POST /digital-exercises/admin/bulk-delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/digital-exercises/admin/bulk-update  — Apply metadata to many exercises
router.patch('/admin/bulk-update', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const ids = req.body?.ids;
    const updates = req.body?.updates;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' });
    }
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object required' });
    }
    const $set = {};
    for (const key of BULK_METADATA_KEYS) {
      if (Object.prototype.hasOwnProperty.call(updates, key)) {
        $set[key] = updates[key];
      }
    }
    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No valid metadata fields to update' });
    }

    const objectIds = ids
      .filter((id) => mongoose.Types.ObjectId.isValid(String(id)))
      .map((id) => new mongoose.Types.ObjectId(String(id)));
    if (objectIds.length === 0) {
      return res.status(400).json({ error: 'No valid exercise ids' });
    }

    const filter = {
      _id: { $in: objectIds },
      isDeleted: { $ne: true }
    };
    if (req.user.role === 'TEACHER') {
      filter.createdBy = req.user.id;
    }

    $set.updatedAt = new Date();
    $set.lastUpdatedBy = req.user.id;

    const result = await DigitalExercise.updateMany(filter, { $set });

    if (Object.prototype.hasOwnProperty.call($set, 'visibleToStudents') && $set.visibleToStudents === true) {
      await DigitalExercise.updateMany(
        {
          ...filter,
          visibleToStudents: true,
          $or: [{ publishedAt: null }, { publishedAt: { $exists: false } }]
        },
        { $set: { publishedAt: new Date() } }
      );
    }

    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (err) {
    console.error('PATCH /digital-exercises/admin/bulk-update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/digital-exercises  — Create exercise
router.post('/', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const normalizedBody = { ...req.body };
    if (Object.prototype.hasOwnProperty.call(normalizedBody, 'questions')) {
      normalizedBody.questions = normalizeQuestionContexts(normalizedBody.questions);
    }

    const exerciseData = canonicalizeExerciseForStorage({
      ...normalizedBody,
      createdBy: req.user.id
    });
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

// POST /api/digital-exercises/:id/recover-media — Repair broken media URLs from R2/S3 (admin)
router.post(
  '/:id/recover-media',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const exercise = await DigitalExercise.findById(req.params.id);
      if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

      if (req.user.role === 'TEACHER' && exercise.createdBy.toString() !== req.user.id) {
        return res.status(403).json({ error: 'Not authorized to edit this exercise' });
      }

      const { updatedCount, resolutions, missing } = await recoverExerciseMedia(exercise);

      if (updatedCount > 0) {
        canonicalizeExerciseForStorage(exercise);
        exercise.markModified('questions');
        if (exercise.sharedAudioUrl) exercise.markModified('sharedAudioUrl');
        if (exercise.videoSuccessFeedback) exercise.markModified('videoSuccessFeedback');
        if (exercise.videoRetryFeedback) exercise.markModified('videoRetryFeedback');
        exercise.lastUpdatedBy = req.user.id;
        exercise.updatedAt = new Date();
        await exercise.save();
      }

      const plain = exercise.toObject();
      res.json({
        success: true,
        updatedCount,
        recovered: resolutions.filter((r) => r.found),
        missing,
        exercise: plain,
      });
    } catch (err) {
      console.error('POST /digital-exercises/:id/recover-media error:', err);
      res.status(500).json({ error: err.message || 'Media recovery failed' });
    }
  }
);

// PUT /api/digital-exercises/:id  — Update exercise
router.put('/:id', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findById(req.params.id);
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    // Teachers can only edit their own exercises
    if (req.user.role === 'TEACHER' && exercise.createdBy.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to edit this exercise' });
    }

    const mediaClears = req.body.mediaClears;
    const existingTopMedia = {
      sharedAudioUrl: exercise.sharedAudioUrl,
      videoSuccessFeedback: exercise.videoSuccessFeedback,
      videoRetryFeedback: exercise.videoRetryFeedback
    };
    for (const key of DIGITAL_EXERCISE_ASSIGNABLE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        if (key === 'questions') {
          const normalized = normalizeQuestionContexts(req.body[key]);
          exercise.questions = preserveExistingQuestionMedia(
            exercise.questions,
            normalized,
            mediaClears
          );
        } else {
          exercise[key] = req.body[key];
        }
      }
    }
    preserveTopLevelMedia(existingTopMedia, exercise, mediaClears);
    canonicalizeExerciseForStorage(exercise);
    exercise.lastUpdatedBy = req.user.id;
    exercise.updatedAt = new Date();

    await exercise.save();
    const updated = await DigitalExercise.findById(exercise._id).populate('createdBy', 'name email').lean();

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
      if (!access.enabled) {
        return res.status(403).json({
          error: 'Journey content is not enabled for your batch yet.',
          code: 'JOURNEY_NOT_ACTIVE'
        });
      }
      if (access.learningEnabled === false) {
        return res.status(403).json({
          error: 'Exercises are not available for your batch.',
          code: 'LEARNING_CONTENT_DISABLED'
        });
      }
      if (!exerciseUnlockedForStudentDay(exercise, access.courseDay)) {
        return res.status(403).json({
          error: 'This exercise unlocks on a later day of your course.',
          code: 'COURSE_DAY_LOCKED'
        });
      }
      if (isContentBlockedForStudent(access.student, { courseDay: exercise.courseDay, level: exercise.level })) {
        return res.status(403).json({
          error: 'This exercise is not available for your learning path.',
          code: 'CONTENT_LEVEL_BLOCKED'
        });
      }
      // Sequence gate
      const seqLock = await checkSequenceLock(req.user.id, exercise.toObject ? exercise.toObject() : exercise);
      if (seqLock.locked) {
        return res.status(403).json({
          error: `Complete exercise ${(seqLock.previousLetter || '').toUpperCase()} first.`,
          code: 'SEQUENCE_LOCKED',
          previousLetter: seqLock.previousLetter
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
      totalPoints: exerciseTotalPoints(exercise.questions)
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
    const useAdvancedGrading = isAdvancedGradingEnabled(q);
    let isCorrect = false;
    let pointsEarned = 0;
    let rawScore = 0;
    let correctAnswer = null;

    if (q.type === 'mcq') {
      const correctIdx = typeof q.correctAnswerIndex === 'number' ? q.correctAnswerIndex : 0;
      rawScore = resp.selectedOptionIndex === correctIdx ? 100 : 0;
      correctAnswer = { correctAnswerIndex: correctIdx, explanation: q.explanation };
    } else if (q.type === 'matching') {
      const pairs = q.pairs || [];
      const total = pairs.length;
      if (total > 0 && Array.isArray(resp.matchingResponse)) {
        const byLeft = {};
        for (const m of resp.matchingResponse) byLeft[m.leftIndex] = m;
        let correctCount = 0;
        for (let li = 0; li < total; li++) {
          const match = byLeft[li];
          if (!match) continue;
          const expectedRight = pairs[li]?.right;
          const givenRight = match.rightValue != null ? match.rightValue : pairs[match.rightIndex]?.right;
          if (expectedRight !== undefined && givenRight !== undefined && matchingRightsEqual(expectedRight, givenRight)) {
            correctCount += 1;
          }
        }
        rawScore = useAdvancedGrading
          ? Math.round((correctCount / total) * 100)
          : (correctCount === total ? 100 : 0);
      }
      correctAnswer = {
        pairs: pairs.map((p, i) => ({ leftIndex: i, rightValue: sanitizeQuestionPlainText(p.right) }))
      };
    } else if (q.type === 'fill-blank') {
      const answers = q.answers || [];
      const total = answers.length;
      if (total > 0 && Array.isArray(resp.fillBlankResponses)) {
        let correctCount = 0;
        for (let i = 0; i < total; i++) {
          const ans = String(resp.fillBlankResponses[i] ?? '');
          const correct = answers[i];
          const ansNorm = sanitizeQuestionPlainText(ans);
          const corrNorm = sanitizeQuestionPlainText(correct);
          const ok = q.caseSensitive
            ? ansNorm === corrNorm
            : ansNorm.toLowerCase() === corrNorm.toLowerCase();
          if (ok) correctCount += 1;
        }
        rawScore = useAdvancedGrading
          ? Math.round((correctCount / total) * 100)
          : (correctCount === total ? 100 : 0);
      }
      correctAnswer = { answers: (answers || []).map((a) => sanitizeQuestionPlainText(a)) };
    } else if (q.type === 'word_bank_fill') {
      const rows = Array.isArray(q.items) ? q.items : [];
      const total = rows.length;
      if (total > 0 && Array.isArray(resp.wordBankAnswers)) {
        const byIndex = {};
        resp.wordBankAnswers.forEach((entry) => {
          const key = Number(entry?.index);
          if (Number.isInteger(key) && key >= 0 && key < total) {
            byIndex[key] = entry?.value;
          }
        });
        let correctCount = 0;
        for (let i = 0; i < total; i++) {
          const given = normalizeWordBankValue(byIndex[i]);
          if (wordBankRowAcceptsGiven(given, rows[i])) correctCount += 1;
        }
        rawScore = useAdvancedGrading
          ? Math.round((correctCount / total) * 100)
          : (correctCount === total ? 100 : 0);
      }
      correctAnswer = {
        wordBank: (Array.isArray(q.wordBank) ? q.wordBank : []).map((w) => sanitizeQuestionPlainText(w)),
        reusableWords: q.reusableWords !== false,
        items: mapWordBankCorrectAnswerPayload(rows)
      };
    } else if (q.type === 'singular_plural') {
      const rows = (q.pairs || []).filter((p) => p.singular && p.plural);
      const total = rows.length;
      if (total > 0 && Array.isArray(resp.singularPluralResponses)) {
        let correctCount = 0;
        for (let i = 0; i < total; i++) {
          const given = String(resp.singularPluralResponses[i] ?? '').trim();
          const expected = String(rows[i].plural || '').trim();
          if (
            given.toLowerCase().replace(/\s+/g, ' ') ===
            expected.toLowerCase().replace(/\s+/g, ' ')
          ) {
            correctCount += 1;
          }
        }
        rawScore = useAdvancedGrading
          ? Math.round((correctCount / total) * 100)
          : (correctCount === total ? 100 : 0);
      }
      correctAnswer = { plurals: rows.map((row) => row.plural) };
    } else if (q.type === 'pronunciation') {
      rawScore = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
      correctAnswer = { word: q.word, phonetic: q.phonetic, acceptedVariants: q.acceptedVariants };
    } else if (q.type === 'video-pronunciation') {
      rawScore = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
      correctAnswer = { caption: q.caption, acceptedVariants: q.acceptedVariants };
    } else if (q.type === 'question-answer') {
      const studentAns = (resp.qaResponse || '').trim();

      const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
      const expectedRaw = samples.find(s => parseTrueFalse(s) !== null) ?? null;
      const isTrueFalse = q.worksheetKind === 'true-false' || expectedRaw !== null;

      if (isTrueFalse) {
        const expected = parseTrueFalse(expectedRaw);
        const given = parseTrueFalse(studentAns);
        rawScore = expected !== null && given !== null && given === expected ? 100 : 0;
        correctAnswer = {
          sampleAnswers: Array.isArray(q.sampleAnswers) ? q.sampleAnswers : []
        };
      } else if (studentAns) {
        const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers.filter(Boolean) : [];
        if (useAdvancedGrading) {
          const aiResult = await aiGradeAnswer(
            q.prompt || '',
            samples,
            studentAns
          );
          rawScore = Math.max(0, Math.min(100, Number(aiResult?.score) || 0));
        } else {
          const normalizedStudent = normalizeTextForExactCompare(studentAns);
          const exact = samples.some((s) => normalizeTextForExactCompare(s) === normalizedStudent);
          rawScore = exact ? 100 : 0;
        }
        correctAnswer = { sampleAnswers: samples };
      }
    } else if (q.type === 'listening') {
      const studentText = normalizeListeningAnswer(resp.listeningText || resp.qaResponse || '');
      const expected = normalizeListeningAnswer(q.expectedTranscript || '');
      rawScore = (expected && studentText && studentText === expected) ? 100 : 0;
      correctAnswer = { expectedTranscript: q.expectedTranscript };
    } else if (q.type === 'jumble-word') {
      rawScore = jumbleWordRawScore(resp.jumbleWordResponse, q.expectedWord, useAdvancedGrading);
      correctAnswer = { expectedWord: q.expectedWord };
    } else if (q.type === 'rearrange') {
      rawScore = rearrangeRawScore(q, resp, useAdvancedGrading);
      correctAnswer = {
        rearrangeTokens: Array.isArray(q.rearrangeTokens) ? q.rearrangeTokens : [],
        rearrangeAnswer: q.rearrangeAnswer || ''
      };
    } else if (q.type === 'image_pin_match') {
      const labels = Array.isArray(q.labels) ? q.labels : [];
      const submitted = Array.isArray(resp.imagePinAnswers) ? resp.imagePinAnswers : [];
      const byLabel = {};
      submitted.forEach((entry) => {
        const lid = String(entry?.labelId || '');
        const pid = String(entry?.pinId || '');
        if (lid && pid) byLabel[lid] = pid;
      });
      let correctCount = 0;
      const total = labels.length;
      for (const l of labels) {
        if (String(byLabel[String(l.id)] || '') === String(l.correctPinId || '')) correctCount += 1;
      }
      rawScore = total > 0 ? Math.round((correctCount / total) * 100) : 0;
      correctAnswer = {
        labels: labels.map((l) => ({ id: l.id, text: l.text, correctPinId: l.correctPinId })),
        pins: Array.isArray(q.pins) ? q.pins : []
      };
    }

    if (useAdvancedGrading) {
      const scoring = applyThresholdScoring(q, rawScore);
      isCorrect = scoring.isCorrect;
      pointsEarned = scoring.pointsEarned;
      correctAnswer = {
        ...(correctAnswer || {}),
        threshold: scoring.threshold,
        scoringMode: scoring.scoringMode,
        score: scoring.score,
        aiGradingEnabled: true
      };
    } else if (q.type === 'pronunciation') {
      const score = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
      isCorrect = score >= 70;
      pointsEarned = isCorrect ? (q.points || 1) : Math.round((q.points || 1) * score / 100);
      correctAnswer = { ...(correctAnswer || {}), score, aiGradingEnabled: false };
    } else if (q.type === 'video-pronunciation') {
      const score = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
      const threshold = normalizeThresholdForQuestion(q);
      isCorrect = score >= threshold;
      pointsEarned = isCorrect ? (q.points || 1) : Math.round((q.points || 1) * score / 100);
      correctAnswer = { ...(correctAnswer || {}), score, threshold, aiGradingEnabled: false };
    } else {
      isCorrect = rawScore >= 100;
      pointsEarned = isCorrect ? (q.points || 1) : 0;
      correctAnswer = { ...(correctAnswer || {}), score: rawScore, aiGradingEnabled: false };
    }

    let subQuestionGrades = [];
    ({
      isCorrect,
      pointsEarned,
      correctAnswer,
      subQuestionGrades
    } = gradeAttachedSubQuestions(q, resp, isCorrect, pointsEarned, correctAnswer));

    const gradedResp = {
      questionIndex: idx,
      questionType: q.type,
      selectedOptionIndex: resp.selectedOptionIndex,
      matchingResponse: resp.matchingResponse,
      fillBlankResponses: resp.fillBlankResponses,
      wordBankAnswers: resp.wordBankAnswers,
      singularPluralResponses: resp.singularPluralResponses,
      spokenText: resp.spokenText,
      pronunciationScore: resp.pronunciationScore,
      qaResponse: resp.qaResponse,
      listeningText: resp.listeningText,
      jumbleWordResponse: resp.jumbleWordResponse,
      rearrangeTextResponse: resp.rearrangeTextResponse,
      rearrangeTokensResponse: resp.rearrangeTokensResponse,
      imagePinAnswers: resp.imagePinAnswers,
      subQuestionResponses: resp.subQuestionResponses,
      subQuestionGrades: subQuestionGrades || [],
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

    const totalPoints = exerciseTotalPoints(exercise.questions);
    const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
    // Only treat the attempt as complete when every question has been submitted at least once.
    // (An 80 % threshold caused multi-clip exercises — e.g. 14 clips — to finish after 12, skipping the rest.)
    const allSubmitted = gradedResponses.length >= exercise.questions.length;

    attempt.responses = gradedResponses;
    attempt.earnedPoints = earnedPoints;
    attempt.totalPoints = totalPoints;
    attempt.scorePercentage = scorePercentage;
    attempt.timeSpentSeconds = sanitizeReportedTimeSpentSeconds(
      attempt,
      timeSpentSeconds ?? attempt.timeSpentSeconds ?? 0,
    );

    if (allSubmitted) {
      attempt.completedAt = new Date();
      attempt.status = 'completed';
      attempt.timeSpentSeconds = sanitizeReportedTimeSpentSeconds(
        attempt,
        attempt.timeSpentSeconds,
      );

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
      if (!isAdvancedGradingEnabled(q)) return Promise.resolve();
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
      const useAdvancedGrading = isAdvancedGradingEnabled(q);
      let isCorrect = false;
      let pointsEarned = 0;
      let rawScore = 0;
      let correctAnswer = null;

      if (q.type === 'mcq') {
        rawScore = resp.selectedOptionIndex === q.correctAnswerIndex ? 100 : 0;
        correctAnswer = { correctAnswerIndex: q.correctAnswerIndex, explanation: q.explanation };
      } else if (q.type === 'matching') {
        const pairs = q.pairs || [];
        const total = pairs.length;
        if (total > 0 && Array.isArray(resp.matchingResponse)) {
          const byLeft = {};
          for (const m of resp.matchingResponse) byLeft[m.leftIndex] = m;
          let correctCount = 0;
          for (let li = 0; li < total; li++) {
            const match = byLeft[li];
            if (!match) continue;
            const expectedRight = pairs[li]?.right;
            const givenRight = match.rightValue != null ? match.rightValue : pairs[match.rightIndex]?.right;
            if (expectedRight !== undefined && givenRight !== undefined && matchingRightsEqual(expectedRight, givenRight)) {
              correctCount += 1;
            }
          }
          rawScore = useAdvancedGrading
            ? Math.round((correctCount / total) * 100)
            : (correctCount === total ? 100 : 0);
        }
        correctAnswer = {
          pairs: pairs.map((p, idx) => ({ leftIndex: idx, rightValue: sanitizeQuestionPlainText(p.right) }))
        };
      } else if (q.type === 'fill-blank') {
        const answers = q.answers || [];
        const total = answers.length;
        if (total > 0 && Array.isArray(resp.fillBlankResponses)) {
          let correctCount = 0;
          for (let idx = 0; idx < total; idx++) {
            const ans = String(resp.fillBlankResponses[idx] ?? '');
            const correct = answers[idx];
            const ansNorm = sanitizeQuestionPlainText(ans);
            const corrNorm = sanitizeQuestionPlainText(correct);
            const ok = q.caseSensitive
              ? ansNorm === corrNorm
              : ansNorm.toLowerCase() === corrNorm.toLowerCase();
            if (ok) correctCount += 1;
          }
          rawScore = useAdvancedGrading
            ? Math.round((correctCount / total) * 100)
            : (correctCount === total ? 100 : 0);
        }
        correctAnswer = { answers: (answers || []).map((a) => sanitizeQuestionPlainText(a)) };
      } else if (q.type === 'word_bank_fill') {
        const rows = Array.isArray(q.items) ? q.items : [];
        const total = rows.length;
        if (total > 0 && Array.isArray(resp.wordBankAnswers)) {
          const byIndex = {};
          resp.wordBankAnswers.forEach((entry) => {
            const key = Number(entry?.index);
            if (Number.isInteger(key) && key >= 0 && key < total) {
              byIndex[key] = entry?.value;
            }
          });
          let correctCount = 0;
          for (let idx = 0; idx < total; idx++) {
            const given = normalizeWordBankValue(byIndex[idx]);
            if (wordBankRowAcceptsGiven(given, rows[idx])) correctCount += 1;
          }
          rawScore = useAdvancedGrading
            ? Math.round((correctCount / total) * 100)
            : (correctCount === total ? 100 : 0);
        }
        correctAnswer = {
          wordBank: (Array.isArray(q.wordBank) ? q.wordBank : []).map((w) => sanitizeQuestionPlainText(w)),
          reusableWords: q.reusableWords !== false,
          items: mapWordBankCorrectAnswerPayload(rows)
        };
      } else if (q.type === 'singular_plural') {
        const rows = (q.pairs || []).filter((p) => p.singular && p.plural);
        const total = rows.length;
        if (total > 0 && Array.isArray(resp.singularPluralResponses)) {
          let correctCount = 0;
          for (let idx = 0; idx < total; idx++) {
            const given = String(resp.singularPluralResponses[idx] ?? '').trim();
            const expected = String(rows[idx].plural || '').trim();
            if (
              given.toLowerCase().replace(/\s+/g, ' ') ===
              expected.toLowerCase().replace(/\s+/g, ' ')
            ) {
              correctCount += 1;
            }
          }
          rawScore = useAdvancedGrading
            ? Math.round((correctCount / total) * 100)
            : (correctCount === total ? 100 : 0);
        }
        correctAnswer = { plurals: rows.map((row) => row.plural) };
      } else if (q.type === 'pronunciation') {
        rawScore = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
        correctAnswer = { word: q.word, phonetic: q.phonetic, acceptedVariants: q.acceptedVariants };
      } else if (q.type === 'video-pronunciation') {
        rawScore = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
        correctAnswer = { caption: q.caption, acceptedVariants: q.acceptedVariants };
      } else if (q.type === 'question-answer') {
        const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
        const expectedRaw = samples.find(s => parseTrueFalse(s) !== null) ?? null;
        const isTrueFalse = q.worksheetKind === 'true-false' || expectedRaw !== null;
        if (isTrueFalse) {
          const expected = parseTrueFalse(expectedRaw);
          const given = parseTrueFalse(resp.qaResponse);
          rawScore = expected !== null && given !== null && given === expected ? 100 : 0;
          correctAnswer = { sampleAnswers: Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [] };
        } else {
          const samples = Array.isArray(q.sampleAnswers) ? q.sampleAnswers.filter(Boolean) : [];
          if (useAdvancedGrading) {
            const aiResult = qaScoreMap[i];
            rawScore = Math.max(0, Math.min(100, Number(aiResult?.score) || 0));
          } else {
            const normalizedStudent = normalizeTextForExactCompare(resp.qaResponse || '');
            const exact = samples.some((s) => normalizeTextForExactCompare(s) === normalizedStudent);
            rawScore = exact ? 100 : 0;
          }
          correctAnswer = { sampleAnswers: samples };
        }
      } else if (q.type === 'listening') {
        const studentText = normalizeListeningAnswer(resp.listeningText || resp.qaResponse || '');
        const expected = normalizeListeningAnswer(q.expectedTranscript || '');
        rawScore = (expected && studentText && studentText === expected) ? 100 : 0;
        correctAnswer = { expectedTranscript: q.expectedTranscript };
      } else if (q.type === 'jumble-word') {
        rawScore = jumbleWordRawScore(resp.jumbleWordResponse, q.expectedWord, useAdvancedGrading);
        correctAnswer = { expectedWord: q.expectedWord };
      } else if (q.type === 'rearrange') {
        rawScore = rearrangeRawScore(q, resp, useAdvancedGrading);
        correctAnswer = {
          rearrangeTokens: Array.isArray(q.rearrangeTokens) ? q.rearrangeTokens : [],
          rearrangeAnswer: q.rearrangeAnswer || ''
        };
      } else if (q.type === 'image_pin_match') {
        const labels = Array.isArray(q.labels) ? q.labels : [];
        const submitted = Array.isArray(resp.imagePinAnswers) ? resp.imagePinAnswers : [];
        const byLabel = {};
        submitted.forEach((entry) => {
          const lid = String(entry?.labelId || '');
          const pid = String(entry?.pinId || '');
          if (lid && pid) byLabel[lid] = pid;
        });
        let correctCount = 0;
        const total = labels.length;
        for (const l of labels) {
          if (String(byLabel[String(l.id)] || '') === String(l.correctPinId || '')) correctCount += 1;
        }
        rawScore = total > 0 ? Math.round((correctCount / total) * 100) : 0;
        correctAnswer = {
          labels: labels.map((l) => ({ id: l.id, text: l.text, correctPinId: l.correctPinId })),
          pins: Array.isArray(q.pins) ? q.pins : []
        };
      }

      if (useAdvancedGrading) {
        const scoring = applyThresholdScoring(q, rawScore);
        isCorrect = scoring.isCorrect;
        pointsEarned = scoring.pointsEarned;
        correctAnswer = {
          ...(correctAnswer || {}),
          threshold: scoring.threshold,
          scoringMode: scoring.scoringMode,
          score: scoring.score,
          aiGradingEnabled: true
        };
      } else if (q.type === 'pronunciation') {
        const score = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
        isCorrect = score >= 70;
        pointsEarned = isCorrect ? (q.points || 1) : Math.round((q.points || 1) * score / 100);
        correctAnswer = { ...(correctAnswer || {}), score, aiGradingEnabled: false };
      } else if (q.type === 'video-pronunciation') {
        const score = Math.max(0, Math.min(100, Number(resp.pronunciationScore) || 0));
        const threshold = normalizeThresholdForQuestion(q);
        isCorrect = score >= threshold;
        pointsEarned = isCorrect ? (q.points || 1) : Math.round((q.points || 1) * score / 100);
        correctAnswer = { ...(correctAnswer || {}), score, threshold, aiGradingEnabled: false };
      } else {
        isCorrect = rawScore >= 100;
        pointsEarned = isCorrect ? (q.points || 1) : 0;
        correctAnswer = { ...(correctAnswer || {}), score: rawScore, aiGradingEnabled: false };
      }

      let subQuestionGrades = [];
      ({
        isCorrect,
        pointsEarned,
        correctAnswer,
        subQuestionGrades
      } = gradeAttachedSubQuestions(q, resp, isCorrect, pointsEarned, correctAnswer));

      earnedPoints += pointsEarned;

      gradedResponses.push({
        questionIndex: i,
        questionType: q.type,
        selectedOptionIndex: resp.selectedOptionIndex,
        matchingResponse: resp.matchingResponse,
        fillBlankResponses: resp.fillBlankResponses,
        wordBankAnswers: resp.wordBankAnswers,
        singularPluralResponses: resp.singularPluralResponses,
        spokenText: resp.spokenText,
        pronunciationScore: resp.pronunciationScore,
        qaResponse: resp.qaResponse,
        listeningText: resp.listeningText,
        jumbleWordResponse: resp.jumbleWordResponse,
        rearrangeTextResponse: resp.rearrangeTextResponse,
        rearrangeTokensResponse: resp.rearrangeTokensResponse,
        imagePinAnswers: resp.imagePinAnswers,
        subQuestionResponses: resp.subQuestionResponses,
        subQuestionGrades: subQuestionGrades || [],
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

    const totalPoints = exerciseTotalPoints(exercise.questions);
    const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

    // Save graded attempt
    attempt.responses = gradedResponses;
    attempt.earnedPoints = earnedPoints;
    attempt.totalPoints = totalPoints;
    attempt.scorePercentage = scorePercentage;
    attempt.completedAt = new Date();
    attempt.status = 'completed';
    attempt.timeSpentSeconds = sanitizeReportedTimeSpentSeconds(
      attempt,
      timeSpentSeconds || 0,
    );
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

    let journeyAdvanced = false;
    let newCourseDay = null;
    let previousCourseDay = null;
    if (req.user.role === 'STUDENT') {
      try {
        const advResult = await checkAndInstantlyAdvanceSilverGoStudent(req.user.id);
        if (advResult.advanced) {
          journeyAdvanced = true;
          previousCourseDay = advResult.previousDay;
          newCourseDay = advResult.newDay;
        }
      } catch (advErr) {
        console.error('[Instant Advance] exercise submit check failed (non-critical):', advErr.message);
      }
    }

    res.json({
      scorePercentage,
      earnedPoints,
      totalPoints,
      passed: scorePercentage >= 60,
      answerDetails,
      journeyAdvanced,
      ...(journeyAdvanced ? { previousCourseDay, newCourseDay } : {})
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

// GET /api/digital-exercises/:id/my-review  — Student: per-question breakdown (best completed attempt)
router.get('/:id/my-review', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'STUDENT') {
      return res.status(403).json({ error: 'Only students can use this review endpoint' });
    }

    const exercise = await DigitalExercise.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });
    if (!exercise.visibleToStudents) {
      return res.status(403).json({ error: 'Exercise not available' });
    }

    const access = await getStudentExerciseAccess(req.user.id);
    if (!access.enabled) {
      return res.status(403).json({ error: 'Journey content is not enabled for your batch yet.' });
    }
    if (access.learningEnabled === false) {
      return res.status(403).json({ error: 'Exercises are not available for your batch.' });
    }
    if (!exerciseUnlockedForStudentDay(exercise, access.courseDay)) {
      return res.status(403).json({ error: 'This exercise unlocks on a later day of your course.' });
    }
    if (isContentBlockedForStudent(access.student, { courseDay: exercise.courseDay, level: exercise.level })) {
      return res.status(403).json({ error: 'This exercise is not available for your learning path.' });
    }
    if (!exerciseLevelAllowedForStudent(exercise.level, access.accessibleLevels)) {
      return res.status(403).json({ error: 'This exercise is above your current language level.' });
    }

    const attempt = await ExerciseAttempt.findOne({
      studentId: req.user.id,
      exerciseId: req.params.id,
      status: 'completed'
    })
      .sort({ scorePercentage: -1, completedAt: -1 })
      .lean();

    if (!attempt) {
      return res.status(404).json({ error: 'No completed attempt yet' });
    }

    const perQuestion = buildPerQuestionReview(exercise, attempt);
    const wrongCount = perQuestion.filter((r) => !r.isCorrect).length;
    const correctCount = perQuestion.filter((r) => r.isCorrect).length;

    res.json({
      exercise: { _id: exercise._id, title: exercise.title, level: exercise.level, category: exercise.category },
      attempt: {
        _id: attempt._id,
        attemptNumber: attempt.attemptNumber,
        scorePercentage: attempt.scorePercentage,
        earnedPoints: attempt.earnedPoints,
        totalPoints: attempt.totalPoints,
        completedAt: attempt.completedAt,
        timeSpentSeconds: attempt.timeSpentSeconds
      },
      summary: {
        totalQuestions: perQuestion.length,
        correctCount,
        wrongCount
      },
      perQuestion
    });
  } catch (err) {
    console.error('GET /digital-exercises/:id/my-review error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/digital-exercises/:id/attempts/:attemptId  — Staff: full attempt breakdown for one student
router.get('/:id/attempts/:attemptId', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    await assertTeacherOwnsExercise(req.user, exercise);

    const attempt = await ExerciseAttempt.findOne({
      _id: req.params.attemptId,
      exerciseId: req.params.id,
      status: 'completed'
    })
      .populate('studentId', 'name email batch level')
      .lean();

    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    const perQuestion = buildPerQuestionReview(exercise, attempt);
    const wrongCount = perQuestion.filter((r) => !r.isCorrect).length;
    const correctCount = perQuestion.filter((r) => r.isCorrect).length;

    res.json({
      exercise: { _id: exercise._id, title: exercise.title, level: exercise.level, category: exercise.category },
      attempt,
      summary: {
        totalQuestions: perQuestion.length,
        correctCount,
        wrongCount
      },
      perQuestion
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code !== 500) {
      return res.status(code).json({ error: err.message });
    }
    console.error('GET /digital-exercises/:id/attempts/:attemptId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/digital-exercises/:id/attempts/:attemptId/questions/:questionIndex/override
// Staff override: manually mark a submitted question (or sub-question) and recalculate score.
router.patch('/:id/attempts/:attemptId/questions/:questionIndex/override', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    await assertTeacherOwnsExercise(req.user, exercise);

    const idx = Number.parseInt(req.params.questionIndex, 10);
    if (!Number.isFinite(idx) || idx < 0 || idx >= (exercise.questions || []).length) {
      return res.status(400).json({ error: 'Invalid question index' });
    }

    const attempt = await ExerciseAttempt.findOne({
      _id: req.params.attemptId,
      exerciseId: req.params.id,
      status: 'completed'
    });
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    const targetResp = (attempt.responses || []).find((r) => Number(r.questionIndex) === idx);
    if (!targetResp) {
      return res.status(404).json({ error: 'No submitted answer found for this question' });
    }

    const q = exercise.questions[idx];
    const shouldBeCorrect = typeof req.body?.isCorrect === 'boolean' ? req.body.isCorrect : true;
    const subQiRaw = req.body?.subQuestionIndex;
    const hasSubIndex = subQiRaw !== undefined && subQiRaw !== null && subQiRaw !== '';
    const subQi = hasSubIndex ? Number.parseInt(subQiRaw, 10) : null;
    const subs = Array.isArray(q.subQuestions) ? q.subQuestions : [];

    if (hasSubIndex) {
      if (!Number.isFinite(subQi) || subQi < 0 || subQi >= subs.length) {
        return res.status(400).json({ error: 'Invalid sub-question index' });
      }
      const sq = subs[subQi];
      const maxSubPts = Number(sq?.points) || 1;
      if (!Array.isArray(targetResp.subQuestionGrades)) targetResp.subQuestionGrades = [];
      const existing = targetResp.subQuestionGrades.find((g) => Number(g.questionIndex) === subQi);
      const gradeEntry = {
        questionIndex: subQi,
        isCorrect: shouldBeCorrect,
        pointsEarned: shouldBeCorrect ? maxSubPts : 0,
        staffOverride: true
      };
      if (existing) {
        existing.isCorrect = gradeEntry.isCorrect;
        existing.pointsEarned = gradeEntry.pointsEarned;
        existing.staffOverride = true;
      } else {
        targetResp.subQuestionGrades.push(gradeEntry);
      }

      const parentGrade = getParentPartReviewGrade(q, targetResp);
      const subTotal = targetResp.subQuestionGrades.reduce((sum, g) => sum + (Number(g.pointsEarned) || 0), 0);
      targetResp.pointsEarned = parentGrade.pointsEarned + subTotal;
      targetResp.isCorrect = parentGrade.isCorrect &&
        targetResp.subQuestionGrades.every((g) => !!g.isCorrect);
    } else {
      const maxPoints = questionTotalPoints(q);
      if (subs.length) {
        if (!Array.isArray(targetResp.subQuestionGrades)) targetResp.subQuestionGrades = [];
        for (let si = 0; si < subs.length; si++) {
          const sq = subs[si];
          const maxSubPts = Number(sq?.points) || 1;
          const pts = shouldBeCorrect ? maxSubPts : 0;
          const existing = targetResp.subQuestionGrades.find((g) => Number(g.questionIndex) === si);
          const gradeEntry = {
            questionIndex: si,
            isCorrect: shouldBeCorrect,
            pointsEarned: pts,
            staffOverride: true
          };
          if (existing) {
            existing.isCorrect = gradeEntry.isCorrect;
            existing.pointsEarned = gradeEntry.pointsEarned;
            existing.staffOverride = true;
          } else {
            targetResp.subQuestionGrades.push(gradeEntry);
          }
        }
        const parentPts = shouldBeCorrect ? (Number(q.points) || 1) : 0;
        targetResp.pointsEarned = parentPts + targetResp.subQuestionGrades.reduce(
          (sum, g) => sum + (Number(g.pointsEarned) || 0),
          0
        );
      } else {
        targetResp.pointsEarned = shouldBeCorrect ? maxPoints : 0;
      }
      targetResp.isCorrect = shouldBeCorrect;
    }

    attempt.markModified('responses');

    const earnedPoints = (attempt.responses || []).reduce((sum, r) => {
      const pts = Number(r?.pointsEarned);
      return sum + (Number.isFinite(pts) ? pts : 0);
    }, 0);
    const totalPoints = exerciseTotalPoints(exercise.questions);
    const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

    attempt.earnedPoints = earnedPoints;
    attempt.totalPoints = totalPoints;
    attempt.scorePercentage = scorePercentage;
    await attempt.save();

    await refreshExerciseCompletionStats(req.params.id);

    return res.json({
      success: true,
      attemptId: attempt._id,
      questionIndex: idx,
      subQuestionIndex: hasSubIndex ? subQi : null,
      isCorrect: shouldBeCorrect,
      pointsEarned: targetResp.pointsEarned,
      earnedPoints: attempt.earnedPoints,
      totalPoints: attempt.totalPoints,
      scorePercentage: attempt.scorePercentage
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code !== 500) {
      return res.status(code).json({ error: err.message });
    }
    console.error('PATCH /digital-exercises/:id/attempts/:attemptId/questions/:questionIndex/override error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/digital-exercises/:id/attempts/:attemptId/regrade
// Re-run auto-grading on a completed attempt (e.g. after fixing sub-question fill-blank logic).
router.post('/:id/attempts/:attemptId/regrade', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    await assertTeacherOwnsExercise(req.user, exercise);

    const attempt = await ExerciseAttempt.findOne({
      _id: req.params.attemptId,
      exerciseId: req.params.id,
      status: 'completed'
    });
    if (!attempt) return res.status(404).json({ error: 'Attempt not found' });

    await regradeCompletedAttempt(exercise, attempt);
    await attempt.save();
    await refreshExerciseCompletionStats(req.params.id);

    const perQuestion = buildPerQuestionReview(exercise, attempt.toObject ? attempt.toObject() : attempt);

    return res.json({
      success: true,
      attemptId: attempt._id,
      earnedPoints: attempt.earnedPoints,
      totalPoints: attempt.totalPoints,
      scorePercentage: attempt.scorePercentage,
      summary: {
        totalQuestions: perQuestion.length,
        correctCount: perQuestion.filter((r) => r.isCorrect).length,
        wrongCount: perQuestion.filter((r) => !r.isCorrect).length
      },
      perQuestion
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code !== 500) {
      return res.status(code).json({ error: err.message });
    }
    console.error('POST /digital-exercises/:id/attempts/:attemptId/regrade error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/digital-exercises/:id/attempts/regrade-all
// Re-map legacy fill-blank answers and regrade every completed attempt (updates stored scores).
router.post('/:id/attempts/regrade-all', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });

    await assertTeacherOwnsExercise(req.user, exercise);

    const attempts = await ExerciseAttempt.find({
      exerciseId: req.params.id,
      status: 'completed'
    });

    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const attempt of attempts) {
      try {
        await regradeCompletedAttempt(exercise, attempt);
        await attempt.save();
        updated += 1;
      } catch (e) {
        skipped += 1;
        errors.push({ attemptId: attempt._id, error: e?.message || 'regrade failed' });
      }
    }

    await refreshExerciseCompletionStats(req.params.id);

    return res.json({
      success: true,
      exerciseId: req.params.id,
      totalAttempts: attempts.length,
      updated,
      skipped,
      hasMultipartFillBlank: exerciseHasMultipartFillBlank(exercise),
      errors: errors.slice(0, 20)
    });
  } catch (err) {
    const code = err.statusCode || 500;
    if (code !== 500) {
      return res.status(code).json({ error: err.message });
    }
    console.error('POST /digital-exercises/:id/attempts/regrade-all error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── TEACHER/ADMIN ANALYTICS ROUTES ──────────────────────────────────────────

// GET /api/digital-exercises/:id/completions  — All completions for an exercise
router.get('/:id/completions', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  try {
    const exercise = await DigitalExercise.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true }
    }).lean();
    if (!exercise) return res.status(404).json({ error: 'Exercise not found' });
    await assertTeacherOwnsExercise(req.user, exercise);

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
      .populate('studentId', 'name email batch level isTestAccount')
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
      // Exclude test accounts from analytics overview
      { $match: { 'student.isTestAccount': { $ne: true } } },
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

// POST /api/digital-exercises/presign-media-urls — Batch presign S3 URLs for admin editor preview
router.post(
  '/presign-media-urls',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const raw = req.body?.urls;
      if (!Array.isArray(raw)) {
        return res.status(400).json({ error: 'urls array is required' });
      }
      const seen = new Set();
      const resolutions = [];
      for (const item of raw) {
        const original = String(item || '').trim();
        if (!original || seen.has(original)) continue;
        seen.add(original);
        const canonical = canonicalizeMediaUrl(original);
        const url = isS3Url(canonical) ? await presignS3Url(canonical) : original;
        resolutions.push({ original, url });
      }
      return res.json({ resolutions });
    } catch (err) {
      console.error('POST /digital-exercises/presign-media-urls error:', err);
      return res.status(500).json({ error: err.message || 'Presign failed' });
    }
  }
);

// POST /api/digital-exercises/upload-attachment  — Upload a per-question attachment
router.post(
  '/upload-attachment',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  attachmentUpload.single('attachment'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const mt = String(req.file.mimetype || '').toLowerCase();
      if (mt.startsWith('audio/')) {
        if (!req.file.buffer?.length) {
          return res.status(400).json({ error: 'Empty audio upload' });
        }
        if (!isExerciseR2Configured()) {
          return res.status(503).json({
            error:
              'Audio attachments require Cloudflare R2. Set R2 credentials and R2_PUBLIC_BASE_URL.',
          });
        }
        const ext = path.extname(req.file.originalname || '') || '.mp3';
        const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
        const key = `exercise-attachments/${filename}`;
        const url = await putExerciseMediaBuffer(req.file.buffer, key, mt || 'audio/mpeg');
        return res.json({ success: true, url });
      }

      // S3 (image/video): .location; PDF/docs: disk relative path
      // Policy: never delete previous S3/R2 objects when a new file is uploaded — old
      // media remains in storage; only the exercise document URL field is updated.
      if (mt.startsWith('image/') && req.file.buffer?.length && isExerciseR2Configured()) {
        const ext = path.extname(req.file.originalname || '') || '.png';
        const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
        const key = `exercise-attachments/${filename}`;
        const publicUrl = await putExerciseMediaBuffer(req.file.buffer, key, mt || 'image/png');
        return res.json({ success: true, url: publicUrl, canonicalUrl: publicUrl });
      }

      const rawUrl = req.file.location || `/uploads/exercise-attachments/${req.file.filename}`;
      const canonicalUrl = canonicalizeMediaUrl(rawUrl);
      // When the bucket is private (S3_USE_SIGNED_URLS=true), presign the URL so the
      // builder can display the image immediately without a 403 from S3.
      const url = req.file.location ? (await presignS3Url(canonicalUrl)) : canonicalUrl;
      return res.json({ success: true, url, canonicalUrl });
    } catch (err) {
      console.error('POST /digital-exercises/upload-attachment error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/digital-exercises/generate-explanation  — AI-generate an answer explanation
router.post(
  '/generate-explanation',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const {
        questionType,
        questionText,
        storyParagraph,
        contextText,
        correctAnswer,
        sampleAnswers,
        targetLanguage,
        audioTranscript
      } = req.body;

      const cleanedSampleAnswers = Array.isArray(sampleAnswers)
        ? sampleAnswers.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      const cleanedAudioTranscript = String(audioTranscript || '').trim();

      const hasAnyInput =
        String(questionText || '').trim() ||
        String(storyParagraph || '').trim() ||
        String(contextText || '').trim() ||
        String(correctAnswer || '').trim() ||
        cleanedAudioTranscript ||
        cleanedSampleAnswers.length > 0;

      if (!hasAnyInput) {
        return res.status(400).json({
          error: 'Provide questionText, storyParagraph, contextText, correctAnswer, or sampleAnswers'
        });
      }

      if (!process.env.EXERCISES_OPENAI_API_KEY) {
        return res.status(503).json({ error: 'OpenAI not configured' });
      }

      const openai = new OpenAI({ apiKey: process.env.EXERCISES_OPENAI_API_KEY });

      const langNote = targetLanguage ? ` Exercise language: ${targetLanguage}.` : '';
      const typeNote = questionType ? ` Question type: ${questionType}.` : '';
      const audioNote = cleanedAudioTranscript
        ? ' An audio transcript is provided — base your explanation on what was actually said in the recording, not guesses.'
        : '';
      const userContent =
        `Write a concise teacher explanation (2-4 sentences) in English for why the answer is correct.${typeNote}${langNote}${audioNote} Use all provided fields together (question, story/context, audio transcript, and answer). If there is a story paragraph, explicitly connect the answer to evidence from it.\n` +
        (questionText ? `Question: ${questionText}\n` : '') +
        (storyParagraph ? `Story paragraph: ${storyParagraph}\n` : '') +
        (contextText ? `Additional context: ${contextText}\n` : '') +
        (cleanedAudioTranscript ? `Audio transcript (what the student hears): ${cleanedAudioTranscript}\n` : '') +
        (correctAnswer ? `Correct answer: ${correctAnswer}\n` : '') +
        (cleanedSampleAnswers.length > 0 ? `Sample answers: ${cleanedSampleAnswers.join(' | ')}` : '');

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a language teacher writing clear answer explanations for students. Always write in English, even if the source content is in another language. When an audio transcript is provided, explain using the exact words and meaning from that transcript. Use the provided story/context as evidence when present, and explain why alternatives would be incorrect when that distinction matters (for example true/false).'
          },
          { role: 'user', content: userContent }
        ],
        max_tokens: 200,
        temperature: 0.5
      });

      const explanation = completion.choices[0]?.message?.content?.trim() || '';
      return res.json({ explanation });
    } catch (err) {
      console.error('POST /digital-exercises/generate-explanation error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/digital-exercises/generate-missing-answers
// Body: { questions: [{ index, type, sentence?, instruction?, hint?, answers?, prompt?, sampleAnswers? }] }
// Returns: { results: [{ index, answers?, sampleAnswers? }] }
router.post(
  '/generate-missing-answers',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const { questions } = req.body;
      if (!Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'questions array is required' });
      }
      if (!process.env.EXERCISES_OPENAI_API_KEY) {
        return res.status(503).json({ error: 'OpenAI not configured' });
      }

      const openai = new OpenAI({ apiKey: process.env.EXERCISES_OPENAI_API_KEY });

      // Build a compact JSON description of each incomplete question for the AI
      const questionDescriptions = questions.map((q) => {
        const idx = Number(q.index);
        const obj = { index: Number.isFinite(idx) ? idx : q.index, type: q.type };
        if (q.instruction) obj.instruction = q.instruction;
        if (q.hint) obj.hint = q.hint;
        if (q.type === 'fill-blank') {
          const sentence = q.sentence || '';
          obj.sentence = sentence;
          // One blank per contiguous run of underscores (single "_" counts, same as student UI).
          const blankCount = (String(sentence).match(/_+/g) || []).length;
          obj.blankCount = blankCount;
          obj.existingAnswers = Array.isArray(q.answers) ? q.answers : [];
        } else {
          obj.prompt = q.prompt || q.question || '';
          obj.existingAnswers = Array.isArray(q.sampleAnswers) ? q.sampleAnswers : [];
        }
        return obj;
      });

      const systemPrompt = `You are an expert language teacher. The user will send a JSON array of questions that need missing answers filled in.

Rules:
- For type "fill-blank": each blank is one contiguous run of underscore characters in "sentence" (a single "_" is one blank; "___" is still one blank). Return exactly "blankCount" strings in "answers", in left-to-right blank order. Do not change the sentence.
- For type "question-answer": return "sampleAnswers" with 1–3 short acceptable strings.
- For type "jumble-word": return "expectedWord" as the correct word.

You MUST respond with a single JSON object of this exact shape (no markdown, no prose):
{ "results": [ { "index": <number matching input>, "answers"?: string[], "sampleAnswers"?: string[], "expectedWord"?: string } ] }

Include one object in "results" for every input question, using the same "index" value each question was given.`;

      const userContent = `Questions to fill:\n${JSON.stringify(questionDescriptions, null, 2)}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: 800,
        temperature: 0.3,
        response_format: { type: 'json_object' }
      });

      let rawContent = completion.choices[0]?.message?.content?.trim() || '{}';
      let parsed;
      try {
        parsed = JSON.parse(rawContent);
      } catch {
        return res.status(500).json({ error: 'AI returned invalid JSON', raw: rawContent });
      }

      const extractResultsArray = (p, inputQs) => {
        if (Array.isArray(p)) return p;
        if (Array.isArray(p?.results)) return p.results;
        if (Array.isArray(p?.items)) return p.items;
        if (Array.isArray(p?.data)) return p.data;
        const numericKeys = Object.keys(p || {}).filter((k) => /^\d+$/.test(k));
        if (numericKeys.length) {
          return numericKeys
            .sort((a, b) => Number(a) - Number(b))
            .map((k) => p[k])
            .filter((x) => x && typeof x === 'object');
        }
        if (inputQs.length === 1 && Array.isArray(p?.answers)) {
          return [{ index: inputQs[0].index, answers: p.answers }];
        }
        return [];
      };

      const results = extractResultsArray(parsed, questions);

      // Validate and sanitize per-item (index may be string from some models)
      const safe = results
        .filter((r) => r && typeof r === 'object' && Number.isFinite(Number(r.index)))
        .map((r) => {
          const out = { index: Number(r.index) };
          if (Array.isArray(r.answers)) {
            out.answers = r.answers.map((a) => String(a ?? '').trim());
          }
          if (Array.isArray(r.sampleAnswers)) {
            out.sampleAnswers = r.sampleAnswers.map((a) => String(a ?? '').trim());
          }
          if (r.expectedWord != null) {
            out.expectedWord = String(r.expectedWord).trim();
          }
          return out;
        });

      return res.json({ results: safe });
    } catch (err) {
      console.error('POST /digital-exercises/generate-missing-answers error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/digital-exercises/convert-question-type
// Body: { question: <ReviewQuestion object>, targetType: string, targetLanguage?: string }
// Returns: { question: <converted question object> }
router.post(
  '/convert-question-type',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const { question, targetType, targetLanguage } = req.body;

      if (!question || typeof question !== 'object') {
        return res.status(400).json({ error: 'question object is required' });
      }
      if (!targetType || typeof targetType !== 'string') {
        return res.status(400).json({ error: 'targetType is required' });
      }
      if (!process.env.EXERCISES_OPENAI_API_KEY) {
        return res.status(503).json({ error: 'OpenAI not configured' });
      }

      const openai = new OpenAI({ apiKey: process.env.EXERCISES_OPENAI_API_KEY });

      const lang = targetLanguage || 'German';

      // Extract the core content from the source question
      const srcType = String(question.type || '');
      const srcKind = String(question.worksheetKind || '');
      const displayType = srcKind || srcType;

      const questionText =
        question.prompt ||
        question.question ||
        question.sentence ||
        question.word ||
        question.scrambledText ||
        question.rearrangePrompt ||
        question.expectedWord ||
        question.caption ||
        question.expectedTranscript ||
        '';

      // Shared meta fields to preserve
      const meta = {
        context: question.context || '',
        instruction: question.instruction || '',
        example: question.example || '',
        points: Number(question.points) || 1
      };

      // Build source description for the AI
      const srcDesc = {
        type: displayType,
        questionText: String(questionText).trim(),
        pairs: question.pairs || undefined,
        options: question.options || undefined,
        sampleAnswers: question.sampleAnswers || undefined,
        answers: question.answers || undefined,
        rearrangePrompt: question.rearrangePrompt || undefined,
        rearrangeTokens: question.rearrangeTokens || undefined,
        rearrangeAnswer: question.rearrangeAnswer || undefined,
        scrambledText: question.scrambledText || undefined,
        expectedWord: question.expectedWord || undefined,
        wordBank: question.wordBank || undefined,
        items: question.items || undefined,
        caption: question.caption || undefined,
        expectedTranscript: question.expectedTranscript || undefined,
        labels: question.labels || undefined,
        pins: question.pins || undefined
      };

      // Per-target type instructions + expected JSON shape
      const targetInstructions = {
        mcq: `Convert to a multiple-choice question (MCQ).
Return JSON: { "type": "mcq", "question": "<question text>", "options": ["<A>","<B>","<C>","<D>"], "correctAnswerIndex": <0-3>, "explanation": "<brief why>", "points": ${meta.points} }
- Derive 4 plausible options from the source content. One must be correct.`,

        matching: `Convert to a matching exercise.
Return JSON: { "type": "matching", "instruction": "<instruction>", "pairs": [{"left":"<term>","right":"<definition>"},...], "points": ${meta.points} }
- Extract or generate at least 3 matching pairs from the source content.`,

        'fill-blank': `Convert to a fill-in-the-blank sentence.
Return JSON: { "type": "fill-blank", "sentence": "<sentence with _ for each blank>", "answers": ["<answer1>",...], "hint": "<optional grammar hint>", "points": ${meta.points} }
- Use a single underscore _ for each blank.`,

        'true-false': `Convert to a true/false (Richtig/Falsch) question.
Return JSON: { "type": "question-answer", "worksheetKind": "true-false", "prompt": "<statement to judge>", "sampleAnswers": ["Richtig"] OR ["Falsch"], "similarityThreshold": 75, "scoringMode": "full", "points": ${meta.points} }
- Write a clear declarative statement. The sampleAnswers should be either ["Richtig"] or ["Falsch"] depending on whether the statement is true.`,

        'sentence-transformation': `Convert to a sentence transformation task.
Return JSON: { "type": "question-answer", "worksheetKind": "sentence-transformation", "prompt": "<instruction + source sentence>", "sampleAnswers": ["<correct transformed sentence>"], "similarityThreshold": 70, "scoringMode": "full", "points": ${meta.points} }`,

        'error-correction': `Convert to an error correction task.
Return JSON: { "type": "question-answer", "worksheetKind": "error-correction", "prompt": "<sentence containing a grammatical error>", "sampleAnswers": ["<corrected sentence>"], "similarityThreshold": 70, "scoringMode": "full", "points": ${meta.points} }`,

        'question-answer': `Convert to a plain question-answer question.
Return JSON: { "type": "question-answer", "prompt": "<question>", "sampleAnswers": ["<acceptable answer>"], "similarityThreshold": 70, "scoringMode": "full", "points": ${meta.points} }`,

        singular_plural: `Convert to a singular/plural exercise.
Return JSON: { "type": "singular_plural", "instruction": "<instruction>", "pairs": [{"singular":"<word>","plural":"<plural>"},...], "points": ${meta.points} }
- Extract or generate at least 2 singular→plural pairs from the source content.`,

        pronunciation: `Convert to a pronunciation question.
Return JSON: { "type": "pronunciation", "word": "<word or phrase>", "phonetic": "<IPA optional>", "translation": "<${lang === 'German' ? 'English' : 'German'} translation>", "acceptedVariants": [], "points": ${meta.points} }`,

        'free-writing-own-sentences': `Convert to a free-writing task where students write their own sentences.
Return JSON: { "type": "question-answer", "worksheetKind": "free-writing-own-sentences", "prompt": "<writing prompt>", "sampleAnswers": ["<example sentence>"], "similarityThreshold": 60, "scoringMode": "proportional", "points": ${meta.points} }`,

        'table-profile-fill': `Convert to a table/profile fill-in task.
Return JSON: { "type": "question-answer", "worksheetKind": "table-profile-fill", "prompt": "<fill-in prompt>", "sampleAnswers": ["<expected values>"], "similarityThreshold": 60, "scoringMode": "proportional", "points": ${meta.points} }`,

        'free-writing-profile': `Convert to a short profile (Steckbrief) writing task.
Return JSON: { "type": "question-answer", "worksheetKind": "free-writing-profile", "prompt": "<profile writing prompt>", "sampleAnswers": ["<example profile sentence or bullet-style answer>"], "similarityThreshold": 60, "scoringMode": "proportional", "points": ${meta.points} }`,

        'jumble-word': `Convert to a jumble-word task (scrambled letters → one correct word).
Return JSON: { "type": "jumble-word", "scrambledText": "<letters with spaces as needed, e.g. Z I M M E R>", "expectedWord": "<correct word>", "boldLetter": "", "categoryTip": "<optional short hint>", "points": ${meta.points} }
- scrambledText must be an anagram-style scramble of expectedWord.`,

        rearrange: `Convert to a rearrange-the-words task (correct sentence order).
Return JSON: { "type": "rearrange", "rearrangePrompt": "<short instruction shown to students>", "rearrangeAnswer": "<correct full sentence>", "rearrangeTokens": ["<word1>","<word2>",...], "points": ${meta.points} }
- rearrangeTokens must be the words of rearrangeAnswer in correct order (the app shuffles them for the student).`,

        word_bank_fill: `Convert to a word-bank fill exercise (shared bank, multiple blanks).
Return JSON: { "type": "word_bank_fill", "instruction": "<instruction>", "wordBank": ["<word1>","<word2>",...], "items": [{"prompt":"<sentence with ___ for each blank>","answer":"<correct word>","acceptedAnswers":[]}], "reusableWords": true, "points": ${meta.points} }
- At least 2 words in wordBank and at least 2 items. Each item.answer must appear in wordBank.`,

        listening: `Convert to a listening comprehension question (teacher will attach audio later if missing).
Return JSON: { "type": "listening", "prompt": "<what the student should do>", "mediaUrl": "", "expectedTranscript": "<exact text students should type>", "attemptMode": "typing-or-speech", "points": ${meta.points} }`,

        'video-pronunciation': `Convert to a video pronunciation task (watch and speak a line).
Return JSON: { "type": "video-pronunciation", "videoUrl": "", "caption": "<line the student should speak>", "secondaryCaption": "", "secondaryCaptionAtSeconds": 5, "points": ${meta.points} }
- Leave videoUrl empty if unknown; teacher can paste a URL later.`,

        image_pin_match: `Convert to an image pin match task (labels matched to numbered pins on an image).
Return JSON: { "type": "image_pin_match", "imageUrl": "", "instruction": "<optional>", "labels": [{"id":"l1","text":"<label text>","correctPinId":"p1"},...], "pins": [{"id":"p1","x":30,"y":45},...], "settings": {"randomizeLabels": true, "allowRetry": true}, "points": ${meta.points} }
- Use 3–4 label/pin pairs. x and y are percentages 5–95. Each label.correctPinId must equal one pin.id. Leave imageUrl empty if no image; teacher uploads later.`
      };

      const targetInstruction = targetInstructions[targetType];
      if (!targetInstruction) {
        return res.status(400).json({ error: `Unsupported targetType: ${targetType}` });
      }

      const systemPrompt = `You are an expert ${lang} language teacher creating digital exercise questions.
You will receive a question in one format and must convert it to a different format.
Respond with ONLY a single JSON object matching the exact shape described. No markdown, no prose, no extra keys.
Preserve the educational content and difficulty level of the original question.
Write all question content in ${lang} unless the original is in another language.`;

      const userContent = `Source question (${displayType}):
${JSON.stringify(srcDesc, null, 2)}

Convert to: ${targetType}

${targetInstruction}

Respond with ONLY the JSON object.`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: 900,
        temperature: 0.4,
        response_format: { type: 'json_object' }
      });

      const rawContent = completion.choices[0]?.message?.content?.trim() || '{}';
      let converted;
      try {
        converted = JSON.parse(rawContent);
      } catch {
        return res.status(500).json({ error: 'AI returned invalid JSON', raw: rawContent });
      }

      // Merge preserved meta fields (keep originals unless AI explicitly populated them)
      if (meta.context && !converted.context) converted.context = meta.context;
      if (meta.instruction && !converted.instruction) converted.instruction = meta.instruction;
      if (meta.example && !converted.example) converted.example = meta.example;
      if (!converted.points) converted.points = meta.points;

      // Builder + player expect explicit `worksheetKind` for worksheet-style Q&A; models often omit it.
      if (targetType === 'true-false') {
        converted.type = 'question-answer';
        converted.worksheetKind = 'true-false';
        const samples = Array.isArray(converted.sampleAnswers) ? converted.sampleAnswers : [];
        let tf = null;
        for (const s of samples) {
          tf = parseTrueFalse(s);
          if (tf !== null) break;
        }
        if (tf === null) tf = true;
        converted.sampleAnswers = tf ? ['Richtig'] : ['Falsch'];
        if (converted.similarityThreshold == null) converted.similarityThreshold = 75;
        if (!converted.scoringMode) converted.scoringMode = 'full';
      } else if (targetType === 'sentence-transformation') {
        converted.type = 'question-answer';
        converted.worksheetKind = 'sentence-transformation';
      } else if (targetType === 'error-correction') {
        converted.type = 'question-answer';
        converted.worksheetKind = 'error-correction';
      } else if (targetType === 'free-writing-own-sentences') {
        converted.type = 'question-answer';
        converted.worksheetKind = 'free-writing-own-sentences';
      } else if (targetType === 'table-profile-fill') {
        converted.type = 'question-answer';
        converted.worksheetKind = 'table-profile-fill';
      } else if (targetType === 'question-answer') {
        converted.type = 'question-answer';
        converted.worksheetKind = null;
      } else if (targetType === 'free-writing-profile') {
        converted.type = 'question-answer';
        converted.worksheetKind = 'free-writing-profile';
        if (converted.similarityThreshold == null) converted.similarityThreshold = 60;
        if (!converted.scoringMode) converted.scoringMode = 'proportional';
      } else if (targetType === 'jumble-word') {
        converted.type = 'jumble-word';
        if (converted.boldLetter == null) converted.boldLetter = '';
        if (converted.categoryTip == null) converted.categoryTip = '';
      } else if (targetType === 'rearrange') {
        converted.type = 'rearrange';
        let toks = converted.rearrangeTokens;
        if (typeof toks === 'string') {
          toks = toks.split(/\s+/).map((t) => String(t || '').trim()).filter(Boolean);
        }
        if (!Array.isArray(toks)) toks = [];
        converted.rearrangeTokens = toks;
        if (!converted.rearrangePrompt) converted.rearrangePrompt = '';
        if (!converted.rearrangeAnswer) converted.rearrangeAnswer = '';
      } else if (targetType === 'word_bank_fill') {
        converted.type = 'word_bank_fill';
        if (!Array.isArray(converted.wordBank)) converted.wordBank = [];
        if (!Array.isArray(converted.items)) converted.items = [];
        if (converted.reusableWords == null) converted.reusableWords = true;
      } else if (targetType === 'listening') {
        converted.type = 'listening';
        if (!converted.attemptMode) converted.attemptMode = 'typing-or-speech';
        if (converted.mediaUrl == null) converted.mediaUrl = '';
      } else if (targetType === 'video-pronunciation') {
        converted.type = 'video-pronunciation';
        if (converted.secondaryCaption == null) converted.secondaryCaption = '';
        if (converted.secondaryCaptionAtSeconds == null) converted.secondaryCaptionAtSeconds = 5;
        if (converted.videoUrl == null) converted.videoUrl = '';
      } else if (targetType === 'image_pin_match') {
        converted.type = 'image_pin_match';
        if (!Array.isArray(converted.labels)) converted.labels = [];
        if (!Array.isArray(converted.pins)) converted.pins = [];
        if (!converted.settings || typeof converted.settings !== 'object') {
          converted.settings = { randomizeLabels: true, allowRetry: true };
        }
        if (converted.imageUrl == null) converted.imageUrl = '';
      }

      return res.json({ question: converted });
    } catch (err) {
      console.error('POST /digital-exercises/convert-question-type error:', err);
      return res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
