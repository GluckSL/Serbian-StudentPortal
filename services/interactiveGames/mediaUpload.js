// services/interactiveGames/mediaUpload.js
// GlückArena: thumbnail upload — reuses project's S3 / R2 patterns

const multer = require('multer');
const path = require('path');
const s3Client = require('../../config/s3');
const multerS3 = require('multer-s3');
const { canonicalizeMediaUrl } = require('../../config/presign');
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function buildUploader() {
  const storage = multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const prefix = process.env.S3_PREFIX || 'uploads';
      cb(null, `${prefix}/game-thumbnails/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  });

  return multer({
    storage,
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
      cb(new Error('Only image files allowed for thumbnails'));
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }).single('thumbnail');
}

const uploader = buildUploader();

/**
 * Handle thumbnail upload for a game set.
 * Returns the uploaded URL string, or sends a 400/500 response and returns null.
 */
function uploadThumbnail(req, res) {
  return new Promise((resolve) => {
    uploader(req, res, (err) => {
      if (err) {
        res.status(400).json({ success: false, message: err.message });
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No thumbnail file provided' });
        return resolve(null);
      }
      const rawUrl = req.file.location || req.file.path || '';
      resolve(canonicalizeMediaUrl(rawUrl));
    });
  });
}

const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/x-m4a'];

function buildAudioUploader(fieldName = 'audio') {
  const storage = multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.mp3';
      const prefix = process.env.S3_PREFIX || 'uploads';
      cb(null, `${prefix}/game-audio/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  });

  return multer({
    storage,
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_AUDIO_TYPES.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
        return cb(null, true);
      }
      cb(new Error('Only audio files allowed'));
    },
    limits: { fileSize: 15 * 1024 * 1024 },
  }).single(fieldName);
}

const audioUploader = buildAudioUploader('audio');

function uploadQuestionAudio(req, res) {
  return new Promise((resolve) => {
    audioUploader(req, res, (err) => {
      if (err) {
        res.status(400).json({ success: false, message: err.message });
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No audio file provided' });
        return resolve(null);
      }
      const rawUrl = req.file.location || req.file.path || '';
      resolve(canonicalizeMediaUrl(rawUrl));
    });
  });
}

function buildImageUploader() {
  const storage = multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    acl: 'public-read',
    key: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const prefix = process.env.S3_PREFIX || 'uploads';
      cb(null, `${prefix}/game-images/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  });

  return multer({
    storage,
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
      cb(new Error('Only image files allowed (jpeg, png, webp, gif)'));
    },
    limits: { fileSize: 5 * 1024 * 1024 },
  }).single('image');
}

const imageUploader = buildImageUploader();

function uploadQuestionImage(req, res) {
  return new Promise((resolve) => {
    imageUploader(req, res, (err) => {
      if (err) {
        res.status(400).json({ success: false, message: err.message });
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No image file provided' });
        return resolve(null);
      }
      const rawUrl = req.file.location || req.file.path || '';
      resolve(canonicalizeMediaUrl(rawUrl));
    });
  });
}

function uploadPairImage(req, res) {
  return new Promise((resolve) => {
    imageUploader(req, res, (err) => {
      if (err) {
        res.status(400).json({ success: false, message: err.message });
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No image file provided' });
        return resolve(null);
      }
      const rawUrl = req.file.location || req.file.path || '';
      resolve(canonicalizeMediaUrl(rawUrl));
    });
  });
}

module.exports = { uploadThumbnail, uploadQuestionAudio, uploadQuestionImage, uploadPairImage };
