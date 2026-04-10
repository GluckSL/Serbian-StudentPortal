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

/** Extract the S3 object key from a full S3 URL. */
function extractKey(url) {
  try {
    return new URL(url).pathname.replace(/^\//, '');
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

module.exports = { presignS3Url, resignExercise, resignExercises, isS3Url, USE_SIGNED };
