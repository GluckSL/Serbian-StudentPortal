/**
 * Renders Sales Dashboard data as a PNG (SVG → sharp) for Google Chat sharing.
 * Dimensions are 2× the base layout for readability in chat.
 */

const { putPaymentProof, isPaymentR2Configured } = require('../modules/payments-v2/backend/services/paymentProofR2Service');

let sharpModule = null;

function getSharp() {
  if (!sharpModule) {
    // Lazy-load so a sharp/Node mismatch does not crash the whole portal on startup.
    sharpModule = require('sharp');
  }
  return sharpModule;
}

const SCALE = 2;
const CARD_W = 360 * SCALE;
const CARD_GAP = 16 * SCALE;
const ROW_STEP = 34 * SCALE;
const HEADER_H = 56 * SCALE;
const BODY_PAD = 36 * SCALE;

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
    return `<text x="${14 * SCALE}" y="${102 * SCALE}" font-size="${22}" fill="#94a3b8" font-family="Segoe UI, Arial, sans-serif">${esc(emptyLabel)}</text>`;
  }
  return counsellors
    .map((c, i) => {
      const y = 92 * SCALE + i * ROW_STEP;
      return `
        <text x="${14 * SCALE}" y="${y}" font-size="${22}" font-weight="600" fill="#0f172a" font-family="Segoe UI, Arial, sans-serif">${esc(c.name)}</text>
        <text x="${14 * SCALE}" y="${y + 28}" font-size="${20}" fill="#64748b" font-family="Segoe UI, Arial, sans-serif">${esc(dayLabel(c.daysSince))} · ${esc(isoToDisplay(c.lastEnrollment))}</text>
      `;
    })
    .join('');
}

function cardBlock(x, y, title, count, headerColor, counsellors, bodyH) {
  const h = HEADER_H + bodyH;
  return `
    <g transform="translate(${x}, ${y})">
      <rect width="${CARD_W}" height="${h}" rx="${10 * SCALE}" fill="#ffffff" stroke="#e2e8f0"/>
      <rect width="${CARD_W}" height="${HEADER_H}" rx="${10 * SCALE}" fill="${headerColor}"/>
      <rect y="${46 * SCALE}" width="${CARD_W}" height="${10 * SCALE}" fill="${headerColor}"/>
      <text x="${14 * SCALE}" y="${34 * SCALE}" font-size="${24}" font-weight="700" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif">${esc(title)}</text>
      <text x="${320 * SCALE}" y="${36 * SCALE}" font-size="${52}" font-weight="800" fill="#ffffff" text-anchor="end" font-family="Segoe UI, Arial, sans-serif">${count}</text>
      <g transform="translate(0, ${HEADER_H})">
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

  const weekLabel = data.reportWindow?.reportText
    ? data.reportWindow.reportText.replace(/^Enrollment report from /, '')
    : '';

  const reportLine = data.reportWindow?.reportText || '';

  const maxRows = Math.max(data.green.length, data.yellow.length, data.red.length, 1);
  const bodyH = BODY_PAD * SCALE + maxRows * ROW_STEP;
  const cardTop = reportLine ? 102 * SCALE : 88 * SCALE;
  const width = CARD_W * 3 + CARD_GAP * 2 + 32 * SCALE;
  const height = cardTop + HEADER_H + bodyH + 24 * SCALE;

  const green = cardBlock(16 * SCALE, cardTop, 'Excellence In Action', data.green.length, '#16a34a', data.green, bodyH);
  const yellow = cardBlock(16 * SCALE + CARD_W + CARD_GAP, cardTop, 'Nurturing Required', data.yellow.length, '#d97706', data.yellow, bodyH);
  const red = cardBlock(16 * SCALE + (CARD_W + CARD_GAP) * 2, cardTop, 'Critical Engagement', data.red.length, '#dc2626', data.red, bodyH);

  const subtitle = weekLabel
    ? `${date} · ${weekLabel} · ${data.totals.enrollmentsScanned} enrollments · ${data.totals.counsellors} watched`
    : `${date} · ${data.totals.enrollmentsScanned} enrollments · ${data.totals.counsellors} watched`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${16 * SCALE}" y="${32 * SCALE}" font-size="${36}" font-weight="700" fill="#0f172a" font-family="Segoe UI, Arial, sans-serif">Counsellor Performance Dashboard</text>
  ${reportLine ? `<text x="${16 * SCALE}" y="${54 * SCALE}" font-size="${24}" font-weight="700" fill="#0f172a" font-family="Segoe UI, Arial, sans-serif">${esc(reportLine)}</text>` : ''}
  <text x="${16 * SCALE}" y="${reportLine ? 76 * SCALE : 54 * SCALE}" font-size="${22}" fill="#64748b" font-family="Segoe UI, Arial, sans-serif">${esc(subtitle)}</text>
  ${green}
  ${yellow}
  ${red}
</svg>`;
}

async function renderDashboardPng(data) {
  const svg = buildDashboardSvg(data);
  return getSharp()(Buffer.from(svg)).png().toBuffer();
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
