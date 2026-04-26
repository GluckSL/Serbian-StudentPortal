const express = require('express');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { verifyToken, checkRole } = require('../middleware/auth');

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

      const key = `listening-media/${Date.now()}-${filename}`;

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

      return res.json({ uploadUrl, fileUrl });
    } catch (err) {
      console.error('R2 presign generation failed:', err);
      return res.status(500).json({ error: err.message || 'Failed to generate upload URL' });
    }
  }
);

module.exports = router;
