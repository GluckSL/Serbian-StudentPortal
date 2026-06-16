// services/interactiveGames/mediaUpload.js
// GlückArena media: images + question audio → Cloudflare R2 (memory only, never project uploads/).
// Thumbnails/images/audio fall back to S3 only when R2 is not configured.

const multer = require('multer');
const path = require('path');
const s3Client = require('../../config/s3');
const multerS3 = require('multer-s3');
const { canonicalizeMediaUrl } = require('../../config/presign');
const { isExerciseR2Configured, putExerciseMediaBuffer } = require('../exerciseMediaR2');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const R2_THUMB_PREFIX = 'glueck-arena/game-thumbnails';
const R2_TAP_BOXES_BG_PREFIX = 'glueck-arena/tap-boxes-backgrounds';
const R2_IMAGE_PREFIX = 'glueck-arena/game-images';
const R2_AUDIO_PREFIX = 'glueck-arena/game-audio';

function imageFileFilter(_req, file, cb) {
  const mt = String(file.mimetype || '').toLowerCase();
  if (ALLOWED_IMAGE_TYPES.includes(mt) || mt === 'image/jpg' || mt === 'image/pjpeg') {
    return cb(null, true);
  }
  // Browsers on Windows often send image/jpg or other image/* variants.
  if (mt.startsWith('image/')) return cb(null, true);
  cb(new Error('Only image files allowed (jpeg, png, webp, gif)'));
}

/** multer-s3 + AWS SDK v3 may omit Location; build URL from bucket/key when needed. */
function s3UrlFromUploadedFile(file) {
  if (file?.location) return file.location;
  const bucket = file?.bucket || process.env.S3_BUCKET;
  const key = file?.key;
  if (!bucket || !key) return '';
  const region = process.env.AWS_REGION || 'us-east-1';
  const encodedKey = String(key)
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;
}

function buildMemoryImageUploader(fieldName) {
  return multer({
    storage: multer.memoryStorage(),
    fileFilter: imageFileFilter,
  }).single(fieldName);
}

function buildS3ImageUploader(fieldName, keyFolder) {
  const storage = multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      const prefix = process.env.S3_PREFIX || 'uploads';
      cb(null, `${prefix}/${keyFolder}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  });

  return multer({
    storage,
    fileFilter: imageFileFilter,
  }).single(fieldName);
}

function r2NotConfiguredResponse(res) {
  res.status(503).json({
    success: false,
    message:
      'Arena image uploads require Cloudflare R2. Set CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_PUBLIC_BASE_URL.',
  });
}

/**
 * Accept multipart image, upload to R2, return public URL.
 * Never writes to the project uploads/ directory.
 */
function handleImageUpload(req, res, { fieldName, r2KeyPrefix, missingMessage, s3KeyFolder }) {
  return new Promise((resolve) => {
    if (isExerciseR2Configured()) {
      const memoryUploader = buildMemoryImageUploader(fieldName);
      return memoryUploader(req, res, async (err) => {
        if (err) {
          res.status(400).json({ success: false, message: err.message });
          return resolve(null);
        }
        if (!req.file) {
          res.status(400).json({ success: false, message: missingMessage });
          return resolve(null);
        }
        if (!req.file.buffer?.length) {
          res.status(400).json({ success: false, message: 'Empty image upload' });
          return resolve(null);
        }
        try {
          const ext = path.extname(req.file.originalname) || '.jpg';
          const key = `${r2KeyPrefix}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
          const publicUrl = await putExerciseMediaBuffer(
            req.file.buffer,
            key,
            req.file.mimetype || 'image/jpeg'
          );
          resolve(publicUrl);
        } catch (uploadErr) {
          console.error('[glueck-arena] R2 image upload failed:', uploadErr.message);
          res.status(500).json({ success: false, message: uploadErr.message || 'R2 upload failed' });
          resolve(null);
        }
      });
    }

    if (!process.env.S3_BUCKET) {
      r2NotConfiguredResponse(res);
      return resolve(null);
    }

    const s3Uploader = buildS3ImageUploader(fieldName, s3KeyFolder);
    s3Uploader(req, res, (err) => {
      if (err) {
        res.status(400).json({ success: false, message: err.message });
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: missingMessage });
        return resolve(null);
      }
      const rawUrl = s3UrlFromUploadedFile(req.file);
      if (!rawUrl) {
        res.status(500).json({ success: false, message: 'S3 upload did not return a URL' });
        return resolve(null);
      }
      resolve(canonicalizeMediaUrl(rawUrl));
    });
  });
}

function buildThumbnailUploader() {
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

const thumbnailS3Uploader = buildThumbnailUploader();
const thumbnailMemoryUploader = buildMemoryImageUploader('thumbnail');

function uploadThumbnail(req, res) {
  return new Promise((resolve) => {
    if (isExerciseR2Configured()) {
      return thumbnailMemoryUploader(req, res, async (err) => {
        if (err) {
          res.status(400).json({ success: false, message: err.message });
          return resolve(null);
        }
        if (!req.file) {
          res.status(400).json({ success: false, message: 'No thumbnail file provided' });
          return resolve(null);
        }
        if (!req.file.buffer?.length) {
          res.status(400).json({ success: false, message: 'Empty thumbnail upload' });
          return resolve(null);
        }
        try {
          const ext = path.extname(req.file.originalname) || '.jpg';
          const key = `${R2_THUMB_PREFIX}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
          const publicUrl = await putExerciseMediaBuffer(
            req.file.buffer,
            key,
            req.file.mimetype || 'image/jpeg'
          );
          resolve(publicUrl);
        } catch (uploadErr) {
          console.error('[glueck-arena] R2 thumbnail upload failed:', uploadErr.message);
          res.status(500).json({ success: false, message: uploadErr.message || 'R2 upload failed' });
          resolve(null);
        }
      });
    }

    if (!process.env.S3_BUCKET) {
      r2NotConfiguredResponse(res);
      return resolve(null);
    }

    thumbnailS3Uploader(req, res, (err) => {
      if (err) {
        res.status(400).json({ success: false, message: err.message });
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No thumbnail file provided' });
        return resolve(null);
      }
      const rawUrl = s3UrlFromUploadedFile(req.file);
      if (!rawUrl) {
        res.status(500).json({ success: false, message: 'S3 upload did not return a URL' });
        return resolve(null);
      }
      resolve(canonicalizeMediaUrl(rawUrl));
    });
  });
}

const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/x-m4a'];

function audioFileFilter(_req, file, cb) {
  const mt = String(file.mimetype || '').toLowerCase();
  if (ALLOWED_AUDIO_TYPES.includes(mt) || mt.startsWith('audio/')) return cb(null, true);
  cb(new Error('Only audio files allowed'));
}

function buildMemoryAudioUploader(fieldName = 'audio') {
  return multer({
    storage: multer.memoryStorage(),
    fileFilter: audioFileFilter,
    limits: { fileSize: 15 * 1024 * 1024 },
  }).single(fieldName);
}

function buildS3AudioUploader(fieldName = 'audio') {
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
    fileFilter: audioFileFilter,
    limits: { fileSize: 15 * 1024 * 1024 },
  }).single(fieldName);
}

const audioMemoryUploader = buildMemoryAudioUploader('audio');
const audioS3Uploader = buildS3AudioUploader('audio');

/** Question / sentence audio → R2 (memory only). S3 only when R2 is not configured. */
function uploadQuestionAudio(req, res) {
  return new Promise((resolve) => {
    if (isExerciseR2Configured()) {
      return audioMemoryUploader(req, res, async (err) => {
        if (err) {
          res.status(400).json({ success: false, message: err.message });
          return resolve(null);
        }
        if (!req.file) {
          res.status(400).json({ success: false, message: 'No audio file provided' });
          return resolve(null);
        }
        if (!req.file.buffer?.length) {
          res.status(400).json({ success: false, message: 'Empty audio upload' });
          return resolve(null);
        }
        try {
          const ext = path.extname(req.file.originalname) || '.mp3';
          const key = `${R2_AUDIO_PREFIX}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
          const publicUrl = await putExerciseMediaBuffer(
            req.file.buffer,
            key,
            req.file.mimetype || 'audio/mpeg'
          );
          resolve(publicUrl);
        } catch (uploadErr) {
          console.error('[glueck-arena] R2 audio upload failed:', uploadErr.message);
          res.status(500).json({ success: false, message: uploadErr.message || 'R2 upload failed' });
          resolve(null);
        }
      });
    }

    if (!process.env.S3_BUCKET) {
      r2NotConfiguredResponse(res);
      return resolve(null);
    }

    audioS3Uploader(req, res, (err) => {
      if (err) {
        res.status(400).json({ success: false, message: err.message });
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No audio file provided' });
        return resolve(null);
      }
      const rawUrl = s3UrlFromUploadedFile(req.file);
      if (!rawUrl) {
        res.status(500).json({ success: false, message: 'S3 upload did not return a URL' });
        return resolve(null);
      }
      resolve(canonicalizeMediaUrl(rawUrl));
    });
  });
}

function uploadQuestionImage(req, res) {
  return handleImageUpload(req, res, {
    fieldName: 'image',
    r2KeyPrefix: R2_IMAGE_PREFIX,
    s3KeyFolder: 'game-images',
    missingMessage: 'No image file provided',
  });
}

function uploadPairImage(req, res) {
  return handleImageUpload(req, res, {
    fieldName: 'image',
    r2KeyPrefix: R2_IMAGE_PREFIX,
    s3KeyFolder: 'game-images',
    missingMessage: 'No image file provided',
  });
}

const tapBoxesBgMemoryUploader = buildMemoryImageUploader('background');

function buildTapBoxesBgS3Uploader() {
  return multer({
    storage: multerS3({
      s3: s3Client,
      bucket: process.env.S3_BUCKET,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `glueck-arena/tap-boxes-backgrounds/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
      cb(new Error('Only image files allowed for Tap the Boxes background'));
    },
    limits: { fileSize: 8 * 1024 * 1024 },
  }).single('background');
}

function uploadTapBoxesBackground(req, res) {
  return new Promise((resolve) => {
    if (isExerciseR2Configured()) {
      return tapBoxesBgMemoryUploader(req, res, async (err) => {
        if (err) {
          res.status(400).json({ success: false, message: err.message });
          return resolve(null);
        }
        if (!req.file) {
          res.status(400).json({ success: false, message: 'No background image provided' });
          return resolve(null);
        }
        if (!req.file.buffer?.length) {
          res.status(400).json({ success: false, message: 'Empty background upload' });
          return resolve(null);
        }
        try {
          const ext = path.extname(req.file.originalname) || '.jpg';
          const key = `${R2_TAP_BOXES_BG_PREFIX}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
          const publicUrl = await putExerciseMediaBuffer(
            req.file.buffer,
            key,
            req.file.mimetype || 'image/jpeg'
          );
          resolve(publicUrl);
        } catch (uploadErr) {
          console.error('[glueck-arena] R2 tap-boxes background upload failed:', uploadErr.message);
          res.status(500).json({ success: false, message: uploadErr.message || 'R2 upload failed' });
          resolve(null);
        }
      });
    }

    if (!process.env.S3_BUCKET) {
      r2NotConfiguredResponse(res);
      return resolve(null);
    }

    const s3Uploader = buildTapBoxesBgS3Uploader();
    return s3Uploader(req, res, (err) => {
      if (err) {
        res.status(400).json({ success: false, message: err.message });
        return resolve(null);
      }
      if (!req.file) {
        res.status(400).json({ success: false, message: 'No background image provided' });
        return resolve(null);
      }
      const rawUrl = s3UrlFromUploadedFile(req.file);
      if (!rawUrl) {
        res.status(500).json({ success: false, message: 'S3 upload did not return a URL' });
        return resolve(null);
      }
      resolve(canonicalizeMediaUrl(rawUrl));
    });
  });
}

module.exports = {
  uploadThumbnail,
  uploadTapBoxesBackground,
  uploadQuestionAudio,
  uploadQuestionImage,
  uploadPairImage,
};
