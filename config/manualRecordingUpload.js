const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Stage uploads on the system temp volume (same idea as Zoom downloads in recordingProcessor).
// Final HLS lives in R2 under manual/{recordingId}/hls/ — project uploads/ is not used.
const uploadDir = path.join(os.tmpdir(), 'gluck-manual-recordings');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ext && ext.length <= 10 ? ext : '.mp4';
    cb(null, `manual_${Date.now()}_${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'video/mp4',
      'video/quicktime',
      'video/x-m4v',
      'video/webm',
      'video/ogg',
    ];
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedExt = ['.mp4', '.mov', '.m4v', '.webm', '.ogg'];
    if (allowedMimeTypes.includes(file.mimetype) || allowedExt.includes(ext)) {
      return cb(null, true);
    }
    return cb(new Error('Only video files (MP4/MOV/M4V/WEBM/OGG) are allowed.'));
  },
});

module.exports = upload;
