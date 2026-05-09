/**
 * Cloudflare R2 storage for payment proof files.
 * Uses the same R2 credentials as the exercise media service so no extra env vars are needed.
 *
 * Required env vars (any one alias per key):
 *   R2_ACCESS_KEY_ID   (or CF_R2_ACCESS_KEY_ID)
 *   R2_SECRET_ACCESS_KEY (or CF_R2_SECRET_ACCESS_KEY)
 *   CF_ACCOUNT_ID       (used to build endpoint)
 *   R2_BUCKET           (or R2_BUCKET_NAME)
 *   R2_PUBLIC_BASE_URL  — public read base URL, e.g. https://pub-xxxx.r2.dev
 *                         If omitted, presigned GET URLs are used instead.
 */
const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let _cfg;

function getR2Config() {
  if (_cfg !== undefined) return _cfg;

  const accountId = process.env.CF_ACCOUNT_ID;
  const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const accessKeyId =
    process.env.R2_ACCESS_KEY_ID ||
    process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.R2_SECRET_ACCESS_KEY ||
    process.env.CF_R2_SECRET_ACCESS_KEY;
  const bucket =
    process.env.R2_BUCKET ||
    process.env.R2_BUCKET_NAME;
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    _cfg = null;
    return _cfg;
  }

  _cfg = {
    client: new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: false,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    publicBaseUrl: publicBaseUrl || null,
  };
  return _cfg;
}

function isPaymentR2Configured() {
  return !!getR2Config();
}

/**
 * Upload proof buffer to R2.
 * Returns `{ key, publicUrl? }`.
 * `publicUrl` is set when R2_PUBLIC_BASE_URL is configured; otherwise callers
 * must use `getProofViewUrl(key)` to generate a presigned URL.
 */
async function putPaymentProof(buffer, key, contentType) {
  const cfg = getR2Config();
  if (!cfg) throw new Error('Payment proof R2 is not configured');

  const normalizedKey = String(key).replace(/^\/+/, '');
  await cfg.client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: normalizedKey,
    Body: buffer,
    ContentType: contentType || 'image/jpeg',
  }));

  const publicUrl = cfg.publicBaseUrl ? `${cfg.publicBaseUrl}/${normalizedKey}` : null;
  return { key: normalizedKey, publicUrl };
}

/**
 * Check whether a key exists in the R2 bucket.
 */
async function proofKeyExists(key) {
  const cfg = getR2Config();
  if (!cfg) return false;
  try {
    await cfg.client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns a public URL (if configured) or a short-lived presigned GET URL for the key.
 * Returns null if R2 is not configured.
 */
async function getProofViewUrl(key, expiresIn = 3600) {
  const cfg = getR2Config();
  if (!cfg) return null;
  if (cfg.publicBaseUrl) return `${cfg.publicBaseUrl}/${key}`;
  return getSignedUrl(cfg.client, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn });
}

module.exports = { isPaymentR2Configured, putPaymentProof, proofKeyExists, getProofViewUrl };
