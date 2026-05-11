// utils/zoomJoinUrls.js — Zoom app deep-link, universal link, and web client (wc) URLs

/**
 * Native Zoom app URI (confno + pwd only; display name is applied via web client).
 * @param {string} zoomNumericId
 * @param {string} [password]
 * @returns {string}
 */
function buildZoomAppUrl(zoomNumericId, password) {
  let url = `zoommtg://zoom.us/join?action=join&confno=${encodeURIComponent(zoomNumericId)}`;
  if (password) url += `&pwd=${encodeURIComponent(password)}`;
  return url;
}

/**
 * Universal link (opens Zoom app when installed).
 * @param {string} zoomNumericId
 * @param {string} [password]
 * @returns {string}
 */
function buildZoomUniversalUrl(zoomNumericId, password) {
  const id = encodeURIComponent(zoomNumericId);
  if (password) {
    return `https://zoom.us/j/${id}?pwd=${encodeURIComponent(password)}`;
  }
  return `https://zoom.us/j/${id}`;
}

/**
 * Web client join URL with display name + password.
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

module.exports = { buildZoomAppUrl, buildZoomUniversalUrl, buildZoomWebUrl };
