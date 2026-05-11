const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { isPaymentR2Configured } = require('../services/paymentProofR2Service');

/** Served under app static: /uploads/payment-hub-v2/... (disk fallback only) */
const uploadDir = path.join(__dirname, '../../../../uploads/payment-hub-v2');
fs.mkdirSync(uploadDir, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10) || '.jpg';
    const safe = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safe);
  },
});

const fileFilter = (_req, file, cb) => {
  const mimeOk = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype) || file.mimetype === 'application/pdf';
  const nameOk = /\.(jpe?g|png|gif|webp|pdf)$/i.test(file.originalname || '');
  if (mimeOk || nameOk) return cb(null, true);
  cb(new Error('Please upload an image (JPG, PNG, WebP, GIF) or a PDF'));
};

const limits = { fileSize: 15 * 1024 * 1024 };

/**
 * When R2 is configured, store in memory so we can stream to R2.
 * Otherwise write to disk so Express can serve it statically.
 * The field name must match client FormData: `screenshot`.
 */
function buildUploadMiddleware() {
  const storage = isPaymentR2Configured() ? multer.memoryStorage() : diskStorage;
  return multer({ storage, fileFilter, limits }).single('screenshot');
}

module.exports = { buildUploadMiddleware, uploadDir };
