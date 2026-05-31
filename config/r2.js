// config/r2.js
// Cloudflare R2 S3-compatible client for storing class recordings

const { S3Client } = require('@aws-sdk/client-s3');

const endpoint = `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const accessKeyId =
  process.env.R2_ACCESS_KEY_ID ||
  process.env.CF_R2_ACCESS_KEY_ID ||
  process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey =
  process.env.R2_SECRET_ACCESS_KEY ||
  process.env.CF_R2_SECRET_ACCESS_KEY ||
  process.env.AWS_SECRET_ACCESS_KEY;

const clientConfig = {
  region: 'auto',
  endpoint,
};

const r2ConfigIssues = [];

// Only set explicit credentials when both values are present.
// Otherwise, let AWS SDK default provider chain resolve from environment/profile.
if (accessKeyId && secretAccessKey) {
  clientConfig.credentials = { accessKeyId, secretAccessKey };
} else {
  console.warn(
    '[R2] Missing explicit R2 credentials. ' +
    'Set R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY (or CF_R2_*).'
  );
  r2ConfigIssues.push('Missing credentials');
}

if (!process.env.CF_ACCOUNT_ID) {
  console.warn('[R2] CF_ACCOUNT_ID is missing. R2 endpoint may be invalid.');
  r2ConfigIssues.push('Missing CF_ACCOUNT_ID');
}

const r2Client = new S3Client(clientConfig);

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'class-recordings';

const R2_CONFIG_OK = r2ConfigIssues.length === 0;

module.exports = { r2Client, R2_BUCKET, R2_CONFIG_OK, r2ConfigIssues, endpoint };
