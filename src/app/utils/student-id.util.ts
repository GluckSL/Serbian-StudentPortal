/** Valid MongoDB ObjectId string (24 hex chars). Rejects literal "null" / "undefined". */
export function normalizeStudentObjectId(raw: unknown): string {
  if (raw == null) return '';
  const id = String(raw).trim();
  if (!id || id === 'null' || id === 'undefined') return '';
  if (!/^[a-fA-F0-9]{24}$/.test(id)) return '';
  return id;
}

export function studentIdFromRef(ref: unknown): string {
  if (ref == null) return '';
  if (typeof ref === 'object') {
    const o = ref as Record<string, unknown>;
    return normalizeStudentObjectId(o['_id'] ?? o['id']);
  }
  return normalizeStudentObjectId(ref);
}
