/**
 * Zoom API expects start_time as local wall-clock for the meeting timezone (not UTC ISO).
 */

function formatZoomLocalStartTime(dateInput, timezone = 'Asia/Kolkata') {
  const startDate = new Date(dateInput);
  if (Number.isNaN(startDate.getTime())) return null;
  const localParts = startDate
    .toLocaleString('sr-Latn-RS', { timeZone: timezone, hour12: false })
    .replace(',', '')
    .split(' ');
  return `${localParts[0]}T${(localParts[1] || '00:00:00').slice(0, 5)}`;
}

/**
 * Normalize portal slot strings (YYYY-MM-DDTHH:mm) or Date values for Zoom create/update.
 */
function normalizeZoomStartTime(startTime, timezone = 'Asia/Kolkata') {
  if (startTime == null || startTime === '') return null;
  const s = String(startTime).trim();
  if (s.length >= 16 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return s.substring(0, 16);
  }
  return formatZoomLocalStartTime(new Date(s), timezone);
}

/** Parse YYYY-MM-DDTHH:mm as IST wall clock. */
function parseIstSlotStartTime(slotStartTime) {
  const pad = String(slotStartTime || '').trim().substring(0, 16);
  if (pad.length < 16) return null;
  const d = new Date(`${pad}:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

module.exports = {
  formatZoomLocalStartTime,
  normalizeZoomStartTime,
  parseIstSlotStartTime,
};
