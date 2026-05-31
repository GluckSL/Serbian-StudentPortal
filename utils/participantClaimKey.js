// utils/participantClaimKey.js — stable key for Zoom participant deduping across one attendance run

function participantClaimKey(p) {
  if (!p) return 'null';
  const raw = p.id ?? p.userId ?? p.participantUserId;
  if (raw !== undefined && raw !== null && String(raw).length > 0) {
    return `z:${String(raw)}`;
  }
  const nm = String(p.name || '')
    .toLowerCase()
    .trim();
  let jt = '';
  try {
    if (p.joinTime != null) jt = String(new Date(p.joinTime).getTime());
  } catch {
    jt = '';
  }
  return `f:${nm}|${jt}`;
}

module.exports = { participantClaimKey };
