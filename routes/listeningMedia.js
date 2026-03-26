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

// ─── Multer for audio/video uploads ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'listening-media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, safe);
  }
});

const audioFilter = (req, file, cb) => {
  const allowed = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/webm', 'audio/ogg',
    'audio/m4a', 'audio/x-m4a', 'video/mp4', 'video/webm'
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only audio/video files allowed'), false);
};

const upload = multer({
  storage,
  fileFilter: audioFilter,
  limits: { fileSize: 25 * 1024 * 1024 } // 25 MB
});

// ─── POST /upload ────────────────────────────────────────────────────────────
// Upload audio file from computer
router.post('/upload',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  upload.single('media'),
  (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No media file uploaded' });
      const url = '/uploads/listening-media/' + path.basename(req.file.path);
      res.json({ success: true, url });
    } catch (err) {
      console.error('Listening media upload error:', err);
      res.status(500).json({ error: err.message || 'Upload failed' });
    }
  }
);

// ─── POST /fetch-from-url ────────────────────────────────────────────────────
// Fetch audio from URL and save locally (for link input)
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
      const dir = path.join(__dirname, '..', 'uploads', 'listening-media');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(parsed.pathname) || '.mp3';
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
      const filePath = path.join(dir, filename);

      await new Promise((resolve, reject) => {
        const client = parsed.protocol === 'https:' ? https : http;
        const file = fs.createWriteStream(filePath);
        client.get(url, { timeout: 30000 }, (response) => {
          if (response.statusCode !== 200) {
            fs.unlink(filePath, () => {});
            return reject(new Error(`Failed to fetch: ${response.statusCode}`));
          }
          response.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', (err) => {
          fs.unlink(filePath, () => {});
          reject(err);
        });
      });

      const serveUrl = '/uploads/listening-media/' + filename;
      res.json({ success: true, url: serveUrl });
    } catch (err) {
      console.error('Fetch from URL error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch audio from URL' });
    }
  }
);

// ─── POST /transcribe ─────────────────────────────────────────────────────────
// Transcribe audio using OpenAI Whisper
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
      let filePath;
      if (mediaUrl.startsWith('/uploads/')) {
        filePath = path.join(__dirname, '..', mediaUrl);
      } else if (mediaUrl.startsWith('http')) {
        return res.status(400).json({ error: 'Please use fetch-from-url first, then transcribe the saved file' });
      } else {
        filePath = path.join(__dirname, '..', 'uploads', 'listening-media', path.basename(mediaUrl));
      }

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Audio file not found' });
      }

      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const fileStream = fs.createReadStream(filePath);

      const transcription = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'whisper-1',
        response_format: 'text',
        temperature: 0.2
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
