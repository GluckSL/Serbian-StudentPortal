'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadsDir = path.join(__dirname, '..', 'uploads', 'sprechen-cards');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    const safe = `${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  },
});

const imageFilter = (_req, file, cb) => {
  const ok = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype || '');
  cb(ok ? null : new Error('Only image files (JPEG, PNG, GIF, WebP) are allowed'), ok);
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 8 * 1024 * 1024 },
});

module.exports = upload.single('image');
