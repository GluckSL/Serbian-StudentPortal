// utils/zoomJoinUrls.js — Zoom app deep-link, universal link, and web client (wc) URLs

/**
 * Read `pwd` from a stored Zoom participant URL (fallback when `zoomPassword` was not saved on the meeting).
 * @param {string} [joinUrl]
 * @returns {string}
 */
function extractZoomPwdFromJoinUrl(joinUrl) {
  if (!joinUrl || typeof joinUrl !== 'string') return '';
  const s = joinUrl.trim();
  if (!s || !/[?&]pwd=/i.test(s)) return '';
  try {
    const href = /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/\//, '')}`;
    const pwd = new URL(href).searchParams.get('pwd');
    return pwd ? pwd.trim() : '';
  } catch {
    const m = s.match(/[?&]pwd=([^&#]+)/i);
    if (!m || !m[1]) return '';
    try {
      return decodeURIComponent(m[1]).trim();
    } catch {
      return m[1].trim();
    }
  }
}

/**
 * Resolve passcode/token for join URLs: DB field, then `pwd` on stored Zoom links.
 * @param {{ zoomPassword?: string, joinUrl?: string, link?: string }} doc
 * @returns {string}
 */
function resolveMeetingJoinPwd(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const stored = String(doc.zoomPassword || '').trim();
  if (stored) return stored;
  const fromJoin = extractZoomPwdFromJoinUrl(doc.joinUrl);
  if (fromJoin) return fromJoin;
  return extractZoomPwdFromJoinUrl(doc.link) || '';
}

/**
 * Native Zoom app deep link (meeting id + optional passcode + portal display name).
 * @param {string} zoomNumericId
 * @param {string} [password]
 * @param {string} [displayName] portal display name → Zoom `uname`
 * @returns {string}
 */
function buildZoomAppUrl(zoomNumericId, password, displayName) {
  let url = `zoommtg://zoom.us/join?action=join&confno=${encodeURIComponent(zoomNumericId)}`;
  if (password) url += `&pwd=${encodeURIComponent(password)}`;
  if (displayName) url += `&uname=${encodeURIComponent(displayName)}`;
  return url;
}

/**
 * Universal https link (hands off to the Zoom app when installed).
 * @param {string} zoomNumericId
 * @param {string} [password]
 * @param {string} [displayName] portal display name → Zoom `uname`
 * @returns {string}
 */
function buildZoomUniversalUrl(zoomNumericId, password, displayName) {
  const id = encodeURIComponent(zoomNumericId);
  const parts = [];
  if (password) parts.push(`pwd=${encodeURIComponent(password)}`);
  if (displayName) parts.push(`uname=${encodeURIComponent(displayName)}`);
  if (parts.length) return `https://zoom.us/j/${id}?${parts.join('&')}`;
  return `https://zoom.us/j/${id}`;
}

/**
 * Zoom web client URL (browser-only; kept for edge cases, not the primary student path).
 * @param {string} zoomNumericId
 * @param {string} [password]
 * @param {string} [displayName]
 * @returns {string}
 */
function buildZoomWebUrl(zoomNumericId, password, displayName) {
  let url = `https://zoom.us/wc/${encodeURIComponent(zoomNumericId)}/join`;
  if (displayName) url += `?uname=${encodeURIComponent(displayName)}`;
  if (password) url += `${displayName ? '&' : '?'}pwd=${encodeURIComponent(password)}`;
  return url;
}

module.exports = {
  buildZoomAppUrl,
  buildZoomUniversalUrl,
  buildZoomWebUrl,
  extractZoomPwdFromJoinUrl,
  resolveMeetingJoinPwd,
};
