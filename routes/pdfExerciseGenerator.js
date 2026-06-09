// routes/pdfExerciseGenerator.js
// PDF → AI Exercise Generator

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const { verifyToken, checkRole } = require('../middleware/auth');
const { extractBracketMarkers, applyBracketMarkersToExercise } = require('../utils/worksheetBracketMarkers');
const EXTRACTION_JOB_TTL_MS = 30 * 60 * 1000;

if (!global.__extractionJobs) {
  global.__extractionJobs = new Map();
}

function createExtractionJob() {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  global.__extractionJobs.set(jobId, {
    status: 'processing',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    result: null,
    error: null,
    progress: {
      current: 0,
      total: 0,
      currentExerciseId: null
    }
  });
  return jobId;
}

function updateExtractionJob(jobId, patch) {
  const prev = global.__extractionJobs.get(jobId);
  if (!prev) return;
  global.__extractionJobs.set(jobId, {
    ...prev,
    ...patch,
    updatedAt: Date.now()
  });
}

function getExtractionJob(jobId) {
  const job = global.__extractionJobs.get(jobId);
  if (!job) return null;
  if (Date.now() - job.createdAt > EXTRACTION_JOB_TTL_MS) {
    global.__extractionJobs.delete(jobId);
    return null;
  }
  return job;
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
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB
});

// ─── OpenAI init ──────────────────────────────────────────────────────────────

let openai = null;
if (process.env.EXERCISES_OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.EXERCISES_OPENAI_API_KEY,
    timeout: Math.min(parseInt(process.env.OPENAI_TIMEOUT_MS || '180000', 10) || 180000, 600000)
  });
}

// ─── PDF text extraction ──────────────────────────────────────────────────────

const { parsePdfBuffer } = require('../services/pdfParseCompat');

async function extractPdfText(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const result = await parsePdfBuffer(buffer);
    const text = (result.text || '')
      .replace(/^-- \d+ of \d+ --\n?|[\r\n]+-- \d+ of \d+ --[\r\n]*/gm, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const pages = result.numpages || 1;
    console.log('📄 PDF parsed:', { pages, length: text.length });
    return { text, pages };
  } catch (err) {
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
    singular_plural: 0,
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
  // Lines with blank markers: runs of underscores (_ or ___), or Lückentext headings
  const fillBlankLines = lines.filter(l => /_+/.test(l));
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
  counts.singular_plural = Math.min(spHeadings * 2, 20);

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
    singular_plural: counts.singular_plural,
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

/**
 * Guess the primary written language of the extracted PDF/text so generated
 * questions stay in the same language (avoids translating German PDFs to English).
 */
function detectContentLanguage(text, fallback = 'German') {
  if (!text || typeof text !== 'string' || text.trim().length < 15) {
    return fallback;
  }
  const sample = text.slice(0, 12000).toLowerCase();
  const deUmlauts = (sample.match(/[äöüß]/g) || []).length;
  const deWords = (sample.match(
    /\b(der|die|das|und|nicht|ist|sind|ein|eine|einen|einem|oder|auch|mit|auf|zu|für|von|wird|werden|haben|sein|sie|ihr|ihnen|über|wie|was|warum|wenn|können|müssen|sollen|dass|denn|aber|nur|noch|schon|bei|nach|aus|dem|den|des|zum|zur|bitte|frage|antwort|übung|lösung)\b/g
  ) || []).length;
  const enWords = (sample.match(
    /\b(the|and|is|are|you|not|this|that|with|from|for|have|has|was|were|can|will|would|should|could|what|when|where|why|how|which|their|there|they|them|answer|question|exercise|solution)\b/g
  ) || []).length;
  const germanScore = deUmlauts * 2 + deWords;
  const englishScore = enWords;
  if (germanScore >= englishScore * 1.1) return 'German';
  if (englishScore >= germanScore * 1.1) return 'English';
  return fallback;
}

// ─── AI generation prompt builder ────────────────────────────────────────────

function buildGenerationPrompt(pdfText, options) {
  const {
    types = ['mcq'],
    typeCounts = {},        // e.g. { matching: 3, 'fill-blank': 4, 'question-answer': 3 }
    targetLanguage = 'German',
    nativeLanguage = 'English',
    /** Language of the source document — all student-facing strings MUST use this */
    contentLanguage = targetLanguage,
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
    'fill-blank': 'Fill in the Blank sentences (use _ or ___ for each blank)',
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
  "question": "question text in ${contentLanguage}",
  "options": ["option1", "option2", "option3", "option4"],
  "correctAnswerIndex": 0,
  "explanation": "brief explanation in ${contentLanguage}",
  "points": 1
}`;
    if (t === 'matching') return `{
  "type": "matching",${sectionTitleNote}
  "instruction": "${worksheetMode
    ? `Verbinden Sie / Match the items on the left with the correct items on the right — wording in ${contentLanguage}, copied from the worksheet where possible.`
    : `Instruction in ${contentLanguage}. Match pairs taken from the document; both sides in ${contentLanguage} unless the PDF explicitly shows a bilingual list (then mirror that structure).`}",
  "pairs": [
    {"left": "${worksheetMode ? 'left value exactly as shown in the worksheet' : `left item in ${contentLanguage} (from the source)`}", "right": "${worksheetMode ? 'right value exactly as shown in the worksheet' : `right item in ${contentLanguage} (from the source)`}"}
  ],
  "points": 1
}`;
    if (t === 'fill-blank') return `{
  "type": "fill-blank",${sectionTitleNote}
  "sentence": "${worksheetMode
    ? 'sentence from the worksheet with _ or ___ for each blank'
    : `sentence with _ or ___ for each blank (each gap is a run of underscores), entirely in ${contentLanguage}`}",
  "answers": ["correct answer for blank 1"],
  "hint": "optional hint in ${contentLanguage}",
  "points": 1
}`;
    if (t === 'pronunciation') return `{
  "type": "pronunciation",${sectionTitleNote}
  "word": "word or short phrase in ${contentLanguage}",
  "phonetic": "/phonetic transcription/",
  "translation": "short gloss or meaning in ${contentLanguage}",
  "acceptedVariants": [],
  "points": 1
}`;
    if (t === 'question-answer') return `{
  "type": "question-answer",${sectionTitleNote}
  "prompt": "${worksheetMode
    ? 'instruction or question from the worksheet (keep original wording and language from the PDF)'
    : `question or instruction in ${contentLanguage} — same language as the source document; do not translate`}",
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
    ? `True/False instruction from the worksheet in ${contentLanguage}. Include the statement to judge.`
    : `True/False instruction in ${contentLanguage}. Include the statement to judge.`}",
  "sampleAnswers": ["correct boolean answer in ${contentLanguage} (e.g. richtig/falsch or true/false as appropriate)"],
  "similarityThreshold": 75,
  "scoringMode": "full",
  "aiGradingEnabled": true,
  "points": 1
}`;
    if (t === 'sentence-transformation') return `{
  "type": "question-answer",${sectionTitleNote}
  "worksheetKind": "sentence-transformation",
  "prompt": "${worksheetMode
    ? `Sentence transformation instruction from the worksheet in ${contentLanguage}. Student writes the transformed sentence/question.`
    : `Sentence transformation instruction in ${contentLanguage}. Student writes the transformed sentence/question.`}",
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
    ? `Singular → Plural instruction from the worksheet in ${contentLanguage}. Student writes the plural form (with article if shown).`
    : `Singular → Plural instruction in ${contentLanguage}. Student writes the plural form (with article if shown).`}",
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
    ? `Table/profile fill-in instruction from the worksheet in ${contentLanguage}. Student writes the missing values.`
    : `Table/profile fill-in instruction in ${contentLanguage}. Student writes the missing values.`}",
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
    ? `Free writing / own sentences instruction from the worksheet in ${contentLanguage}. Write the required number of sentences.`
    : `Free writing / own sentences instruction in ${contentLanguage}. Write the required number of sentences.`}",
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
    ? `Profile/Steckbrief writing instruction from the worksheet in ${contentLanguage}. Write a short profile.`
    : `Profile/Steckbrief writing instruction in ${contentLanguage}. Write a short profile.`}",
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
    ? `Error correction instruction from the worksheet in ${contentLanguage}. Student writes the corrected sentence(s).`
    : `Error correction instruction in ${contentLanguage}. Student writes the corrected sentence(s).`}",
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
  • "Lückentext" / "Ergänzen Sie" → fill-blank (one _ or ___ per missing word, answers from the answer key)
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

TARGET LANGUAGE (learning focus): ${targetLanguage}
SOURCE CONTENT LANGUAGE (language of the PDF — use for ALL student-facing text): ${contentLanguage}
NATIVE LANGUAGE (for your own reasoning only; do NOT use for questions, prompts, options, or sentences shown to students): ${nativeLanguage}
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
2. For MCQ: 4 options, exactly one correct. Question stem and ALL four options MUST be in ${contentLanguage} — the same language as the source document. Never translate stems or options into ${nativeLanguage}.
3. For Matching: 4–6 pairs per question. ${worksheetMode ? 'Copy left/right values verbatim from the worksheet table.' : `Take pairs from the document; both columns in ${contentLanguage} unless the PDF explicitly shows a bilingual list (then mirror that). Do not convert everything into ${nativeLanguage}.`}
4. For Fill-in-blank: use a run of underscores for each gap (e.g. _ or ___); each contiguous run counts as one blank. Answers array must have exactly one entry per blank. Sentence and answers in ${contentLanguage}.
5. For Pronunciation: key words from the content in ${contentLanguage}.
6. For Question/Answer (including worksheetKind variants): prompt, sampleAnswers, and every instruction MUST be in ${contentLanguage}. Provide 2–4 sampleAnswers covering acceptable phrasings. Set scoringMode "proportional" for open writing tasks, "full" for exact transformations. Use similarityThreshold 60–70 depending on strictness needed.

DOCUMENT CONTENT:
---
${fullContent}
---

RESPONSE FORMAT — Return ONLY valid JSON, no markdown, no extra text:
{
  "suggestedTitle": "Short exercise title based on content (in ${contentLanguage})",
  "suggestedDescription": "One sentence describing what students will practice (in ${contentLanguage})",
  "detectedLevel": "${level}",
  "detectedLanguage": "${contentLanguage}",
  "contentType": "questions_found|content_only|mixed",
  "questions": [
    ${outputSchema}
  ]
}

STRICT RULES:
- Return ONLY the JSON object — no markdown fences, no commentary.
- LANGUAGE LOCK: The document below is in ${contentLanguage}. Every question, prompt, instruction, MCQ stem and option, fill-blank sentence, matching item, pronunciation field, sampleAnswers entry, suggestedTitle, and suggestedDescription MUST be written in ${contentLanguage}. Do NOT translate the material into ${nativeLanguage} or English unless the source document itself is English.
- Each blank (each run of underscores) in fill-blank sentences must have exactly one matching entry in the answers array.
- sampleAnswers for question-answer must contain all plausible correct phrasings (in ${contentLanguage}) so AI grading succeeds.
- For worksheetMode matching, copy the exact values from the document; do not translate.${worksheetMode ? '\n- Always include "sectionTitle" on every question.' : ''}`;
}

// ─── Strict extraction prompt (worksheetMode only) ───────────────────────────
// Used when the PDF is a structured language worksheet.
// The AI must ONLY extract — never generate or invent questions.

function buildExtractionPrompt(pdfText, options) {
  const {
    targetLanguage = 'German',
    nativeLanguage = 'English',
    contentLanguage = 'German',
    level = 'A1'
  } = options;

  // Send head + tail so the answer key (usually at the end) is always included.
  const headText = pdfText.substring(0, 6000);
  const tailStart = Math.max(6000, pdfText.length - 3000);
  const tailText = tailStart < pdfText.length ? pdfText.substring(tailStart) : '';
  const fullContent = tailText
    ? `${headText}\n\n[... middle section omitted for brevity ...]\n\n${tailText}`
    : headText;

  return `You are an expert educational worksheet parser.

Your task is to STRICTLY extract and reconstruct ALL exercises from the given content.
You are NOT allowed to generate new questions.

TARGET LANGUAGE (learning focus): ${targetLanguage}
SOURCE CONTENT LANGUAGE (all student-facing text must use this): ${contentLanguage}
NATIVE LANGUAGE (for your reasoning only — do NOT use in output): ${nativeLanguage}
LEVEL: ${level} (CEFR)

---

CORE OBJECTIVE
Convert the source worksheet into structured JSON with:
- correct exercise types
- correct instructions (German + English where both appear in the source)
- correct questions taken verbatim from the source
- correct answers taken from the solution / answer-key section

---

CRITICAL RULES (MANDATORY)

1. DO NOT GENERATE CONTENT
   Every question must come from the source verbatim.
   Do NOT rewrite, paraphrase, or invent anything.

2. PRESERVE STRUCTURE
   Detect and map:
   - Topic (Thema X.X)
   - Exercise (Übung X.X)
   - Difficulty (Stufe 1 / 2 / 3) → "easy" | "medium" | "hard"

3. TYPE DETECTION (STRICT)
   Classify each exercise:
   - mcq          → options like (und / aber) OR labelled a/b/c/d exist
   - matching     → two columns need pairing
   - fill_in_blank→ blanks like ___ exist in sentences
   - error_correction → sentences must be corrected
   - open_writing → user writes their own sentences
   - transformation → sentence transformation (e.g. statement → question)
   - true_false   → explicitly labelled Richtig/Falsch or True/False
   - short_answer → direct short answers with no rewrite
   DO NOT MISCLASSIFY.

4. INSTRUCTION + BLOCK TEXT
   Each exercise MUST include:
   - instruction_de (German instruction text — copied verbatim from the source; if the block starts with an "Instruction:" or "Anweisung:" label, extract the text AFTER that label as instruction_de)
   - instruction_en (English, copied verbatim if present in source; otherwise "")
   - content: the FULL raw text of this exercise block from the document (every content line for this Übung), verbatim — never summarize or omit (required for downstream deterministic parsing)

4b. BRACKET MARKERS (AUTHOR CONVENTION — HIGHEST PRIORITY)
   When the source uses explicit bracket markers:
   - Text inside curly braces {like this} = instruction (NOT a student question)
     - If {text} contains " / ", split: German before slash → instruction_de, English after → instruction_en
     - Otherwise the full {text} → instruction_de
     - Two separate {DE text} {EN text} pairs → first = instruction_de, second = instruction_en
   - Text inside square brackets [like this] = worked example → "example" field on the FIRST question row only
   - Do NOT include the {brackets} or [brackets] in output fields
   - Remove marker text from "content" and "question" fields (metadata only, not graded items)

5. fill_in_blank LINE FORMAT
   In each question's "question" field put ONLY the sentence with underscore blanks — no leading item numbers ("1.", "2)").
   If a line ends with "→ ____" or "-> ____" where ONLY underscores follow the arrow, omit that arrow and gap unless the answer key gives a separate translation answer for it (layout scaffold, not a second graded blank).
   Optional Beispiel / Example lines for the exercise → put verbatim in an "example" field on the first question row of that exercise.

5b. EXAMPLE FIELD (ALL TYPES)
   If the exercise block contains a worked example line labelled "Beispiel:", "Example:", "z.B.", or similar, copy it verbatim into the "example" field on the FIRST question row of that exercise block (regardless of exercise type — applies to mcq, true_false, short_answer, fill_in_blank, etc.). Leave "example" as "" on all subsequent rows.

6. ANSWER MAPPING (VERY IMPORTANT)
   If a LÖSUNGSSCHLÜSSEL / Answer Key section exists:
   - Map answers EXACTLY as written
   - DO NOT GUESS
   Rules:
   - mcq            → correctAnswerIndex must match the correct option (0-based)
   - matching       → return correct pairs as { "left": "...", "right": "..." }
   - fill_in_blank  → answers array must have exactly one entry per blank that remains after applying rule 5
   - error_correction → correctedText is the corrected sentence from the key
   - open_writing / transformation / short_answer → put accepted answers in answers[]

7. LANGUAGE RULE
   Keep ALL questions in original language (${contentLanguage}).
   Do NOT translate.

8. SKIP IF UNCLEAR
   If any part is unclear → skip that question.
   DO NOT hallucinate.

---

OUTPUT FORMAT (STRICT JSON — return ONLY this, no markdown):
{
  "suggestedTitle": "short title based on topic",
  "suggestedDescription": "one sentence about what students practise",
  "detectedLevel": "${level}",
  "contentType": "questions_found",
  "topics": [
    {
      "title": "topic title from document",
      "exercises": [
        {
          "exerciseId": "e.g. L1.1",
          "difficulty": "easy | medium | hard",
          "type": "mcq | matching | fill_in_blank | singular_plural | error_correction | open_writing | transformation | true_false | short_answer",
          "instruction_de": "German instruction verbatim",
          "instruction_en": "English instruction verbatim or empty string",
          "content": "FULL verbatim exercise block text from the source (every line belonging to this Übung); required for deterministic parsing — do not summarize",
          "questions": [
            {
              "question": "question text verbatim from source",
              "example": "optional worked example line for this exercise block",
              "options": [],
              "correctAnswerIndex": null,
              "answers": [],
              "pairs": [{"singular":"","plural":""}],
              "correctedText": ""
            }
          ]
        }
      ]
    }
  ]
}

---

VALIDATION BEFORE OUTPUT
- No invented content
- No wrong answers
- No missing instructions
- JSON must be valid

---

DOCUMENT CONTENT:
---
${fullContent}
---

Return ONLY the JSON object. No markdown fences. No explanation.`;
}

// ─── Flatten extraction result to existing flat questions[] format ─────────────
// Converts the strict extraction schema (topics → exercises → questions) into
// the same flat questions[] array that the rest of the system already consumes.

const EXTRACTION_TYPE_MAP = {
  fill_in_blank:    'fill-blank',
  error_correction: 'question-answer',
  open_writing:     'question-answer',
  transformation:   'question-answer',
  true_false:       'question-answer',
  short_answer:     'question-answer',
  jumbled_words:    'jumble-word',
  jumble_word:      'jumble-word',
  'jumble-word':    'jumble-word',
  translation:      'question-answer',
  qa:               'question-answer',
  mcq:              'mcq',
  matching:         'matching',
  singular_plural:  'singular_plural',
  pronunciation:    'pronunciation'
};

const EXTRACTION_WORKSHEET_KIND = {
  error_correction: 'error-correction',
  open_writing:     'free-writing-own-sentences',
  transformation:   'sentence-transformation',
  true_false:       'true-false'
};

/** Combine German + English worksheet headings for one instruction banner. */
function mergeWorksheetInstructions(instruction_de, instruction_en) {
  const de = String(instruction_de || '').trim();
  const en = String(instruction_en || '').trim();
  if (de && en) return `${de} — ${en}`;
  return de || en || '';
}

/**
 * Normalize extracted fill-blank lines:
 * - Strip worksheet item index (1., (2), …) from the sentence body.
 * - Remove trailing translation scaffold "→ ____" / "-> ____" (underscore-only gap after arrow).
 * - Align answers[] length with real blank count (single lemma keys stay valid).
 */
/** Skip worksheet/OCR noise lines — not matching pair rows. */
function matchingPairLineLooksLikeNoise(line) {
  const t = String(line || '').trim();
  if (t.length < 2) return true;
  if (/^(?:Übung|Ubung|aufgabe|exercise)\s*[.:]?\s*[A-Z]?\d+/i.test(t)) return true;
  if (/^lösungschlüssel|^losungsschlussel|^answer\s*key/i.test(t)) return true;
  return false;
}

/**
 * Structured matching: numbered lines (`1. ich`) = left column, letter lines (`a. komme`) = right column.
 * Zips by index only — no invented rights.
 */
function extractMatchingPairs(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const leftItems = [];
  const rightItems = [];

  for (const line of lines) {
    if (matchingPairLineLooksLikeNoise(line)) continue;

    // a. komme
    if (/^[a-z]\./i.test(line)) {
      rightItems.push(line.replace(/^[a-z]\.\s*/i, '').trim());
      continue;
    }

    // 1. ich — must not treat "1." as letter line (already handled above)
    if (/^\d+\./.test(line)) {
      leftItems.push(line.replace(/^\d+\.\s*/, '').trim());
      continue;
    }
  }

  const pairs = [];
  const count = Math.min(leftItems.length, rightItems.length);
  for (let i = 0; i < count; i++) {
    pairs.push({
      left: leftItems[i],
      right: rightItems[i],
    });
  }

  console.log('[MATCH FIXED]', { leftItems, rightItems, pairs });

  if (pairs.length > 0) return pairs;

  // Fallback only when column layout did not apply: explicit arrows with real left/right text.
  return extractMatchingPairsArrowFallback(text);
}

/** Arrow rows when worksheets use → instead of two columns (no synthetic values). */
function extractMatchingPairsArrowFallback(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const pairs = [];
  for (const line of lines) {
    if (matchingPairLineLooksLikeNoise(line)) continue;
    if (!/(?:→|->)/.test(line)) continue;
    const m = line.match(/^(.*?)(?:→|->)(.*)$/);
    let left = String(m?.[1] ?? '').trim();
    let right = String(m?.[2] ?? '').trim();
    left = left.replace(/^\d+\.\s*/, '').replace(/^[a-z]\.\s*/i, '').trim();
    right = right.replace(/^\d+\.\s*/, '').replace(/^[a-z]\.\s*/i, '').trim();
    if (left && right) pairs.push({ left, right });
  }
  return pairs;
}

/**
 * Answers from bracket hints on lines that already contain blanks (first parenthesis group per line).
 */
function extractFillAnswers(text) {
  const answers = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (!/_{2,}/.test(line)) continue;
    const match = line.match(/\((.*?)\)/);
    if (match) answers.push(match[1].trim());
  }
  return answers;
}

/** All parenthesis answers on blank lines in source order (when one line has multiple blanks). */
function extractFillAnswersAllParenOnBlankLines(text) {
  const answers = [];
  const lines = String(text || '').split('\n');
  for (const line of lines) {
    if (!/_{2,}/.test(line)) continue;
    for (const m of line.matchAll(/\(([^)]*)\)/g)) {
      const v = String(m[1] || '').trim();
      if (v) answers.push(v);
    }
  }
  return answers;
}

/**
 * Answer-key driven blank: replace first occurrence of `answer` in `sentence` with ___.
 * @returns {{ sentence: string, answer: string } | null}
 */
function generateFillBlank(sentence, answer) {
  const a = String(answer || '').trim();
  if (!a) return null;
  const src = String(sentence || '');
  const safe = src.replace(a, '___');
  if (safe === src) return null;
  return { sentence: safe, answer: a };
}

/** Try each provided answer until one successfully blanks the sentence. */
function tryGenerateFillBlankFromAnswers(sentence, answers) {
  const list = Array.isArray(answers)
    ? answers.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  for (const a of list) {
    const g = generateFillBlank(sentence, a);
    if (g) return g;
  }
  return null;
}

/** First word blanked when worksheet expects conjugation / sein-haben style but OCR delivered plain sentences. */
function convertToFillBlank(sentence) {
  const s = String(sentence || '').trim();
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const answer = words[0];
  const rest = words.slice(1).join(' ');
  return {
    sentence: `___ ${rest}`,
    answer,
  };
}

function instructionImpliesFillBlank(instr) {
  const t = String(instr || '');
  return /\b(sein|haben|ergänzen|ergaenzen|fill[-\s]?in|lücken|luecken|lückentext|lueckentext|verbform|verb\s*form|konjugier|richtige\s+form|passende\s+form)\b/i.test(
    t,
  );
}

/** Merge AI answers with bracket extraction by blank index (prefer AI slot, then brackets). */
function mergeFillBracketAnswers(sentence, aiAnswers) {
  const blanks = (String(sentence || '').match(/_+/g) || []).length;
  let bracket = extractFillAnswers(String(sentence || ''));
  if (bracket.length < blanks) {
    bracket = extractFillAnswersAllParenOnBlankLines(String(sentence || ''));
  }
  const ai = Array.isArray(aiAnswers) ? aiAnswers.map((a) => String(a ?? '').trim()) : [];
  const out = [];
  for (let i = 0; i < blanks; i++) {
    out.push(ai[i] || bracket[i] || '');
  }
  return out;
}

function normalizeFillBlankExtract(sentence, answers, instructionHint = '') {
  let s = String(sentence || '').replace(/\s+/g, ' ').trim();
  let ans = Array.isArray(answers) ? answers.map((a) => String(a ?? '')) : [];

  s = s.replace(/^(?:\(\d+\)\s*|\d{1,3}[.)]\s+)/u, '').trim();

  let blanks = (s.match(/_+/g) || []).length;
  const hint = String(instructionHint || '').trim();

  // Answer key / AI answers: insert blank by substituting the known answer (e.g. "Sie ist Ärztin." + "ist" → "Sie ___ Ärztin.")
  if (blanks === 0 && s.length >= 2) {
    const fromKey = tryGenerateFillBlankFromAnswers(s, ans);
    if (fromKey) {
      s = fromKey.sentence.replace(/\s+/g, ' ').trim();
      ans = [fromKey.answer];
      blanks = (s.match(/_+/g) || []).length;
    }
  }

  if (
    blanks === 0 &&
    hint &&
    instructionImpliesFillBlank(hint) &&
    s.length >= 3
  ) {
    const conv = convertToFillBlank(s);
    if (conv) {
      s = conv.sentence.replace(/\s+/g, ' ').trim();
      if (!ans.some((a) => String(a).trim())) {
        ans = [conv.answer];
      }
      blanks = (s.match(/_+/g) || []).length;
    }
  }

  const translationTail = /\s*(?:→|->)\s*_+\s*$/u;
  const hadTranslationTail = translationTail.test(s);
  if (hadTranslationTail) {
    s = s.replace(translationTail, '').trim();
  }

  blanks = (s.match(/_+/g) || []).length;
  if (blanks === 0) {
    return { sentence: s, answers: ans };
  }

  ans = mergeFillBracketAnswers(s, ans);

  while (ans.length < blanks) ans.push('');
  if (ans.length > blanks) ans = ans.slice(0, blanks);

  if (hadTranslationTail && blanks === 1) {
    const firstFilled = ans.findIndex((a) => (a || '').trim());
    if (firstFilled >= 0) {
      ans = [ans[firstFilled]];
    } else {
      ans = [''];
    }
  }

  return { sentence: s, answers: ans };
}

/** Leading list / index noise: "1.", "1)", "(1)", "1 ", bullets (PDF/OCR). */
const SP_LEADING_MARKER = /^(?:\(\d+\)\s*|\d+[.)]\s*|\d{1,2}\s+(?=der\b|die\b|das\b|ein\b|eine\b|einem\b|einen\b|einer\b|eines\b|[A-Za-zäöüÄÖÜß])|[•‣▪·\-–—*＊‧·]\s+)/u;

/** Strip same markers (and stray inline index) from captured cells. */
function stripSingularPluralCell(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(SP_LEADING_MARKER, '').trim();
  s = s.replace(/\s+\(\d{1,2}\)\s*$/u, '').trim();
  return s;
}

function singularPluralLineLooksLikeNoise(line) {
  const t = line.trim();
  if (t.length < 3) return true;
  if (/^https?:\/\//i.test(t)) return true;
  if (/^(?:seite|page|blatt)\s*[:#.]?\s*\d+/i.test(t)) return true;
  if (/^(?:übung|aufgabe|exercise|task)\s*[:#.]?\s*\d*$/i.test(t)) return true;
  if (/^[\d\s.:|°\-–—→>_=]{2,}$/i.test(t) && !/[a-zäöüß]/i.test(t)) return true;
  return false;
}

function singularPluralPairLooksValid(singular, plural) {
  if (!singular || !plural || singular === plural) return false;
  if (singular.length < 2 || plural.length < 2) return false;
  if (singular.length > 180 || plural.length > 180) return false;
  const hasLetter = (s) => /[a-zA-ZäöüÄÖÜß]/.test(s);
  if (!hasLetter(singular) || !hasLetter(plural)) return false;
  return true;
}

function dedupeSingularPluralPairs(pairs) {
  const seen = new Set();
  const out = [];
  for (const p of pairs) {
    const key = `${p.singular.toLowerCase()}\0${p.plural.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Deterministic singular/plural row extraction from raw worksheet text (no AI).
 * Supports: arrow (→ / ->), numbered + arrow (incl. "(1)" and short numeric prefix before articles),
 * pipe, double-space columns; noise filtering and deduplication.
 */
function extractSingularPluralPairs(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const pairs = [];

  for (const line of lines) {
    if (singularPluralLineLooksLikeNoise(line)) continue;

    // Numbered / bulleted + arrow (incl. "(1) der Mann → …", "12 der Mann → …" before article)
    let match = line.match(
      /^(?:\(\d+\)\s*|\d+[.)]\s*|\d{1,2}\s+(?=der\b|die\b|das\b|ein\b|eine\b|einem\b|einen\b|einer\b|eines\b|[A-Za-zäöüÄÖÜß])|[•‣▪·\-–—*＊‧·]\s*)?(.+?)\s*(?:→|->)\s*(.+)$/u
    );
    if (match) {
      const singular = stripSingularPluralCell(match[1]);
      const plural = stripSingularPluralCell(match[2]);
      if (singularPluralPairLooksValid(singular, plural)) {
        pairs.push({ singular, plural });
      }
      continue;
    }

    // Table-like pipe (skip lines that look like markdown tables)
    if (/^\|?\s*:?-{3,}/.test(line)) continue;
    match = line.match(/^(.+?)\s*\|\s*(.+)$/);
    if (match) {
      const singular = stripSingularPluralCell(match[1]);
      const plural = stripSingularPluralCell(match[2]);
      if (singularPluralPairLooksValid(singular, plural)) {
        pairs.push({ singular, plural });
      }
      continue;
    }

    // Two columns separated by 2+ spaces (ignore lines with arrow tokens — handled above)
    if (/(?:→|->)/.test(line)) continue;
    match = line.match(/^(.+?)\s{2,}(.+)$/);
    if (match) {
      const singular = stripSingularPluralCell(match[1]);
      const plural = stripSingularPluralCell(match[2]);
      if (singularPluralPairLooksValid(singular, plural)) {
        pairs.push({ singular, plural });
      }
    }
  }

  return dedupeSingularPluralPairs(pairs);
}

/**
 * Build { singular, plural }[] from raw block text (rules first) or AI extraction payload (fallback).
 * @param {object} q - one question object from AI JSON
 * @param {string} [rawBlockText] - full exercise block text when available (PDF pipeline)
 */
function pairsFromSingularPluralQuestion(q, rawBlockText) {
  const questionText = String(rawBlockText || '').trim();
  if (questionText.length) {
    console.log('[SP RAW BLOCK]', questionText.slice(0, 200));
    const deterministicPairs = extractSingularPluralPairs(questionText);
    console.log('[SP PARSED PAIRS]', deterministicPairs.length);
    if (deterministicPairs.length > 0) {
      console.log('[SINGULAR_PLURAL DETECTED]', deterministicPairs.length);
      return deterministicPairs;
    }
  }

  const rawPairs = Array.isArray(q?.pairs) ? q.pairs : [];
  const out = [];
  for (const p of rawPairs) {
    if (!p || typeof p !== 'object') continue;
    const s = String(p.singular != null ? p.singular : p.left != null ? p.left : '').trim();
    const pl = String(p.plural != null ? p.plural : p.right != null ? p.right : '').trim();
    if (s && pl && s !== pl) out.push({ singular: s, plural: pl });
  }
  const qn = String(q?.question || '').trim();
  const ca = q?.correctAnswer != null ? String(q.correctAnswer).trim() : '';
  if (!out.length && qn && ca && qn !== ca) out.push({ singular: qn, plural: ca });
  return out;
}

function flattenExtractionResult(parsed) {
  const flatQuestions = [];

  for (const topic of (parsed.topics || [])) {
    for (const exercise of (topic.exercises || [])) {
      const bracketParsed = extractBracketMarkers(exercise.content || '');
      const mappedType = EXTRACTION_TYPE_MAP[exercise.type] || 'question-answer';
      const worksheetKind = EXTRACTION_WORKSHEET_KIND[exercise.type] || null;
      const sectionTitle = [topic.title, exercise.exerciseId].filter(Boolean).join(' | ');

      let singularPluralBulkDone = false;
      let spPairsFromRaw = null;
      if (mappedType === 'singular_plural') {
        const rawEx = bracketParsed.cleanedContent || String(exercise.content || '').trim();
        if (rawEx.length >= 5) {
          console.log('[SP RAW BLOCK]', rawEx.slice(0, 200));
          spPairsFromRaw = extractSingularPluralPairs(rawEx);
          console.log('[SP PARSED PAIRS]', spPairsFromRaw.length);
          if (spPairsFromRaw.length > 0) {
            console.log('[SINGULAR_PLURAL DETECTED]', spPairsFromRaw.length);
          }
        }
      }

      let matchingBulkDone = false;
      let matchingDetPairs = null;
      if (mappedType === 'matching') {
        const rawEx = bracketParsed.cleanedContent || String(exercise.content || '').trim();
        console.log('[BLOCK]', rawEx);
        matchingDetPairs = rawEx.length >= 5 ? extractMatchingPairs(rawEx) : [];
        console.log('[MATCH PAIRS]', matchingDetPairs);
      }

      const exDe = String(exercise.instruction_de || bracketParsed.instruction_de || '').trim();
      const exEn = String(exercise.instruction_en || bracketParsed.instruction_en || '').trim();
      const exMergedInstr = mergeWorksheetInstructions(exDe, exEn) || null;
      const blockExample = String(bracketParsed.example || '').trim();
      let questionRowIndex = 0;

      for (const q of (exercise.questions || [])) {
        const rowExample = String(q.example || '').trim() || (questionRowIndex === 0 ? blockExample : '');
        questionRowIndex += 1;
        const base = {
          type: mappedType,
          points: 1,
          sectionTitle: sectionTitle || null,
          instruction_de: exDe || undefined,
          instruction_en: exEn || undefined,
          instruction: exMergedInstr
        };
        if (worksheetKind) base.worksheetKind = worksheetKind;

        if (mappedType === 'mcq') {
          const options = Array.isArray(q.options) && q.options.length
            ? q.options.map(String).filter(Boolean)
            : [];
          const cai = parseInt(q.correctAnswerIndex);
          flatQuestions.push(sanitizeQuestion({
            ...base,
            question: String(q.question || ''),
            options,
            correctAnswerIndex: isNaN(cai) ? 0 : cai,
            explanation: '',
            example: rowExample
          }));
        } else if (mappedType === 'matching') {
          if (matchingDetPairs && matchingDetPairs.length > 0) {
            if (!matchingBulkDone) {
              matchingBulkDone = true;
              flatQuestions.push(sanitizeQuestion({
                ...base,
                pairs: matchingDetPairs
              }));
            }
            continue;
          }
          const subRaw = String(q.question || '').trim();
          const subDet = subRaw.length >= 3 ? extractMatchingPairs(subRaw) : [];
          const pairs = subDet.length > 0
            ? subDet
            : (Array.isArray(q.pairs) ? q.pairs : []).map((p) => ({
                left: String(p?.left != null ? p.left : '').trim(),
                right: String(p?.right != null ? p.right : '').trim()
              })).filter((p) => p.left || p.right);
          flatQuestions.push(sanitizeQuestion({
            ...base,
            pairs
          }));
        } else if (mappedType === 'singular_plural') {
          if (spPairsFromRaw && spPairsFromRaw.length > 0) {
            if (!singularPluralBulkDone) {
              singularPluralBulkDone = true;
              flatQuestions.push(sanitizeQuestion({
                ...base,
                pairs: spPairsFromRaw,
                scoringMode: 'full',
                aiGradingEnabled: false
              }));
            }
            continue;
          }
          const rawEx = bracketParsed.cleanedContent || String(exercise.content || '').trim();
          const pairs = pairsFromSingularPluralQuestion(q, rawEx);
          flatQuestions.push(sanitizeQuestion({
            ...base,
            pairs,
            scoringMode: 'full',
            aiGradingEnabled: false
          }));
        } else if (mappedType === 'fill-blank') {
          const rawSentence = String(q.question || '');
          const rawAnswers = Array.isArray(q.answers) ? q.answers.map(String) : [];
          const norm = normalizeFillBlankExtract(rawSentence, rawAnswers, exMergedInstr || '');
          console.log('[FILL ANSWERS]', norm.answers);
          flatQuestions.push(sanitizeQuestion({
            ...base,
            sentence: norm.sentence,
            answers: norm.answers,
            example: rowExample,
            hint: String(q.hint || ''),
            caseSensitive: false
          }));
        } else {
          // question-answer and all worksheet-kind variants
          const rawAnswers = Array.isArray(q.answers) && q.answers.length
            ? q.answers
            : (q.correctedText ? [q.correctedText] : []);
          const threshold = exercise.type === 'true_false' ? 75
            : exercise.type === 'open_writing' ? 60
            : 70;
          const scoringMode = (exercise.type === 'open_writing' || exercise.type === 'short_answer')
            ? 'proportional'
            : 'full';
          flatQuestions.push(sanitizeQuestion({
            ...base,
            prompt: String(q.question || ''),
            sampleAnswers: rawAnswers.map(String).filter(Boolean),
            similarityThreshold: threshold,
            scoringMode,
            aiGradingEnabled: true,
            example: rowExample
          }));
        }
      }
    }
  }

  return flatQuestions;
}

function stripMarkdownFences(raw) {
  return String(raw || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function extractFirstJsonObject(raw) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function removeLineBreaksInsideStrings(raw) {
  const s = String(raw || '');
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        out += ' ';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

function safeJsonParse(raw) {
  const cleaned = stripMarkdownFences(raw);
  const firstCandidate = extractFirstJsonObject(cleaned) || cleaned;
  try {
    return JSON.parse(firstCandidate);
  } catch {}

  const normalized = removeLineBreaksInsideStrings(firstCandidate)
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/\r?\n/g, ' ')
    .trim();
  try {
    return JSON.parse(normalized);
  } catch {}
  return null;
}

async function extractWithRetry(prompt, options = {}) {
  const {
    systemContent = 'Return ONLY valid JSON.',
    model = process.env.OPENAI_MODEL || 'gpt-4o',
    max_tokens = 2000,
    temperature = 0.0,
    logLabel = 'extraction'
  } = options;

  const callOnce = async (userPrompt) => {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: userPrompt }
      ],
      max_tokens,
      temperature
    });
    return completion.choices[0].message.content.trim();
  };

  const firstRaw = await callOnce(prompt);
  const firstParsed = safeJsonParse(firstRaw);
  if (firstParsed) return firstParsed;

  console.warn(`⚠️ JSON parse failed on first attempt (${logLabel})`);
  console.warn(`↻ Retrying with strict JSON instruction (${logLabel})`);
  const retryPrompt = `${prompt}\n\nFIX YOUR JSON. RETURN VALID JSON ONLY. DO NOT BREAK STRING FORMATTING.`;
  const secondRaw = await callOnce(retryPrompt);
  const secondParsed = safeJsonParse(secondRaw);
  if (secondParsed) return secondParsed;

  console.error(`❌ Final JSON parse failure after retry (${logLabel})`);
  return null;
}

async function runSequentialWorksheetExtraction(sourceText, options = {}) {
  const {
    level = 'A1',
    targetLanguage = 'German',
    nativeLanguage = 'English',
    sourceLabel = 'worksheet',
    selectedExerciseIds = null,
    selectedExercises = null,
    contentLanguage = targetLanguage,
    jobId = null
  } = options;

  const { exercises: allExercises, solutionBlock } = splitWorksheetIntoExercises(sourceText);
  const selectedExercisesList = Array.isArray(selectedExercises) ? selectedExercises : [];
  const selectedIdSetFromList = selectedExercisesList.length
    ? new Set(selectedExercisesList.map(ex => String(ex?.exerciseId || '').trim()).filter(Boolean))
    : null;
  const selection = selectedIdSetFromList && selectedIdSetFromList.size
    ? selectedIdSetFromList
    : (Array.isArray(selectedExerciseIds) && selectedExerciseIds.length
      ? new Set(selectedExerciseIds.map(id => String(id)))
      : null);
  const requestedCountByExerciseId = new Map(
    selectedExercisesList
      .map((ex) => [String(ex?.exerciseId || '').trim(), Number(ex?.questionCount || 0)])
      .filter(([id]) => !!id)
  );
  let exercises = selection
    ? allExercises.filter(ex => selection.has(String(ex.exerciseId || '')))
    : allExercises;

  // When the frontend provided a selection (from AI detection in Step 2),
  // the split-based exercises may lack _aiPreExtracted.  Run AI detection
  // to get structured data and prefer those results.
  const needsAi = !exercises || exercises.length === 0
    || (selection && !exercises.some(ex => ex._aiPreExtracted));
  if (needsAi) {
    const aiDetected = await detectExercisesWithAI(sourceText);
    const rebuilt = buildExercisesFromAiDetection(sourceText, aiDetected);
    // Prefer AI-detected exercises that match the selection.
    const matched = selection
      ? rebuilt.filter(ex => selection.has(String(ex.exerciseId || '')))
      : rebuilt;
    if (matched.length > 0) {
      exercises = matched;
    } else if (rebuilt.length > 0) {
      exercises = rebuilt;
    }
  }

  if (!exercises || exercises.length === 0) {
    const err = new Error('Failed to detect exercises from PDF structure.');
    err.statusCode = 400;
    throw err;
  }

  console.log('Detected exercises:', exercises.map(e => e.exerciseId));
  console.log(`🔬 Sequential extraction (${sourceLabel}): ${exercises.length} exercise blocks`);
  // #region agent log
  const fs2 = require('fs'); try { fs2.appendFileSync('debug-fbfbea.log', JSON.stringify({sessionId:'fbfbea',location:'pdfExerciseGenerator.js:runSequentialWorksheetExtraction',message:'exercises to process after filter',data:{exerciseCount:exercises.length,exerciseIds:exercises.map(e=>e.exerciseId),selectedExerciseIds:selectedExerciseIds||null,allDetectedCount:allExercises.length,allDetectedIds:allExercises.map(e=>e.exerciseId)},timestamp:Date.now(),hypothesisId:'A_C'})+'\n'); } catch(e){}
  // #endregion
  const allQuestions = [];
  const extractionLog = [];
  const failedExercises = [];

  // Set total before loop so frontend knows the full count immediately.
  if (jobId) {
    updateExtractionJob(jobId, {
      progress: { current: 0, total: exercises.length, currentExerciseId: null }
    });
  }

  for (let i = 0; i < exercises.length; i++) {
    const block = exercises[i];

    if (jobId) {
      updateExtractionJob(jobId, {
        progress: { current: i, total: exercises.length, currentExerciseId: block.exerciseId || null }
      });
    }

    console.log('[BLOCK]', block.content);

    if (!block.content || block.content.length < 20) {
      console.warn(`⚠️ Skipped exercise ${block.exerciseId}: content too short`);
      failedExercises.push(block.exerciseId || 'unknown');
      extractionLog.push({ exerciseId: block.exerciseId || 'unknown', ok: false, error: 'Content too short for extraction' });
      continue;
    }

    // When the AI full-extraction path already parsed this block, skip the
    // second per-block AI call and flatten the pre-extracted data directly.
    let result;
    if (block._aiPreExtracted) {
      console.log(`[runSequentialWorksheetExtraction] Using pre-extracted data for ${block.exerciseId}`);
      const pre = block._aiPreExtracted;
      // Normalise type to the internal schema expected by flattenSingleExercise
      const typeMap = {
        matching: 'matching',
        'true/false': 'true_false',
        'true-false': 'true_false',
        true_false: 'true_false',
        jumbled_words: 'jumbled_words',
        jumble_word: 'jumbled_words',
        'jumble-word': 'jumbled_words',
        fill_blank: 'fill_in_blank',
        mcq: 'mcq',
        translation: 'translation',
        qa: 'short_answer',
        pronunciation: 'pronunciation'
      };
      result = {
        type: typeMap[pre.type] || pre.type || 'short_answer',
        exerciseId: block.exerciseId,
        topic: String(pre.title || '').trim(),
        instruction_de: '',
        instruction_en: '',
        questions: pre.questions || []
      };
    } else {
      const prompt = buildSingleExerciseExtractionPrompt({
        topic: block.topic || '',
        exerciseId: block.exerciseId || '',
        level: block.difficulty || level || 'easy',
        instruction_de: block.instruction_de || '',
        instruction_en: block.instruction_en || '',
        content: block.content || '',
        solution_key: block.solution_key || solutionBlock,
        questionCount: requestedCountByExerciseId.get(String(block.exerciseId || '')) || undefined
      });

      result = await extractWithRetry(prompt, {
        systemContent: 'You are a deterministic worksheet extraction engine. Return ONLY valid JSON. No markdown. No explanation. Never invent content.',
        max_tokens: 2000,
        temperature: 0.0,
        logLabel: `${sourceLabel}:${block.exerciseId || 'unknown'}`
      });
    }

    if (!result) {
      failedExercises.push(block.exerciseId || 'unknown');
      extractionLog.push({ exerciseId: block.exerciseId || 'unknown', ok: false, error: 'Invalid JSON after retry' });
      continue;
    }

    try {
      const blockMeta = block._aiPreExtracted
        ? { instruction_de: '', instruction_en: '', example: '' }
        : { instruction_de: block.instruction_de, instruction_en: block.instruction_en, example: block.example };
      const questions = flattenSingleExercise(result, block.content || '', blockMeta);
      allQuestions.push(...questions);
      extractionLog.push({ exerciseId: block.exerciseId || 'unknown', type: result.type, count: questions.length, ok: true });
    } catch (err) {
      console.warn(`⚠️ Skipped exercise ${block.exerciseId}:`, err.message);
      failedExercises.push(block.exerciseId || 'unknown');
      extractionLog.push({ exerciseId: block.exerciseId || 'unknown', ok: false, error: err.message });
    }
  }

  return { allQuestions, extractionLog, failedExercises, total: exercises.length };
}

function buildDetectedExercisePreview(sourceText, blocks, solutionBlock = '') {
  const normalizedFull = normalizePdfText(sourceText);
  const answerKeyText =
    solutionBlock && String(solutionBlock).trim().length > 20
      ? solutionBlock
      : extractAnswerKey(normalizedFull);
  const answerMap = parseAnswerKey(answerKeyText);

  return (blocks || []).map((ex) => {
    const id = String(ex.exerciseId || ex.id || '');
    const rawText = String(ex.content || '');

    if (ex._aiPreExtracted && typeof ex._aiPreExtracted === 'object') {
      const ai = ex._aiPreExtracted;
      const rawQuestions = Array.isArray(ai.questions) ? ai.questions : [];
      const bracketParsed = extractBracketMarkers(rawText);
      const aiTypeMap = {
        fill_blank: 'fill_in_blank',
        jumbled_words: 'jumbled_words',
        jumble_word: 'jumbled_words',
        'jumble-word': 'jumbled_words',
        qa: 'short_answer',
        translation: 'short_answer',
        true_false: 'true_false',
        pronunciation: 'pronunciation'
      };
      const type = String(aiTypeMap[ai.type] || ai.type || ex.sectionType || '');

      // Deterministic preview rows (fill-in-blank + matching).
      const pairs = type === 'matching'
        ? rawQuestions.map((q) => ({
            left: String(q?.left || '').trim(),
            right: String(q?.right || '').trim()
          })).filter((p) => p.left || p.right)
        : type === 'singular_plural'
          ? rawQuestions.map((q) => ({
              left: String(q?.singular || q?.left || '').trim(),
              right: String(q?.plural || q?.right || '').trim()
            })).filter((p) => p.left || p.right)
          : [];
      const questions = type === 'fill_in_blank'
        ? rawQuestions.map((q) => ({
            sentence: String(q?.sentence || '').trim(),
            answer: q?.answer == null ? '' : String(q.answer).trim()
          })).filter((q) => q.sentence)
        : [];

      // Build extractedItems for the rich template ngSwitch rendering.
      const bracketInstruction = mergeWorksheetInstructions(bracketParsed.instruction_de || '', bracketParsed.instruction_en || '');
      const extractedItems = rawQuestions.map((q) => {
        const itemType = type === 'true_false' ? 'question-answer' : type;
        const base = { instruction: bracketInstruction || mergeWorksheetInstructions(ex.instruction_de || '', ex.instruction_en || '') };

        switch (itemType) {
          case 'mcq':
            return {
              ...base, type: 'mcq',
              question: String(q?.question || q?.sentence || '').trim(),
              options: Array.isArray(q?.options) ? q.options : [],
              correctAnswerIndex: q?.answer != null
                ? (() => {
                    const opt = Array.isArray(q.options) ? q.options : [];
                    if (typeof q.answer === 'number') return q.answer;
                    const label = String(q.answer).trim().replace(/[) .]/g, '');
                    const idx = opt.findIndex((o) => String(o).trim().startsWith(label));
                    return idx >= 0 ? idx : null;
                  })()
                : null
            };
          case 'fill_in_blank':
            return {
              ...base, type: 'fill-blank',
              sentence: String(q?.sentence || '').trim(),
              answers: q?.answer != null ? [String(q.answer).trim()] : (q?.correct_answer ? [String(q.correct_answer).trim()] : [])
            };
          case 'matching':
            return {
              ...base, type: 'matching',
              pairs: [{ left: String(q?.left || '').trim(), right: String(q?.right || '').trim() }]
            };
          case 'singular_plural':
            return {
              ...base, type: 'singular_plural',
              pairs: [{ singular: String(q?.singular || '').trim(), plural: String(q?.plural || '').trim() }]
            };
          case 'jumbled_words':
            return {
              ...base, type: 'jumble-word',
              scrambledText: String(q?.scrambled || q?.scrambled_text || q?.scrambledText || q?.letters || '').trim(),
              expectedWord: String(q?.correct_word || q?.correctWord || q?.word || '').trim(),
              categoryTip: String(q?.category_tip || q?.categoryTip || '').trim(),
              boldLetter: String(q?.bold_letter || q?.boldLetter || '').trim()
            };
          case 'pronunciation':
            return {
              ...base, type: 'pronunciation',
              word: String(q?.word || q?.question || '').trim(),
              phonetic: String(q?.phonetic || '').trim(),
              translation: String(q?.translation || '').trim(),
              acceptedVariants: Array.isArray(q?.acceptedVariants) ? q.acceptedVariants.map(String) : []
            };
          case 'translation':
            return {
              ...base, type: 'question-answer',
              prompt: String(q?.source || q?.question || '').trim() + ' → ' + String(q?.target || '').trim(),
              sampleAnswers: q?.target ? [String(q.target).trim()] : []
            };
          case 'short_answer':
          case 'question-answer':
            return {
              ...base, type: 'question-answer',
              prompt: String(q?.question || '').trim(),
              sampleAnswers: q?.answer ? [String(q.answer).trim()] : [],
              worksheetKind: type === 'true_false' ? 'true-false' : ''
            };
          default:
            return { ...base, type: itemType, ...q };
        }
      });

      return {
        id,
        exerciseId: id,
        topic: ex.topic || '',
        difficulty: ex.difficulty || 'easy',
        instruction_de: bracketParsed.instruction_de || ex.instruction_de || '',
        instruction_en: bracketParsed.instruction_en || ex.instruction_en || '',
        instruction: bracketInstruction || mergeWorksheetInstructions(ex.instruction_de || '', ex.instruction_en || ''),
        example: bracketParsed.example || ex.example || '',
        type,
        questionCount: Math.max(rawQuestions.length, pairs.length, questions.length, 1),
        rawText: rawText || (ai ? JSON.stringify(ai) : ''),
        questions,
        pairs,
        extractedItems,
      };
    }

    const detected = detectExerciseTypeAndQuestionCount(
      ex.content,
      ex.instruction_de,
      ex.sectionType,
      ex.exerciseId,
    );
    const preview = processExerciseForPreview(
      id,
      ex.content,
      answerMap,
      ex.instruction_de,
      ex.instruction_en,
    );
    const mergedInstruction =
      (preview.instruction && preview.instruction.trim()) ||
      mergeWorksheetInstructions(ex.instruction_de, ex.instruction_en);
    let type = detected.type;
    let questionCount = detected.questionCount;
    if (preview.type === 'matching' && preview.pairs.length) {
      type = 'matching';
      questionCount = preview.pairs.length;
    } else if (preview.type === 'fill_in_blank' && preview.questions.length) {
      type = 'fill_in_blank';
      questionCount = preview.questions.length;
    }
    return {
      id,
      exerciseId: id,
      topic: ex.topic || '',
      difficulty: ex.difficulty || 'easy',
      instruction_de: ex.instruction_de || '',
      instruction_en: ex.instruction_en || '',
      instruction: mergedInstruction,
      example: ex.example || '',
      type,
      questionCount,
      rawText,
      questions: preview.questions || [],
      pairs: preview.pairs || [],
    };
  });
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
      const split = splitWorksheetIntoExercises(result.text);
      const exercises = buildDetectedExercisePreview(result.text, split.exercises || [], split.solutionBlock || '');

      res.json({
        success: true,
        uploadId: path.basename(req.file.path),
        filename: req.file.originalname,
        pages: result.pages,
        totalChars: result.text.length,
        previewText,
        hasContent: result.text.trim().length > 50,
        detectedTypes,
        worksheetMode: _worksheetMode,
        exercises
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

// ─── ROUTE: POST /api/pdf-exercises/detect-structure-ai ──────────────────────
// Re-scan existing uploaded PDF and rebuild exercise rows using AI detection.
router.post('/detect-structure-ai',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const { uploadId } = req.body || {};
    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId is required' });
    }
    if (!openai) {
      return res.status(503).json({ error: 'AI service is not configured. Please set EXERCISES_OPENAI_API_KEY.' });
    }

    const filePath = path.join(__dirname, '..', 'uploads', 'pdf-exercises', uploadId);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'PDF file not found. Please upload again.' });
    }

    try {
      const result = await extractPdfText(filePath);
      if (!result.text || result.text.trim().length < 20) {
        return res.status(422).json({
          error: 'Could not extract readable text from the PDF. The PDF may be image-based or scanned. Please use a text-based PDF.'
        });
      }

      const rawDetected = detectQuestionTypes(result.text);
      const { _worksheetMode, ...detectedTypes } = rawDetected;

      const aiDetected = await detectExercisesWithAI(result.text);
      const aiBlocks = buildExercisesFromAiDetection(result.text, aiDetected);
      const exercises = buildDetectedExercisePreview(result.text, aiBlocks, '');

      return res.json({
        success: true,
        uploadId: String(uploadId),
        pages: result.pages,
        totalChars: result.text.length,
        previewText: result.text.substring(0, 2000),
        hasContent: result.text.trim().length > 50,
        detectedTypes,
        worksheetMode: true,
        exercises,
        structureSource: 'ai'
      });
    } catch (err) {
      console.error('AI structure scan error:', err);
      return res.status(500).json({ error: err.message || 'Failed to run AI structure scan' });
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
      worksheetMode: clientWorksheetMode,
      selectedExerciseIds,
      selectedExercises
    } = req.body;

    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId is required' });
    }

    if (!openai) {
      return res.status(503).json({ error: 'AI service is not configured. Please set EXERCISES_OPENAI_API_KEY.' });
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

      const resolvedTarget = targetLanguage || 'German';
      const resolvedNative = nativeLanguage || 'English';
      const contentLanguage = detectContentLanguage(pdfData.text, resolvedTarget);

      if (worksheetMode) {
        const jobId = createExtractionJob();
        process.nextTick(async () => {
          try {
            const result = await runSequentialWorksheetExtraction(pdfData.text, {
              level: level || 'A1',
              targetLanguage: resolvedTarget,
              nativeLanguage: resolvedNative,
              contentLanguage,
              sourceLabel: uploadId,
              selectedExerciseIds,
              selectedExercises,
              jobId
            });
            const allQuestions = result.allQuestions || [];
            const extractionLog = result.extractionLog || [];
            const failedExercises = result.failedExercises || extractionLog.filter(x => x.ok === false).map(x => String(x.exerciseId || 'unknown'));
            const total = Number(result.total || (allQuestions.length + failedExercises.length));
            const successCount = Math.max(0, total - failedExercises.length);
            updateExtractionJob(jobId, {
              status: 'done',
              progress: { current: total, total, currentExerciseId: null },
              result: {
                success: true,
                suggestedTitle: 'Extracted Worksheet',
                suggestedDescription: '',
                detectedLevel: level || 'A1',
                contentLanguage,
                contentType: 'questions_found',
                worksheetMode: true,
                extracted: allQuestions,
                failedExercises,
                total,
                successCount,
                failedCount: failedExercises.length,
                questions: allQuestions,
                extractionLog,
                pdfInfo: { pages: pdfData.pages, uploadId }
              }
            });
          } catch (jobErr) {
            updateExtractionJob(jobId, {
              status: 'error',
              error: jobErr?.statusCode === 400
                ? 'Failed to detect exercises from PDF structure.'
                : (jobErr.message || 'Extraction job failed')
            });
          }
        });
        return res.json({
          success: true,
          processing: true,
          jobId
        });
      }

      const prompt = buildGenerationPrompt(pdfData.text, {
            types: types || Object.keys(resolvedTypeCounts).filter(k => resolvedTypeCounts[k] > 0) || ['mcq'],
            typeCounts: resolvedTypeCounts,
            targetLanguage: resolvedTarget,
            nativeLanguage: resolvedNative,
            contentLanguage,
            level: level || 'A1',
            difficulty: difficulty || 'Beginner',
            maxQuestions: Math.min(resolvedMax, 100),
            worksheetMode
          });

      console.log(`🤖 Generating exercises from PDF: ${uploadId} (${pdfData.pages} pages, ${pdfData.text.length} chars)`);

      const generated = await extractWithRetry(prompt, {
        systemContent: 'You are an expert language exercise creator. Always respond with valid JSON only, no markdown code blocks, no extra text. Follow the user message strictly: every student-facing string (questions, prompts, options, sentences, sampleAnswers, titles) must use the SOURCE CONTENT LANGUAGE named in the prompt — never translate the source into another language unless that source language is explicitly different.',
        max_tokens: 4000,
        temperature: 0.4,
        logLabel: `generate:${uploadId}`
      });
      if (!generated) {
        return res.status(500).json({
          error: 'AI returned an unexpected format. Please try again.',
          details: process.env.NODE_ENV === 'development' ? 'Invalid JSON after retry' : undefined
        });
      }

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
        contentLanguage,
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
      if (err.statusCode === 400) {
        return res.status(400).json({ success: false, error: 'Failed to detect exercises from PDF structure.' });
      }
      if (err.code === 'insufficient_quota') {
        return res.status(503).json({ error: 'AI quota exceeded. Please try again later.' });
      }
      res.status(500).json({ error: err.message || 'Failed to generate exercises' });
    }
  }
);

// ─── ROUTE: GET /api/pdf-exercises/extraction-status/:jobId ───────────────────
router.get('/extraction-status/:jobId',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  (req, res) => {
    const jobId = String(req.params.jobId || '');
    const job = getExtractionJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, status: 'error', error: 'Extraction job not found or expired.' });
    }
    if (job.status === 'processing') {
      return res.json({ success: true, status: 'processing', jobId, progress: job.progress || null });
    }
    if (job.status === 'error') {
      return res.json({ success: false, status: 'error', jobId, error: job.error || 'Extraction failed.', progress: job.progress || null });
    }
    return res.json({ success: true, status: 'done', jobId, result: job.result, progress: job.progress || null });
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
      return res.status(503).json({ error: 'AI service is not configured. Please set EXERCISES_OPENAI_API_KEY.' });
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
      const resolvedTarget = targetLanguage || 'German';
      const resolvedNative = nativeLanguage || 'English';
      const contentLanguage = detectContentLanguage(cleanedText, resolvedTarget);

      // Worksheet text uses the strict extraction prompt; plain content uses generation.
      const isExtraction = worksheetMode;
      const prompt = isExtraction
        ? buildExtractionPrompt(cleanedText, {
            targetLanguage: resolvedTarget,
            nativeLanguage: resolvedNative,
            contentLanguage,
            level: level || 'A1'
          })
        : buildGenerationPrompt(cleanedText, {
            types: types || Object.keys(resolvedTypeCounts).filter(k => resolvedTypeCounts[k] > 0) || ['mcq'],
            typeCounts: resolvedTypeCounts,
            targetLanguage: resolvedTarget,
            nativeLanguage: resolvedNative,
            contentLanguage,
            level: level || 'A1',
            difficulty: difficulty || 'Beginner',
            maxQuestions: Math.min(resolvedMax, 100),
            worksheetMode
          });

      console.log(`🤖 ${isExtraction ? 'Extracting' : 'Generating'} exercises from pasted text (${cleanedText.length} chars)`);

      const generated = await extractWithRetry(prompt, {
        systemContent: isExtraction
          ? 'You are an expert educational worksheet parser. Always respond with valid JSON only, no markdown code blocks, no extra text. Extract exercises EXACTLY as they appear in the source — never invent or paraphrase content.'
          : 'You are an expert language exercise creator. Always respond with valid JSON only, no markdown code blocks, no extra text. Follow the user message strictly: every student-facing string (questions, prompts, options, sentences, sampleAnswers, titles) must use the SOURCE CONTENT LANGUAGE named in the prompt — never translate the source into another language unless that source language is explicitly different.',
        max_tokens: 4000,
        temperature: isExtraction ? 0.1 : 0.4,
        logLabel: `text-generate:${isExtraction ? 'extract' : 'generate'}`
      });
      if (!generated) {
        return res.status(500).json({
          error: 'AI returned an unexpected format. Please try again.',
          details: process.env.NODE_ENV === 'development' ? 'Invalid JSON after retry' : undefined
        });
      }

      // Flatten extraction schema or sanitize generation schema
      const questions = isExtraction
        ? flattenExtractionResult(generated)
        : (generated.questions || [])
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
        contentLanguage,
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

// ─── Per-exercise extraction prompt ──────────────────────────────────────────
// Called for ONE exercise block at a time. More precise than the whole-doc prompt.
// Input fields map directly to the structured INPUT FORMAT the user defined.

function buildSingleExerciseExtractionPrompt(block) {
  const {
    topic = '',
    exerciseId = '',
    level = 'easy',
    instruction_de = '',
    instruction_en = '',
    content = '',
    solution_key = '',
    questionCount = null
  } = block;

  return `You are a deterministic worksheet extraction engine.

Your job is to convert structured worksheet content into PERFECT JSON.
You MUST NOT generate or invent any content.

---

INPUT:

TOPIC: ${topic}
EXERCISE_ID: ${exerciseId}
LEVEL: ${level}
INSTRUCTION_DE: ${instruction_de}
INSTRUCTION_EN: ${instruction_en}
EXPECTED_QUESTION_COUNT: ${questionCount != null ? Number(questionCount) : '(auto)'}

CONTENT:
${content}

SOLUTION_KEY:
${solution_key || '(none)'}

---

CORE RULES (STRICT)

1. NO GENERATION — do NOT create new questions, do NOT rewrite sentences.
   Only extract and map existing content.

2. TYPE DETECTION — classify EXACTLY one type:
   - mcq           → options like (a / b) OR (und / aber) OR a. b. c.
   - matching       → two columns need pairing
   - fill_in_blank  → blanks like ___ exist
   - singular_plural → singular/plural practice (Singular→Plural, Plural forms, etc.): one row per word pair; use pairs[{singular, plural}]
   - error_correction → sentences must be corrected
   - open_writing   → user writes their own sentences
   - transformation → sentence transformation required
   - true_false     → explicitly stated Richtig/Falsch or True/False
   - short_answer   → direct answer expected
   - pronunciation   → single words or short phrases to speak aloud / Aussprache
   If unsure → leave type as empty string.

3. INSTRUCTION MAPPING
   - instruction_de = EXACT German instruction from INSTRUCTION_DE above (strip any leading "Instruction:" or "Anweisung:" label if present)
   - instruction_en = EXACT English instruction (if present)
   - DO NOT merge or rewrite
   - BRACKET MARKERS: {curly braces} = instruction (split on " / " for DE/EN); [square brackets] = example on FIRST question row only. Strip markers from CONTENT and question text.

4. QUESTION EXTRACTION — TYPE-BASED SPLITTING (MANDATORY)
   Extract the REAL worksheet item count. Do NOT over-group and do NOT over-split.
   Keep original German text exactly as written.
   If EXPECTED_QUESTION_COUNT is a valid number > 0, use it as the target count when splitting.

   Splitting rules:
   - matching           → each pair = ONE question
   - fill_in_blank      → each sentence/item = ONE question (see fill-blank formatting rules below)
   - transformation     → each sentence/item = ONE question
   - error_correction   → each sentence/item = ONE question
   - singular/plural or table/profile pair tasks → each word/value pair = ONE question
   - question formulation / short-answer tasks    → each sentence/item = ONE question
   - writing own sentences                        → each required sentence = ONE question
   - paragraph/profile writing                    → ONE question only

   Additional strict rules:
   - Do NOT merge unrelated numbered items.
   - Do NOT reduce item count.
   - Do NOT invent missing items.
   - For inline choice patterns like "(und / aber)", treat each sentence as a fill_in_blank item.

5. ANSWER MAPPING (CRITICAL)
   If SOLUTION_KEY exists, extract answers EXACTLY from it — DO NOT guess.

   Per type:
   - matching:         each extracted question should contain the pair for one item
   - fill_in_blank:    each extracted question should represent one sentence/item;
                       answers[] must match that item's blanks only
   - error_correction: each extracted question should represent one wrong sentence;
                       correctedText or answers[] should map that one sentence
   - transformation:   each extracted question should represent one source sentence;
                       answers[] should contain that one transformed output
   - true_false:       each extracted question should represent one statement;
                       answers[] should contain "richtig" or "falsch"
   - singular_plural: each question object is ONE row: either pairs: [{ "singular":"...", "plural":"..." }] OR legacy question + correctAnswer for a single row
   - short_answer/open_writing item tasks: one question per item with its mapped answer(s)
   - paragraph/profile writing: one question only for the full writing task

   If no solution → leave answer fields empty / null.

6. fill_in_blank FORMATTING (VERY IMPORTANT)
   - Put ONLY the clause students fill in inside "question": underscore blanks (_) as in the PDF.
   - Do NOT prefix with worksheet item numbers (no leading "1." / "2)" — those are layout only).
   - If a line ends with a translation scaffold like "→ ____" or "-> ____" where ONLY underscores follow the arrow (no words), OMIT that arrow and second gap — it is not a separate graded blank unless the answer key lists a distinct translation answer for it.
   - If the worksheet shows a worked example ("Beispiel:", "Example:", "z.B.") that belongs to this exercise block, copy it verbatim into "example" on the FIRST question row only (leave "" on other rows unless an example is tied to one specific item). This applies to ALL exercise types (mcq, true_false, short_answer, fill_in_blank, etc.).

7. instruction_en — copy verbatim from INSTRUCTION_EN above when provided; otherwise extract English from bilingual headings in CONTENT (text after " / " or after "Hinweis / Note") into instruction_en.

8. NO HALLUCINATION — if any part is unclear, leave fields empty. DO NOT guess.

---

SELF-VALIDATION (MANDATORY BEFORE OUTPUT):
✓ questions array count matches real worksheet items for this exercise type
✓ No invented content
✓ No missing instructions
✓ For fill_in_blank, answers map per item (not globally merged); blank count in "question" must equal answers.length when answers are known
✓ For singular_plural, each question has pairs[] with singular and plural populated from CONTENT / SOLUTION_KEY

---

Return ONLY valid JSON in this EXACT shape:
{
  "exerciseId": "${exerciseId}",
  "topic": "${topic}",
  "difficulty": "${level}",
  "type": "",
  "instruction_de": "",
  "instruction_en": "",
  "questions": [
    {
      "question": "",
      "example": "",
      "options": [],
      "correctAnswerIndex": null,
      "answers": [],
      "pairs": [{"singular":"","plural":""}],
      "correctedText": "",
      "word": "",
      "phonetic": "",
      "translation": ""
    }
  ]
}

NOTE: For type "pronunciation", use "word" for the target word/phrase (not "question"),
"phonetic" for optional IPA, and "translation" for optional translation.

IMPORTANT JSON RULES:
- Output MUST be valid JSON
- All strings must be properly closed
- Do NOT include line breaks inside string values
- Replace newlines with spaces
- Do NOT truncate output
- If invalid, fix internally before returning

No explanation. No markdown. Return ONLY the JSON object.`;
}

// ─── Worksheet splitter ───────────────────────────────────────────────────────
// Splits raw PDF/text into individual exercise blocks by detecting:
// - Übung headers  (Übung L1.1, Übung 2, etc.)
// - Topic headers  (Thema 1, Lektion 1, etc.)
// - STUFE sections (STUFE 1 – LEICHT)
// - LÖSUNGSSCHLÜSSEL / Answer Key as a separate tail block
//
// Returns { solutionBlock: string, exercises: ExerciseBlock[] }

function normalizePdfText(text) {
  let t = String(text || '');
  // Repair common broken encodings / OCR variants of "Übung"
  t = t.replace(/Ãœbung/gi, 'Übung');
  t = t.replace(/\bUbung\b/gi, 'Übung');
  t = t.replace(/Ü\s*b\s*u\s*n\s*g/gi, 'Übung');
  t = t.replace(/Ü\s+bung/gi, 'Übung');
  t = t.replace(/Übung(?=\d)/gi, 'Übung ');
  // Normalize broken exercise decimals like "1 . 1" -> "1.1"
  t = t.replace(/(\d+)\s*\.\s*(\d+)/g, '$1.$2');
  // Normalize "Übung 1 .1" or "Übung1 . 1"
  t = t.replace(/(Übung)\s*(\d+)\s*\.\s*(\d+)/gi, '$1 $2.$3');
  // Ensure a space after Übung and before first number
  t = t.replace(/\bÜbung\s*(\d)/gi, 'Übung $1');
  // Join broken lines where newline is followed by lowercase text
  t = t.replace(/\n(?=[a-zäöüß])/g, ' ');
  // Normalize spacing
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t;
}

/** Answer-key tail when splitter did not isolate it (e.g. marker appears early). */
function extractAnswerKey(fullText) {
  const m = String(fullText || '').match(
    /L[ÖO]SUNGSSCHL[ÜU]SSEL|Lösungsschlüssel|Lösungen|Answer Key[\s\S]*/i,
  );
  return m ? m[0] : '';
}

/** Map exercise id → raw answer subsection text (from Übung header to next Übung or EOF). */
function parseAnswerKey(answerText) {
  const map = {};
  const t = String(answerText || '');
  const re = /Übung\s+([A-Za-z]?\d+(?:\.\d+)+)/gi;
  const hits = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    hits.push({ id: String(m[1] || '').trim(), index: m.index });
  }
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].index : t.length;
    const slice = t.slice(hits[i].index, end).trim();
    const id = hits[i].id;
    if (!id) continue;
    map[id] = slice;
    const noL = id.replace(/^L/i, '');
    if (noL !== id && !map[noL]) map[noL] = slice;
    if (!/^L/i.test(id)) {
      const withL = `L${id}`;
      if (!map[withL]) map[withL] = slice;
    }
  }
  return map;
}

function resolveAnswerBlock(answerMap, exerciseId) {
  const id = String(exerciseId || '').trim();
  if (!id || !answerMap || typeof answerMap !== 'object') return '';
  const candidates = [id, id.replace(/^L/i, ''), id.match(/^\d/) ? `L${id}` : id];
  for (const c of candidates) {
    if (c && answerMap[c]) return answerMap[c];
  }
  for (const key of Object.keys(answerMap)) {
    const kn = key.replace(/^L/i, '');
    const in_ = id.replace(/^L/i, '');
    if (key === id || kn === in_) return answerMap[key];
  }
  return '';
}

function stripWorksheetExerciseHeader(blockText) {
  const lines = String(blockText || '').split('\n');
  if (!lines.length) return String(blockText || '').trim();
  const first = lines[0].trim();
  if (/^(?:Ü\s*b\s*u\s*n\s*g|Übung|Ubung)\s+[A-Z]?\d+(?:\.\d+)?/i.test(first)) {
    return lines.slice(1).join('\n').trim();
  }
  return String(blockText || '').trim();
}

/**
 * Inline matching: one line like `1. ich a. kommen` (OCR spacing tolerant).
 * Prefer answer-key lines `1 – a Wort` for the right column — do not trust OCR right column when key exists.
 */
function extractInlineMatching(blockText) {
  const items = [];
  const body = stripWorksheetExerciseHeader(blockText);
  const regex = /^(\d+)\.\s+(.+?)\s+([a-z])\.\s+(.+)$/i;
  for (const line of body.split('\n')) {
    const m = line.trim().match(regex);
    if (!m) continue;
    items.push({
      index: parseInt(m[1], 10),
      left: String(m[2] || '').trim(),
      option: String(m[3] || '').toLowerCase(),
      rawRight: String(m[4] || '').trim(),
    });
  }
  return items;
}

function applyMatchingAnswerKey(items, answerBlock) {
  const map = {};
  const block = String(answerBlock || '');
  const patterns = [
    /(\d+)\s*[\u2013\u2014\-–]\s*([a-z])\s+(.+)/gi,
    /(\d+)\.\s*([a-z])\s*[.):\-–]\s*(.+)/gi,
    /(\d+)\s+([a-z])\s*[.):\-–]\s*(.+)/gi,
  ];
  for (const re of patterns) {
    let mm;
    while ((mm = re.exec(block)) !== null) {
      map[`${parseInt(mm[1], 10)}-${String(mm[2]).toLowerCase()}`] = String(mm[3] || '').trim();
    }
  }
  const hasKeyLines = Object.keys(map).length > 0;
  return (items || []).map((item) => {
    const key = `${item.index}-${String(item.option).toLowerCase()}`;
    const fromKey = map[key];
    const right = fromKey || (!hasKeyLines ? item.rawRight : '');
    return { left: item.left, right };
  });
}

function extractFillBlankLines(blockText) {
  const questions = [];
  const re = /^\d+\.\s*(.*)$/;
  for (const line of String(blockText || '').split('\n')) {
    const m = line.trim().match(re);
    if (m) questions.push({ raw: String(m[1] || '').trim() });
  }
  return questions;
}

function parseFillAnswerLinesFromBlock(answerBlock) {
  const answers = [];
  for (const line of String(answerBlock || '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^\d+\s*[.)\-–]\s*(.+)$/);
    if (m) answers.push(String(m[1] || '').trim());
  }
  return answers;
}

function applyFillAnswersFromBlock(questions, answerBlock) {
  const answers = parseFillAnswerLinesFromBlock(answerBlock);
  return (questions || []).map((q, i) => {
    const answer = String(answers[i] || '').trim();
    let sentence = q.raw;
    if (answer && !/_{2,}/.test(sentence)) {
      const g = generateFillBlank(sentence, answer);
      if (g) {
        return { sentence: g.sentence, answer: g.answer };
      }
    }
    if (answer && /_{2,}/.test(sentence)) {
      return { sentence, answer };
    }
    return { sentence, answer };
  });
}

/** Deterministic worksheet preview: matching (inline + key) or fill-in-blank (numbered lines + key). */
function processExerciseForPreview(exerciseId, blockText, answerMap, instruction_de, instruction_en) {
  const instruction = mergeWorksheetInstructions(instruction_de, instruction_en);
  const answerBlock = resolveAnswerBlock(answerMap, exerciseId);
  const block = String(blockText || '');
  const body = stripWorksheetExerciseHeader(block);
  const hay = `${instruction_de}\n${instruction_en}\n${body}`;

  if (/\b(zuordnen|zuordnungs|matching|connect|pair|verbinden)\b/i.test(hay)) {
    const items = extractInlineMatching(block);
    if (items.length) {
      const pairs = applyMatchingAnswerKey(items, answerBlock).filter((p) => p.left && p.right);
      if (pairs.length) {
        return { type: 'matching', instruction, pairs, questions: [] };
      }
    }
  }
  if (/\b(lückentext|lueckentext|fill[-\s]?in|lücken|luecken)\b/i.test(hay)) {
    const rows = extractFillBlankLines(body);
    if (rows.length) {
      const questions = applyFillAnswersFromBlock(rows, answerBlock);
      if (questions.length) {
        return { type: 'fill_in_blank', instruction, questions, pairs: [] };
      }
    }
  }
  return { type: '', instruction, questions: [], pairs: [] };
}

function splitWorksheetIntoExercises(text) {
  const rawText = String(text || '');
  const normalized = normalizePdfText(text);
  console.log('PDF raw preview:', rawText.slice(0, 500));
  console.log('PDF normalized preview:', normalized.slice(0, 500));

  let exerciseText = normalized;
  const solutionRegex = /\n\s*(LÖSUNGSSCHLÜSSEL|Lösungsschlüssel|Lösungen|Lösung|Answer Key|Lösungen:)\s*\n/i;
  const solutionMatch = solutionRegex.exec(exerciseText);
  let solutionIndex = -1;
  if (solutionMatch && solutionMatch.index > exerciseText.length * 0.5) {
    solutionIndex = solutionMatch.index;
    exerciseText = exerciseText.slice(0, solutionIndex);
  }

  // ─── Pass 0: "Instruction:" / "Anweisung:" markers ──────────────────────────
  // Handles PDFs that use an explicit "Instruction: ..." label to start each exercise block.
  const instructionMarkerRegex = /(?:^|\n)[ \t]*(Instruction|Anweisung)\s*:/gi;
  const instructionMatches = [...exerciseText.matchAll(instructionMarkerRegex)];
  let matches = [];
  if (instructionMatches.length >= 2) {
    console.log('Pass 0: Instruction: markers found', instructionMatches.length);
    matches = instructionMatches.map(m => ({ 0: m[0].trim(), index: m.index }));
  }

  // ─── Pass 1: classic Übung markers ──────────────────────────────────────────
  const ubungRegex = /(?:Ü\s*b\s*u\s*n\s*g|Übung|Ubung)\s*[A-Z]?\d+(?:\.\d+)?/gi;
  if (!matches.length) matches = [...exerciseText.matchAll(ubungRegex)];

  // ─── Pass 2: dotted numeric IDs  1.1, 2.3  ──────────────────────────────────
  if (!matches.length) {
    const idRegex = /\b([A-Z]?\d+\.\d+)\b/g;
    const seenIds = new Set();
    const fallback = [];
    for (const m of exerciseText.matchAll(idRegex)) {
      const id = String(m[1] || '').trim();
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      fallback.push({ 0: `Übung ${id}`, index: m.index });
    }
    if (fallback.length) {
      console.warn('Primary Übung regex found no matches; using numeric fallback detection.');
      matches = fallback;
    }
  }

  // ─── Pass 3: broad heading detection  "1.", "2.", "A.", "B." or title keywords ─
  // Catches worksheets that use plain numbered/lettered sections without the word "Übung".
  if (!matches.length) {
    const lines = exerciseText.split('\n');
    const headingRegex = /^(?:(\d+)\.\s+\S|([A-Z])\.\s+\S)/;
    const titleKeywords = /\b(Wortschatz|Übung|Aufgabe|Jumbled|Fill\s+in|Match|Zuordnung|Translation|Pronunciation|Vocabulary|Grammar)\b/i;
    const broadFallback = [];
    const seenNums = new Set();
    let offset = 0;
    for (const line of lines) {
      const hm = headingRegex.exec(line.trim());
      if (hm || titleKeywords.test(line)) {
        const num = hm ? (hm[1] || hm[2]) : line.trim().slice(0, 20);
        if (!seenNums.has(num)) {
          seenNums.add(num);
          broadFallback.push({ 0: line.trim().slice(0, 40), index: offset });
        }
      }
      offset += line.length + 1;
    }
    if (broadFallback.length) {
      console.warn('Fallback to broad heading detection:', broadFallback.map(m => m[0]));
      matches = broadFallback;
    }
  }

  // Deduplicate matched exercise headers while preserving source order.
  const seenMatchKeys = new Set();
  matches = matches.filter(m => {
    const idMatch = /(\d+(?:\.\d+)?|[A-Z])/.exec(String(m[0] || ''));
    const key = idMatch ? idMatch[1] : String(m[0] || '').trim().toLowerCase().slice(0, 30);
    if (!key || seenMatchKeys.has(key)) return false;
    seenMatchKeys.add(key);
    return true;
  });

  console.log('Detected exercises:', matches.map(m => m[0]));

  if (!matches.length) {
    return { exercises: [], solutionBlock: '' };
  }

  const exercises = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = matches[i + 1]?.index || exerciseText.length;
    const block = exerciseText.slice(start, end).trim();
    if (!block || block.length < 10) continue;

    // Derive a stable exerciseId from the heading text
    const idMatch = /(?:Ü\s*b\s*u\s*n\s*g|Übung|Ubung)\s*([A-Z]?\d+(?:\.\d+)?)/i.exec(block)
      || /\b([A-Z]?\d+\.\d+)\b/.exec(block)
      || /^(?:(\d+)\.|([A-Z])\.)/.exec(block.trim());
    const exerciseId = idMatch
      ? String(idMatch[1] || idMatch[2] || '').trim()
      : String(i + 1);

    let instruction_de = '';
    let instruction_en = '';
    const firstLines = block.split('\n').slice(0, 4).join(' ');
    const slashSplit = firstLines.split(/\s*\/\s*/);
    if (slashSplit.length >= 2) {
      instruction_de = slashSplit[0].replace(/^\d+\.\s*|^[A-Z]\.\s*/g, '').trim();
      instruction_en = slashSplit.slice(1).join(' / ').trim();
    } else {
      instruction_de = firstLines.replace(/^\d+\.\s*|^[A-Z]\.\s*/g, '').trim();
    }
    // Strip explicit "Instruction:" / "Anweisung:" label prefix if present
    instruction_de = instruction_de.replace(/^(?:Instruction|Anweisung)\s*:\s*/i, '').trim();

    exercises.push(applyBracketMarkersToExercise({
      id: exerciseId,
      exerciseId,
      topic: '',
      difficulty: 'easy',
      instruction_de,
      instruction_en,
      sectionType: '',
      content: block,
      solution_key: ''
    }));
  }

  const solutionBlock = solutionIndex !== -1 ? normalized.slice(solutionIndex) : '';
  return { exercises, solutionBlock };
}

// ─── AI-powered full extraction for worksheets whose headings don't match ────
// any regex pattern. Returns the exercises array directly (already structured).
async function detectExercisesWithAI(text) {
  const sample = String(text || '').slice(0, 18000);

  const prompt = `You are an expert educational content parser specialized in extracting structured exercises from messy PDF text.

Your task is to analyze the given raw text extracted from a worksheet PDF and convert it into clean, structured JSON.

----------------------------------------
GOAL
----------------------------------------
Identify ALL exercises in the text and extract them into structured format.

----------------------------------------
STEP 1: DETECT EXERCISE BLOCKS
----------------------------------------
Split the text into logical exercise sections.

Clues for new exercises:
- Numbered headings (1., 2., 3., etc.)
- Titles like: Wortschatz, Übung, Aufgabe, Match the pairs, Jumbled Letters, Fill in the blanks
- Capital letter sections (A., B., C.)

Each section = one exercise block

----------------------------------------
STEP 2: IDENTIFY EXERCISE TYPE
----------------------------------------
For each block, detect type:

- "matching"  → pairs like:  word — meaning  /  word → meaning
- "jumbled_words"  → scrambled letters to form words
- "fill_blank"  → sentences with blanks (___)
- "mcq"  → options like a), b), c), d)
- "translation"  → German ↔ English conversion
- "qa"  → direct questions/answers
- "true_false"  → statements marked Richtig/Falsch or True/False
- "pronunciation"  → words or phrases for speaking aloud / Aussprache

----------------------------------------
STEP 3: EXTRACT CONTENT
----------------------------------------

1. MATCHING — extract pairs:
   { "left": "das Wohnzimmer", "right": "living room" }

2. MCQ — extract question, options array, correct answer (or null)

3. FILL_BLANK — extract sentence, correct answer (or null)

4. JUMBLED_WORDS — extract scrambled, correct_word (or null if not inferable)

5. TRANSLATION — extract source, target

6. QA — extract question, answer (or null)

7. TRUE_FALSE — extract question, answer (True/False)

8. PRONUNCIATION — extract word, phonetic (if available), translation (if available)

----------------------------------------
IMPORTANT RULES
----------------------------------------
- Ignore meta-instructions like "Match the following", "Example:", bilingual workout headers
- Treat "—", "→", "-" as matching separators
- If multiple pairs are on the same line → split them
- Fix broken / merged lines logically
- Preserve original words (do NOT translate)
- If answer is not clearly available → set "answer": null
- Do NOT hallucinate answers

----------------------------------------
OUTPUT FORMAT (STRICT JSON ONLY)
----------------------------------------

Return ONLY this JSON — no markdown, no explanation, no comments:

{
  "exercises": [
    {
      "title": "Exercise title if found",
      "type": "matching",
      "questions": [
        { "left": "", "right": "" }
      ]
    },
    {
      "title": "Pronunciation exercise",
      "type": "pronunciation",
      "questions": [
        { "word": "der Tisch", "phonetic": "/deːɐ̯ tɪʃ/", "translation": "the table" }
      ]
    }
  ]
}

----------------------------------------
INPUT TEXT:
----------------------------------------
${sample}`;

  const parsed = await extractWithRetry(prompt, {
    systemContent: 'You are a deterministic worksheet extraction engine. Return ONLY valid JSON matching the requested schema. No markdown fences. No explanation. Never invent content.',
    max_tokens: 4000,
    temperature: 0.0,
    logLabel: 'ai-full-extractor'
  });

  // parsed should be { exercises: [...] } — convert to the startSnippet format
  // that buildExercisesFromAiDetection expects.
  const rawExercises = Array.isArray(parsed?.exercises) ? parsed.exercises : [];
  if (!rawExercises.length) {
    console.warn('[detectExercisesWithAI] AI returned no exercises.');
    return [];
  }

  console.log(`[detectExercisesWithAI] AI extracted ${rawExercises.length} exercise(s) directly.`);

  // Return in the startSnippet format so the rest of the pipeline
  // (buildExercisesFromAiDetection) can slice the source text correctly.
  return rawExercises.map((ex, i) => {
    const firstQuestion = (ex.questions || [])[0];
    const exerciseId = String(ex.title || (i + 1)).replace(/\s+/g, '_').slice(0, 20) || String(i + 1);
    return {
      exerciseId,
      startSnippet: String(ex.title || '').trim().slice(0, 60),
      _aiExtracted: ex
    };
  }).filter(item => item.exerciseId);
}

function buildExercisesFromAiDetection(text, detections) {
  if (!detections || !detections.length) return [];

  const source = normalizePdfText(String(text || ''));

  // Find snippet positions for all detections in the source text.
  const withIndex = detections
    .map(d => ({ ...d, index: d.startSnippet ? source.indexOf(d.startSnippet) : -1 }));

  // Detections whose snippet was found — order by position in the source.
  const found = withIndex.filter(d => d.index >= 0).sort((a, b) => a.index - b.index);
  // Detections whose snippet was NOT found — keep them but fallback to AI title.
  const missing = withIndex.filter(d => d.index < 0);

  const exercises = [];
  const seenExerciseIds = new Set();

  // Build from snippets found in the source text.
  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    const next = found[i + 1];
    const end = next ? next.index : source.length;
    const prevEnd = i > 0 ? found[i - 1].index : 0;
    const rawStart = cur.index;
    const raw = source.slice(rawStart, end).trim();
    if (!cur.exerciseId || seenExerciseIds.has(cur.exerciseId)) continue;
    seenExerciseIds.add(cur.exerciseId);
    const ai = cur._aiExtracted || null;
    exercises.push({
      id: cur.exerciseId,
      exerciseId: cur.exerciseId,
      topic: ai ? String(ai.title || '').trim() : '',
      difficulty: 'easy',
      instruction_de: '',
      instruction_en: '',
      sectionType: ai ? String(ai.type || '') : '',
      content: raw,
      solution_key: '',
      _aiPreExtracted: ai
    });
  }

  // Fallback for detections without a matching snippet.
  for (const d of missing) {
    const ai = d._aiExtracted;
    if (!d.exerciseId || seenExerciseIds.has(d.exerciseId)) continue;
    seenExerciseIds.add(d.exerciseId);
    exercises.push({
      id: d.exerciseId,
      exerciseId: d.exerciseId,
      topic: ai ? String(ai.title || '').trim() : '',
      difficulty: 'easy',
      instruction_de: '',
      instruction_en: '',
      sectionType: ai ? String(ai.type || '') : '',
      content: (() => {
        if (!ai) return 'exercise';
        const base = String(ai.title || ai.type || '').trim();
        if (base.length >= 20) return base;
        // Try to find question text in source as content.
        const q1 = Array.isArray(ai.questions) ? ai.questions[0] : null;
        if (q1) {
          const qText = String(q1.sentence || q1.question || q1.left || q1.scrambled || q1.source || q1.prompt || '').trim().slice(0, 60);
          if (qText) {
            const qIdx = source.indexOf(qText);
            if (qIdx >= 0) {
              const preText = source.slice(Math.max(0, qIdx - 500), qIdx);
              const lastBrace = preText.lastIndexOf('{');
              const rawStart = lastBrace >= 0 ? Math.max(0, qIdx - 500) + lastBrace : Math.max(0, qIdx - 200);
              const postText = source.slice(qIdx + qText.length, Math.min(source.length, qIdx + 2000));
              const nextBrace = postText.indexOf('\n{');
              const rawEnd = nextBrace >= 0 ? qIdx + qText.length + nextBrace : Math.min(source.length, qIdx + 1000);
              return source.slice(rawStart, rawEnd).trim();
            }
            return qText;
          }
        }
        return base || 'exercise';
      })(),
      solution_key: '',
      _aiPreExtracted: ai
    });
  }

  return exercises.filter(ex => ex.content && ex.content.length >= 3);
}

function detectExerciseTypeAndQuestionCount(content, instruction = '', sectionType = '', exerciseId = '') {
  if (!content && !instruction) return { type: '', questionCount: 0 };
  const rawContent = String(content || '');
  const lines = rawContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const instr = String(instruction || '').toLowerCase();
  const numbered = rawContent.match(/^\s*\d+[.)]/gm) || [];

  // Instruction is the sole source of truth for type.
  // Priority order: matching > mcq > fill_blank > singular_plural > question > error_correction > writing
  let type = 'unknown';
  if (/zuordnungs|zuordnen|verbinden|matching|connect|pair/i.test(instr)) {
    type = 'matching';
  } else if (/welches|which|choose|wähle|passt/i.test(instr)) {
    type = 'mcq';
  } else if (/lückentext|ergänzen|fill/i.test(instr)) {
    type = 'fill_in_blank';
  } else if (/plural|singular/i.test(instr)) {
    type = 'singular_plural';
  } else if (/frage|formulier|bilden/i.test(instr)) {
    type = 'short_answer';
  } else if (/fehler|korrigieren|correct.*error|find.*error/i.test(instr)) {
    type = 'error_correction';
  } else if (/aussprache|pronunciation|phonetic|speak\s*aloud|pronounce/i.test(instr)) {
    type = 'pronunciation';
  } else if (/schreiben|write/i.test(instr)) {
    if (/frage|question/i.test(instr)) {
      type = 'short_answer';
    } else if (/fehler|korrigieren|correct.*error|find.*error/i.test(instr)) {
      type = 'error_correction';
    } else {
      type = 'open_writing';
    }
  }

  // Mixed instruction: correction wins over writing only when truly about error fixing.
  if (/fehler|korrigieren|correct.*error|find.*error/i.test(instr) && /satz|write|schreiben/i.test(instr)) {
    type = 'error_correction';
  }

  // Safe fallback for unresolved 'unknown' types.
  if (type === 'unknown') {
    console.log('[FALLBACK TYPE]', { id: exerciseId || null, instruction });
    if (/connect|match|pair/i.test(instr)) {
      type = 'matching';
    } else if (/fill/i.test(instr)) {
      type = 'fill_in_blank';
    } else if (/question|frage/i.test(instr)) {
      type = 'short_answer';
    }
  }

  // Count based on type.
  let questionCount = 1;
  if (type === 'matching') {
    const leftItems = lines.filter(l => /^\d+\./.test(l));
    const rightItems = lines.filter(l => /^[a-z]\./i.test(l));
    if (leftItems.length && rightItems.length) {
      questionCount = Math.min(leftItems.length, rightItems.length);
    } else if (leftItems.length) {
      questionCount = leftItems.length;
    } else {
      const inlinePairs = lines.filter(l => /\d+[.)].+?[a-zA-Z][.)]/.test(l));
      questionCount = inlinePairs.length || 4;
    }
    console.log('[MATCH COUNT]', {
      id: exerciseId || null,
      left: leftItems.length,
      right: rightItems.length,
      final: questionCount
    });
  } else if (type === 'fill_in_blank') {
    const blankLines = lines.filter(l => /_+/.test(l)).length;
    questionCount = Math.max(blankLines, 1);
  } else if (type === 'open_writing') {
    questionCount = 1;
  } else {
    questionCount = Math.max(numbered.length, 1);
  }

  console.log('[FINAL CLASSIFIER]', {
    id: exerciseId || null,
    instruction,
    detectedType: type
  });

  return { type, questionCount };
}

// ─── Convert single-exercise extraction result to flat question(s) ────────────
// Same type-mapping logic as flattenExtractionResult, but for one exercise.
// `blockMeta` optional: { instruction_de, instruction_en } from splitWorksheetIntoExercises (AI may omit).

/** Pairs from AI "full worksheet" schema: each row { left, right } (not nested in question string). */
function pairsFromAiMatchingQuestions(questions) {
  const rows = Array.isArray(questions) ? questions : [];
  return rows
    .map((q) => ({
      left: String(q?.left != null ? q.left : '').trim(),
      right: String(q?.right != null ? q.right : '').trim()
    }))
    .filter((p) => p.left || p.right);
}

function rawLooksLikeJsonObject(s) {
  const t = String(s || '').trim();
  return t.startsWith('{') && t.endsWith('}');
}

/** Normalize one AI jumble row — field names vary by model / prompt version. */
function normalizeAiJumbleItem(q) {
  if (!q || typeof q !== 'object') {
    return { scramble: '', cw: '', category: '', hintLetter: '' };
  }
  let scramble = String(
    q.scrambled != null ? q.scrambled
      : (q.scramble != null ? q.scramble
        : (q.scrambled_text != null ? q.scrambled_text
          : (q.scrambledText != null ? q.scrambledText
            : (q.letters_display != null ? q.letters_display : ''))))
  ).trim();
  if (!scramble && Array.isArray(q.letters)) {
    scramble = q.letters.map((ch) => String(ch ?? '').trim()).filter(Boolean).join(' ');
  }
  if (!scramble && Array.isArray(q.tokens)) {
    scramble = q.tokens.map((t) => String(t ?? '').trim()).filter(Boolean).join(' ');
  }
  const cw = String(
    q.correct_word != null ? q.correct_word
      : (q.correctWord != null ? q.correctWord
        : (q.expected_word != null ? q.expected_word
          : (q.expectedWord != null ? q.expectedWord
            : (q.word != null ? q.word
              : (q.answer != null ? q.answer
                : (q.solution != null ? q.solution : ''))))))
  ).trim();
  const category = String(q.category != null ? q.category : (q.topic != null ? q.topic : '')).trim();
  let hintLetter = String(
    q.hint_letter != null ? q.hint_letter
      : (q.bold_letter != null ? q.bold_letter
        : (q.boldLetter != null ? q.boldLetter : ''))
  ).trim();
  // Some schemas put the single hint letter in `hint` (e.g. "W"); ignore long instructional strings.
  if (!hintLetter && q.hint != null) {
    const h = String(q.hint).trim();
    if (h.length > 0 && h.length <= 4) {
      const hm = h.match(/[\p{L}]/u);
      if (hm) hintLetter = hm[0];
    }
  }
  return { scramble, cw, category, hintLetter };
}

function flattenSingleExercise(result, rawExerciseContent = '', blockMeta = null) {
  const bracketParsed = extractBracketMarkers(rawExerciseContent);
  const mappedType = EXTRACTION_TYPE_MAP[result.type] || 'question-answer';
  const worksheetKind = EXTRACTION_WORKSHEET_KIND[result.type] || null;
  const sectionTitle = [result.topic, result.exerciseId].filter(Boolean).join(' | ') || null;
  const raw = bracketParsed.cleanedContent || String(rawExerciseContent || '').trim();
  const deInstr = String(result.instruction_de || blockMeta?.instruction_de || bracketParsed.instruction_de || '').trim();
  const enInstr = String(result.instruction_en || blockMeta?.instruction_en || bracketParsed.instruction_en || '').trim();
  const mergedInstr = mergeWorksheetInstructions(deInstr, enInstr) || null;
  const blockExample = String(blockMeta?.example || bracketParsed.example || '').trim();

  const exerciseBase = () => ({
    type: mappedType,
    points: 1,
    sectionTitle,
    worksheetKind: worksheetKind || undefined,
    instruction_de: deInstr || undefined,
    instruction_en: enInstr || undefined,
    instruction: mergedInstr
  });

  // AI pre-extraction stores JSON in block.content — regex pair extractors must not run on that.
  if (mappedType === 'matching') {
    const fromAi = pairsFromAiMatchingQuestions(result.questions);
    if (fromAi.length) {
      return [sanitizeQuestion({
        ...exerciseBase(),
        pairs: fromAi
      })];
    }
  }

  // One consolidated question from raw block when rules find pairs (avoids duplicate AI rows; no extra AI for SP content).
  if (mappedType === 'singular_plural' && raw.length >= 5 && !rawLooksLikeJsonObject(raw)) {
    console.log('[SP RAW BLOCK]', raw.slice(0, 200));
    const det = extractSingularPluralPairs(raw);
    console.log('[SP PARSED PAIRS]', det.length);
    if (det.length > 0) {
      console.log('[SINGULAR_PLURAL DETECTED]', det.length);
      return [sanitizeQuestion({
        ...exerciseBase(),
        pairs: det,
        scoringMode: 'full',
        aiGradingEnabled: false
      })];
    }
  }

  if (mappedType === 'matching' && raw.length >= 5 && !rawLooksLikeJsonObject(raw)) {
    console.log('[BLOCK]', raw);
    const det = extractMatchingPairs(raw);
    console.log('[MATCH PAIRS]', det);
    if (det.length > 0) {
      return [sanitizeQuestion({
        ...exerciseBase(),
        pairs: det
      })];
    }
  }

  return (result.questions || []).map((q, qi) => {
    const base = exerciseBase();
    const rowExample = String(q.example || '').trim() || (qi === 0 ? blockExample : '');

    if (mappedType === 'jumble-word') {
      const norm = normalizeAiJumbleItem(q);
      let scramble = norm.scramble;
      let cw = norm.cw;
      let boldLetter = norm.hintLetter;
      if (boldLetter.length > 1) {
        const m = boldLetter.match(/[\p{L}]/u);
        boldLetter = m ? m[0] : boldLetter.slice(0, 1);
      }
      // Derive boldLetter: first letter of expectedWord that appears in scramble (if not set).
      const scrambleLetters = scramble.replace(/\s/g, '').toUpperCase();
      const cwUpper = cw.toUpperCase();
      if (!boldLetter && cwUpper) {
        for (const ch of cwUpper) {
          if (scrambleLetters.includes(ch)) {
            boldLetter = ch;
            break;
          }
        }
      }
      // Only show a category tip if it was explicitly provided (PDF field `category_tip`
      // or an existing `categoryTip`). Do not auto-fill from inferred worksheet category,
      // otherwise the player shows a "tip" even when the teacher left it blank.
      const categoryTip = String(
        q.category_tip != null ? q.category_tip
          : (q.categoryTip != null ? q.categoryTip : '')
      ).trim();
      return sanitizeQuestion({
        ...base,
        type: 'jumble-word',
        scrambledText: scramble,
        expectedWord: cw,
        boldLetter,
        categoryTip
      });
    }
    if (result.type === 'translation') {
      const src = String(q.source || '').trim();
      const tgt = String(q.target || '').trim();
      const line = [src, tgt].filter(Boolean).join(' → ');
      return sanitizeQuestion({
        ...base,
        prompt: line || String(q.question || '').trim(),
        sampleAnswers: tgt ? [tgt] : [],
        similarityThreshold: 70,
        scoringMode: 'proportional',
        aiGradingEnabled: true
      });
    }
    if (result.type === 'qa') {
      const pr = String(q.question || '').trim();
      const ans = q.answer == null ? '' : String(q.answer).trim();
      return sanitizeQuestion({
        ...base,
        prompt: pr,
        sampleAnswers: ans ? [ans] : [],
        similarityThreshold: 70,
        scoringMode: 'proportional',
        aiGradingEnabled: true
      });
    }

    if (mappedType === 'mcq') {
      const options = Array.isArray(q.options) && q.options.length
        ? q.options.map(String).filter(Boolean)
        : [];
      const cai = parseInt(q.correctAnswerIndex);
      return sanitizeQuestion({ ...base, question: String(q.question || ''), options, correctAnswerIndex: isNaN(cai) ? 0 : cai, explanation: '', example: rowExample });
    }
    if (mappedType === 'matching') {
      const directL = String(q.left != null ? q.left : '').trim();
      const directR = String(q.right != null ? q.right : '').trim();
      if (directL || directR) {
        return sanitizeQuestion({
          ...base,
          pairs: [{ left: directL, right: directR }]
        });
      }
      const subRaw = String(q.question || '').trim();
      const subDet = subRaw.length >= 3 ? extractMatchingPairs(subRaw) : [];
      const pairs = subDet.length > 0
        ? subDet
        : (Array.isArray(q.pairs) ? q.pairs : []).map((p) => ({
            left: String(p?.left != null ? p.left : '').trim(),
            right: String(p?.right != null ? p.right : '').trim()
          })).filter((p) => p.left || p.right);
      return sanitizeQuestion({
        ...base,
        pairs
      });
    }
    if (mappedType === 'singular_plural') {
      const pairs = pairsFromSingularPluralQuestion(q, raw);
      return sanitizeQuestion({
        ...base,
        pairs,
        scoringMode: 'full',
        aiGradingEnabled: false
      });
    }
    if (mappedType === 'fill-blank') {
      const rawSentence = String(q.question || q.sentence || '').trim();
      let rawAnswers = Array.isArray(q.answers) ? q.answers.map(String) : [];
      if (!rawAnswers.length && q.correct_answer != null && String(q.correct_answer).trim()) {
        rawAnswers = [String(q.correct_answer).trim()];
      }
      if (!rawAnswers.length && q.answer != null && String(q.answer).trim()) {
        rawAnswers = [String(q.answer).trim()];
      }
      const norm = normalizeFillBlankExtract(rawSentence, rawAnswers, mergedInstr || '');
      console.log('[FILL ANSWERS]', norm.answers);
      return sanitizeQuestion({
        ...base,
        sentence: norm.sentence,
        answers: norm.answers,
        example: rowExample,
        hint: String(q.hint || ''),
        caseSensitive: false
      });
    }
    if (mappedType === 'pronunciation') {
      return sanitizeQuestion({
        ...base,
        word: String(q.word || q.question || '').trim(),
        phonetic: String(q.phonetic || '').trim(),
        translation: String(q.translation || '').trim(),
        acceptedVariants: Array.isArray(q.acceptedVariants) ? q.acceptedVariants.map(String) : []
      });
    }
    const rawAnswers = Array.isArray(q.answers) && q.answers.length
      ? q.answers
      : (q.correctedText ? [q.correctedText] : []);
    const threshold = result.type === 'true_false' ? 75 : result.type === 'open_writing' ? 60 : 70;
    const scoringMode = (result.type === 'open_writing' || result.type === 'short_answer') ? 'proportional' : 'full';
    return sanitizeQuestion({ ...base, prompt: String(q.question || ''), sampleAnswers: rawAnswers.map(String).filter(Boolean), similarityThreshold: threshold, scoringMode, aiGradingEnabled: true, example: rowExample });
  }).filter(Boolean);
}

// ─── ROUTE: POST /api/pdf-exercises/extract-single-exercise ──────────────────
// Re-extract one exercise block precisely using the per-exercise prompt.
// Body: { topic, exerciseId, level, instruction_de, instruction_en, content, solution_key }

router.post('/extract-single-exercise',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const { topic, exerciseId, level, instruction_de, instruction_en, content, solution_key } = req.body || {};

    if (!content || typeof content !== 'string' || content.trim().length < 5) {
      return res.status(400).json({ error: 'content is required' });
    }
    if (!openai) {
      return res.status(503).json({ error: 'AI service is not configured. Please set EXERCISES_OPENAI_API_KEY.' });
    }

    try {
      const prepared = applyBracketMarkersToExercise({
        instruction_de: instruction_de || '',
        instruction_en: instruction_en || '',
        content: content.trim()
      });

      const prompt = buildSingleExerciseExtractionPrompt({
        topic: topic || '',
        exerciseId: exerciseId || '',
        level: level || 'easy',
        instruction_de: prepared.instruction_de || '',
        instruction_en: prepared.instruction_en || '',
        content: prepared.content || content.trim(),
        solution_key: solution_key || ''
      });

      const result = await extractWithRetry(prompt, {
        systemContent: 'You are a deterministic worksheet extraction engine. Return ONLY valid JSON. No markdown. No explanation. Never invent content.',
        max_tokens: 2000,
        temperature: 0.0,
        logLabel: `single:${exerciseId || 'unknown'}`
      });
      if (!result) {
        return res.status(500).json({ error: 'AI returned invalid JSON. Please try again.' });
      }

      const questions = flattenSingleExercise(result, prepared.content || content.trim(), {
        instruction_de: prepared.instruction_de || '',
        instruction_en: prepared.instruction_en || '',
        example: prepared.example || ''
      });
      res.json({ success: true, exerciseId: result.exerciseId, type: result.type, questions });

    } catch (err) {
      console.error('Single-exercise extraction error:', err);
      if (err.code === 'insufficient_quota') return res.status(503).json({ error: 'AI quota exceeded.' });
      res.status(500).json({ error: err.message || 'Extraction failed' });
    }
  }
);

// ─── ROUTE: POST /api/pdf-exercises/extract-exercises-sequential ─────────────
// Two-pass pipeline for uploaded worksheets:
//   1. Split PDF text into Übung blocks using splitWorksheetIntoExercises()
//   2. Call OpenAI once per block using the per-exercise prompt
//   3. Merge results into flat questions[]
// Body: { uploadId, targetLanguage, nativeLanguage, level, selectedExerciseIds? }

router.post('/extract-exercises-sequential',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const { uploadId, targetLanguage, nativeLanguage, level, selectedExerciseIds } = req.body || {};

    if (!uploadId) return res.status(400).json({ error: 'uploadId is required' });
    if (!openai) return res.status(503).json({ error: 'AI service is not configured.' });

    const filePath = path.join(__dirname, '..', 'uploads', 'pdf-exercises', uploadId);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'PDF file not found. Please upload again.' });

    try {
      const pdfData = await extractPdfText(filePath);
      if (!pdfData.text || pdfData.text.trim().length < 20) {
        return res.status(422).json({ error: 'Could not extract readable text from this PDF.' });
      }

      const contentLanguage = detectContentLanguage(pdfData.text, targetLanguage || 'German');
      const result = await runSequentialWorksheetExtraction(pdfData.text, {
        level: level || 'A1',
        targetLanguage: targetLanguage || 'German',
        nativeLanguage: nativeLanguage || 'English',
        sourceLabel: uploadId,
        selectedExerciseIds,
        contentLanguage
      });
      const allQuestions = result.allQuestions || [];
      const extractionLog = result.extractionLog || [];
      const failedExercises = result.failedExercises || extractionLog.filter(x => x.ok === false).map(x => String(x.exerciseId || 'unknown'));
      const total = Number(result.total || (allQuestions.length + failedExercises.length));
      const successCount = Math.max(0, total - failedExercises.length);

      res.json({
        success: true,
        suggestedTitle: '',
        suggestedDescription: '',
        detectedLevel: level || 'A1',
        contentLanguage,
        contentType: 'questions_found',
        worksheetMode: true,
        extracted: allQuestions,
        failedExercises,
        total,
        successCount,
        failedCount: failedExercises.length,
        questions: allQuestions,
        extractionLog,
        pdfInfo: { pages: pdfData.pages, uploadId }
      });

    } catch (err) {
      console.error('Sequential extraction error:', err);
      if (err.statusCode === 400) {
        return res.status(400).json({ success: false, error: 'Failed to detect exercises from PDF structure.' });
      }
      if (err.code === 'insufficient_quota') return res.status(503).json({ error: 'AI quota exceeded.' });
      res.status(500).json({ error: err.message || 'Sequential extraction failed' });
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
  const deIns = q.instruction_de != null ? String(q.instruction_de).trim() : '';
  const enIns = q.instruction_en != null ? String(q.instruction_en).trim() : '';
  if (deIns) base.instruction_de = deIns;
  if (enIns) base.instruction_en = enIns;
  const mergedIns = q.instruction != null ? String(q.instruction).trim() : '';
  if (mergedIns) base.instruction = mergedIns;

  if (q.type === 'mcq') {
    const options = Array.isArray(q.options) ? q.options.map(String).filter(Boolean) : [];
    const cai = parseInt(q.correctAnswerIndex);
    const maxIdx = Math.max(0, options.length - 1);
    const rawOptionImages = Array.isArray(q.optionImageUrls) ? q.optionImageUrls.map((u) => String(u || '').trim()) : [];
    const optionImageUrls = options.slice(0, 6).map((_, i) => rawOptionImages[i] || '');
    const out = {
      ...base,
      question: String(q.question || ''),
      imageUrl: q.imageUrl || null,
      options: options.slice(0, 6),
      optionImageUrls,
      correctAnswerIndex: options.length === 0 || isNaN(cai) || cai < 0 ? 0 : Math.min(cai, maxIdx),
      explanation: String(q.explanation || '')
    };
    const ex = String(q.example || '').trim();
    if (ex) out.example = ex;
    return out;
  }

  if (q.type === 'matching') {
    const pairs = Array.isArray(q.pairs)
      ? q.pairs
          .map((p) => ({
            left: String(p?.left != null ? p.left : '').trim(),
            right: String(p?.right != null ? p.right : '').trim()
          }))
          .filter((p) => p.left || p.right)
      : [];
    const out = {
      ...base,
      pairs
    };
    const ins = String(q.instruction || '').trim();
    if (ins) out.instruction = ins;
    return out;
  }

  if (q.type === 'singular_plural') {
    let pairs = Array.isArray(q.pairs)
      ? q.pairs.map((p) => {
          if (!p || typeof p !== 'object') return null;
          const s = String(p.singular != null ? p.singular : p.left != null ? p.left : '').trim();
          const pl = String(p.plural != null ? p.plural : p.right != null ? p.right : '').trim();
          if (s && pl) return { singular: s, plural: pl };
          return null;
        }).filter(Boolean)
      : [];
    if (!pairs.length && q.prompt && Array.isArray(q.sampleAnswers) && q.sampleAnswers.length) {
      const s = String(q.prompt || '').trim();
      const pl = String(q.sampleAnswers[0] || '').trim();
      if (s && pl) pairs = [{ singular: s, plural: pl }];
    }
    const scoringMode = ['full', 'proportional'].includes(q.scoringMode) ? q.scoringMode : 'full';
    const out = {
      ...base,
      pairs,
      scoringMode,
      aiGradingEnabled: q.aiGradingEnabled === true
    };
    const ins = String(q.instruction || '').trim();
    if (ins) out.instruction = ins;
    return out;
  }

  if (q.type === 'fill-blank') {
    const rawSentence = String(q.sentence || '');
    const rawAnswers = Array.isArray(q.answers) ? q.answers.map(String) : [];
    const hint = mergeWorksheetInstructions(
      q.instruction_de != null ? String(q.instruction_de) : '',
      q.instruction_en != null ? String(q.instruction_en) : '',
    );
    const norm = normalizeFillBlankExtract(rawSentence, rawAnswers, hint || String(q.instruction || '').trim());
    const sentence = norm.sentence;
    const blanks = (sentence.match(/_+/g) || []).length;
    let answers = norm.answers.map(String);
    while (answers.length < blanks) answers.push('');
    if (answers.length > blanks) answers = answers.slice(0, blanks);
    const out = {
      ...base,
      sentence,
      answers,
      hint: String(q.hint || ''),
      caseSensitive: false
    };
    const ins = String(q.instruction || '').trim();
    if (ins) out.instruction = ins;
    const ex = String(q.example || '').trim();
    if (ex) out.example = ex;
    return out;
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
    const out = {
      ...base,
      prompt: String(q.prompt || ''),
      sampleAnswers: Array.isArray(q.sampleAnswers) ? q.sampleAnswers.map(String).filter(Boolean) : [],
      similarityThreshold: (isNaN(threshold) || threshold < 0 || threshold > 100) ? 65 : threshold,
      scoringMode,
      aiGradingEnabled: q.aiGradingEnabled !== false
    };
    const ex = String(q.example || '').trim();
    if (ex) out.example = ex;
    return out;
  }

  if (q.type === 'jumble-word') {
    let scrambledText = String(q.scrambledText || '').trim();
    const expectedWord = String(q.expectedWord || '').trim();
    let boldLetter = String(q.boldLetter || '').trim();
    // Single display grapheme (Latin letters / umlauts): take first meaningful char
    const m = boldLetter.match(/[\p{L}]/u);
    boldLetter = m ? m[0] : boldLetter.slice(0, 1);
    const categoryTip = String(q.categoryTip || '').trim();
    const out = {
      ...base,
      scrambledText,
      expectedWord,
      boldLetter,
      categoryTip
    };
    const ins = String(q.instruction || '').trim();
    if (ins) out.instruction = ins;
    const ex = String(q.example || '').trim();
    if (ex) out.example = ex;
    const hi = String(q.hint || '').trim();
    if (hi) out.hint = hi;
    return out;
  }

  return base;
}

module.exports = router;
