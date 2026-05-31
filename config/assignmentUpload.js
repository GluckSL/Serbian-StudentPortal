// config/assignmentUpload.js
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const s3Client = require('./s3');

// Allowed assignment file types
const allowedTypes = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function fileFilter(req, file, cb) {
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type for assignment'), false);
  }
}

const assignmentUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      const key = `${prefix}/assignments/${Date.now()}_${file.originalname}`;
      cb(null, key);
    },
  }),
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

module.exports = assignmentUpload;
