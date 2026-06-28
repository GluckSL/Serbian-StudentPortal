'use strict';

const fs = require('fs');
const path = require('path');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'uploads', 'dg-context-images');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `ctx-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const upload = multer({
  storage,
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
      return res.status(400).json({ message: 'No file received.' });
    }
    const relativePath = `/uploads/dg-context-images/${req.file.filename}`;
    res.json({ url: relativePath });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Upload failed' });
  }
};
