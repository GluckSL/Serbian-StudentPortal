// routes/pdfExerciseGenerator.js
// PDF → AI Exercise Generator

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const { verifyToken, checkRole } = require('../middleware/auth');

// Support both pdf-parse APIs:
// - v1: module exports a function (pdf(buffer) -> { text, numpages, ... })
// - v2: module exports PDFParse class with getText()
let PDFParseClass = null;
let parsePdfBuffer = null;
try {
  const _pdfParseLib = require('pdf-parse');
  PDFParseClass = _pdfParseLib.PDFParse || (_pdfParseLib.default && _pdfParseLib.default.PDFParse) || null;

  if (typeof _pdfParseLib === 'function') {
    parsePdfBuffer = _pdfParseLib;
  } else if (_pdfParseLib && typeof _pdfParseLib.default === 'function') {
    parsePdfBuffer = _pdfParseLib.default;
  }

  if (!parsePdfBuffer && (!PDFParseClass || typeof PDFParseClass !== 'function')) {
    console.warn('⚠️ pdf-parse loaded, but no compatible parser export found. PDF exercise generator will be disabled.');
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
  if (!parsePdfBuffer && !PDFParseClass) {
    throw new Error('PDF parsing is not available on this server. Please install compatible pdf-parse dependencies.');
  }

  const buffer = fs.readFileSync(filePath);

  // Prefer v1/v1-compatible function parser when available (most deployment-friendly path).
  if (typeof parsePdfBuffer === 'function') {
    try {
      const result = await parsePdfBuffer(buffer);
      const text = result && typeof result.text === 'string' ? result.text : '';
      const pages = result && Number.isFinite(Number(result.numpages))
        ? Number(result.numpages)
        : (result && Number.isFinite(Number(result.total)) ? Number(result.total) : 1);
      return {
        text,
        pages,
        info: result && typeof result.info === 'object' ? result.info : {}
      };
    } catch (err) {
      console.error('PDF parse error (function API):', err);
      throw new Error('Failed to extract text from PDF: ' + err.message);
    }
  }

  let parser = null;
  try {
    parser = new PDFParseClass({ data: buffer });
    const result = await parser.getText();
    const text = result && typeof result.text === 'string' ? result.text : '';
    const pages = result && typeof result.total === 'number' ? result.total : 1;
    if (typeof parser.destroy === 'function') {
      await parser.destroy().catch(() => {});
    }
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

// ─── Question-type detector ───────────────────────────────────────────────────
// Scans raw PDF text and returns estimated counts per exercise type.
// Also returns a worksheetMode flag when structured worksheet markers are found.

function detectQuestionTypes(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const counts = {
    mcq: 0,
    matching: 0,
    'fill-blank': 0,
    pronunciation: 0,
    'question-answer': 0,
    'true-false': 0,
    'sentence-transformation': 0,
    'singular-plural': 0,
    'table-profile-fill': 0,
    'free-writing-own-sentences': 0,
    'free-writing-profile': 0,
    'error-correction': 0
  };

  // ── Worksheet detection (German/English structured worksheets) ──────────────
  // These keywords reliably signal a structured teacher-created worksheet that
  // contains an answer key and numbered Übung blocks.
  const worksheetSignals = [
    /\bSTUFE\s*\d/i,
    /\bLÖSUNGSSCHLÜSSEL\b/i,
    /\bAnswer\s+Key\b/i,
    /\bÜbung\s+L?\d/i,
    /\b(LEICHT|MITTEL|SCHWER)\b/i,
    /\bSelbstlernen\b/i,
    /\bHinweis\s*\/\s*Note\b/i
  ];
  const isWorksheet = worksheetSignals.some(re => re.test(text));

  // ── Fill-in-the-blank ───────────────────────────────────────────────────────
  // Lines containing ___ blanks; also detect German Lückentext headings
  const fillBlankLines = lines.filter(l => /_{3,}/.test(l));
  const luckentextHeadings = lines.filter(l =>
    /\b(Lückentext|Ergänzen\s+Sie|ergänze|fill\s+in|fill-in|Lücke)\b/i.test(l)
  );
  counts['fill-blank'] = Math.min(fillBlankLines.length || luckentextHeadings.length * 4, 50);

  // ── MCQ: groups of option-style lines a)/b)/c)... ──────────────────────────
  let mcqCount = 0;
  let optionRunLen = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const isOption =
      /^[a-dA-D][.)]\s+\S/.test(l) ||
      /^\([a-dA-D]\)\s+\S/.test(l) ||
      /^[a-dA-D]\s*[-–]\s+\S/.test(l);
    if (isOption) {
      optionRunLen++;
      if (optionRunLen >= 3) {
        mcqCount++;
        optionRunLen = 0;
        while (
          i + 1 < lines.length &&
          (/^[a-dA-D][.)]\s/.test(lines[i + 1]) || /^\([a-dA-D]\)/.test(lines[i + 1]))
        ) i++;
      }
    } else {
      optionRunLen = 0;
    }
  }
  counts.mcq = Math.min(mcqCount, 50);

  // ── Matching ────────────────────────────────────────────────────────────────
  // German worksheet matching: "Ordnen Sie zu", "Zuordnung", "Verbinden Sie", etc.
  let matchHeadingCount = 0;
  let matchItemsTotal = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const isMatchHeading =
      /\b(match|zuordnen|verbinde|ordne\s+zu|pair\s+up|connect|Zuordnung|Ordnen\s+Sie\s+zu|Verbinden\s+Sie)\b/i.test(l);
    if (isMatchHeading) {
      matchHeadingCount++;
      let items = 0;
      for (let j = i + 1; j < Math.min(i + 25, lines.length); j++) {
        if (/^\d+[.)]\s+\S/.test(lines[j]) || /^[a-fA-F][.)]\s+\S/.test(lines[j])) items++;
      }
      matchItemsTotal += items || 4; // default estimate 4 pairs per heading
    }
  }
  if (matchHeadingCount > 0) {
    counts.matching = Math.min(matchHeadingCount, 10);
  }

  // ── Pronunciation ───────────────────────────────────────────────────────────
  const phoneticLines = lines.filter(l => /\/[^/\n]{1,30}\//.test(l));
  const pronunciationHeadings = lines.filter(l =>
    /\b(pronunciation|aussprache|phonetic|speak\s+aloud|pronounce)\b/i.test(l)
  );
  if (phoneticLines.length > 0) {
    counts.pronunciation = Math.min(phoneticLines.length, 30);
  } else if (pronunciationHeadings.length > 0) {
    counts.pronunciation = Math.min(pronunciationHeadings.length * 3, 20);
  }

  // ── Question / Answer (open ended) ─────────────────────────────────────────
  // Covers: W-Fragen, Ja-Nein-Fragen transformation, Fehlerkorrektur, Steckbrief,
  // Eigene Sätze, and any numbered question ending in ?
  let qaCount = 0;

  // German worksheet open-answer headings
  const qaHeadings = lines.filter(l =>
    /\b(W-Frage|Ja[-–]Nein|Fragewort|Fehlerkorrektur|korrigieren\s+Sie|Eigene\s+Sätze|Steckbrief|Aussagesatz|bilden\s+Sie|Schreiben\s+Sie|Transformation|Umformen)\b/i.test(l)
  );
  qaCount += qaHeadings.length * 3; // rough estimate: ~3 items per heading

  // Numbered questions ending in ?
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\d+[.)]\s+.{5,}\?\s*$/.test(l)) {
      const nextLine = lines[i + 1] || '';
      const nextIsOption = /^[a-dA-D][.)]\s/.test(nextLine) || /^\([a-dA-D]\)/.test(nextLine);
      if (!nextIsOption) qaCount++;
    }
    // Answer-line blanks like "→ ___..." signal transformation exercises
    if (/^→\s*_{5,}/.test(l)) qaCount++;
  }
  counts['question-answer'] = Math.min(qaCount, 40);

  // ── Worksheet category aliases (STUFE worksheet style) ─────────────────
  // These are represented as `type: question-answer` internally, but
  // labeled in the UI using `worksheetKind`.
  const tfHeadings = lines.filter(l =>
    /\b(Richtig|Falsch|True|False|Ja[-–]Nein)\b/i.test(l)
  ).length;
  counts['true-false'] = Math.min(tfHeadings * 2, 20);

  const transformHeadings = lines.filter(l =>
    /\b(W-Frage|Fragewort|Transformation|Umformen|Aussagesatz)\b/i.test(l) ||
    /Aussagesatz\s*→\s*W/i.test(l)
  ).length;
  counts['sentence-transformation'] = Math.min(transformHeadings * 2, 20);

  const spHeadings = lines.filter(l =>
    /Singular\s*(?:→|->)\s*Plural|Singular.*Plural/i.test(l)
  ).length;
  counts['singular-plural'] = Math.min(spHeadings * 2, 20);

  const tableHeadings = lines.filter(l =>
    /\b(Tabelle|Table)\b/i.test(l) && !/\b(Steckbrief)\b/i.test(l)
  ).length;
  counts['table-profile-fill'] = Math.min(tableHeadings * 2, 20);

  const ownSentHeadings = lines.filter(l =>
    /\b(Eigene\s+Sätze|Schreiben\s+Sie\s+\d+\s+Sätze|Eigene\s+Sätze\s+bilden|Own\s+Sentences)\b/i.test(l)
  ).length;
  counts['free-writing-own-sentences'] = Math.min(ownSentHeadings * 2, 20);

  const profileHeadings = lines.filter(l =>
    /\b(Steckbrief|Profile|Profil)\b/i.test(l)
  ).length;
  counts['free-writing-profile'] = Math.min(profileHeadings * 2, 20);

  const errHeadings = lines.filter(l =>
    /\b(Fehlerkorrektur|korrigieren|Fehler)\b/i.test(l)
  ).length;
  counts['error-correction'] = Math.min(errHeadings * 2, 20);

  const pseudoSum = Object.values({
    'true-false': counts['true-false'],
    'sentence-transformation': counts['sentence-transformation'],
    'singular-plural': counts['singular-plural'],
    'table-profile-fill': counts['table-profile-fill'],
    'free-writing-own-sentences': counts['free-writing-own-sentences'],
    'free-writing-profile': counts['free-writing-profile'],
    'error-correction': counts['error-correction']
  }).reduce((s, v) => s + v, 0);

  // When we detect worksheet-style categories, suppress generic question-answer
  // so admins get the worksheet-specific types in the UI.
  if (isWorksheet && pseudoSum > 0) {
    counts['question-answer'] = 0;
  }

  // ── For worksheets with STUFE tiers, apply sensible defaults ───────────────
  // When a structured worksheet is detected and auto-detection yields very low
  // counts (e.g. scanned or simple PDFs), set a useful minimum mix.
  if (isWorksheet) {
    if (counts.matching === 0 && matchHeadingCount === 0) counts.matching = 2;
    if (counts['fill-blank'] === 0) counts['fill-blank'] = 3;
    if (pseudoSum === 0 && counts['question-answer'] === 0) counts['question-answer'] = 3;
  }

  return { ...counts, _worksheetMode: isWorksheet };
}

// ─── AI generation prompt builder ────────────────────────────────────────────

function buildGenerationPrompt(pdfText, options) {
  const {
    types = ['mcq'],
    typeCounts = {},        // e.g. { matching: 3, 'fill-blank': 4, 'question-answer': 3 }
    targetLanguage = 'German',
    nativeLanguage = 'English',
    level = 'A1',
    maxQuestions = 10,
    difficulty = 'Beginner',
    worksheetMode = false
  } = options;

  // Build per-type count directives
  const typeCountLines = types
    .filter(t => typeCounts[t] > 0)
    .map(t => `  - ${t}: exactly ${typeCounts[t]} question(s)`)
    .join('\n');
  const hasTypeCounts = typeCountLines.length > 0;

  const typeDescriptions = {
    mcq: 'Multiple Choice Questions (4 options, one correct answer)',
    matching: 'Matching exercises (pairs of left/right items to match)',
    'fill-blank': 'Fill in the Blank sentences (use ___ for blanks)',
    pronunciation: 'Pronunciation checks (single words or short phrases to speak aloud)',
    'question-answer': 'Open-answer questions — student reads the question and types a free-text answer',
    'true-false': 'True/False tasks — student decides if a statement is true or false',
    'sentence-transformation': 'Sentence Transformation — transform a sentence as requested',
    'singular-plural': 'Singular → Plural — write the correct plural form (with article if needed)',
    'table-profile-fill': 'Table/Profile Fill-in — fill values from a table/profile',
    'free-writing-own-sentences': 'Free Writing — Own Sentences (write your own sentences)',
    'free-writing-profile': 'Free Writing — Profile (write a short profile/Steckbrief)',
    'error-correction': 'Error Correction — correct mistakes and write the correct sentence'
  };

  const requestedTypes = types.map(t => `- ${typeDescriptions[t] || t}`).join('\n');

  const outputSchema = types.map(t => {
    const sectionTitleNote = worksheetMode
      ? `\n  "sectionTitle": "STUFE label or Übung heading from the worksheet (e.g. STUFE 1 – LEICHT, or Übung L1.6)",`
      : '';

    if (t === 'mcq') return `{
  "type": "mcq",${sectionTitleNote}
  "question": "question text in ${nativeLanguage}",
  "options": ["option1", "option2", "option3", "option4"],
  "correctAnswerIndex": 0,
  "explanation": "why this is correct",
  "points": 1
}`;
    if (t === 'matching') return `{
  "type": "matching",${sectionTitleNote}
  "instruction": "${worksheetMode
    ? 'Verbinden Sie / Match the items on the left with the correct items on the right.'
    : `Match the ${targetLanguage} words/phrases with their ${nativeLanguage} translations`}",
  "pairs": [
    {"left": "${worksheetMode ? 'left value exactly as shown in the worksheet' : `word/phrase in ${targetLanguage}`}", "right": "${worksheetMode ? 'right value exactly as shown in the worksheet' : `translation in ${nativeLanguage}`}"}
  ],
  "points": 1
}`;
    if (t === 'fill-blank') return `{
  "type": "fill-blank",${sectionTitleNote}
  "sentence": "${worksheetMode
    ? 'sentence from the worksheet with ___ for each blank'
    : 'sentence with ___ for each blank'}",
  "answers": ["correct answer for blank 1"],
  "hint": "optional grammar or vocabulary hint",
  "points": 1
}`;
    if (t === 'pronunciation') return `{
  "type": "pronunciation",${sectionTitleNote}
  "word": "word or short phrase in ${targetLanguage}",
  "phonetic": "/phonetic transcription/",
  "translation": "translation in ${nativeLanguage}",
  "acceptedVariants": [],
  "points": 1
}`;
    if (t === 'question-answer') return `{
  "type": "question-answer",${sectionTitleNote}
  "prompt": "${worksheetMode
    ? 'instruction or question from the worksheet (keep original language, e.g. German)'
    : `question text in ${nativeLanguage}`}",
  "sampleAnswers": ["acceptable answer 1", "acceptable answer 2", "acceptable answer 3"],
  "similarityThreshold": 65,
  "scoringMode": "proportional",
  "aiGradingEnabled": true,
  "points": 1
}`;

    // Worksheet-category aliases: all use the question-answer engine, but
    // are labeled via worksheetKind for UI rendering.
    if (t === 'true-false') return `{
  "type": "question-answer",${sectionTitleNote}
  "worksheetKind": "true-false",
  "prompt": "${worksheetMode
    ? 'True/False instruction from the worksheet (German). Include the statement to judge.'
    : 'True/False instruction in German. Include the statement to judge.'}",
  "sampleAnswers": ["correct boolean answer (richtig or falsch)"],
  "similarityThreshold": 75,
  "scoringMode": "full",
  "aiGradingEnabled": true,
  "points": 1
}`;
    if (t === 'sentence-transformation') return `{
  "type": "question-answer",${sectionTitleNote}
  "worksheetKind": "sentence-transformation",
  "prompt": "${worksheetMode
    ? 'Sentence transformation instruction from the worksheet (German). Student writes the transformed sentence/question.'
    : 'Sentence transformation instruction in German. Student writes the transformed sentence/question.'}",
  "sampleAnswers": ["correct transformation 1", "correct transformation 2", "correct transformation 3"],
  "similarityThreshold": 70,
  "scoringMode": "full",
  "aiGradingEnabled": true,
  "points": 1
}`;
    if (t === 'singular-plural') return `{
  "type": "question-answer",${sectionTitleNote}
  "worksheetKind": "singular-plural",
  "prompt": "${worksheetMode
    ? 'Singular → Plural instruction from the worksheet (German). Student writes the plural form (with article if shown).'
    : 'Singular → Plural instruction in German. Student writes the plural form (with article if shown).'}",
  "sampleAnswers": ["plural form 1", "plural form 2"],
  "similarityThreshold": 70,
  "scoringMode": "full",
  "aiGradingEnabled": true,
  "points": 1
}`;
    if (t === 'table-profile-fill') return `{
  "type": "question-answer",${sectionTitleNote}
  "worksheetKind": "table-profile-fill",
  "prompt": "${worksheetMode
    ? 'Table/profile fill-in instruction from the worksheet (German). Student writes the missing values.'
    : 'Table/profile fill-in instruction in German. Student writes the missing values.'}",
  "sampleAnswers": ["filled values 1", "filled values 2"],
  "similarityThreshold": 60,
  "scoringMode": "proportional",
  "aiGradingEnabled": true,
  "points": 1
}`;
    if (t === 'free-writing-own-sentences') return `{
  "type": "question-answer",${sectionTitleNote}
  "worksheetKind": "free-writing-own-sentences",
  "prompt": "${worksheetMode
    ? 'Free writing / own sentences instruction from the worksheet (German). Write the required number of sentences.'
    : 'Free writing / own sentences instruction in German. Write the required number of sentences.'}",
  "sampleAnswers": ["example sentences 1", "example sentences 2"],
  "similarityThreshold": 60,
  "scoringMode": "proportional",
  "aiGradingEnabled": true,
  "points": 1
}`;
    if (t === 'free-writing-profile') return `{
  "type": "question-answer",${sectionTitleNote}
  "worksheetKind": "free-writing-profile",
  "prompt": "${worksheetMode
    ? 'Profile/Steckbrief writing instruction from the worksheet (German). Write a short profile.'
    : 'Profile/Steckbrief writing instruction in German. Write a short profile.'}",
  "sampleAnswers": ["profile example 1", "profile example 2"],
  "similarityThreshold": 60,
  "scoringMode": "proportional",
  "aiGradingEnabled": true,
  "points": 1
}`;
    if (t === 'error-correction') return `{
  "type": "question-answer",${sectionTitleNote}
  "worksheetKind": "error-correction",
  "prompt": "${worksheetMode
    ? 'Error correction instruction from the worksheet (German). Student writes the corrected sentence(s).'
    : 'Error correction instruction in German. Student writes the corrected sentence(s).'}",
  "sampleAnswers": ["corrected sentence 1", "corrected sentence 2"],
  "similarityThreshold": 70,
  "scoringMode": "full",
  "aiGradingEnabled": true,
  "points": 1
}`;
    return '';
  }).filter(Boolean).join(',\n');

  // Include the tail of the document to capture answer keys that appear at the end
  const headText = pdfText.substring(0, 6000);
  const tailStart = Math.max(6000, pdfText.length - 3000);
  const tailText = tailStart < pdfText.length ? pdfText.substring(tailStart) : '';
  const fullContent = tailText
    ? `${headText}\n\n[... middle section omitted for brevity ...]\n\n${tailText}`
    : headText;

  const worksheetInstructions = worksheetMode ? `
WORKSHEET-SPECIFIC RULES (worksheetMode is ON — this is a structured language worksheet):
- The document contains STUFE (difficulty tier) sections: STUFE 1 (easy), STUFE 2 (medium), STUFE 3 (hard/difficult).
- There is a LÖSUNGSSCHLÜSSEL / Answer Key section — USE IT to set exact correct answers.
- For every Übung (exercise) block in the document, extract the exercise type and create the appropriate question(s):
  • "Zuordnung" / "Ordnen Sie zu" / "Verbinden Sie" → matching
  • "Lückentext" / "Ergänzen Sie" → fill-blank (one ___ per missing word, answers from the answer key)
  • "Aussagesatz → W-Frage" / "W-Fragen" / "Fragewort" → sentence-transformation (question-answer task with worksheetKind="sentence-transformation")
  • "Aussagesatz → Ja-Nein-Frage" / "Ja-Nein-Fragen" / "True/False" → true-false (question-answer task with worksheetKind="true-false")
  • "Singular → Plural" / "Plural" → singular-plural (question-answer task with worksheetKind="singular-plural")
  • "sein oder haben" / "S/H category" → fill-blank (answers: "S" or "H" or the verb form)
  • "Fehlerkorrektur" / "korrigieren" / "Error Correction" → error-correction (question-answer task with worksheetKind="error-correction")
  • "Eigene Sätze bilden" / "Schreiben Sie" / "Free Writing / Own Sentences" → free-writing-own-sentences (question-answer task with worksheetKind="free-writing-own-sentences")
  • "Steckbrief" / "Profile" / "Free Writing – profile" → free-writing-profile (question-answer task with worksheetKind="free-writing-profile")
  • "Tabelle" / "Profil" / "Table / Profile Fill-in" → table-profile-fill (question-answer task with worksheetKind="table-profile-fill")
- Include "sectionTitle" on every question using the STUFE label and/or Übung number (e.g. "STUFE 1 – LEICHT | Übung L1.1").
- For numbered-item exercises (e.g. Übung with 6 numbered lines), create ONE question per numbered item where feasible, or group them if they form a cohesive matching set.
- Use the answer key to populate correct answers — do not guess.` : '';

  const countDirective = hasTypeCounts
    ? `\nEXACT QUESTION COUNTS REQUIRED:\n${typeCountLines}\n(Generate exactly these numbers — no more, no less for each type.)`
    : `\nGenerate up to ${maxQuestions} questions total, distributing them across the requested types.`;

  return `You are an expert ${targetLanguage} language teacher and exercise creator.

TASK: Analyze the following ${worksheetMode ? 'structured language worksheet' : 'document'} and generate interactive digital language exercises.

TARGET LANGUAGE: ${targetLanguage}
NATIVE LANGUAGE: ${nativeLanguage}
LEVEL: ${level} (CEFR)
DIFFICULTY: ${difficulty}
${countDirective}

EXERCISE TYPES TO GENERATE:
${requestedTypes}
${worksheetInstructions}
GENERAL ANALYSIS INSTRUCTIONS:
1. ${worksheetMode
  ? 'Extract exercises directly from the worksheet. Use the answer key section (LÖSUNGSSCHLÜSSEL / Answer Key) to set all correct answers.'
  : 'Detect if content already contains questions, then either extract or generate questions based on the vocabulary and grammar in the text.'}
2. For MCQ: 4 options, exactly one correct. Use ${nativeLanguage} for the question stem.
3. For Matching: 4–6 pairs per question. ${worksheetMode ? 'Copy left/right values verbatim from the worksheet table.' : `${targetLanguage} on the left, ${nativeLanguage} on the right.`}
4. For Fill-in-blank: use ___ (three underscores) for each missing word; answers array must have exactly one entry per blank.
5. For Pronunciation: key ${targetLanguage} words from the content.
6. For Question/Answer: provide 2–4 sampleAnswers covering acceptable phrasings. Set scoringMode "proportional" for open writing tasks, "full" for exact transformations. Use similarityThreshold 60–70 depending on strictness needed.

DOCUMENT CONTENT:
---
${fullContent}
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

STRICT RULES:
- Return ONLY the JSON object — no markdown fences, no commentary.
- Each ___ in fill-blank sentences must have exactly one matching entry in the answers array.
- sampleAnswers for question-answer must contain all plausible correct phrasings so AI grading succeeds.
- For worksheetMode matching, copy the exact values from the document; do not translate.${worksheetMode ? '\n- Always include "sectionTitle" on every question.' : ''}`;
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
      const rawDetected = detectQuestionTypes(result.text);
      const { _worksheetMode, ...detectedTypes } = rawDetected;

      res.json({
        success: true,
        uploadId: path.basename(req.file.path),
        filename: req.file.originalname,
        pages: result.pages,
        totalChars: result.text.length,
        previewText,
        hasContent: result.text.trim().length > 50,
        detectedTypes,
        worksheetMode: _worksheetMode
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
      typeCounts,
      targetLanguage,
      nativeLanguage,
      level,
      difficulty,
      maxQuestions,
      worksheetMode: clientWorksheetMode
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

      // Detect worksheet mode from the extracted text unless the client explicitly specifies
      const rawDetected = detectQuestionTypes(pdfData.text);
      const worksheetMode = clientWorksheetMode != null ? Boolean(clientWorksheetMode) : rawDetected._worksheetMode;

      // Resolve effective typeCounts: client value → detected → empty
      const resolvedTypeCounts = typeCounts && Object.keys(typeCounts).length
        ? typeCounts
        : (() => { const { _worksheetMode, ...rest } = rawDetected; return rest; })();

      // Compute maxQuestions from typeCounts sum if available
      const totalFromCounts = Object.values(resolvedTypeCounts).reduce((s, v) => s + (Number(v) || 0), 0);
      const resolvedMax = totalFromCounts > 0
        ? totalFromCounts
        : Math.min(parseInt(maxQuestions) || 10, 100);

      // Build prompt and call OpenAI
      const prompt = buildGenerationPrompt(pdfData.text, {
        types: types || Object.keys(resolvedTypeCounts).filter(k => resolvedTypeCounts[k] > 0) || ['mcq'],
        typeCounts: resolvedTypeCounts,
        targetLanguage: targetLanguage || 'German',
        nativeLanguage: nativeLanguage || 'English',
        level: level || 'A1',
        difficulty: difficulty || 'Beginner',
        maxQuestions: Math.min(resolvedMax, 100),
        worksheetMode
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
        worksheetMode,
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

// ─── ROUTE: POST /api/pdf-exercises/text-generate ────────────────────────────
// Generate exercises from pasted text (worksheet/doc style or plain content)
router.post('/text-generate',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const {
      text,
      types,
      typeCounts,
      targetLanguage,
      nativeLanguage,
      level,
      difficulty,
      maxQuestions
    } = req.body || {};

    if (!text || typeof text !== 'string' || text.trim().length < 20) {
      return res.status(400).json({ error: 'text is required and must be at least 20 characters' });
    }

    if (!openai) {
      return res.status(503).json({ error: 'AI service is not configured. Please set OPENAI_API_KEY.' });
    }

    const cleanedText = text.trim();
    const rawDetectedText = detectQuestionTypes(cleanedText);
    const worksheetMode = rawDetectedText._worksheetMode ||
      /Übung|LÖSUNGSSCHLÜSSEL|Lösungsschlüssel|STUFE|LEKTION|Answer Key|Solution Key/i.test(cleanedText);

    const resolvedTypeCounts = typeCounts && Object.keys(typeCounts).length
      ? typeCounts
      : (() => { const { _worksheetMode, ...rest } = rawDetectedText; return rest; })();

    const totalFromCounts = Object.values(resolvedTypeCounts).reduce((s, v) => s + (Number(v) || 0), 0);
    const resolvedMax = totalFromCounts > 0
      ? totalFromCounts
      : Math.min(parseInt(maxQuestions) || 10, 100);

    try {
      const prompt = buildGenerationPrompt(cleanedText, {
        types: types || Object.keys(resolvedTypeCounts).filter(k => resolvedTypeCounts[k] > 0) || ['mcq'],
        typeCounts: resolvedTypeCounts,
        targetLanguage: targetLanguage || 'German',
        nativeLanguage: nativeLanguage || 'English',
        level: level || 'A1',
        difficulty: difficulty || 'Beginner',
        maxQuestions: Math.min(resolvedMax, 100),
        worksheetMode
      });

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

      const questions = (generated.questions || [])
        .filter(q => q && q.type && ['mcq', 'matching', 'fill-blank', 'pronunciation', 'question-answer'].includes(q.type))
        .map(q => sanitizeQuestion(q));

      if (questions.length === 0) {
        return res.status(422).json({
          error: 'AI could not generate valid exercises from this text. Please try with different exercise types or more content-rich text.'
        });
      }

      res.json({
        success: true,
        suggestedTitle: generated.suggestedTitle || 'Generated Exercise',
        suggestedDescription: generated.suggestedDescription || '',
        detectedLevel: generated.detectedLevel || level || 'A1',
        contentType: generated.contentType || 'content_only',
        worksheetMode,
        questions,
        textInfo: {
          charCount: cleanedText.length,
          worksheetMode
        }
      });
    } catch (err) {
      console.error('Text generation error:', err);
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

  // Preserve optional worksheet metadata if present
  if (q.sectionTitle && typeof q.sectionTitle === 'string') {
    base.sectionTitle = q.sectionTitle.trim();
  }
  if (q.tier && typeof q.tier === 'string') {
    base.tier = q.tier.trim();
  }
  if (q.worksheetKind && typeof q.worksheetKind === 'string') {
    base.worksheetKind = q.worksheetKind.trim();
  }

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
    const threshold = parseInt(q.similarityThreshold);
    const scoringMode = ['full', 'proportional'].includes(q.scoringMode) ? q.scoringMode : 'proportional';
    return {
      ...base,
      prompt: String(q.prompt || ''),
      sampleAnswers: Array.isArray(q.sampleAnswers) ? q.sampleAnswers.map(String).filter(Boolean) : [],
      similarityThreshold: (isNaN(threshold) || threshold < 0 || threshold > 100) ? 65 : threshold,
      scoringMode,
      aiGradingEnabled: q.aiGradingEnabled !== false
    };
  }

  return base;
}

module.exports = router;
