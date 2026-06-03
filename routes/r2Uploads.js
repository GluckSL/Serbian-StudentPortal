const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { verifyToken, checkRole } = require('../middleware/auth');
const {
  isExerciseR2Configured,
  headExerciseMediaKey,
  extractMediaKeyFromUrl,
  publicUrlForKey,
} = require('../services/exerciseMediaR2');

const router = express.Router();

function sanitizeFilename(name) {
  return String(name || 'file.bin')
    .replace(/[^\w.\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

router.post(
  '/generate-upload-url',
  verifyToken,
  checkRole(['ADMIN', 'TEACHER', 'TEACHER_ADMIN']),
  async (req, res) => {
    try {
      const accountId = process.env.CF_ACCOUNT_ID;
      const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
      const accessKeyId = process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
      const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME;
      const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

      if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
        return res.status(500).json({
          error: 'R2 is not configured. Missing one or more required env vars.',
        });
      }

      const filename = sanitizeFilename(req.body?.filename);
      const contentType = String(req.body?.contentType || '').trim();
      if (!filename) return res.status(400).json({ error: 'filename is required' });
      if (!contentType) return res.status(400).json({ error: 'contentType is required' });

      const p = String(req.body?.prefix || 'listening-media').trim();
      const allowedPrefixes = [
        'listening-media',
        'exercise-attachments',
        'glueck-arena/game-audio',
        'glueck-arena/game-images',
        'glueck-arena/game-thumbnails',
      ];
      const prefix = allowedPrefixes.includes(p) ? p : 'listening-media';

      const key = `${prefix}/${Date.now()}-${filename}`;

      const client = new S3Client({
        region: 'auto',
        endpoint,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });
      const fileUrl = `${String(publicBaseUrl).replace(/\/+$/, '')}/${key}`;

      const uid = req.user?.id != null ? String(req.user.id) : 'unknown';
      const role = req.user?.role || '';
      console.log(
        '[R2 exercise audio] Presigned PUT issued user=%s role=%s key=%s contentType=%s publicUrl=%s (client will PUT next)',
        uid,
        role,
        key,
        contentType,
        fileUrl
      );

      return res.json({ uploadUrl, fileUrl });
    } catch (err) {
      console.error('R2 presign generation failed:', err);
      return res.status(500).json({ error: err.message || 'Failed to generate upload URL' });
    }
  }
);

/**
 * POST /api/r2/resolve-media-urls
 * For each stored URL, if the same object key exists in R2, return the canonical public URL.
 * Lets clients remap broken /uploads/… links after redeploys when objects still exist in R2.
 */
router.post('/resolve-media-urls', verifyToken, async (req, res) => {
  try {
    const urls = req.body?.urls;
    if (!Array.isArray(urls)) {
      return res.status(400).json({ error: 'urls array is required' });
    }
    if (!isExerciseR2Configured()) {
      return res.status(503).json({ error: 'Media recovery is not configured (R2).' });
    }

    const resolutions = [];
    const seen = new Set();
    for (const raw of urls) {
      const original = String(raw || '').trim();
      if (!original || seen.has(original)) continue;
      seen.add(original);

      const key = extractMediaKeyFromUrl(original);
      if (!key) {
        resolutions.push({ original, url: original, found: false });
        continue;
      }
      const exists = await headExerciseMediaKey(key);
      const canonical = publicUrlForKey(key);
      resolutions.push({
        original,
        url: exists && canonical ? canonical : original,
        found: Boolean(exists && canonical),
      });
    }

    return res.json({ resolutions });
  } catch (err) {
    console.error('R2 resolve-media-urls failed:', err);
    return res.status(500).json({ error: err.message || 'Resolve failed' });
  }
});

module.exports = router;
