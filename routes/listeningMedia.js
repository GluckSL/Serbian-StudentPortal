// routes/listeningMedia.js
// Upload audio/video for listening/pronunciation questions + AI transcription (Whisper)
//
// Storage strategy:
//   • Video files (mp4 / webm / mov) → AWS S3  (full https://…amazonaws.com URL stored)
//   • Audio files                    → Local disk under uploads/listening-media/
//     served by app.use('/uploads', express.static(...)) in app.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const { verifyToken, checkRole } = require('../middleware/auth');
const { presignS3Url } = require('../config/presign');

const LISTENING_MEDIA_DIR = path.join(__dirname, '..', 'uploads', 'listening-media');

function ensureListeningMediaDir() {
  if (!fs.existsSync(LISTENING_MEDIA_DIR)) {
    fs.mkdirSync(LISTENING_MEDIA_DIR, { recursive: true });
  }
}

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
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
  };
  return map[mt] || '.bin';
}

function isVideoMime(mt) {
  const m = String(mt || '').toLowerCase();
  return m === 'video/mp4' || m === 'video/webm' || m === 'video/quicktime';
}

const mediaFilter = (req, file, cb) => {
  const mt = String(file.mimetype || '').toLowerCase();
  if (mt.startsWith('audio/') || isVideoMime(mt)) return cb(null, true);
  return cb(new Error(`Only audio/* or MP4/WebM/MOV video allowed. Received: ${mt || 'unknown'}`), false);
};

// ─── Multer: video → S3, audio → disk ────────────────────────────────────────

const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureListeningMediaDir();
    cb(null, LISTENING_MEDIA_DIR);
  },
  filename: (req, file, cb) => {
    const ext = inferExtension(file);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const s3Storage = multerS3({
  s3: s3Client,
  bucket: process.env.S3_BUCKET,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: (req, file, cb) => {
    const prefix = process.env.S3_PREFIX || 'uploads';
    const ext = inferExtension(file);
    cb(null, `${prefix}/listening-media/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

// Custom storage that delegates to disk or S3 based on mimetype
const hybridStorage = {
  _handleFile(req, file, cb) {
    if (isVideoMime(file.mimetype)) {
      s3Storage._handleFile(req, file, cb);
    } else {
      diskStorage._handleFile(req, file, cb);
    }
  },
  _removeFile(req, file, cb) {
    if (isVideoMime(file.mimetype)) {
      s3Storage._removeFile(req, file, cb);
    } else {
      diskStorage._removeFile(req, file, cb);
    }
  },
};

const upload = multer({
  storage: hybridStorage,
  fileFilter: mediaFilter,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

// ─── POST /upload ────────────────────────────────────────────────────────────
const uploadSingleMedia = (req, res, next) => {
  upload.single('media')(req, res, (err) => {
    if (err) {
      console.error('Listening media upload error (multer):', err);
      if (err.message && err.message.includes('bucket')) {
        console.error(`S3 config: bucket="${process.env.S3_BUCKET}" region="${process.env.AWS_REGION}"`);
        return res.status(400).json({
          error: `S3 upload failed: ${err.message}. Bucket="${process.env.S3_BUCKET || 'undefined'}" Region="${process.env.AWS_REGION || 'undefined'}"`,
        });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    next();
  });
};

router.post('/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  uploadSingleMedia,
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No media file uploaded' });

      // S3 (video): req.file.location is the full https://…amazonaws.com/… URL
      // Disk (audio): build a relative /uploads/… URL served by express.static
      let url = req.file.location
        ? req.file.location
        : `/uploads/listening-media/${req.file.filename}`;

      // If presigning is enabled, sign the S3 URL right away so the admin
      // video preview works without making the bucket public.
      if (req.file.location) {
        url = await presignS3Url(url);
      }

      res.json({ success: true, url });
    } catch (err) {
      console.error('Listening media upload error:', err);
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }
);

// ─── POST /fetch-from-url ────────────────────────────────────────────────────
// Fetches audio from an external URL → saves to disk (audio only use-case)
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
      fs.writeFileSync(path.join(LISTENING_MEDIA_DIR, filename), buffer);

      res.json({ success: true, url: `/uploads/listening-media/${filename}` });
    } catch (err) {
      console.error('Fetch from URL error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch audio from URL' });
    }
  }
);

// ─── Resolve /uploads/… path to absolute file (for transcribe) ───────────────
function resolveUploadsFilePath(mediaUrl) {
  const s = String(mediaUrl || '').trim();
  if (!s.startsWith('/uploads/')) return null;
  const filePath = path.join(__dirname, '..', s.replace(/^\//, ''));
  const uploadsRoot = path.resolve(path.join(__dirname, '..', 'uploads'));
  const resolved = path.resolve(filePath);
  return resolved.startsWith(uploadsRoot) ? resolved : null;
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
