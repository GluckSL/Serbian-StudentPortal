'use strict';

/**
 * Recover exercise media URLs from Cloudflare R2 or AWS S3 when MongoDB still has
 * a path/URL but links are broken (expired presign, /uploads/… after redeploy, etc.).
 * Does not delete or move objects — only repairs stored URL strings.
 */

const { HeadObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('../config/s3');
const { canonicalizeMediaUrl, isS3Url, extractKey } = require('../config/presign');
const {
  isExerciseR2Configured,
  headExerciseMediaKey,
  extractMediaKeyFromUrl,
  publicUrlForKey,
} = require('../services/exerciseMediaR2');

const MEDIA_SCALAR_FIELDS = ['imageUrl', 'attachmentUrl', 'mediaUrl', 'videoUrl', 'audioUrl'];

function collectMediaUrlsFromQuestion(q, out) {
  if (!q || typeof q !== 'object') return;
  for (const field of MEDIA_SCALAR_FIELDS) {
    const v = String(q[field] ?? '').trim();
    if (v) out.push({ container: q, field, value: v });
  }
  if (Array.isArray(q.optionImageUrls)) {
    q.optionImageUrls.forEach((u, oi) => {
      const v = String(u ?? '').trim();
      if (v) out.push({ container: q, field: 'optionImageUrls', index: oi, value: v });
    });
  }
  if (Array.isArray(q.subQuestions)) {
    for (const sq of q.subQuestions) collectMediaUrlsFromQuestion(sq, out);
  }
}

function collectAllMediaRefs(exercise) {
  const refs = [];
  if (!exercise || typeof exercise !== 'object') return refs;
  if (String(exercise.sharedAudioUrl || '').trim()) {
    refs.push({ container: exercise, field: 'sharedAudioUrl', value: String(exercise.sharedAudioUrl).trim() });
  }
  for (const listKey of ['videoSuccessFeedback', 'videoRetryFeedback']) {
    const list = exercise[listKey];
    if (!Array.isArray(list)) continue;
    list.forEach((row, i) => {
      const v = String(row?.audioUrl ?? '').trim();
      if (v) refs.push({ container: list, field: `${listKey}:${i}:audioUrl`, index: i, value: v, listKey });
    });
  }
  if (Array.isArray(exercise.questions)) {
    for (const q of exercise.questions) collectMediaUrlsFromQuestion(q, refs);
  }
  return refs;
}

function candidateKeysForPath(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const keys = new Set();
  const add = (k) => {
    const c = String(k || '').replace(/^\/+/, '');
    if (c) keys.add(c);
  };
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      add(new URL(s).pathname.replace(/^\//, ''));
    } catch {
      /* ignore */
    }
  }
  add(s);
  const r2Key = extractMediaKeyFromUrl(s);
  if (r2Key) add(r2Key);
  if (s.includes('uploads/')) {
    const idx = s.toLowerCase().indexOf('uploads/');
    add(s.slice(idx));
    add(s.slice(idx).replace(/^uploads\//, ''));
  }
  const prefix = process.env.S3_PREFIX || 'uploads';
  for (const k of [...keys]) {
    if (!k.startsWith(prefix + '/') && k.includes('exercise-attachments/')) {
      add(`${prefix}/${k}`);
    }
  }
  return [...keys];
}

async function headS3Key(key) {
  const bucket = process.env.S3_BUCKET;
  if (!bucket || !key) return false;
  try {
    await s3Client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: String(key).replace(/^\/+/, '') })
    );
    return true;
  } catch {
    return false;
  }
}

function s3PublicUrlForKey(key) {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.AWS_REGION || 'us-east-1';
  if (!bucket || !key) return null;
  const clean = String(key).replace(/^\/+/, '');
  return `https://${bucket}.s3.${region}.amazonaws.com/${clean}`;
}

/**
 * Resolve one stored URL to a working canonical URL if the object exists in R2 or S3.
 */
async function resolveStoredMediaUrl(raw) {
  const original = String(raw || '').trim();
  if (!original) {
    return { original, url: '', found: false, storage: null };
  }

  const canonical = canonicalizeMediaUrl(original);
  const tryKeys = new Set([
    ...candidateKeysForPath(original),
    ...candidateKeysForPath(canonical),
  ]);
  if (isS3Url(canonical)) {
    const k = extractKey(canonical);
    if (k) tryKeys.add(k);
  }

  if (isExerciseR2Configured()) {
    for (const key of tryKeys) {
      const r2Key = extractMediaKeyFromUrl(key) || key;
      if (r2Key && (await headExerciseMediaKey(r2Key))) {
        const publicUrl = publicUrlForKey(r2Key);
        if (publicUrl) {
          return { original, url: publicUrl, found: true, storage: 'r2' };
        }
      }
    }
  }

  for (const key of tryKeys) {
    if (await headS3Key(key)) {
      const url = isS3Url(canonical) ? canonical : s3PublicUrlForKey(key);
      return { original, url: url || canonical, found: true, storage: 's3' };
    }
  }

  return { original, url: canonical || original, found: false, storage: null };
}

function applyRefToContainer(ref, newUrl) {
  const { container, field, index, listKey } = ref;
  if (listKey && field.includes(':audioUrl')) {
    if (container[index]) container[index].audioUrl = newUrl;
    return;
  }
  if (field === 'optionImageUrls' && typeof index === 'number') {
    if (!Array.isArray(container.optionImageUrls)) container.optionImageUrls = [];
    container.optionImageUrls[index] = newUrl;
    return;
  }
  container[field] = newUrl;
}

/**
 * Walk exercise document, repair media URLs in place, return summary.
 * @param {object} exercise Mongoose doc or plain object with questions[]
 */
async function recoverExerciseMedia(exercise) {
  const refs = collectAllMediaRefs(exercise);
  const seen = new Set();
  const resolutions = [];
  let updatedCount = 0;

  for (const ref of refs) {
    const raw = ref.value;
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);

    const result = await resolveStoredMediaUrl(raw);
    resolutions.push({
      field: ref.field,
      index: ref.index,
      original: result.original,
      url: result.url,
      found: result.found,
      storage: result.storage,
    });

    if (result.found && result.url && result.url !== raw) {
      applyRefToContainer(ref, result.url);
      updatedCount += 1;
    } else if (result.found && result.url === raw && raw.includes('X-Amz-')) {
      applyRefToContainer(ref, canonicalizeMediaUrl(raw));
      updatedCount += 1;
    }
  }

  const missing = resolutions.filter((r) => !r.found && r.original);
  return { updatedCount, resolutions, missing };
}

module.exports = {
  recoverExerciseMedia,
  resolveStoredMediaUrl,
  collectAllMediaRefs,
};
