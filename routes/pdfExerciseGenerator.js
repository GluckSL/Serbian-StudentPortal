// routes/pdfExerciseGenerator.js
// PDF → AI Exercise Generator

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const { verifyToken, checkRole } = require('../middleware/auth');
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
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB
});

// ─── OpenAI init ──────────────────────────────────────────────────────────────

let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ─── PDF text extraction ──────────────────────────────────────────────────────

async function extractPdfText(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(buffer);
    const loadingTask = getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true
    });
    const pdf = await loadingTask.promise;
    const pageChunks = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const line = (content.items || [])
        .map(item => (item && typeof item.str === 'string') ? item.str : '')
        .filter(Boolean)
        .join(' ');
      pageChunks.push(line.trim());
    }

    const fullText = pageChunks.filter(Boolean).join('\n\n');
    return {
      text: fullText,
      pages: pdf.numPages
    };
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

4. INSTRUCTION EXTRACTION
   Each exercise MUST include:
   - instruction_de (German, copied verbatim from source)
   - instruction_en (English, copied verbatim if present in source; otherwise "")

5. ANSWER MAPPING (VERY IMPORTANT)
   If a LÖSUNGSSCHLÜSSEL / Answer Key section exists:
   - Map answers EXACTLY as written
   - DO NOT GUESS
   Rules:
   - mcq            → correctAnswerIndex must match the correct option (0-based)
   - matching       → return correct pairs as { "left": "...", "right": "..." }
   - fill_in_blank  → answers array must have exactly one entry per blank
   - error_correction → correctedText is the corrected sentence from the key
   - open_writing / transformation / short_answer → put accepted answers in answers[]

6. LANGUAGE RULE
   Keep ALL questions in original language (${contentLanguage}).
   Do NOT translate.

7. SKIP IF UNCLEAR
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
          "type": "mcq | matching | fill_in_blank | error_correction | open_writing | transformation | true_false | short_answer",
          "instruction_de": "German instruction verbatim",
          "instruction_en": "English instruction verbatim or empty string",
          "questions": [
            {
              "question": "question text verbatim from source",
              "options": [],
              "correctAnswerIndex": null,
              "answers": [],
              "pairs": [],
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
  mcq:              'mcq',
  matching:         'matching'
};

const EXTRACTION_WORKSHEET_KIND = {
  error_correction: 'error-correction',
  open_writing:     'free-writing-own-sentences',
  transformation:   'sentence-transformation',
  true_false:       'true-false'
};

function flattenExtractionResult(parsed) {
  const flatQuestions = [];

  for (const topic of (parsed.topics || [])) {
    for (const exercise of (topic.exercises || [])) {
      const mappedType = EXTRACTION_TYPE_MAP[exercise.type] || 'question-answer';
      const worksheetKind = EXTRACTION_WORKSHEET_KIND[exercise.type] || null;
      const sectionTitle = [topic.title, exercise.exerciseId].filter(Boolean).join(' | ');

      for (const q of (exercise.questions || [])) {
        const base = {
          type: mappedType,
          points: 1,
          sectionTitle: sectionTitle || null,
          instruction: exercise.instruction_de || null
        };
        if (worksheetKind) base.worksheetKind = worksheetKind;

        if (mappedType === 'mcq') {
          const options = Array.isArray(q.options) && q.options.length
            ? q.options.map(String)
            : ['Option A', 'Option B', 'Option C', 'Option D'];
          const cai = parseInt(q.correctAnswerIndex);
          flatQuestions.push(sanitizeQuestion({
            ...base,
            question: String(q.question || ''),
            options,
            correctAnswerIndex: isNaN(cai) ? 0 : cai,
            explanation: ''
          }));
        } else if (mappedType === 'matching') {
          const pairs = Array.isArray(q.pairs)
            ? q.pairs.filter(p => p.left && p.right)
            : [];
          flatQuestions.push(sanitizeQuestion({
            ...base,
            instruction: exercise.instruction_de || 'Match the items.',
            pairs
          }));
        } else if (mappedType === 'fill-blank') {
          const sentence = String(q.question || '');
          const blanks = (sentence.match(/_+/g) || []).length;
          const answers = Array.isArray(q.answers) ? q.answers.map(String) : [];
          while (answers.length < blanks) answers.push('');
          flatQuestions.push(sanitizeQuestion({
            ...base,
            sentence,
            answers: answers.slice(0, blanks),
            hint: '',
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
            aiGradingEnabled: true
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
    contentLanguage = targetLanguage,
    jobId = null
  } = options;

  const { exercises: allExercises, solutionBlock } = splitWorksheetIntoExercises(sourceText);
  const selection = Array.isArray(selectedExerciseIds) && selectedExerciseIds.length
    ? new Set(selectedExerciseIds.map(id => String(id)))
    : null;
  let exercises = selection
    ? allExercises.filter(ex => selection.has(String(ex.exerciseId || '')))
    : allExercises;

  if (!exercises || exercises.length === 0) {
    const aiDetected = await detectExercisesWithAI(sourceText);
    const rebuilt = buildExercisesFromAiDetection(sourceText, aiDetected);
    if (selection) {
      exercises = rebuilt.filter(ex => selection.has(String(ex.exerciseId || '')));
    } else {
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

    if (!block.content || block.content.length < 20) {
      console.warn(`⚠️ Skipped exercise ${block.exerciseId}: content too short`);
      failedExercises.push(block.exerciseId || 'unknown');
      extractionLog.push({ exerciseId: block.exerciseId || 'unknown', ok: false, error: 'Content too short for extraction' });
      continue;
    }

    const prompt = buildSingleExerciseExtractionPrompt({
      topic: block.topic || '',
      exerciseId: block.exerciseId || '',
      level: block.difficulty || level || 'easy',
      instruction_de: block.instruction_de || '',
      instruction_en: block.instruction_en || '',
      content: block.content || '',
      solution_key: block.solution_key || solutionBlock
    });

    const result = await extractWithRetry(prompt, {
      systemContent: 'You are a deterministic worksheet extraction engine. Return ONLY valid JSON. No markdown. No explanation. Never invent content.',
      max_tokens: 2000,
      temperature: 0.0,
      logLabel: `${sourceLabel}:${block.exerciseId || 'unknown'}`
    });

    if (!result) {
      failedExercises.push(block.exerciseId || 'unknown');
      extractionLog.push({ exerciseId: block.exerciseId || 'unknown', ok: false, error: 'Invalid JSON after retry' });
      continue;
    }

    try {
      const questions = flattenSingleExercise(result);
      allQuestions.push(...questions);
      // #region agent log
      try { fs2.appendFileSync('debug-fbfbea.log', JSON.stringify({sessionId:'fbfbea',location:'pdfExerciseGenerator.js:flattenSingleExercise',message:'questions from one exercise',data:{exerciseId:block.exerciseId,aiReturnedType:result.type,aiQuestionsCount:(result.questions||[]).length,flattenedCount:questions.length},timestamp:Date.now(),hypothesisId:'B_D'})+'\n'); } catch(e){}
      // #endregion
      extractionLog.push({ exerciseId: block.exerciseId || 'unknown', type: result.type, count: questions.length, ok: true });
    } catch (err) {
      console.warn(`⚠️ Skipped exercise ${block.exerciseId}:`, err.message);
      failedExercises.push(block.exerciseId || 'unknown');
      extractionLog.push({ exerciseId: block.exerciseId || 'unknown', ok: false, error: err.message });
    }
  }

  return { allQuestions, extractionLog, failedExercises, total: exercises.length };
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
      const exercises = (split.exercises || []).map(ex => {
        const detected = detectExerciseTypeAndQuestionCount(ex.content, ex.instruction_de);
        return {
          exerciseId: ex.exerciseId || '',
          topic: ex.topic || '',
          difficulty: ex.difficulty || 'easy',
          instruction_de: ex.instruction_de || '',
          instruction_en: ex.instruction_en || '',
          type: detected.type,
          questionCount: detected.questionCount
        };
      });

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
      selectedExerciseIds
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
    solution_key = ''
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
   - error_correction → sentences must be corrected
   - open_writing   → user writes their own sentences
   - transformation → sentence transformation required
   - true_false     → explicitly stated Richtig/Falsch or True/False
   - short_answer   → direct answer expected
   If unsure → leave type as empty string.

3. INSTRUCTION MAPPING
   - instruction_de = EXACT German instruction from INSTRUCTION_DE above
   - instruction_en = EXACT English instruction (if present)
   - DO NOT merge or rewrite

4. QUESTION EXTRACTION — EXACTLY 1 QUESTION PER EXERCISE (MANDATORY)
   CRITICAL: The questions array MUST contain EXACTLY 1 item. Never return more than 1 question object.
   Combine ALL numbered items from the exercise into that single question as follows:

   - matching        → 1 question; ALL pairs go in the pairs array (never split into separate questions)
   - open_writing    → 1 question
   - fill_in_blank   → 1 question; join ALL numbered sentences into ONE question field,
                       keeping the numbering (e.g. "1. Ich habe ___ und Fieber. 2. Er will ___, aber er ist krank.");
                       answers array must have EXACTLY one entry per blank (_), left-to-right top-to-bottom across ALL sentences
   - mcq with inline word choices (e.g. "und / aber", "oder / und") → treat as fill_in_blank;
                       replace each (option1 / option2) group with ___; combine all sentences into 1 question;
                       answers array has the correct word for each blank in order
   - transformation  → 1 question; question field lists ALL sentences to transform (keep numbering);
                       answers array has the correct transformation for each item in order
   - error_correction→ 1 question; question field lists ALL incorrect sentences (keep numbering);
                       answers array has the corrected version for each sentence in order
   - true_false      → 1 question; question field lists ALL statements (keep numbering);
                       answers array has "richtig" or "falsch" for each statement in order
   - short_answer    → 1 question; question field lists ALL sub-questions (keep numbering);
                       answers array has all answers in order

5. ANSWER MAPPING (CRITICAL)
   If SOLUTION_KEY exists, extract answers EXACTLY from it — DO NOT guess.

   Per type:
   - fill_in_blank / mcq-as-fill_in_blank:
       answers.length MUST equal the total number of ___ blanks across ALL combined sentences
   - matching:        pairs[] with { left, right } from solution (all pairs in the one question)
   - error_correction: answers[] has the corrected sentence for EACH numbered item, in order
   - transformation:  answers[] has the correct transformation for EACH numbered item, in order
   - true_false:      answers[] has "richtig" or "falsch" for EACH statement, in order
   - short_answer:    answers[] has the answer for EACH sub-question, in order

   If no solution → leave answer fields empty / null.

6. NO HALLUCINATION — if any part is unclear, leave fields empty. DO NOT guess.

---

SELF-VALIDATION (MANDATORY BEFORE OUTPUT):
✓ questions array has EXACTLY 1 item — if you have more, merge them into 1 now
✓ No invented content
✓ No missing instructions
✓ answers.length matches total blank count across all combined sentences (fill_in_blank)
✓ pairs have both left and right (matching)
✓ JSON is valid

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
      "options": [],
      "correctAnswerIndex": null,
      "answers": [],
      "pairs": [],
      "correctedText": ""
    }
  ]
}

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
  t = t.replace(/Übung(?=\d)/gi, 'Übung ');
  // Join broken lines where newline is followed by lowercase text
  t = t.replace(/\n(?=[a-zäöüß])/g, ' ');
  // Normalize spacing
  t = t.replace(/[ \t]{2,}/g, ' ');
  return t;
}

function splitWorksheetIntoExercises(text) {
  const normalized = normalizePdfText(text);

  const regex = /(Übung|Ubung)\s*\d+(?:\.\d+)?/gi;
  const matches = [...normalized.matchAll(regex)];

  console.log('Detected exercises:', matches.map(m => m[0]));
  // #region agent log
  const _fs = require('fs'); try { _fs.appendFileSync('debug-fbfbea.log', JSON.stringify({sessionId:'fbfbea',location:'pdfExerciseGenerator.js:splitWorksheetIntoExercises',message:'all regex matches before dedup',data:{matchCount:matches.length,matches:matches.map(m=>({text:m[0],index:m.index}))},timestamp:Date.now(),hypothesisId:'A'})+'\n'); } catch(e){}
  // #endregion

  if (!matches.length) {
    return { exercises: [], solutionBlock: '' };
  }

  const exercises = [];
  const seenExerciseIds = new Set();
  // The first duplicate Übung ID marks the start of the answer key / solution section.
  // Capture that position so the full solution block can be passed to each exercise.
  let solutionBlockStart = -1;

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = matches[i + 1]?.index || normalized.length;

    const block = normalized.slice(start, end).trim();

    const idMatch = /(Übung|Ubung)\s*(\d+(?:\.\d+)?)/i.exec(block);
    const exerciseId = idMatch ? idMatch[2] : '';

    if (!exerciseId || seenExerciseIds.has(exerciseId)) {
      // First duplicate → start of the answer key section
      if (exerciseId && seenExerciseIds.has(exerciseId) && solutionBlockStart === -1) {
        solutionBlockStart = start;
      }
      continue;
    }
    seenExerciseIds.add(exerciseId);
    exercises.push({
      exerciseId,
      topic: '',
      difficulty: 'easy',
      instruction_de: '',
      instruction_en: '',
      content: block,
      solution_key: ''
    });
  }

  // Also look for an explicit LÖSUNGSSCHLÜSSEL / Answer Key header as a fallback.
  if (solutionBlockStart === -1) {
    const solMatch = /LÖSUNGSSCHLÜSSEL|Lösungsschlüssel|ANSWER\s+KEY|Answer\s+Key/i.exec(normalized);
    if (solMatch) solutionBlockStart = solMatch.index;
  }

  const solutionBlock = solutionBlockStart !== -1
    ? normalized.slice(solutionBlockStart)
    : '';

  // #region agent log
  try { _fs.appendFileSync('debug-fbfbea.log', JSON.stringify({sessionId:'fbfbea',location:'pdfExerciseGenerator.js:splitWorksheetIntoExercises',message:'solutionBlock extracted',data:{solutionBlockStart,solutionBlockLength:solutionBlock.length,solutionBlockPreview:solutionBlock.slice(0,300)},timestamp:Date.now(),hypothesisId:'A_FIX'})+'\n'); } catch(e){}
  // #endregion

  return {
    exercises,
    solutionBlock
  };
}

async function detectExercisesWithAI(text) {
  const sample = String(text || '').slice(0, 18000);
  const prompt = `Detect all exercise sections in this worksheet.

Return JSON array:
[
  {
    "exerciseId": "1.1",
    "startSnippet": "first few words of the exercise"
  }
]

Rules:
* Identify Übung sections even if broken
* Handle OCR text
* Do NOT extract questions
* Only detect structure

Return JSON only.`;

  const parsed = await extractWithRetry(`${prompt}\n\nWORKSHEET TEXT:\n${sample}`, {
    systemContent: 'You detect worksheet structure only. Return valid JSON array only.',
    max_tokens: 1200,
    temperature: 0.0,
    logLabel: 'ai-structure-detector'
  });

  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(item => ({
      exerciseId: String(item?.exerciseId || '').trim(),
      startSnippet: String(item?.startSnippet || '').trim()
    }))
    .filter(item => item.exerciseId && item.startSnippet.length >= 5);
}

function buildExercisesFromAiDetection(text, detections) {
  const source = normalizePdfText(String(text || ''));
  const starts = (detections || [])
    .map(d => ({ ...d, index: source.indexOf(d.startSnippet) }))
    .filter(d => d.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (!starts.length) return [];

  const exercises = [];
  const seenExerciseIds = new Set();
  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i];
    const next = starts[i + 1];
    const end = next ? next.index : source.length;
    const content = source.slice(cur.index, end).trim();
    if (!cur.exerciseId || seenExerciseIds.has(cur.exerciseId)) {
      continue;
    }
    seenExerciseIds.add(cur.exerciseId);
    exercises.push({
      exerciseId: cur.exerciseId,
      topic: '',
      difficulty: 'easy',
      instruction_de: '',
      instruction_en: '',
      content,
      solution_key: ''
    });
  }
  return exercises.filter(ex => ex.content && ex.content.length >= 20);
}

function detectExerciseTypeAndQuestionCount(content, instruction = '') {
  const text = `${instruction}\n${content}`.trim();
  if (!text) return { type: '', questionCount: 0 };
  const numbered = (content.match(/^\s*\d+[.)]\s+/gm) || []).length;
  const blanks = (content.match(/_+/g) || []).length;
  const optionLines = (content.match(/^\s*(?:[a-dA-D][.)]|\([a-dA-D]\))\s+/gm) || []).length;
  const hasTf = /\b(Richtig|Falsch|True|False|Ja[-–]Nein)\b/i.test(text);
  const hasMatching = /\b(match|zuordnen|verbinde|ordne\s+zu|pair\s+up|connect|Zuordnung|Ordnen\s+Sie\s+zu|Verbinden\s+Sie)\b/i.test(text);
  const hasTransform = /\b(W-Frage|Fragewort|Transformation|Umformen|Aussagesatz)\b/i.test(text);
  const hasErrorCorrection = /\b(Fehlerkorrektur|korrigieren|Fehler)\b/i.test(text);
  const hasOwnWriting = /\b(Eigene\s+Sätze|Schreiben\s+Sie|Own\s+Sentences|Steckbrief|Profile)\b/i.test(text);

  if (hasTf) return { type: 'true_false', questionCount: Math.max(numbered, 1) };
  if (hasMatching) return { type: 'matching', questionCount: Math.max(numbered, 1) };
  if (optionLines >= 2) return { type: 'mcq', questionCount: Math.max(1, Math.ceil(optionLines / 4)) };
  if (blanks > 0) return { type: 'fill_in_blank', questionCount: Math.max(numbered, 1) };
  if (hasErrorCorrection) return { type: 'error_correction', questionCount: Math.max(numbered, 1) };
  if (hasTransform) return { type: 'transformation', questionCount: Math.max(numbered, 1) };
  if (hasOwnWriting) return { type: 'open_writing', questionCount: Math.max(numbered, 1) };
  return { type: numbered > 0 ? 'short_answer' : '', questionCount: Math.max(numbered, 0) };
}

// ─── Convert single-exercise extraction result to flat question(s) ────────────
// Same type-mapping logic as flattenExtractionResult, but for one exercise.

function flattenSingleExercise(result) {
  const mappedType = EXTRACTION_TYPE_MAP[result.type] || 'question-answer';
  const worksheetKind = EXTRACTION_WORKSHEET_KIND[result.type] || null;
  const sectionTitle = [result.topic, result.exerciseId].filter(Boolean).join(' | ') || null;

  return (result.questions || []).map(q => {
    const base = {
      type: mappedType,
      points: 1,
      sectionTitle,
      instruction: result.instruction_de || null
    };
    if (worksheetKind) base.worksheetKind = worksheetKind;

    if (mappedType === 'mcq') {
      const options = Array.isArray(q.options) && q.options.length
        ? q.options.map(String)
        : ['Option A', 'Option B'];
      const cai = parseInt(q.correctAnswerIndex);
      return sanitizeQuestion({ ...base, question: String(q.question || ''), options, correctAnswerIndex: isNaN(cai) ? 0 : cai, explanation: '' });
    }
    if (mappedType === 'matching') {
      const pairs = Array.isArray(q.pairs) ? q.pairs.filter(p => p.left && p.right) : [];
      return sanitizeQuestion({ ...base, instruction: result.instruction_de || 'Match the items.', pairs });
    }
    if (mappedType === 'fill-blank') {
      const sentence = String(q.question || '');
      const blanks = (sentence.match(/_+/g) || []).length;
      const answers = Array.isArray(q.answers) ? q.answers.map(String) : [];
      while (answers.length < blanks) answers.push('');
      return sanitizeQuestion({ ...base, sentence, answers: answers.slice(0, blanks), hint: '', caseSensitive: false });
    }
    const rawAnswers = Array.isArray(q.answers) && q.answers.length
      ? q.answers
      : (q.correctedText ? [q.correctedText] : []);
    const threshold = result.type === 'true_false' ? 75 : result.type === 'open_writing' ? 60 : 70;
    const scoringMode = (result.type === 'open_writing' || result.type === 'short_answer') ? 'proportional' : 'full';
    return sanitizeQuestion({ ...base, prompt: String(q.question || ''), sampleAnswers: rawAnswers.map(String).filter(Boolean), similarityThreshold: threshold, scoringMode, aiGradingEnabled: true });
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
      return res.status(503).json({ error: 'AI service is not configured. Please set OPENAI_API_KEY.' });
    }

    try {
      const prompt = buildSingleExerciseExtractionPrompt({
        topic: topic || '',
        exerciseId: exerciseId || '',
        level: level || 'easy',
        instruction_de: instruction_de || '',
        instruction_en: instruction_en || '',
        content: content.trim(),
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

      const questions = flattenSingleExercise(result);
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
    const blanks = (sentence.match(/_+/g) || []).length;
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
