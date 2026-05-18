'use strict';

const path = require('path');
const multer = require('multer');
const multerS3 = require('multer-s3');
const s3Client = require('../config/s3');

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

const storage = multerS3({
  s3: s3Client,
  bucket: process.env.S3_BUCKET,
  contentType: multerS3.AUTO_CONTENT_TYPE,
  key: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const prefix = process.env.S3_PREFIX || 'uploads';
    cb(null, `${prefix}/sprechen-cards/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_IMAGE_TYPES.includes(String(file.mimetype || '').toLowerCase());
    cb(ok ? null : new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'), ok);
  },
  limits: { fileSize: 8 * 1024 * 1024 },
});

module.exports = upload.single('image');
