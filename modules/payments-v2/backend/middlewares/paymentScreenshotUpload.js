const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { isPaymentR2Configured } = require('../services/paymentProofR2Service');
const {
  paymentProofFileFilter,
  PROOF_FILTER_ERROR,
  PROOF_MAX_BYTES,
} = require('../../../../utils/paymentProofFileFilter');

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

const limits = { fileSize: PROOF_MAX_BYTES };

/**
 * When R2 is configured, store in memory so we can stream to R2.
 * Otherwise write to disk so Express can serve it statically.
 * The field name must match client FormData: `screenshot`.
 */
function buildUploadMiddleware() {
  const storage = isPaymentR2Configured() ? multer.memoryStorage() : diskStorage;
  const upload = multer({ storage, fileFilter: paymentProofFileFilter, limits }).single('screenshot');
  return (req, res, next) => {
    upload(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File is too large. Maximum size is 15 MB.',
        });
      }
      return res.status(400).json({
        success: false,
        message: err.message || PROOF_FILTER_ERROR,
      });
    });
  };
}

module.exports = { buildUploadMiddleware, uploadDir };
