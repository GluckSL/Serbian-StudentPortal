'use strict';

/** All attachment URLs for a question (prefers attachmentUrls, falls back to legacy attachmentUrl). */
function getQuestionAttachmentUrls(row) {
  if (!row || typeof row !== 'object') return [];
  const fromArray = (Array.isArray(row.attachmentUrls) ? row.attachmentUrls : [])
    .map((u) => String(u || '').trim())
    .filter(Boolean);
  if (fromArray.length) return [...new Set(fromArray)];
  const legacy = String(row.attachmentUrl || '').trim();
  return legacy ? [legacy] : [];
}

function setQuestionAttachmentUrls(row, urls) {
  if (!row || typeof row !== 'object') return;
  const cleaned = (urls || []).map((u) => String(u || '').trim()).filter(Boolean);
  row.attachmentUrls = cleaned;
  row.attachmentUrl = cleaned[0] || '';
}

/** Keep attachmentUrl in sync when only attachmentUrls is present. */
function normalizeQuestionAttachmentFields(row) {
  if (!row || typeof row !== 'object') return;
  const urls = getQuestionAttachmentUrls(row);
  setQuestionAttachmentUrls(row, urls);
}

module.exports = {
  getQuestionAttachmentUrls,
  setQuestionAttachmentUrls,
  normalizeQuestionAttachmentFields,
};
