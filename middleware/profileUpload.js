const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const s3Client = require('../config/s3');

// Allowed image MIME types
const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/gif'];

function fileFilter(req, file, cb) {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type! Only image files are allowed.'), false);
  }
}

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      const ext = path.extname(file.originalname);
      const userId = req.user?.id || 'unknown';
      const key = `${prefix}/profile-photos/${userId}_${Date.now()}${ext}`;
      cb(null, key);
    },
  }),
  fileFilter,
});

module.exports = upload;
