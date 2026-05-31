const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

/** Project root `uploads/` (same as multer paymentScreenshotUpload). */
const uploadsRoot = path.join(__dirname, '../../../../uploads');

let client = null;
const getClient = () => {
  if (!client && process.env.AWS_ACCESS_KEY_ID) {
    client = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } });
  }
  return client;
};

const uploadFile = async (key, buffer, mimeType) => {
  const c = getClient();
  if (!c) throw new Error('S3 not configured');
  await c.send(new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: buffer, ContentType: mimeType }));
  return key;
};

const getPresignedUrl = async (key, expiresIn = 3600) => {
  const c = getClient();
  if (!c) return null;
  return getSignedUrl(c, new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn });
};

const normalizeScreenshotKey = (key) => String(key).replace(/^uploads\/?/i, '').replace(/^\//, '');

const localProofFileExists = async (cleanKey) => {
  const abs = path.resolve(path.join(uploadsRoot, cleanKey));
  const root = path.resolve(uploadsRoot);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  try {
    await fs.promises.access(abs, fs.constants.R_OK);
    const st = await fs.promises.stat(abs);
    return st.isFile();
  } catch {
    return false;
  }
};

/** Only presign when the object is actually in the bucket (avoids NoSuchKey when proof is on disk only). */
const s3ObjectExists = async (cleanKey) => {
  const c = getClient();
  const bucket = process.env.S3_BUCKET;
  if (!c || !bucket) return false;
  try {
    await c.send(new HeadObjectCommand({ Bucket: bucket, Key: cleanKey }));
    return true;
  } catch {
    return false;
  }
};

/**
 * URL for admins/students to open a proof file.
 * 1) Already absolute URL → return as-is (covers R2 public URLs stored directly).
 * 2) File on app disk (multer disk fallback) → `/uploads/...`.
 * 3) R2 configured + key exists in R2 → public URL or presigned GET.
 * 4) S3 configured + key exists in S3 → presigned URL.
 * 5) Otherwise null — caller shows a friendly message.
 */
const resolveScreenshotViewUrl = async (key) => {
  if (!key) return null;
  const s = String(key);
  if (/^https?:\/\//i.test(s)) return s;
  const clean = normalizeScreenshotKey(s);
  if (!clean) return null;

  if (await localProofFileExists(clean)) {
    return `/uploads/${clean}`;
  }

  // Try R2 first (payment-specific R2 service)
  const proofR2 = require('./paymentProofR2Service');
  if (proofR2.isPaymentR2Configured()) {
    try {
      if (await proofR2.proofKeyExists(clean)) {
        const u = await proofR2.getProofViewUrl(clean);
        if (u) return u;
      }
    } catch {
      /* fall through */
    }
  }

  // Fallback: AWS S3 presign
  if (await s3ObjectExists(clean)) {
    try {
      const u = await getPresignedUrl(clean);
      if (u) return u;
    } catch {
      /* fall through */
    }
  }

  return null;
};

module.exports = { uploadFile, getPresignedUrl, resolveScreenshotViewUrl };
