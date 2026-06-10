/** Question row fields that store per-question attachments (legacy + multi). */
export type QuestionAttachmentRow = {
  attachmentUrl?: string | null;
  attachmentUrls?: string[] | null;
};

/** All attachment URLs for a question (prefers attachmentUrls, falls back to legacy attachmentUrl). */
export function getQuestionAttachmentUrls(row: QuestionAttachmentRow | null | undefined): string[] {
  const fromArray = (row?.attachmentUrls || [])
    .map((u) => String(u || '').trim())
    .filter(Boolean);
  if (fromArray.length) return [...new Set(fromArray)];
  const legacy = String(row?.attachmentUrl || '').trim();
  return legacy ? [legacy] : [];
}

/** Sync attachmentUrl (first item) and attachmentUrls on a question row. */
export function setQuestionAttachmentUrls(
  row: QuestionAttachmentRow,
  urls: string[]
): void {
  const cleaned = urls.map((u) => String(u || '').trim()).filter(Boolean);
  row.attachmentUrls = cleaned;
  row.attachmentUrl = cleaned[0] || '';
}

/** Append a URL if not already present. */
export function appendQuestionAttachment(row: QuestionAttachmentRow, url: string): void {
  const u = String(url || '').trim();
  if (!u) return;
  const existing = getQuestionAttachmentUrls(row);
  if (!existing.includes(u)) existing.push(u);
  setQuestionAttachmentUrls(row, existing);
}

/** Remove attachment at index. */
export function removeQuestionAttachmentAt(row: QuestionAttachmentRow, index: number): void {
  const urls = getQuestionAttachmentUrls(row);
  if (index < 0 || index >= urls.length) return;
  urls.splice(index, 1);
  setQuestionAttachmentUrls(row, urls);
}
