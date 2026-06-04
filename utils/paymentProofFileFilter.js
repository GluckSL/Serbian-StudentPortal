const path = require('path');

const PROOF_EXT_RE = /\.(jpe?g|png|gif|webp|heic|heif|pdf)$/i;
const PROOF_MIME_RE = /^image\/(jpeg|jpg|png|gif|webp|heic|heif)$/i;

/** Whether a multer file looks like an allowed payment proof (image or PDF). */
function isAcceptedPaymentProofFile(file) {
  const name = String(file?.originalname || '');
  const extOk = PROOF_EXT_RE.test(name);
  const mime = String(file?.mimetype || '').toLowerCase();

  if (PROOF_MIME_RE.test(mime) || mime === 'application/pdf' || mime === 'application/x-pdf') {
    return true;
  }
  // Mobile browsers (especially iOS) often send empty or generic mimetypes
  if (!mime || mime === 'application/octet-stream') {
    return extOk;
  }
  return extOk;
}

const PROOF_FILTER_ERROR = 'Please upload an image (JPG, PNG, HEIC) or a PDF (max 15 MB).';

function paymentProofFileFilter(_req, file, cb) {
  if (isAcceptedPaymentProofFile(file)) return cb(null, true);
  cb(new Error(PROOF_FILTER_ERROR));
}

module.exports = {
  isAcceptedPaymentProofFile,
  paymentProofFileFilter,
  PROOF_FILTER_ERROR,
  PROOF_MAX_BYTES: 15 * 1024 * 1024,
};
