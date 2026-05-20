// Cloudflare R2 storage for agreement template PDFs.
// Uses the same R2 credentials as the exercise media bucket.
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

let _cfg;

function getR2Config() {
  if (_cfg !== undefined) return _cfg;
  const accountId = process.env.CF_ACCOUNT_ID;
  const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || process.env.CF_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || process.env.CF_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME;
  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    _cfg = null;
    return _cfg;
  }
  _cfg = {
    client: new S3Client({ region: 'auto', endpoint, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey } }),
    bucket
  };
  return _cfg;
}

function isAgreementR2Configured() {
  return !!getR2Config();
}

async function putAgreementTemplate(buffer, templateId) {
  const cfg = getR2Config();
  if (!cfg) throw new Error('R2 is not configured for agreement templates');
  const key = `agreements/templates/${templateId}/source.pdf`;
  await cfg.client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: buffer,
    ContentType: 'application/pdf'
  }));
  return key;
}

async function getAgreementTemplateBuffer(r2Key) {
  const cfg = getR2Config();
  if (!cfg) throw new Error('R2 is not configured');
  const resp = await cfg.client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: r2Key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function getAgreementTemplateSignedUrl(r2Key, expiresIn = 600) {
  const cfg = getR2Config();
  if (!cfg) throw new Error('R2 is not configured');
  const cmd = new GetObjectCommand({ Bucket: cfg.bucket, Key: r2Key });
  return getSignedUrl(cfg.client, cmd, { expiresIn });
}

async function deleteAgreementTemplate(r2Key) {
  const cfg = getR2Config();
  if (!cfg) throw new Error('R2 is not configured');
  await cfg.client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: r2Key }));
}

module.exports = {
  isAgreementR2Configured,
  putAgreementTemplate,
  getAgreementTemplateBuffer,
  getAgreementTemplateSignedUrl,
  deleteAgreementTemplate
};
