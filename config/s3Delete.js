// config/s3Delete.js
// Helper to delete a file from S3 given its full S3 URL or S3 key

const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const s3Client = require('./s3');

/**
 * Deletes an object from S3.
 * @param {string} fileUrlOrKey - Full S3 URL (https://bucket.s3.region.amazonaws.com/key)
 *                                or just the S3 key (uploads/profile-photos/...)
 */
async function deleteFromS3(fileUrlOrKey) {
  if (!fileUrlOrKey) return;

  try {
    let key = fileUrlOrKey;

    // If a full URL is provided, extract the key portion
    if (fileUrlOrKey.startsWith('http')) {
      const url = new URL(fileUrlOrKey);
      // pathname starts with '/', strip the leading slash
      key = url.pathname.replace(/^\//, '');
    }

    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
      console.warn('[s3Delete] S3_BUCKET env var not set — skipping delete');
      return;
    }

    await s3Client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key })
    );

    console.log(`[s3Delete] Deleted s3://${bucket}/${key}`);
  } catch (err) {
    console.error('[s3Delete] Failed to delete from S3:', err.message);
  }
}

module.exports = deleteFromS3;
