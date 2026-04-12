const multer = require('multer');
const multerS3 = require('multer-s3');
const s3Client = require('./s3');

const ALLOWED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const DANGEROUS_EXT = /\.(exe|bat|cmd|com|scr|msi|dll|vbs|ps1|pif|cpl|inf|reg|hta|iso)$/i;

function fileFilter(req, file, cb) {
  if (DANGEROUS_EXT.test(file.originalname || '')) {
    return cb(new Error('This file type is not allowed.'), false);
  }
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    return cb(new Error('Only PDF, images, and Word documents are allowed.'), false);
  }
  cb(null, true);
}

const classSubmissionUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: process.env.S3_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const prefix = process.env.S3_PREFIX || 'uploads';
      cb(null, `${prefix}/class-submissions/${Date.now()}_${file.originalname}`);
    }
  }),
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }
});

module.exports = classSubmissionUpload;
