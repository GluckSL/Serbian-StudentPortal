#!/usr/bin/env node
/**
 * Allow browser direct PUT uploads to S3 (teacher resources presign flow).
 * Run on the app server: node deploy/apply-s3-cors.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { S3Client, GetBucketCorsCommand, PutBucketCorsCommand } = require('@aws-sdk/client-s3');

const BUCKET = process.env.S3_BUCKET;
const REGION = process.env.AWS_REGION;

const REQUIRED_ORIGINS = [
  'https://gluckstudentsportal.com',
  'https://www.gluckstudentsportal.com',
  'http://localhost:4200',
];

const BROWSER_UPLOAD_RULE = {
  AllowedHeaders: ['*'],
  AllowedMethods: ['PUT', 'GET', 'HEAD', 'POST'],
  AllowedOrigins: REQUIRED_ORIGINS,
  ExposeHeaders: ['ETag', 'x-amz-request-id'],
  MaxAgeSeconds: 3600,
};

function ruleCoversBrowserUpload(rule) {
  if (!rule || !Array.isArray(rule.AllowedMethods) || !Array.isArray(rule.AllowedOrigins)) return false;
  if (!rule.AllowedMethods.includes('PUT')) return false;
  return REQUIRED_ORIGINS.every((origin) => rule.AllowedOrigins.includes(origin));
}

async function main() {
  if (!BUCKET || !REGION || !process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('Missing S3 env vars. Need AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, S3_BUCKET.');
    process.exit(1);
  }

  const client = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  let rules = [];
  try {
    const out = await client.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
    rules = out.CORSRules || [];
    console.log(`Current CORS rules on ${BUCKET}:`, rules.length);
  } catch (err) {
    if (err.name !== 'NoSuchCORSConfiguration') throw err;
    console.log(`No existing CORS on ${BUCKET}; creating one.`);
  }

  if (rules.some(ruleCoversBrowserUpload)) {
    console.log('S3 CORS already allows browser PUT from gluckstudentsportal.com. Nothing to do.');
    return;
  }

  rules.push(BROWSER_UPLOAD_RULE);
  await client.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: { CORSRules: rules },
    })
  );

  console.log(`Updated S3 CORS on bucket "${BUCKET}" (region ${REGION}).`);
  console.log('Allowed origins for PUT:', REQUIRED_ORIGINS.join(', '));
  console.log('Hard-refresh the portal and retry the upload.');
}

main().catch((err) => {
  console.error('Failed to apply S3 CORS:', err.message || err);
  process.exit(1);
});
