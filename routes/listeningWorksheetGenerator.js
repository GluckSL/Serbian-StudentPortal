// routes/listeningWorksheetGenerator.js
// Extract a "manual listening worksheet" from a PDF that contains audio-related questions.
//
// Teacher/Admin flow:
// 1) Upload PDF using existing /api/pdf-exercises/upload (Multer stores it in uploads/pdf-exercises/)
// 2) Upload audio using existing /api/listening-media/upload
// 3) Call this endpoint with the `uploadId` (PDF reference) to extract questions.
//
// This endpoint returns strict JSON that matches the DigitalExercise.questions shape.

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');

const { verifyToken, checkRole } = require('../middleware/auth');

// pdf-parse v2 uses PDFParse class; CJS may wrap as { default: { PDFParse } } or { PDFParse }
let PDFParseClass = null;
try {
  const _pdfParseLib = require('pdf-parse');
  PDFParseClass =
    _pdfParseLib.PDFParse ||
    (_pdfParseLib.default && _pdfParseLib.default.PDFParse) ||
    (_pdfParseLib.default && typeof _pdfParseLib.default === 'function' ? _pdfParseLib.default : null);
  if (!PDFParseClass || typeof PDFParseClass !== 'function') {
    console.warn('⚠️ pdf-parse: PDFParse class not found. Listening worksheet generator will be disabled.');
    PDFParseClass = null;
  }
} catch (err) {
  console.warn('⚠️ pdf-parse failed to load:', err.message, '— Listening worksheet generator will be disabled.');
}

async function extractPdfText(filePath) {
  if (!PDFParseClass) {
    throw new Error('pdf-parse is not available on this server. Listening worksheet generator is disabled.');
  }
  let parser;
  try {
    const buffer = fs.readFileSync(filePath);
    parser = new PDFParseClass({ data: buffer });
    const result = await parser.getText();
    const text = result && typeof result.text === 'string' ? result.text : '';
    const pages = result && typeof result.total === 'number' ? result.total : 1;
    await parser.destroy().catch(() => {});
    return { text, pages };
  } catch (err) {
    if (parser && typeof parser.destroy === 'function') {
      await parser.destroy().catch(() => {});
    }
    console.error('PDF parse error:', err);
    throw new Error('Failed to extract text from PDF: ' + err.message);
  }
}

function buildWorksheetPrompt(pdfText, options) {
  const {
    targetLanguage = 'German',
    nativeLanguage = 'English',
    level = 'A1',
    difficulty = 'Beginner',
    maxQuestions = 25
  } = options || {};

  return `You are an expert language teacher and exercise extractor.
TASK: Extract the listening-worksheet questions from the PDF text below.

IMPORTANT:
1) The PDF contains questions that are related to a teacher-uploaded audio. You do NOT need to analyze the audio file.
2) Extract ONLY these question types that are required by the system:
   - mcq
   - fill-blank
   - question-answer
   - pronunciation
3) Return the questions EXACTLY as they appear in the PDF (wording and answer options), including correct answers.
4) Use these field rules:
   - mcq:
     - "question": question text
     - "options": 4 options (strings)
     - "correctAnswerIndex": 0-based index into options for the correct option
     - "explanation": brief explanation if available, else ""
   - fill-blank:
     - "sentence": sentence using exactly three underscores ___ for each blank
     - "answers": array of correct answers in the same order as blanks
     - "hint": optional hint or "".
   - question-answer:
     - "prompt": question text
     - "sampleAnswers": array of acceptable correct answers (strings). If the PDF provides one answer, return one element.
     - "similarityThreshold": integer 0-100 (use 70 if not specified)
     - "scoringMode": "full" or "proportional" (use "full" if not specified)
   - pronunciation:
     - "word": target word or short phrase to speak
     - "phonetic": phonetic spelling if available else ""
     - "translation": translation if available else ""
     - "acceptedVariants": array of acceptable variants (strings) if given else []
5) Keep each question's "points" as 1 unless points are explicitly specified in the PDF.

LEVEL: ${level}
DIFFICULTY: ${difficulty}
TARGET_LANGUAGE: ${targetLanguage}
NATIVE_LANGUAGE: ${nativeLanguage}
MAX_QUESTIONS: ${maxQuestions}

PDF TEXT:
---
${pdfText.substring(0, 18000)}
---

RESPONSE FORMAT (Return ONLY valid JSON, no markdown, no extra keys):
{
  "suggestedTitle": "short exercise title",
  "suggestedDescription": "one sentence describing what students do",
  "detectedLevel": "${level}",
  "questions": [
    {
      "type": "mcq | fill-blank | question-answer | pronunciation",
      "points": 1,
      "question": "...",
      "options": ["...", "...", "...", "..."],
      "correctAnswerIndex": 0,
      "explanation": ""
    }
  ]
}
`;
}

function sanitizeListeningQuestion(q) {
  const type = q?.type;
  const points = Number.isFinite(parseInt(q?.points)) ? parseInt(q.points) : 1;

  if (!['mcq', 'fill-blank', 'question-answer', 'pronunciation'].includes(type)) return null;

  if (type === 'mcq') {
    const question = String(q.question || 'Question');
    const optionsRaw = Array.isArray(q.options) ? q.options : [];
    const options = optionsRaw.map(o => String(o)).map(s => s.trim()).filter(Boolean);
    const safeOptions = options.length >= 2 ? options : ['Option A', 'Option B'];

    let correctAnswerIndex = parseInt(q.correctAnswerIndex);
    if (!Number.isFinite(correctAnswerIndex) || correctAnswerIndex < 0 || correctAnswerIndex >= safeOptions.length) {
      correctAnswerIndex = 0;
    }

    return {
      type: 'mcq',
      question,
      imageUrl: q.imageUrl ? String(q.imageUrl) : null,
      options: safeOptions.slice(0, 6),
      correctAnswerIndex,
      explanation: q.explanation ? String(q.explanation) : ''
    };
  }

  if (type === 'fill-blank') {
    const sentence = String(q.sentence || '').trim();
    // Count ___ blanks (strictly the required pattern).
    const blanks = (sentence.match(/___/g) || []).length;
    const answersRaw = Array.isArray(q.answers) ? q.answers : [];
    const answers = answersRaw.map(a => String(a).trim()).filter(a => a !== '');

    if (!sentence || blanks === 0) return null;

    const safeAnswers = answers.length > 0 ? answers.slice(0, blanks) : new Array(blanks).fill('');
    while (safeAnswers.length < blanks) safeAnswers.push('');

    return {
      type: 'fill-blank',
      sentence,
      answers: safeAnswers,
      hint: q.hint ? String(q.hint) : '',
      caseSensitive: q.caseSensitive === true,
      points
    };
  }

  if (type === 'question-answer') {
    const prompt = String(q.prompt || '').trim();
    if (!prompt) return null;

    const sampleAnswers = Array.isArray(q.sampleAnswers)
      ? q.sampleAnswers.map(a => String(a).trim()).filter(Boolean).slice(0, 6)
      : [];

    const similarityThreshold = Number.isFinite(parseInt(q.similarityThreshold))
      ? Math.max(0, Math.min(100, parseInt(q.similarityThreshold)))
      : 70;

    const scoringMode = q.scoringMode === 'proportional' ? 'proportional' : 'full';

    return {
      type: 'question-answer',
      prompt,
      sampleAnswers,
      similarityThreshold,
      scoringMode,
      points
    };
  }

  if (type === 'pronunciation') {
    const word = String(q.word || '').trim();
    if (!word) return null;

    const acceptedVariants = Array.isArray(q.acceptedVariants)
      ? q.acceptedVariants.map(v => String(v).trim()).filter(Boolean).slice(0, 10)
      : [];

    return {
      type: 'pronunciation',
      word,
      phonetic: q.phonetic ? String(q.phonetic) : '',
      translation: q.translation ? String(q.translation) : '',
      audioUrl: q.audioUrl ? String(q.audioUrl) : null,
      acceptedVariants,
      points
    };
  }

  return null;
}

// ─── ROUTE: POST /api/listening-worksheets/generate ───────────────────────────
router.post('/generate', verifyToken, checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']), async (req, res) => {
  const {
    uploadId,
    audioUrl, // optional (not required for extraction)
    targetLanguage,
    nativeLanguage,
    level,
    difficulty,
    maxQuestions
  } = req.body || {};

  if (!uploadId || typeof uploadId !== 'string') {
    return res.status(400).json({ error: 'uploadId is required' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'AI service is not configured. Please set OPENAI_API_KEY.' });
  }

  const filePath = path.join(__dirname, '..', 'uploads', 'pdf-exercises', uploadId);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'PDF file not found. Please upload again.' });
  }

  try {
    const pdfData = await extractPdfText(filePath);
    if (!pdfData.text || pdfData.text.trim().length < 20) {
      return res.status(422).json({
        error: 'Could not extract readable text from the PDF. The PDF may be image-based or scanned.'
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const prompt = buildWorksheetPrompt(pdfData.text, {
      targetLanguage: targetLanguage || 'German',
      nativeLanguage: nativeLanguage || 'English',
      level: level || 'A1',
      difficulty: difficulty || 'Beginner',
      maxQuestions: Math.min(parseInt(maxQuestions) || 25, 50)
    });

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a strict JSON API. Return ONLY valid JSON. No markdown. No extra keys.'
        },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4500,
      temperature: 0.3
    });

    const rawContent = (completion.choices?.[0]?.message?.content || '').trim();

    let generated;
    try {
      const cleaned = rawContent
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      generated = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON parse error from AI response:', rawContent.substring(0, 500));
      return res.status(500).json({
        error: 'AI returned an unexpected format. Please try again.',
        details: process.env.NODE_ENV === 'development' ? rawContent.substring(0, 300) : undefined
      });
    }

    const questions = (generated?.questions || [])
      .map(sanitizeListeningQuestion)
      .filter(Boolean)
      .slice(0, Math.min(parseInt(maxQuestions) || 25, 50));

    if (!questions.length) {
      return res.status(422).json({
        error: 'AI could not extract valid questions from this PDF. Please try a different worksheet PDF.'
      });
    }

    res.json({
      success: true,
      suggestedTitle: generated?.suggestedTitle || 'Listening Worksheet',
      suggestedDescription: generated?.suggestedDescription || 'Listen and answer the questions from the worksheet.',
      detectedLevel: generated?.detectedLevel || level || 'A1',
      questions,
      pdfInfo: { pages: pdfData.pages, uploadId }
    });
  } catch (err) {
    console.error('Listening worksheet extraction error:', err);
    res.status(500).json({ error: err.message || 'Failed to extract listening worksheet' });
  }
});

module.exports = router;

