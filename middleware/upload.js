const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const s3Client = require('../config/s3');

// Allowed file types for course materials
const allowedTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'application/zip'
];

function fileFilter(req, file, cb) {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type!'), false);
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
      const key = `${prefix}/course-materials/${Date.now()}_${file.originalname}`;
      cb(null, key);
    },
  }),
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

module.exports = upload;
