// routes/pronunciationEvaluation.js
//
// New, production-grade audio-based pronunciation evaluator.
//
//   POST /api/pronunciation/evaluate
//     multipart/form-data:
//       - audio:        File  (webm / ogg / mp3 / wav / m4a, ≤ 15 MB)
//       - expected:     string (required)
//       - language:     'German' | 'English' | 'de-DE' | 'en-US' (optional)
//       - variants:     JSON array of accepted alternatives (optional)
//       - threshold:    number 0–100 (optional; default 70)
//       - clientMeta:   JSON blob for debug logs (optional)
//
//     → 200 JSON:
//       {
//         transcript: string,
//         score: number,            // 0–100
//         isCorrect: boolean,
//         confidence: 'low'|'medium'|'high',
//         wordAnalysis: [{ expected, spoken, status: 'correct'|'incorrect'|'missing' }],
//         hints: string[],
//         threshold: number,
//         matchedAgainst: string,
//         normalizedExpected: string,
//         normalizedSpoken: string,
//         durationMs: number,       // server processing time
//         engine: 'openai' | 'fallback',
//         requestId: string
//       }
//
// The frontend uses this in place of the old webkitSpeechRecognition flow.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// OpenAI SDK upload compatibility for Node runtimes <20:
// ensure global File exists before requiring the SDK.
try {
  if (typeof globalThis.File === 'undefined') {
    const { File } = require('node:buffer');
    if (File) {
      globalThis.File = File;
    }
  }
} catch {
  // Best effort: if unavailable, SDK will still emit a clear runtime error.
}

const OpenAI = require('openai');
const { toFile } = require('openai/uploads');

const { verifyToken, checkRole } = require('../middleware/auth');
const {
  scorePronunciation,
  evaluateThresholdAdvanced,
  normalizeText,
  computeConfidence,
  computeLowAudioQualityFlag,
  DEFAULT_THRESHOLD,
  explainPronunciationFromScore,
} = require('../services/pronunciationScoring');
const pronAnalytics = require('../services/pronunciationAnalytics');

// ── Multer: disk storage in OS temp, strict filter + limit ──────────────────

const TEMP_DIR = path.join(os.tmpdir(), 'pronunciation-uploads');
function ensureTempDir() {
  try { fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch { /* ignore */ }
}
ensureTempDir();

const ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'video/webm', // some mobile browsers label MediaRecorder output this way
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TEMP_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').slice(0, 8) || '.webm';
    cb(null, `pron-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB, plenty for <60s clips
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype) || /^audio\//.test(file.mimetype)) {
      return cb(null, true);
    }
    return cb(new Error(`Unsupported audio mime type: ${file.mimetype}`));
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function safeUnlink(p) {
  if (!p) return;
  fs.unlink(p, () => { /* best effort */ });
}

function normalizeAudioForTranscription(inputPath) {
  const outputPath = path.join(
    TEMP_DIR,
    `norm-${Date.now()}-${crypto.randomBytes(5).toString('hex')}.wav`
  );
  const args = [
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '16000',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    outputPath,
  ];
  const run = spawnSync('ffmpeg', args, { stdio: 'pipe' });
  if (run.status === 0 && fs.existsSync(outputPath)) {
    return { path: outputPath, normalized: true, error: null };
  }
  safeUnlink(outputPath);
  return {
    path: inputPath,
    normalized: false,
    error: run?.stderr ? String(run.stderr).slice(0, 500) : 'ffmpeg normalization unavailable',
  };
}

/**
 * @param {string|undefined} input
 * @param {{ freeSpeech?: boolean }} [opts]
 */
function normaliseLanguage(input, opts = {}) {
  const raw = String(input || '').trim();
  if (!raw) {
    // Conversation mode omits `language` so Whisper can detect what the student actually spoke.
    if (opts.freeSpeech) {
      return { full: 'Auto', bcp47: 'auto', whisper: null };
    }
    return { full: 'German', bcp47: 'de-DE', whisper: 'de' };
  }
  const lower = raw.toLowerCase();
  if (lower === 'english' || lower === 'en' || lower === 'en-us') {
    return { full: 'English', bcp47: 'en-US', whisper: 'en' };
  }
  if (lower === 'german' || lower === 'de' || lower === 'de-de') {
    return { full: 'German', bcp47: 'de-DE', whisper: 'de' };
  }
  // Passthrough for future languages.
  return { full: raw, bcp47: raw, whisper: lower.slice(0, 2) };
}

function parseVariants(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === 'string');
  } catch { /* fall through */ }
  return String(raw).split('|').map((s) => s.trim()).filter(Boolean);
}

function parseClientMeta(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { raw: String(raw).slice(0, 500) }; }
}

/**
 * Transcribe audio file on disk. Prefers OpenAI (Whisper / gpt-4o-transcribe);
 * falls back to an empty transcript with engine='fallback' if the key is not
 * configured or the request fails.
 */
async function transcribeAudio(filePath, whisperLang, hintText = '') {
  if (!process.env.DG_OPENAI_API_KEY) {
    return { text: '', engine: 'fallback', error: 'DG_OPENAI_API_KEY not configured' };
  }

  const openai = new OpenAI({ apiKey: process.env.DG_OPENAI_API_KEY });
  const model = process.env.OPENAI_SPEECH_MODEL || 'whisper-1';

  try {
    // Some production Node runtimes do not expose global `File`, which can
    // break stream-based uploads in the OpenAI SDK. Convert to an SDK file
    // object via `toFile` for runtime-safe multipart handling.
    const audioBuffer = await fs.promises.readFile(filePath);
    const filename = path.basename(filePath) || 'recording.webm';
    const sdkFile = await toFile(audioBuffer, filename);

    const prompt = String(hintText || '').trim().slice(0, 280);
    const transcription = await openai.audio.transcriptions.create({
      file: sdkFile,
      model,
      language: whisperLang || undefined,
      prompt: prompt || undefined,
      response_format: 'json',
      temperature: 0.0,
    });
    const text = String(transcription?.text || '').trim();
    return { text, engine: 'openai' };
  } catch (err) {
    return {
      text: '',
      engine: 'fallback',
      error: err?.message || 'OpenAI transcription failed',
    };
  }
}

// ── Route ───────────────────────────────────────────────────────────────────

/**
 * POST /api/pronunciation/evaluate
 *
 * The full wrapper runs multer first so that any multipart error still comes
 * back as JSON (helpful for debug logs on the client).
 */
router.post(
  '/evaluate',
  verifyToken,
  checkRole(['STUDENT', 'ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN']),
  (req, res, next) => {
    upload.single('audio')(req, res, (err) => {
      if (err) {
        console.error('[pronunciation.evaluate] multer error:', err.message);
        return res.status(400).json({
          error: err.message || 'Audio upload failed',
          code: 'AUDIO_UPLOAD_FAILED',
        });
      }
      next();
    });
  },
  async (req, res) => {
    const requestId = crypto.randomBytes(8).toString('hex');
    const startedAt = Date.now();
    const audioPath = req.file?.path;
    const audioSize = req.file?.size || 0;
    let normalizedAudioPath = null;

    try {
      const expected = String(req.body?.expected || '').trim();
      if (!expected) {
        safeUnlink(audioPath);
        return res.status(400).json({
          error: 'Missing expected phrase',
          code: 'EXPECTED_REQUIRED',
          requestId,
        });
      }
      if (!audioPath) {
        return res.status(400).json({
          error: 'No audio file received',
          code: 'AUDIO_REQUIRED',
          requestId,
        });
      }

      const clientMeta = parseClientMeta(req.body?.clientMeta);
      const isFreeSpeech = clientMeta?.freeSpeech === true;
      const language = normaliseLanguage(req.body?.language, { freeSpeech: isFreeSpeech });
      const variants = parseVariants(req.body?.variants);
      const thresholdRaw = Number(req.body?.threshold);
      const threshold = Number.isFinite(thresholdRaw)
        ? Math.max(0, Math.min(100, Math.round(thresholdRaw)))
        : DEFAULT_THRESHOLD;
      const attemptCountRaw = Number(req.body?.attemptCount ?? clientMeta?.attemptCount ?? 0);
      const attemptCount = Number.isFinite(attemptCountRaw) ? Math.max(0, Math.floor(attemptCountRaw)) : 0;
      const normalization = normalizeAudioForTranscription(audioPath);
      normalizedAudioPath = normalization.normalized ? normalization.path : null;

      // IMPORTANT: Do NOT pass the expected sentence as a Whisper prompt — it
      // causes Whisper to autocomplete partial speech into the full target phrase,
      // making any partial attempt appear as 100% correct.
      // For free-speech / conversation mode we enrich the hint with context about
      // numbers, prices, times, and spellings so Whisper handles those better.
      // Free speech: do not pin Whisper to German — that made English answers transcribe as German
      // and bypassed the "reply in German" hint flow in DG conversation.
      const genericHint = isFreeSpeech
        ? 'Language tutoring dialogue. The learner may answer in English or German. Names, numbers, prices, times, spelled letters, short phrases.'
        : (language.full === 'German'
            ? 'Deutsch. Sprachübung.'
            : 'English. Language practice.');
      const transcribeRes = await transcribeAudio(
        normalization.path,
        language.whisper == null ? undefined : language.whisper,
        genericHint,
      );
      const transcript = transcribeRes.text || '';
      const engine = transcribeRes.engine;

      // Free-speech conversation mode: skip lexical scoring against the
      // placeholder 'free speech' string — it produces meaningless 0% scores.
      // Return the raw transcript with a neutral outcome instead.
      if (isFreeSpeech) {
        const durationMs = Date.now() - startedAt;
        const cm = clientMeta || {};
        const lowAudioQuality = computeLowAudioQualityFlag({
          clientMeta: cm,
          audioSize,
          score: transcript ? 100 : 0,
          wordCoverage: transcript ? 1 : 0,
        });
        pronAnalytics.record({
          requestId,
          userId: String(req.user?.id || req.user?._id || '').slice(-8),
          engine,
          language: language.bcp47,
          score: 100,
          threshold: DEFAULT_THRESHOLD,
          isCorrect: true,
          isAlmostCorrect: false,
          confidence: 'high',
          silenceRejected: !!cm.silenceRejected,
          silenceReason: cm.silenceReason || null,
          networkError: false,
          assistedMode: false,
          retryCount: Number(cm.retryCount) || 0,
          deviceType: cm.deviceType === 'mobile' ? 'mobile' : 'desktop',
          browser: String(cm.browser || ''),
          durationMs,
          lowAudioQuality,
        });
        return res.json({
          requestId,
          engine,
          transcript,
          score: 100,
          isCorrect: true,
          isAlmostCorrect: false,
          confidence: 'high',
          threshold: DEFAULT_THRESHOLD,
          assistedMode: false,
          matchedAgainst: 'free_speech',
          normalizedExpected: '',
          normalizedSpoken: transcript,
          expectedText: '',
          spokenText: transcript,
          wordAnalysis: [],
          hints: [],
          feedback: { missingWords: [], extraWords: [], matchedWords: [], suggestion: '' },
          flags: { lowAudioQuality, freeSpeech: true },
          durationMs,
          transcriptionError: transcribeRes.error || null,
        });
      }

      const scoreRes = scorePronunciation(expected, transcript, {
        variants,
        lang: language.bcp47,
        attemptCount,
      });

      const lowAudioQuality = computeLowAudioQualityFlag({
        clientMeta: clientMeta || {},
        audioSize,
        score: scoreRes.score,
        wordCoverage: scoreRes.wordCoverage,
      });

      const durationMs = Date.now() - startedAt;
      const confidence = computeConfidence(scoreRes.score, {
        lowAudioQuality,
        wordCoverage: scoreRes.wordCoverage,
      });

      // Advanced 3-state evaluation (replaces simple binary evaluateThreshold).
      const { isCorrect, isAlmostCorrect, threshold: appliedThreshold } = evaluateThresholdAdvanced(
        scoreRes.score,
        threshold,
        {
          confidence,
          normalizedExpected: scoreRes.normalizedExpected,
          normalizedSpoken: scoreRes.normalizedSpoken,
          wordCoverage: scoreRes.wordCoverage,
        },
      );

      const { wordAnalysis, hints } = explainPronunciationFromScore(
        scoreRes,
        transcript,
        language.bcp47,
      );

      // Client-reported analytics travel in clientMeta; read them defensively.
      const cm = clientMeta || {};
      const analyticsEvt = {
        requestId,
        userId: String(req.user?.id || req.user?._id || '').slice(-8),
        engine,
        language: language.bcp47,
        score: scoreRes.score,
        threshold: appliedThreshold,
        isCorrect,
        isAlmostCorrect,
        confidence,
        silenceRejected: !!cm.silenceRejected,
        silenceReason: cm.silenceReason || null,
        networkError: false,
        assistedMode: !!cm.assistedMode,
        retryCount: Number(cm.retryCount) || 0,
        deviceType: cm.deviceType === 'mobile' ? 'mobile' : 'desktop',
        browser: String(cm.browser || ''),
        durationMs,
        lowAudioQuality,
      };
      pronAnalytics.record(analyticsEvt);

      // Structured log for observability — no PII beyond what was spoken.
      console.log('[pronunciation.evaluate]', {
        ...analyticsEvt,
        audioSize,
        transcriptLength: transcript.length,
        audioPeak: cm.audioPeak ?? null,
        audioAverage: cm.audioAverage ?? null,
        recordingDuration: cm.recordingDuration ?? null,
        error: transcribeRes.error,
        normalizedAudio: normalization.normalized,
        normalizationError: normalization.error,
        attemptCount,
      });

      const feedback = {
        missingWords: scoreRes.feedback?.missingWords || [],
        extraWords: scoreRes.feedback?.extraWords || [],
        matchedWords: scoreRes.feedback?.matchedWords || [],
        suggestion: scoreRes.feedback?.suggestion || 'Try saying the phrase a bit more clearly.',
      };
      if (confidence === 'low') {
        feedback.suggestion = `${feedback.suggestion} We might have misheard you.`;
      }

      return res.json({
        requestId,
        engine,
        transcript,
        score: scoreRes.score,
        isCorrect,
        isAlmostCorrect,
        confidence,
        threshold: appliedThreshold,
        assistedMode: !!cm.assistedMode,
        matchedAgainst: scoreRes.matchedAgainst,
        normalizedExpected: scoreRes.normalizedExpected,
        normalizedSpoken: scoreRes.normalizedSpoken,
        // Human-readable comparison text for the learner-facing UI.
        expectedText: scoreRes.matchedAgainst || expected,
        spokenText: transcript,
        wordAnalysis,
        hints,
        feedback,
        flags: {
          lowAudioQuality,
        },
        durationMs,
        transcriptionError: transcribeRes.error || null,
      });
    } catch (err) {
      console.error('[pronunciation.evaluate] fatal error:', err);
      return res.status(500).json({
        error: err?.message || 'Evaluation failed',
        code: 'EVALUATION_FAILED',
        requestId,
      });
    } finally {
      safeUnlink(audioPath);
      safeUnlink(normalizedAudioPath);
    }
  }
);

/**
 * POST /api/pronunciation/text-score
 *
 * Fallback endpoint for clients that cannot upload audio (legacy speech
 * recognition path). The browser passes the transcript it computed locally
 * and we just re-run the scoring server-side.
 */
router.post(
  '/text-score',
  verifyToken,
  checkRole(['STUDENT', 'ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN']),
  express.json(),
  (req, res) => {
    const requestId = crypto.randomBytes(8).toString('hex');
    try {
      const expected = String(req.body?.expected || '').trim();
      const transcript = String(req.body?.transcript || '').trim();
      const language = normaliseLanguage(req.body?.language);
      const variants = Array.isArray(req.body?.variants) ? req.body.variants : [];
      const thresholdRaw = Number(req.body?.threshold);
      const threshold = Number.isFinite(thresholdRaw)
        ? Math.max(0, Math.min(100, Math.round(thresholdRaw)))
        : DEFAULT_THRESHOLD;
      const attemptCountRaw = Number(req.body?.attemptCount ?? req.body?.clientMeta?.attemptCount ?? 0);
      const attemptCount = Number.isFinite(attemptCountRaw) ? Math.max(0, Math.floor(attemptCountRaw)) : 0;

      if (!expected) {
        return res.status(400).json({
          error: 'Missing expected phrase',
          code: 'EXPECTED_REQUIRED',
          requestId,
        });
      }

      const scoreRes = scorePronunciation(expected, transcript, {
        variants,
        lang: language.bcp47,
        attemptCount,
        lowAudioQuality: false,
      });
      const confidence = computeConfidence(scoreRes.score, {
        lowAudioQuality: false,
        wordCoverage: scoreRes.wordCoverage,
      });
      const { isCorrect, isAlmostCorrect, threshold: appliedThreshold } = evaluateThresholdAdvanced(
        scoreRes.score,
        threshold,
        {
          confidence,
          normalizedExpected: scoreRes.normalizedExpected,
          normalizedSpoken: scoreRes.normalizedSpoken,
          wordCoverage: scoreRes.wordCoverage,
        },
      );
      const { wordAnalysis, hints } = explainPronunciationFromScore(
        scoreRes,
        transcript,
        language.bcp47,
      );

      const cm = (() => {
        const raw = req.body?.clientMeta;
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return {}; }
      })();

      pronAnalytics.record({
        requestId,
        userId: String(req.user?.id || req.user?._id || '').slice(-8),
        engine: 'client-transcript',
        language: language.bcp47,
        score: scoreRes.score,
        threshold: appliedThreshold,
        isCorrect,
        confidence,
        silenceRejected: !!cm.silenceRejected,
        silenceReason: cm.silenceReason || null,
        networkError: false,
        assistedMode: !!cm.assistedMode,
        retryCount: Number(cm.retryCount) || 0,
        deviceType: cm.deviceType === 'mobile' ? 'mobile' : 'desktop',
        browser: String(cm.browser || ''),
        lowAudioQuality: false,
      });

      const feedback = {
        missingWords: scoreRes.feedback?.missingWords || [],
        extraWords: scoreRes.feedback?.extraWords || [],
        matchedWords: scoreRes.feedback?.matchedWords || [],
        suggestion: scoreRes.feedback?.suggestion || 'Try saying the phrase a bit more clearly.',
      };
      if (confidence === 'low') {
        feedback.suggestion = `${feedback.suggestion} We might have misheard you.`;
      }

      return res.json({
        requestId,
        engine: 'client-transcript',
        transcript,
        score: scoreRes.score,
        isCorrect,
        isAlmostCorrect,
        confidence,
        threshold: appliedThreshold,
        assistedMode: !!cm.assistedMode,
        matchedAgainst: scoreRes.matchedAgainst,
        normalizedExpected: scoreRes.normalizedExpected,
        normalizedSpoken: scoreRes.normalizedSpoken,
        expectedText: scoreRes.matchedAgainst || expected,
        spokenText: transcript,
        wordAnalysis,
        hints,
        feedback,
        flags: {
          lowAudioQuality: false,
        },
      });
    } catch (err) {
      console.error('[pronunciation.text-score] error:', err);
      return res.status(500).json({
        error: err?.message || 'Scoring failed',
        code: 'SCORING_FAILED',
        requestId,
      });
    }
  }
);

/**
 * POST /api/pronunciation/telemetry
 *
 * Fire-and-forget channel for events that never produce a server request
 * (silence rejects, network errors, assisted-mode starts). Lets us keep
 * insights accurate without spending an LLM call.
 */
router.post(
  '/telemetry',
  verifyToken,
  checkRole(['STUDENT', 'ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN']),
  express.json({ limit: '16kb' }),
  (req, res) => {
    try {
      const body = req.body || {};
      pronAnalytics.record({
        requestId: String(body.requestId || crypto.randomBytes(6).toString('hex')),
        userId: String(req.user?.id || req.user?._id || '').slice(-8),
        engine: String(body.engine || 'client-telemetry'),
        language: String(body.language || ''),
        score: 0,
        threshold: 0,
        isCorrect: false,
        confidence: body.confidence || 'low',
        silenceRejected: !!body.silenceRejected,
        silenceReason: body.silenceReason || null,
        networkError: !!body.networkError,
        assistedMode: !!body.assistedMode,
        retryCount: Number(body.retryCount) || 0,
        deviceType: body.deviceType === 'mobile' ? 'mobile' : 'desktop',
        browser: String(body.browser || ''),
      });
      return res.json({ ok: true });
    } catch (err) {
      console.warn('[pronunciation.telemetry] error:', err?.message);
      return res.status(200).json({ ok: false });
    }
  },
);

/**
 * GET /api/pronunciation/insights
 *
 * Returns rolling-window aggregates — intended for an internal dashboard.
 * Restricted to staff roles; students never see this.
 */
router.get(
  '/insights',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN', 'SUB_ADMIN']),
  (_req, res) => {
    res.json({
      ok: true,
      insights: pronAnalytics.getInsights(),
      generatedAt: new Date().toISOString(),
    });
  },
);

/**
 * GET /api/pronunciation/health
 * Lightweight readiness check for the client "Test Microphone" flow.
 */
router.get('/health', verifyToken, (_req, res) => {
  res.json({
    ok: true,
    openaiConfigured: !!process.env.DG_OPENAI_API_KEY,
    speechModel: process.env.OPENAI_SPEECH_MODEL || 'whisper-1',
    defaultThreshold: DEFAULT_THRESHOLD,
    normalizeSample: normalizeText('Hällo, Welt!'),
  });
});

module.exports = router;
