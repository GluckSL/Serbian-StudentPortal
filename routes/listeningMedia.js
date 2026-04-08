// routes/listeningMedia.js
// Upload audio for listening questions + AI transcription (Whisper)

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { verifyToken, checkRole } = require('../middleware/auth');

const LISTENING_MEDIA_DIR = path.join(__dirname, '..', 'uploads', 'listening-media');

function ensureListeningMediaDir() {
  if (!fs.existsSync(LISTENING_MEDIA_DIR)) {
    fs.mkdirSync(LISTENING_MEDIA_DIR, { recursive: true });
  }
}

// ─── Multer disk storage (same pattern as pdf-exercises; served via app.use('/uploads', ...)) ─
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
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  return map[mt] || '.bin';
}

const audioFilter = (req, file, cb) => {
  const mt = String(file.mimetype || '').toLowerCase();
  const isAudio = mt.startsWith('audio/');
  const isAllowedVideo = mt === 'video/mp4' || mt === 'video/webm' || mt === 'video/quicktime';
  if (isAudio || isAllowedVideo) return cb(null, true);
  return cb(new Error(`Only audio files (audio/*) or MP4/WebM/MOV video are allowed. Received: ${mt || 'unknown'}`), false);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureListeningMediaDir();
    cb(null, LISTENING_MEDIA_DIR);
  },
  filename: (req, file, cb) => {
    const ext = inferExtension(file);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  fileFilter: audioFilter,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB (matches admin video upload cap)
});

// ─── POST /upload ────────────────────────────────────────────────────────────
const uploadSingleMedia = (req, res, next) => {
  upload.single('media')(req, res, (err) => {
    if (err) {
      console.error('Listening media upload error (multer):', err);
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
};

router.post('/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  uploadSingleMedia,
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No media file uploaded' });
      const url = `/uploads/listening-media/${req.file.filename}`;
      res.json({ success: true, url });
    } catch (err) {
      console.error('Listening media upload error:', err);
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }
);

// ─── POST /fetch-from-url ────────────────────────────────────────────────────
router.post('/fetch-from-url',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'Invalid URL protocol' });
      }

      const buffer = await new Promise((resolve, reject) => {
        const client = parsed.protocol === 'https:' ? https : http;
        const chunks = [];
        client.get(url, { timeout: 30000 }, (response) => {
          if (response.statusCode !== 200) {
            return reject(new Error(`Failed to fetch: ${response.statusCode}`));
          }
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => resolve(Buffer.concat(chunks)));
          response.on('error', reject);
        }).on('error', reject);
      });

      const ext = path.extname(parsed.pathname) || '.mp3';
      ensureListeningMediaDir();
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      const filePath = path.join(LISTENING_MEDIA_DIR, filename);
      fs.writeFileSync(filePath, buffer);

      const relativeUrl = `/uploads/listening-media/${filename}`;
      res.json({ success: true, url: relativeUrl });
    } catch (err) {
      console.error('Fetch from URL error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch audio from URL' });
    }
  }
);

/** Resolve stored media path to absolute file under project uploads/ (for transcribe). */
function resolveUploadsFilePath(mediaUrl) {
  const s = String(mediaUrl || '').trim();
  if (!s.startsWith('/uploads/')) return null;
  const rel = s.replace(/^\//, '');
  const filePath = path.join(__dirname, '..', rel);
  const uploadsRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(uploadsRoot)) return null;
  return resolved;
}

// ─── POST /transcribe ─────────────────────────────────────────────────────────
router.post('/transcribe',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    const { mediaUrl } = req.body;
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return res.status(400).json({ error: 'mediaUrl is required' });
    }

    if (!process.env.OPENAI_API_KEY) {
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
          error: 'mediaUrl must be a /uploads/... path on this server or a full HTTP/HTTPS URL',
        });
      }

      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      const ext = path.extname(mediaUrl.split('?')[0]) || '.mp3';
      const filename = `audio${ext}`;
      const blob = new Blob([audioBuffer]);
      const file = new File([blob], filename);

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
