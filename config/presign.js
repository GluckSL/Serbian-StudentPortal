// config/presign.js
// Generates presigned S3 GetObject URLs so private S3 objects can be played
// in the browser without making the bucket public.
//
// Enable with S3_USE_SIGNED_URLS=true in .env
// Expiry controlled by S3_SIGNED_URL_EXPIRY (seconds, default 3600 = 1 hour)

const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('./s3');

const USE_SIGNED = process.env.S3_USE_SIGNED_URLS === 'true';
const EXPIRES_IN = parseInt(process.env.S3_SIGNED_URL_EXPIRY || '3600', 10);

/** Returns true if the string looks like a direct S3 object URL. */
function isS3Url(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('.amazonaws.com/');
}

/**
 * Extract the S3 object key from a full S3 URL.
 * Some stored URLs are multiply percent-encoded; decoding repeatedly yields the
 * real key that matches the object in the bucket. Signing with a key that still
 * contains literal %20 makes the SDK emit %2520 in the presigned path → NoSuchKey.
 */
function extractKey(url) {
  try {
    let path = new URL(url).pathname.replace(/^\//, '');
    let prev = null;
    for (let i = 0; i < 8 && path !== prev; i++) {
      prev = path;
      try {
        path = decodeURIComponent(path);
      } catch {
        break;
      }
    }
    return path;
  } catch {
    return null;
  }
}

/**
 * If S3_USE_SIGNED_URLS=true and the URL is an S3 URL, returns a presigned URL.
 * Otherwise returns the original URL unchanged.
 */
async function presignS3Url(url) {
  if (!USE_SIGNED || !isS3Url(url)) return url;
  const key = extractKey(url);
  if (!key) return url;
  try {
    const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key });
    return await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN });
  } catch (err) {
    console.error('[presign] Failed to sign URL:', url, err.message);
    return url; // fall back to original — still may get 403 but won't crash
  }
}

/**
 * Sign using the exact S3 object key (e.g. multer-s3 `file.key`), avoiding URL parse bugs.
 * Prefer this when both key and location URL are available (class resources, deletes, etc.).
 */
async function presignS3ObjectKey(key) {
  if (!USE_SIGNED || !key || typeof key !== 'string') return null;
  const clean = key.replace(/^\//, '').trim();
  if (!clean) return null;
  try {
    const command = new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: clean });
    return await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN });
  } catch (err) {
    console.error('[presign] Failed to sign object key:', clean, err.message);
    return null;
  }
}

/**
 * Presign for rows that store both canonical `fileName` (S3 key) and `fileUrl` (https location).
 */
async function presignStoredS3Url(fileName, fileUrl) {
  if (!USE_SIGNED || !fileUrl) return fileUrl;
  const signed = await presignS3ObjectKey(fileName);
  if (signed) return signed;
  return presignS3Url(fileUrl);
}

/** RFC 6266-style Content-Disposition for S3 GetObject (triggers browser download). */
function attachmentContentDisposition(filename) {
  const base = String(filename || 'download').replace(/["\r\n]/g, '_');
  const star = encodeURIComponent(base);
  return `attachment; filename="${base}"; filename*=UTF-8''${star}`;
}

/**
 * Presigned URL that includes ResponseContentDisposition=attachment so the browser saves the file
 * instead of opening it (avoids relying on cross-origin fetch + blob, which S3 often blocks via CORS).
 */
async function presignS3DownloadUrl(fileName, fileUrl, originalName) {
  const disp = attachmentContentDisposition(originalName);
  if (!USE_SIGNED) {
    return fileUrl || null;
  }
  const clean = fileName && String(fileName).replace(/^\//, '').trim();
  if (clean) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: clean,
        ResponseContentDisposition: disp
      });
      return await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN });
    } catch (err) {
      console.error('[presign] presignS3DownloadUrl (key) failed:', clean, err.message);
    }
  }
  if (!fileUrl) return null;
  const key = extractKey(fileUrl);
  if (!key) return null;
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: disp
    });
    return await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN });
  } catch (err) {
    console.error('[presign] presignS3DownloadUrl (url) failed:', err.message);
    return null;
  }
}

/**
 * Presigned URL with inline disposition for browser preview/iframe usage.
 * This helps avoid forced downloads when object metadata contains attachment disposition.
 */
async function presignS3InlineUrl(fileName, fileUrl, originalName) {
  const base = String(originalName || 'preview').replace(/["\r\n]/g, '_');
  const star = encodeURIComponent(base);
  const disp = `inline; filename="${base}"; filename*=UTF-8''${star}`;

  if (!USE_SIGNED) {
    return fileUrl || null;
  }

  const clean = fileName && String(fileName).replace(/^\//, '').trim();
  if (clean) {
    try {
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: clean,
        ResponseContentDisposition: disp
      });
      return await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN });
    } catch (err) {
      console.error('[presign] presignS3InlineUrl (key) failed:', clean, err.message);
    }
  }

  if (!fileUrl) return null;
  const key = extractKey(fileUrl);
  if (!key) return null;
  try {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: disp
    });
    return await getSignedUrl(s3Client, command, { expiresIn: EXPIRES_IN });
  } catch (err) {
    console.error('[presign] presignS3InlineUrl (url) failed:', err.message);
    return null;
  }
}

/**
 * Walk all media URL fields in a plain exercise object and replace S3 URLs
 * with presigned versions.  Mutates in place (safe since callers use .lean()).
 */
async function resignExercise(exercise) {
  if (!USE_SIGNED || !exercise) return exercise;

  if (isS3Url(exercise.sharedAudioUrl)) {
    exercise.sharedAudioUrl = await presignS3Url(exercise.sharedAudioUrl);
  }

  for (const list of [exercise.videoSuccessFeedback, exercise.videoRetryFeedback]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (isS3Url(item.audioUrl)) item.audioUrl = await presignS3Url(item.audioUrl);
    }
  }

  if (Array.isArray(exercise.questions)) {
    for (const q of exercise.questions) {
      if (isS3Url(q.audioUrl))  q.audioUrl  = await presignS3Url(q.audioUrl);
      if (isS3Url(q.mediaUrl))  q.mediaUrl  = await presignS3Url(q.mediaUrl);
      if (isS3Url(q.videoUrl))  q.videoUrl  = await presignS3Url(q.videoUrl);
      if (isS3Url(q.imageUrl))  q.imageUrl  = await presignS3Url(q.imageUrl);
      if (isS3Url(q.attachmentUrl)) q.attachmentUrl = await presignS3Url(q.attachmentUrl);
    }
  }

  return exercise;
}

/**
 * Resign all exercises in an array (e.g. browse / admin list responses).
 * Runs all presign calls in parallel per exercise for speed.
 */
async function resignExercises(exercises) {
  if (!USE_SIGNED || !Array.isArray(exercises)) return exercises;
  await Promise.all(exercises.map(ex => resignExercise(ex)));
  return exercises;
}

module.exports = {
  presignS3Url,
  presignS3ObjectKey,
  presignStoredS3Url,
  presignS3DownloadUrl,
  presignS3InlineUrl,
  resignExercise,
  resignExercises,
  isS3Url,
  USE_SIGNED
};
