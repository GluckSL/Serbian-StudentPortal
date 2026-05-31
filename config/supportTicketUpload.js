const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const { r2Client, R2_BUCKET } = require('./r2');

const upload = multer({
  storage: multerS3({
    s3: r2Client,
    bucket: R2_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const safeExt = ext && ext.length <= 10 ? ext : '';
      cb(null, `support-tickets/ticket_${Date.now()}_${Math.round(Math.random() * 1e9)}${safeExt}`);
    }
  }),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only PNG/JPEG/WEBP images are allowed.'));
    }
    cb(null, true);
  }
});

module.exports = upload;
