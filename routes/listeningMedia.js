// routes/listeningMedia.js
// Upload audio for listening/pronunciation questions + AI transcription (Whisper)
//
// Storage strategy:
//   • Audio → Cloudflare R2 only (multipart buffered in memory, never disk/S3)
//   • Video → use POST /api/r2/generate-upload-url from the client (not this route)

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { verifyToken, checkRole } = require('../middleware/auth');
const { isExerciseR2Configured, putExerciseMediaBuffer } = require('../services/exerciseMediaR2');

// ─── Extension helper ─────────────────────────────────────────────────────────
function inferExtension(file) {
  const extFromName = path.extname(file.originalname || '');
  if (extFromName) return extFromName;

  const mt = String(file.mimetype || '').toLowerCase();
  const map = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/x-aac': '.aac',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/flac': '.flac',
  };
  return map[mt] || '.bin';
}

const mediaFilter = (req, file, cb) => {
  const mt = String(file.mimetype || '').toLowerCase();
  if (mt.startsWith('video/')) {
    return cb(new Error('Video uploads must use direct R2 upload via presigned URL.'), false);
  }
  if (mt.startsWith('audio/')) return cb(null, true);
  return cb(new Error(`Only audio/* is allowed on this endpoint. Received: ${mt || 'unknown'}`), false);
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: mediaFilter,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

const uploadSingleMedia = (req, res, next) => {
  upload.single('media')(req, res, (err) => {
    if (err) {
      console.error('Listening media upload error (multer):', err);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
};

router.post(
  '/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  uploadSingleMedia,
  async (req, res) => {
    try {
      if (!req.file?.buffer) return res.status(400).json({ error: 'No media file uploaded' });

      if (!isExerciseR2Configured()) {
        return res.status(503).json({
          error:
            'Audio storage is not configured. Set R2 credentials and R2_PUBLIC_BASE_URL for Cloudflare R2.',
        });
      }

      const ext = inferExtension(req.file);
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      const key = `listening-media/${filename}`;
      const url = await putExerciseMediaBuffer(
        req.file.buffer,
        key,
        req.file.mimetype || 'audio/mpeg'
      );

      res.json({ success: true, url });
    } catch (err) {
      console.error('Listening media upload error:', err);
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }
);

// ─── POST /fetch-from-url ────────────────────────────────────────────────────
router.post(
  '/fetch-from-url',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    if (!isExerciseR2Configured()) {
      return res.status(503).json({
        error:
          'Audio storage is not configured. Set R2 credentials and R2_PUBLIC_BASE_URL for Cloudflare R2.',
      });
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'Invalid URL protocol' });
      }

      const { buffer, contentType } = await new Promise((resolve, reject) => {
        const client = parsed.protocol === 'https:' ? https : http;
        const chunks = [];
        client.get(url, { timeout: 30000 }, (response) => {
          if (response.statusCode !== 200) {
            return reject(new Error(`Failed to fetch: ${response.statusCode}`));
          }
          const ct = String(response.headers?.['content-type'] || '').split(';')[0].trim();
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({ buffer: Buffer.concat(chunks), contentType: ct || 'audio/mpeg' })
          );
          response.on('error', reject);
        }).on('error', reject);
      });

      const ext = path.extname(parsed.pathname) || '.mp3';
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      const key = `listening-media/${filename}`;
      const outUrl = await putExerciseMediaBuffer(buffer, key, contentType || 'audio/mpeg');
      return res.json({ success: true, url: outUrl });
    } catch (err) {
      console.error('Fetch from URL error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch audio from URL' });
    }
  }
);

// ─── Resolve /uploads/… path to absolute file (for transcribe legacy paths only) ─
function resolveUploadsFilePath(mediaUrl) {
  const s = String(mediaUrl || '').trim();
  if (!s.startsWith('/uploads/')) return null;
  const filePath = path.join(__dirname, '..', s.replace(/^\//, ''));
  const uploadsRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
  const resolved = path.resolve(filePath);
  return resolved.startsWith(uploadsRoot) ? resolved : null;
}

// ─── POST /transcribe ─────────────────────────────────────────────────────────
router.post(
  '/transcribe',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const { mediaUrl } = req.body;
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return res.status(400).json({ error: 'mediaUrl is required' });
    }

    if (!process.env.EXERCISES_OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI transcription is not configured' });
    }

    try {
      let audioBuffer;

      const localPath = resolveUploadsFilePath(mediaUrl);
      if (localPath && fs.existsSync(localPath)) {
        audioBuffer = fs.readFileSync(localPath);
      } else if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
        const parsed = new URL(mediaUrl);
        audioBuffer = await new Promise((resolve, reject) => {
          const client = parsed.protocol === 'https:' ? https : http;
          const chunks = [];
          client.get(mediaUrl, { timeout: 60000 }, (response) => {
            if (response.statusCode !== 200) {
              return reject(new Error(`Failed to fetch audio: ${response.statusCode}`));
            }
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
          }).on('error', reject);
        });
      } else {
        return res.status(400).json({
          error: 'mediaUrl must be a public HTTP/HTTPS URL or a legacy /uploads/... path on this server',
        });
      }

      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.EXERCISES_OPENAI_API_KEY });

      const ext = path.extname(mediaUrl.split('?')[0]) || '.mp3';
      const blob = new Blob([audioBuffer]);
      const file = new File([blob], `audio${ext}`);

      const transcription = await openai.audio.transcriptions.create({
        file,
        model: 'whisper-1',
        response_format: 'text',
        temperature: 0.2,
      });

      const text = (typeof transcription === 'string' ? transcription : (transcription?.text ?? '')).trim();
      res.json({ success: true, transcript: text });
    } catch (err) {
      console.error('Transcription error:', err);
      res.status(500).json({ error: err.message || 'Transcription failed' });
    }
  }
);

module.exports = router;
