const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { r2Client, R2_BUCKET } = require('./r2');

const ALLOWED_MIME = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
  'application/pdf',
  'video/mp4', 'video/webm'
];

const upload = multer({
  storage: multerS3({
    s3: r2Client,
    bucket: R2_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ext && ext.length <= 10 ? ext : '';
      cb(null, `olly-chat/media_${Date.now()}_${Math.round(Math.random() * 1e9)}${safeExt}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('File type not supported. Allowed: images, PDF, MP4/WebM.'));
    }
    cb(null, true);
  }
});

module.exports = upload;
