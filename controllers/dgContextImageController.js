'use strict';

const path = require('path');
const multer = require('multer');
const { isExerciseR2Configured, putExerciseMediaBuffer } = require('../services/exerciseMediaR2');

const R2_KEY_PREFIX = 'dg-context-images';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed (JPG, PNG, GIF, WebP).'));
  },
});

exports.uploadMiddleware = upload.single('file');

exports.uploadContextImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Nijedna datoteka nije primljena.' });
    }
    if (!req.file.buffer?.length) {
      return res.status(400).json({ message: 'Prazno otpremanje slike.' });
    }
    if (!isExerciseR2Configured()) {
      return res.status(503).json({
        message:
          'Otpremanje slika zahteva Cloudflare R2. Postavite CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET i R2_PUBLIC_BASE_URL.',
      });
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase() || '.jpg';
    const key = `${R2_KEY_PREFIX}/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    const publicUrl = await putExerciseMediaBuffer(
      req.file.buffer,
      key,
      req.file.mimetype || 'image/jpeg',
    );

    res.json({ url: publicUrl });
  } catch (e) {
    console.error('[dg-context-image] R2 upload failed:', e.message);
    res.status(500).json({ message: e.message || 'Otpremanje nije uspelo' });
  }
};
