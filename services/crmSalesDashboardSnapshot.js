/**
 * Renders Sales Dashboard data as a PNG (SVG → sharp) for Google Chat sharing.
 */

const sharp = require('sharp');
const { putPaymentProof, isPaymentR2Configured } = require('../modules/payments-v2/backend/services/paymentProofR2Service');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dayLabel(days) {
  if (days == null) return 'Inactive';
  if (days === 0) return 'Today';
  if (days === 1) return '1 Day Ago';
  return `${days} Days Ago`;
}

function isoToDisplay(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function cardRows(counsellors, emptyLabel) {
  if (!counsellors.length) {
    return `<text x="14" y="118" font-size="11" fill="#94a3b8" font-family="Segoe UI, Arial, sans-serif">${esc(emptyLabel)}</text>`;
  }
  return counsellors
    .map((c, i) => {
      const y = 108 + i * 34;
      return `
        <text x="14" y="${y}" font-size="11" font-weight="600" fill="#0f172a" font-family="Segoe UI, Arial, sans-serif">${esc(c.name)}</text>
        <text x="14" y="${y + 14}" font-size="10" fill="#64748b" font-family="Segoe UI, Arial, sans-serif">${esc(dayLabel(c.daysSince))} · ${esc(isoToDisplay(c.lastEnrollment))}</text>
      `;
    })
    .join('');
}

function cardBlock(x, title, subtitle, count, headerColor, counsellors) {
  const rowH = Math.max(120, 96 + counsellors.length * 34);
  const h = 72 + rowH;
  return `
    <g transform="translate(${x}, 88)">
      <rect width="360" height="${h}" rx="10" fill="#ffffff" stroke="#e2e8f0"/>
      <rect width="360" height="72" rx="10" fill="${headerColor}"/>
      <rect y="62" width="360" height="10" fill="${headerColor}"/>
      <text x="14" y="28" font-size="12" font-weight="700" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif">${esc(title)}</text>
      <text x="14" y="46" font-size="10" fill="rgba(255,255,255,0.9)" font-family="Segoe UI, Arial, sans-serif">${esc(subtitle)}</text>
      <text x="320" y="44" font-size="26" font-weight="800" fill="#ffffff" text-anchor="end" font-family="Segoe UI, Arial, sans-serif">${count}</text>
      <g transform="translate(0, 72)">
        ${cardRows(counsellors, 'None in this bucket')}
      </g>
    </g>
  `;
}

function buildDashboardSvg(data) {
  const date = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Colombo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const maxRows = Math.max(data.green.length, data.yellow.length, data.red.length, 1);
  const bodyH = 96 + maxRows * 34;
  const height = 88 + 72 + bodyH + 24;

  const green = cardBlock(16, 'Excellence In Action', 'Last 3 days (8→6 Jul)', data.green.length, '#16a34a', data.green);
  const yellow = cardBlock(392, 'Nurturing Required', 'Next 3 days (5→3 Jul)', data.yellow.length, '#d97706', data.yellow);
  const red = cardBlock(768, 'Critical Engagement', 'Older / none (≤2 Jul)', data.red.length, '#dc2626', data.red);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1144" height="${height}" viewBox="0 0 1144 ${height}">
  <rect width="1144" height="${height}" fill="#ffffff"/>
  <text x="16" y="32" font-size="18" font-weight="700" fill="#0f172a" font-family="Segoe UI, Arial, sans-serif">Counsellor Performance Dashboard</text>
  <text x="16" y="54" font-size="12" fill="#64748b" font-family="Segoe UI, Arial, sans-serif">${esc(date)} · ${data.totals.enrollmentsScanned} enrollments · ${data.totals.counsellors} watched</text>
  ${green}
  ${yellow}
  ${red}
</svg>`;
}

async function renderDashboardPng(data) {
  const svg = buildDashboardSvg(data);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function pngBufferFromBase64(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const b64 = raw.replace(/^data:image\/png;base64,/, '');
  if (!b64) return null;
  return Buffer.from(b64, 'base64');
}

async function uploadDashboardPng(buffer) {
  if (!isPaymentR2Configured()) {
    throw new Error('R2 is not configured — cannot upload dashboard image for Google Chat.');
  }
  const date = new Date().toISOString().slice(0, 10);
  const key = `sales-dashboard/${date}/counsellor-performance-${Date.now()}.png`;
  const { publicUrl, key: storedKey } = await putPaymentProof(buffer, key, 'image/png');
  if (!publicUrl) {
    throw new Error('R2_PUBLIC_BASE_URL is required so Google Chat can display the image.');
  }
  return { key: storedKey, publicUrl };
}

module.exports = {
  buildDashboardSvg,
  renderDashboardPng,
  pngBufferFromBase64,
  uploadDashboardPng,
};
