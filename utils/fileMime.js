const path = require('path');

/** Extension → MIME for common class resource uploads (Office, archives, media). */
const EXT_TO_MIME = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
};

/** MIME substrings / prefixes safe to open inline in a browser tab. */
const PREVIEWABLE_PREFIXES = ['image/', 'audio/', 'video/'];
const PREVIEWABLE_EXACT = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/html',
]);

function extFromName(originalName) {
  if (!originalName || typeof originalName !== 'string') return '';
  return path.extname(originalName).toLowerCase();
}

/**
 * Best Content-Type for S3 GetObject overrides and uploads.
 * Prefer stored mimeType when sensible; fall back to extension map.
 */
function resolveContentType(originalName, mimeType) {
  const ext = extFromName(originalName);
  const fromExt = ext ? EXT_TO_MIME[ext] : null;
  const stored = mimeType && typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';

  if (!stored) return fromExt || 'application/octet-stream';

  // Wrong types that cause browsers to render Office/ZIP internals as XML.
  if (
    stored === 'application/xml' ||
    stored === 'text/xml' ||
    stored === 'application/x-zip-compressed' ||
    stored === 'application/x-zip'
  ) {
    return fromExt || stored;
  }

  if (stored === 'application/octet-stream' || stored === 'binary/octet-stream') {
    return fromExt || stored;
  }

  return stored;
}

/** True when the browser can reasonably preview the file inline (PDF, images, text, media). */
function isBrowserPreviewable(originalName, mimeType) {
  const type = resolveContentType(originalName, mimeType).toLowerCase();
  if (PREVIEWABLE_EXACT.has(type)) return true;
  return PREVIEWABLE_PREFIXES.some((p) => type.startsWith(p));
}

module.exports = {
  EXT_TO_MIME,
  resolveContentType,
  isBrowserPreviewable,
};
