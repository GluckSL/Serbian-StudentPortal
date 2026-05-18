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
 * Strip presigned query params so only the stable object URL is stored in MongoDB.
 * Prevents expired signatures from breaking media after admin save/reload cycles.
 */
function canonicalizeS3Url(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!trimmed || !isS3Url(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    return `${u.origin}${u.pathname}`;
  } catch {
    return trimmed.split('?')[0];
  }
}

function canonicalizeMediaUrl(url) {
  if (!url || typeof url !== 'string') return url;
  return canonicalizeS3Url(url.trim());
}

function urlHasPresignedQuery(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  return s.includes('.amazonaws.com/') && (s.includes('X-Amz-') || s.includes('x-amz-'));
}

function questionHasPresignedMedia(q) {
  if (!q || typeof q !== 'object') return false;
  const fields = [q.audioUrl, q.mediaUrl, q.videoUrl, q.imageUrl, q.attachmentUrl];
  if (fields.some(urlHasPresignedQuery)) return true;
  if (Array.isArray(q.optionImageUrls) && q.optionImageUrls.some(urlHasPresignedQuery)) return true;
  if (Array.isArray(q.subQuestions)) {
    return q.subQuestions.some(questionHasPresignedMedia);
  }
  return false;
}

/** True when an exercise document still stores short-lived S3 presigned URLs. */
function exerciseHasPresignedMedia(exercise) {
  if (!exercise || typeof exercise !== 'object') return false;
  if (urlHasPresignedQuery(exercise.sharedAudioUrl)) return true;
  for (const list of [exercise.videoSuccessFeedback, exercise.videoRetryFeedback]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (urlHasPresignedQuery(item?.audioUrl)) return true;
    }
  }
  if (!Array.isArray(exercise.questions)) return false;
  return exercise.questions.some(questionHasPresignedMedia);
}

function canonicalizeQuestionMedia(q) {
  if (!q || typeof q !== 'object') return;
  if (q.audioUrl) q.audioUrl = canonicalizeMediaUrl(q.audioUrl);
  if (q.mediaUrl) q.mediaUrl = canonicalizeMediaUrl(q.mediaUrl);
  if (q.videoUrl) q.videoUrl = canonicalizeMediaUrl(q.videoUrl);
  if (q.imageUrl) q.imageUrl = canonicalizeMediaUrl(q.imageUrl);
  if (q.attachmentUrl) q.attachmentUrl = canonicalizeMediaUrl(q.attachmentUrl);
  if (Array.isArray(q.optionImageUrls)) {
    q.optionImageUrls = q.optionImageUrls.map((u) => canonicalizeMediaUrl(u));
  }
  if (Array.isArray(q.subQuestions)) {
    for (const sq of q.subQuestions) canonicalizeQuestionMedia(sq);
  }
}

/**
 * Normalize all media URL fields before persisting an exercise document.
 */
function canonicalizeExerciseForStorage(exercise) {
  if (!exercise || typeof exercise !== 'object') return exercise;
  if (exercise.sharedAudioUrl) {
    exercise.sharedAudioUrl = canonicalizeMediaUrl(exercise.sharedAudioUrl);
  }
  for (const list of [exercise.videoSuccessFeedback, exercise.videoRetryFeedback]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item?.audioUrl) item.audioUrl = canonicalizeMediaUrl(item.audioUrl);
    }
  }
  if (Array.isArray(exercise.questions)) {
    for (const q of exercise.questions) canonicalizeQuestionMedia(q);
  }
  return exercise;
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
      if (Array.isArray(q.optionImageUrls)) {
        for (let oi = 0; oi < q.optionImageUrls.length; oi++) {
          if (isS3Url(q.optionImageUrls[oi])) {
            q.optionImageUrls[oi] = await presignS3Url(q.optionImageUrls[oi]);
          }
        }
      }
      if (Array.isArray(q.subQuestions)) {
        for (const sq of q.subQuestions) {
          if (isS3Url(sq.audioUrl)) sq.audioUrl = await presignS3Url(sq.audioUrl);
          if (isS3Url(sq.mediaUrl)) sq.mediaUrl = await presignS3Url(sq.mediaUrl);
          if (isS3Url(sq.videoUrl)) sq.videoUrl = await presignS3Url(sq.videoUrl);
          if (isS3Url(sq.imageUrl)) sq.imageUrl = await presignS3Url(sq.imageUrl);
          if (isS3Url(sq.attachmentUrl)) sq.attachmentUrl = await presignS3Url(sq.attachmentUrl);
          if (Array.isArray(sq.optionImageUrls)) {
            for (let oi = 0; oi < sq.optionImageUrls.length; oi++) {
              if (isS3Url(sq.optionImageUrls[oi])) {
                sq.optionImageUrls[oi] = await presignS3Url(sq.optionImageUrls[oi]);
              }
            }
          }
        }
      }
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

const MEDIA_URL_FIELD_NAMES = new Set([
  'imageUrl',
  'thumbnailUrl',
  'introCardImageUrl',
  'studentCardImageUrl',
  'botCardImageUrl',
  'cardImageUrl',
  'attachmentUrl',
  'mediaUrl',
  'videoUrl',
  'audioUrl',
]);

/**
 * Presign known media URL fields on any plain object tree (Sprechen modules, game sets, etc.).
 */
async function resignMediaInObject(root) {
  if (!USE_SIGNED || !root) return root;

  const walk = async (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      await Promise.all(node.map((item) => walk(item)));
      return;
    }
    const entries = Object.entries(node);
    await Promise.all(
      entries.map(async ([key, val]) => {
        if (typeof val === 'string' && MEDIA_URL_FIELD_NAMES.has(key) && isS3Url(val)) {
          node[key] = await presignS3Url(val);
          return;
        }
        if (val && typeof val === 'object') {
          await walk(val);
        }
      })
    );
  };

  await walk(root);
  return root;
}

async function resignMediaInObjects(items) {
  if (!USE_SIGNED || !Array.isArray(items)) return items;
  await Promise.all(items.map((item) => resignMediaInObject(item)));
  return items;
}

/** Strip presign query params from known media URL fields before persisting to MongoDB. */
function canonicalizeMediaInObject(root) {
  if (!root || typeof root !== 'object') return root;

  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item));
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      if (typeof val === 'string' && MEDIA_URL_FIELD_NAMES.has(key)) {
        node[key] = canonicalizeMediaUrl(val);
      } else if (val && typeof val === 'object') {
        walk(val);
      }
    }
  };

  walk(root);
  return root;
}

module.exports = {
  presignS3Url,
  presignS3ObjectKey,
  presignStoredS3Url,
  presignS3DownloadUrl,
  presignS3InlineUrl,
  resignExercise,
  resignExercises,
  resignMediaInObject,
  resignMediaInObjects,
  canonicalizeMediaInObject,
  canonicalizeS3Url,
  canonicalizeMediaUrl,
  canonicalizeExerciseForStorage,
  exerciseHasPresignedMedia,
  isS3Url,
  USE_SIGNED
};
