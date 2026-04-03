// routes/listeningMedia.js
// Upload audio for listening questions + AI transcription (Whisper)

const express = require('express');
const router = express.Router();
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const https = require('https');
const http = require('http');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const { verifyToken, checkRole } = require('../middleware/auth');

// ─── Multer-S3 for audio/video uploads ───────────────────────────────────────
const audioFilter = (req, file, cb) => {
  const allowed = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/ogg',
    'audio/m4a', 'audio/x-m4a', 'video/mp4', 'video/webm'
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only audio/video files allowed'), false);
};

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      const ext = path.extname(file.originalname) || '.mp3';
      const key = `${prefix}/listening-media/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      cb(null, key);
    },
  }),
  fileFilter: audioFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// ─── POST /upload ────────────────────────────────────────────────────────────
// Upload audio file from computer → streams directly to S3
router.post('/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  upload.single('media'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No media file uploaded' });
      // req.file.location is the full S3 URL provided by multer-s3
      res.json({ success: true, url: req.file.location });
    } catch (err) {
      console.error('Listening media upload error:', err);
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }
);

// ─── POST /fetch-from-url ────────────────────────────────────────────────────
// Fetch audio from an external URL and store it in S3
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

      // Download the remote file into a buffer, then upload to S3
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
      const prefix = process.env.S3_PREFIX || 'uploads';
      const key = `${prefix}/listening-media/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;

      await s3Client.send(new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentLength: buffer.length,
      }));

      const region = process.env.AWS_REGION;
      const bucket = process.env.S3_BUCKET;
      const s3Url = `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

      res.json({ success: true, url: s3Url });
    } catch (err) {
      console.error('Fetch from URL error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch audio from URL' });
    }
  }
);

// ─── POST /transcribe ─────────────────────────────────────────────────────────
// Transcribe audio using OpenAI Whisper
// mediaUrl must be a publicly accessible URL (e.g., S3 URL)
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
      // Download the audio from the URL (works for both S3 URLs and any public URL)
      if (!mediaUrl.startsWith('http')) {
        return res.status(400).json({ error: 'mediaUrl must be a full HTTP/HTTPS URL' });
      }

      const parsed = new URL(mediaUrl);
      const audioBuffer = await new Promise((resolve, reject) => {
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

      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // OpenAI SDK needs a File-like object — use a Buffer wrapped as a Blob
      const ext = path.extname(parsed.pathname) || '.mp3';
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
