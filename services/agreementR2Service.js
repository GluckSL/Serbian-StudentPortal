// Cloudflare R2 storage for agreement template PDFs.
// Uses the same R2 credentials as the exercise media bucket.
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand
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

async function putAgreementDocx(buffer, templateId) {
  const cfg = getR2Config();
  if (!cfg) throw new Error('R2 is not configured for agreement templates');
  const key = `agreements/templates/${templateId}/source.docx`;
  await cfg.client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    Body: buffer,
    ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }));
  return key;
}

async function getAgreementDocxBuffer(r2Key) {
  const cfg = getR2Config();
  if (!cfg) throw new Error('R2 is not configured');
  const resp = await cfg.client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: r2Key }));
  const chunks = [];
  for await (const chunk of resp.Body) chunks.push(chunk);
  return Buffer.concat(chunks);
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

async function deleteAgreementObject(r2Key) {
  if (!r2Key) return;
  const cfg = getR2Config();
  if (!cfg) throw new Error('R2 is not configured');
  await cfg.client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: r2Key }));
}

/** Server-side copy within the same bucket (avoids download + re-upload on template create). */
async function copyAgreementObject(sourceKey, destKey) {
  const cfg = getR2Config();
  if (!cfg) throw new Error('R2 is not configured');
  await cfg.client.send(
    new CopyObjectCommand({
      Bucket: cfg.bucket,
      Key: destKey,
      CopySource: `${cfg.bucket}/${sourceKey}`
    })
  );
  return destKey;
}

/** Remove PDF + DOCX sources for a template (best-effort). */
async function deleteAgreementTemplateFiles(template) {
  const errors = [];
  const keys = new Set();
  if (template?.r2Key) keys.add(template.r2Key);
  if (template?.docxR2Key) keys.add(template.docxR2Key);
  const id = template?._id?.toString?.() || template?.id;
  if (id) {
    keys.add(`agreements/templates/${id}/source.pdf`);
    keys.add(`agreements/templates/${id}/source.docx`);
  }
  for (const key of keys) {
    try {
      await deleteAgreementObject(key);
    } catch (e) {
      errors.push(`${key}: ${e.message}`);
    }
  }
  return { deleted: keys.size, errors };
}

module.exports = {
  isAgreementR2Configured,
  putAgreementTemplate,
  putAgreementDocx,
  getAgreementTemplateBuffer,
  getAgreementDocxBuffer,
  getAgreementTemplateSignedUrl,
  copyAgreementObject,
  deleteAgreementTemplate: deleteAgreementObject,
  deleteAgreementTemplateFiles
};
