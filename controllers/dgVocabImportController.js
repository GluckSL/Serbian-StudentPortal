'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { parsePdfBuffer } = require('../services/pdfParseCompat');
const mammoth = require('mammoth');
const OpenAI = require('openai');

const uploadDir = path.join(__dirname, '..', 'uploads', 'dg-vocab-import');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = String(file.originalname || 'upload').replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ok) cb(null, true);
    else cb(new Error('Only PDF or Word (.docx) files are allowed.'));
  },
});

function dgOpenAi() {
  const key = process.env.DG_OPENAI_API_KEY || process.env.EXERCISES_OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    timeout: Math.min(parseInt(process.env.OPENAI_TIMEOUT_MS || '120000', 10) || 120000, 300000),
  });
}

async function readDocumentText(filePath, mimetype) {
  if (mimetype === 'application/pdf') {
    const buffer = fs.readFileSync(filePath);
    const data = await parsePdfBuffer(buffer);
    return String(data.text || '').trim();
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ path: filePath });
    return String(result.value || '').trim();
  }
  return '';
}

function truncateForPrompt(text, maxLen) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  if (t.length <= maxLen) return t;
  const head = t.slice(0, Math.floor(maxLen * 0.65));
  const tail = t.slice(-Math.floor(maxLen * 0.3));
  return `${head}\n\n[... middle omitted ...]\n\n${tail}`;
}

function parseJsonFromModelContent(raw) {
  let s = String(raw || '').trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/im.exec(s);
  if (fence) s = fence[1].trim();
  const parsed = JSON.parse(s);
  return parsed;
}

function normalizeEntries(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const word = String(row.word || row.term || '').trim();
    const translation = String(row.translation || row.meaning || '').trim();
    if (!word || !translation) continue;
    const category = String(row.category || 'general').trim() || 'general';
    const usageRaw = row.usage != null ? String(row.usage).trim() : '';
    out.push({
      word,
      translation,
      category,
      ...(usageRaw ? { usage: usageRaw } : {}),
    });
  }
  return out;
}

/** POST multipart: file + targetLanguage + nativeLanguage */
async function importFromDocument(req, res) {
  const file = req.file;
  if (!file?.path) {
    return res.status(400).json({ message: 'Missing file upload.' });
  }

  const targetLanguage = String(req.body?.targetLanguage || 'German').trim() || 'German';
  const nativeLanguage = String(req.body?.nativeLanguage || 'English').trim() || 'English';

  const openai = dgOpenAi();
  if (!openai) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
    return res.status(503).json({
      message: 'AI import is not configured. Set DG_OPENAI_API_KEY or EXERCISES_OPENAI_API_KEY.',
    });
  }

  let extracted = '';
  try {
    extracted = await readDocumentText(file.path, file.mimetype);
  } catch (e) {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
    return res.status(400).json({ message: e?.message || 'Could not read document.' });
  } finally {
    try {
      fs.unlinkSync(file.path);
    } catch (_) {}
  }

  if (!extracted || extracted.length < 20) {
    return res.status(400).json({
      message: 'Could not extract enough text from this file. Try another PDF/DOCX or copy text manually.',
    });
  }

  const docSnippet = truncateForPrompt(extracted, 14000);

  const system = `You extract vocabulary rows for a language-tutoring product. Output must be valid JSON only.`;
  const user = `Read the following document text. Extract vocabulary suitable for an "AI tutor vocabulary allow-list" (words/phrases the AI may use in conversation).

Target language (L2 — put surface forms in "word"): ${targetLanguage}
Translation language (put glosses in "translation"): ${nativeLanguage}

Rules:
- Only include items clearly present in or clearly implied by lists/glossaries/tables in the text (do not invent unrelated words).
- "word" is the term in ${targetLanguage} (or the learning language if the document uses another L2 consistently).
- "translation" is in ${nativeLanguage}.
- "category" is a short topic label (e.g. restaurant, grammar, greetings) or "general".
- "usage" is optional: one short example sentence in ${targetLanguage} if you can take it from the document; otherwise omit or use "".
- Maximum 35 items. Prefer the most important teaching vocabulary if there are many.
- Return shape: {"vocabulary":[...]} where each item has word, translation, category, and optionally usage.

Document text:
---
${docSnippet}
---`;

  try {
    const completion = await openai.chat.completions.create({
      model: process.env.DG_VOCAB_IMPORT_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
    });
    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(502).json({ message: 'Empty response from AI.' });
    }
    let parsed;
    try {
      parsed = parseJsonFromModelContent(content);
    } catch {
      return res.status(502).json({ message: 'AI returned invalid JSON. Try again or use a simpler word list.' });
    }
    const vocabulary = normalizeEntries(parsed.vocabulary || parsed.items || parsed.words);
    if (!vocabulary.length) {
      return res.status(422).json({ message: 'No vocabulary could be extracted. Try a clearer word list or glossary in the file.' });
    }
    return res.json({ vocabulary });
  } catch (e) {
    console.error('dgVocabImport AI error:', e?.message || e);
    return res.status(502).json({ message: e?.message || 'AI extraction failed.' });
  }
}

module.exports = {
  uploadMiddleware: upload.single('file'),
  importFromDocument,
};
