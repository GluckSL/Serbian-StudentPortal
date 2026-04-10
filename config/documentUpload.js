// config/documentUpload.js
// Multer-S3 configuration for student document uploads

const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const s3Client = require('./s3');

// File filter — only allow specific file types
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPG, PNG, DOC, and DOCX files are allowed.'), false);
  }
};

const upload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      const studentId = req.user?.id || 'temp';
      const documentType = req.body?.documentType || 'document';
      const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const key = `${prefix}/student-documents/${studentId}/${documentType}_${Date.now()}_${sanitizedName}`;
      cb(null, key);
    },
  }),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = upload;
