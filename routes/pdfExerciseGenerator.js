// routes/pdfExerciseGenerator.js
// PDF → AI Exercise Generator

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const { verifyToken, checkRole } = require('../middleware/auth');

// pdf-parse v2 uses PDFParse class; CJS may wrap as { default: { PDFParse } } or { PDFParse }
let PDFParseClass = null;
try {
  const _pdfParseLib = require('pdf-parse');
  PDFParseClass = _pdfParseLib.PDFParse || (_pdfParseLib.default && _pdfParseLib.default.PDFParse) || (_pdfParseLib.default && typeof _pdfParseLib.default === 'function' ? _pdfParseLib.default : null);
  if (!PDFParseClass || typeof PDFParseClass !== 'function') {
    console.warn('⚠️ pdf-parse: PDFParse class not found. PDF exercise generator will be disabled.');
    PDFParseClass = null;
  }
} catch (err) {
  console.warn('⚠️ pdf-parse failed to load:', err.message, '— PDF exercise generator will be disabled.');
}

// ─── Multer config for PDF uploads ────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'pdf-exercises');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
  }
});

const pdfFilter = (req, file, cb) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter: pdfFilter,
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

// ─── OpenAI init ──────────────────────────────────────────────────────────────

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ─── PDF text extraction ──────────────────────────────────────────────────────

async function extractPdfText(filePath) {
  if (!PDFParseClass) {
    throw new Error('PDF parsing is not available on this server. Please install compatible pdf-parse dependencies.');
  }
  let parser;
  try {
    const buffer = fs.readFileSync(filePath);
    parser = new PDFParseClass({ data: buffer });
    const result = await parser.getText();
    const text = result && typeof result.text === 'string' ? result.text : '';
    const pages = result && typeof result.total === 'number' ? result.total : 1;
    await parser.destroy().catch(() => {});
    return {
      text,
      pages,
      info: {}
    };
  } catch (err) {
    if (parser && typeof parser.destroy === 'function') {
      await parser.destroy().catch(() => {});
    }
    console.error('PDF parse error:', err);
    throw new Error('Failed to extract text from PDF: ' + err.message);
  }
}

// ─── AI generation prompt builder ────────────────────────────────────────────

function buildGenerationPrompt(pdfText, options) {
  const {
    types = ['mcq'],
    targetLanguage = 'German',
    nativeLanguage = 'English',
    level = 'A1',
    maxQuestions = 10,
    difficulty = 'Beginner'
  } = options;

  const typeDescriptions = {
    mcq: 'Multiple Choice Questions (4 options, one correct answer)',
    matching: 'Matching exercises (pairs of left/right items to match)',
    'fill-blank': 'Fill in the Blank sentences (use ___ for blanks)',
    pronunciation: 'Pronunciation checks (single words or short phrases to speak aloud)',
    'question-answer': 'Short Answer Questions — student reads the question and types a free-text answer'
  };

  const requestedTypes = types.map(t => `- ${typeDescriptions[t] || t}`).join('\n');

  const outputSchema = types.map(t => {
    if (t === 'mcq') return `{
  "type": "mcq",
  "question": "question text in ${nativeLanguage}",
  "options": ["option1", "option2", "option3", "option4"],
  "correctAnswerIndex": 0,
  "explanation": "why this is correct",
  "points": 1
}`;
    if (t === 'matching') return `{
  "type": "matching",
  "instruction": "Match the ${targetLanguage} words/phrases with their ${nativeLanguage} translations",
  "pairs": [
    {"left": "word/phrase in ${targetLanguage}", "right": "translation in ${nativeLanguage}"}
  ],
  "points": 1
}`;
    if (t === 'fill-blank') return `{
  "type": "fill-blank",
  "sentence": "sentence with ___ for each blank",
  "answers": ["correct answer for blank 1"],
  "hint": "optional grammar or vocabulary hint",
  "points": 1
}`;
    if (t === 'pronunciation') return `{
  "type": "pronunciation",
  "word": "word or short phrase in ${targetLanguage}",
  "phonetic": "/phonetic transcription/",
  "translation": "translation in ${nativeLanguage}",
  "acceptedVariants": [],
  "points": 1
}`;
    if (t === 'question-answer') return `{
  "type": "question-answer",
  "prompt": "question text in ${nativeLanguage} (student types a short answer)",
  "sampleAnswers": ["acceptable answer 1", "acceptable answer 2"],
  "aiGradingEnabled": true,
  "points": 1
}`;
    return '';
  }).filter(Boolean).join(',\n');

  return `You are an expert ${targetLanguage} language teacher and exercise creator.

TASK: Analyze the following PDF content and generate interactive language exercises.

TARGET LANGUAGE: ${targetLanguage}
NATIVE LANGUAGE: ${nativeLanguage}  
LEVEL: ${level} (CEFR)
DIFFICULTY: ${difficulty}
MAX QUESTIONS: ${maxQuestions}

EXERCISE TYPES TO GENERATE:
${requestedTypes}

ANALYSIS INSTRUCTIONS:
1. DETECT if the PDF already contains questions/exercises (look for numbered questions, multiple-choice options, fill-in-blank gaps, etc.)
   - If YES: Extract and convert them directly to the requested format
   - If NO: Generate new questions from the content/vocabulary/grammar in the text

2. For MCQ: Create clear questions with 4 options, exactly one correct answer. Use ${nativeLanguage} for the question.
3. For Matching: Create 4-6 pairs. Use ${targetLanguage} vocabulary on the left, ${nativeLanguage} translations on the right.
4. For Fill-in-blank: Use real sentences from the content, replace key ${targetLanguage} words with ___ (three underscores).
5. For Pronunciation: Pick important ${targetLanguage} words/phrases from the content.
6. For Question/Answer: Write an open-ended question in ${nativeLanguage} based on the content. Provide 1-3 sample correct answers in sampleAnswers. Keep the question concise so a student can answer in 1-2 sentences.

PDF CONTENT:
---
${pdfText.substring(0, 8000)}
---

RESPONSE FORMAT — Return ONLY valid JSON, no markdown, no extra text:
{
  "suggestedTitle": "Short exercise title based on content",
  "suggestedDescription": "One sentence describing what students will practice",
  "detectedLevel": "${level}",
  "detectedLanguage": "${targetLanguage}",
  "contentType": "questions_found|content_only|mixed",
  "questions": [
    ${outputSchema}
  ]
}

RULES:
- Generate up to ${maxQuestions} questions total
- Distribute questions across the requested types
- All questions must be relevant to the PDF content
- Questions should be appropriate for ${level} level students
- For MCQ options: make wrong answers plausible but clearly incorrect
- For fill-blank: each ___ represents exactly one blank with one answer in the answers array
- Return ONLY the JSON object, nothing else`;
}

// ─── ROUTE: POST /api/pdf-exercises/upload ────────────────────────────────────
// Upload PDF, extract text, return preview

router.post('/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  upload.single('pdf'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No PDF file uploaded' });
      }

      const result = await extractPdfText(req.file.path);

      // Return preview (first 2000 chars of text) and file reference
      const previewText = result.text.substring(0, 2000);

      res.json({
        success: true,
        uploadId: path.basename(req.file.path),
        filename: req.file.originalname,
        pages: result.pages,
        totalChars: result.text.length,
        previewText,
        hasContent: result.text.trim().length > 50
      });
    } catch (err) {
      // Clean up on error
      if (req.file) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
      console.error('PDF upload error:', err);
      res.status(500).json({ error: err.message || 'Failed to process PDF' });
    }
  }
);

// ─── ROUTE: POST /api/pdf-exercises/generate ─────────────────────────────────
// Generate exercises from uploaded PDF using AI

router.post('/generate',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const {
      uploadId,
      types,
      targetLanguage,
      nativeLanguage,
      level,
      difficulty,
      maxQuestions
    } = req.body;

    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId is required' });
    }

    if (!openai) {
      return res.status(503).json({ error: 'AI service is not configured. Please set OPENAI_API_KEY.' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', 'pdf-exercises', uploadId);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'PDF file not found. Please upload again.' });
    }

    try {
      // Extract text
      const pdfData = await extractPdfText(filePath);

      if (!pdfData.text || pdfData.text.trim().length < 20) {
        return res.status(422).json({
          error: 'Could not extract readable text from the PDF. The PDF may be image-based or scanned. Please use a text-based PDF.'
        });
      }

      // Build prompt and call OpenAI
      const prompt = buildGenerationPrompt(pdfData.text, {
        types: types || ['mcq'],
        targetLanguage: targetLanguage || 'German',
        nativeLanguage: nativeLanguage || 'English',
        level: level || 'A1',
        difficulty: difficulty || 'Beginner',
        maxQuestions: Math.min(parseInt(maxQuestions) || 10, 100)
      });

      console.log(`🤖 Generating exercises from PDF: ${uploadId} (${pdfData.pages} pages, ${pdfData.text.length} chars)`);

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert language exercise creator. Always respond with valid JSON only, no markdown code blocks, no extra text.'
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 4000,
        temperature: 0.4
      });

      const rawContent = completion.choices[0].message.content.trim();

      // Parse the response
      let generated;
      try {
        // Strip markdown code blocks if present
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

      // Validate and sanitize questions
      const questions = (generated.questions || [])
        .filter(q => q && q.type && ['mcq', 'matching', 'fill-blank', 'pronunciation', 'question-answer'].includes(q.type))
        .map(q => sanitizeQuestion(q));

      if (questions.length === 0) {
        return res.status(422).json({
          error: 'AI could not generate valid exercises from this PDF content. Please try with different exercise types or a more content-rich PDF.'
        });
      }

      res.json({
        success: true,
        suggestedTitle: generated.suggestedTitle || 'Generated Exercise',
        suggestedDescription: generated.suggestedDescription || '',
        detectedLevel: generated.detectedLevel || level || 'A1',
        contentType: generated.contentType || 'content_only',
        questions,
        pdfInfo: {
          pages: pdfData.pages,
          uploadId
        }
      });

    } catch (err) {
      console.error('Exercise generation error:', err);
      if (err.code === 'insufficient_quota') {
        return res.status(503).json({ error: 'AI quota exceeded. Please try again later.' });
      }
      res.status(500).json({ error: err.message || 'Failed to generate exercises' });
    }
  }
);

// ─── ROUTE: DELETE /api/pdf-exercises/cleanup/:uploadId ──────────────────────
// Clean up uploaded PDF after exercise is saved

router.delete('/cleanup/:uploadId',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  (req, res) => {
    const filePath = path.join(__dirname, '..', 'uploads', 'pdf-exercises', req.params.uploadId);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      res.json({ success: true });
    } catch {
      res.json({ success: false });
    }
  }
);

// ─── Helper: sanitize/normalize a question from AI output ────────────────────

function sanitizeQuestion(q) {
  const base = { type: q.type, points: parseInt(q.points) || 1 };

  if (q.type === 'mcq') {
    const options = Array.isArray(q.options) ? q.options.map(String) : ['Option A', 'Option B', 'Option C', 'Option D'];
    const cai = parseInt(q.correctAnswerIndex);
    return {
      ...base,
      question: String(q.question || 'Question'),
      imageUrl: q.imageUrl || null,
      options: options.slice(0, 6),
      correctAnswerIndex: (isNaN(cai) || cai < 0 || cai >= options.length) ? 0 : cai,
      explanation: String(q.explanation || '')
    };
  }

  if (q.type === 'matching') {
    const pairs = Array.isArray(q.pairs)
      ? q.pairs.filter(p => p.left && p.right).map(p => ({ left: String(p.left), right: String(p.right) }))
      : [];
    return {
      ...base,
      instruction: String(q.instruction || 'Match the items on the left with their correct pairs on the right.'),
      pairs: pairs.length >= 2 ? pairs : [{ left: 'Word 1', right: 'Translation 1' }, { left: 'Word 2', right: 'Translation 2' }]
    };
  }

  if (q.type === 'fill-blank') {
    const sentence = String(q.sentence || '');
    const blanks = (sentence.match(/___/g) || []).length;
    const answers = Array.isArray(q.answers)
      ? q.answers.slice(0, blanks).map(String)
      : new Array(blanks).fill('');
    // Pad answers if needed
    while (answers.length < blanks) answers.push('');
    return {
      ...base,
      sentence,
      answers,
      hint: String(q.hint || ''),
      caseSensitive: false
    };
  }

  if (q.type === 'pronunciation') {
    return {
      ...base,
      word: String(q.word || ''),
      phonetic: String(q.phonetic || ''),
      translation: String(q.translation || ''),
      audioUrl: q.audioUrl || null,
      acceptedVariants: Array.isArray(q.acceptedVariants) ? q.acceptedVariants.map(String) : []
    };
  }

  if (q.type === 'question-answer') {
    return {
      ...base,
      prompt: String(q.prompt || ''),
      sampleAnswers: Array.isArray(q.sampleAnswers) ? q.sampleAnswers.map(String).filter(Boolean) : [],
      aiGradingEnabled: q.aiGradingEnabled !== false
    };
  }

  return base;
}

module.exports = router;
