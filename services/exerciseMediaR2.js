// Shared Cloudflare R2 helpers for exercise audio / attachments (PutObject, HeadObject, URL parsing).
// Policy: exercise media is write-only from this app — objects are never deleted when replaced or
// when an exercise is updated; only MongoDB URL references change.
const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');

let cachedConfig;

function getExerciseR2Config() {
  if (cachedConfig !== undefined) return cachedConfig;
  const accountId = process.env.CF_ACCOUNT_ID;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME;
  const publicBaseUrl = String(process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    cachedConfig = null;
    return cachedConfig;
  }

  cachedConfig = {
    client: new S3Client({
      region: 'auto',
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    }),
    bucket,
    publicBaseUrl,
  };
  return cachedConfig;
}

function isExerciseR2Configured() {
  return !!getExerciseR2Config();
}

async function putExerciseMediaBuffer(buffer, key, contentType) {
  const cfg = getExerciseR2Config();
  if (!cfg) throw new Error('R2 is not configured');
  const normalizedKey = String(key || '').replace(/^\/+/, '');
  await cfg.client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: normalizedKey,
      Body: buffer,
      ContentType: contentType || 'application/octet-stream',
    })
  );
  const publicUrl = `${cfg.publicBaseUrl}/${normalizedKey}`;
  const bytes = Buffer.isBuffer(buffer) ? buffer.length : 0;
  console.log(
    '[R2 exercise audio] Upload complete (server PutObject) bucket=%s key=%s contentType=%s bytes=%s publicUrl=%s',
    cfg.bucket,
    normalizedKey,
    contentType || 'application/octet-stream',
    bytes,
    publicUrl
  );
  return publicUrl;
}

async function headExerciseMediaKey(key) {
  const cfg = getExerciseR2Config();
  if (!cfg) return false;
  const normalizedKey = String(key || '').replace(/^\/+/, '');
  try {
    await cfg.client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: normalizedKey }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Maps stored URLs (relative /uploads/… or full public R2 URL) to an R2 object key
 * under listening-media/ or exercise-attachments/.
 */
function extractMediaKeyFromUrl(url) {
  const s = String(url || '').trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  const markers = ['listening-media/', 'exercise-attachments/'];
  for (const m of markers) {
    const idx = lower.indexOf(m);
    if (idx !== -1) return s.slice(idx).replace(/^\/+/, '');
  }
  return null;
}

function publicUrlForKey(key) {
  const cfg = getExerciseR2Config();
  if (!cfg) return null;
  const normalizedKey = String(key || '').replace(/^\/+/, '');
  return `${cfg.publicBaseUrl}/${normalizedKey}`;
}

module.exports = {
  getExerciseR2Config,
  isExerciseR2Configured,
  putExerciseMediaBuffer,
  headExerciseMediaKey,
  extractMediaKeyFromUrl,
  publicUrlForKey,
};
