/**
 * Renders Sales Dashboard data as a PNG (SVG → resvg) for Google Chat sharing.
 * Layout: Name + Last/Risk only — no calendar dates (GChat requirement).
 */

const { Resvg } = require('@resvg/resvg-js');
const { putPaymentProof, isPaymentR2Configured } = require('../modules/payments-v2/backend/services/paymentProofR2Service');

const FONT = 'Arial, Helvetica, sans-serif';
const SCALE = 2;
const CARD_W = 380 * SCALE;
const CARD_GAP = 14 * SCALE;
const HEADER_H = 78 * SCALE;
const THEAD_H = 30 * SCALE;
const ROW_H = 38 * SCALE;
const BODY_PAD_BOTTOM = 8 * SCALE;
const COL1_W = CARD_W * 0.55;
const COL2_W = CARD_W - COL1_W;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function dayLabel(days, period) {
  if (days == null) return 'Inactive';
  if (days === 0) return period === 'morning' ? 'Yesterday' : 'Today';
  if (days === 1) return '1 Day Ago';
  return `${days} Days Ago`;
}

function isYesterdayHighlight(days, period) {
  return period === 'morning' && days === 0;
}

function truncateName(name, max = 28) {
  const s = String(name || '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function riskLabel(c, period) {
  if (c.daysSince != null) return dayLabel(c.daysSince, period);
  return c.riskType || 'No activity found';
}

function statusColor(cardType, c) {
  if (cardType === 'green') return '#15803d';
  if (cardType === 'yellow') return '#b45309';
  if (c.riskType === 'Delayed') return '#b45309';
  return '#dc2626';
}

function cardBodyHeight(counsellors) {
  if (!counsellors.length) return THEAD_H + 28 + BODY_PAD_BOTTOM;
  return THEAD_H + counsellors.length * ROW_H + BODY_PAD_BOTTOM;
}

function tableHead(midLabel) {
  const y = HEADER_H + 20;
  return `
    <rect x="0" y="${HEADER_H}" width="${CARD_W}" height="${THEAD_H}" fill="#f8fafc"/>
    <line x1="0" y1="${HEADER_H + THEAD_H}" x2="${CARD_W}" y2="${HEADER_H + THEAD_H}" stroke="#e2e8f0"/>
    <text x="${12 * SCALE}" y="${y}" font-size="${16}" font-weight="700" fill="#64748b" font-family="${FONT}">NAME</text>
    <text x="${COL1_W + 8}" y="${y}" font-size="${16}" font-weight="700" fill="#64748b" font-family="${FONT}">${esc(midLabel)}</text>
  `;
}

function tableRows(counsellors, cardType, period, emptyLabel) {
  if (!counsellors.length) {
    const y = HEADER_H + THEAD_H + 22;
    return `<text x="${12 * SCALE}" y="${y}" font-size="${18}" fill="#94a3b8" font-family="${FONT}">${esc(emptyLabel)}</text>`;
  }

  return counsellors
    .map((c, i) => {
      const rowTop = HEADER_H + THEAD_H + i * ROW_H;
      const textY = rowTop + 24;
      const lastText = cardType === 'red' ? riskLabel(c, period) : dayLabel(c.daysSince, period);
      const lastColor = statusColor(cardType, c);
      const highlight = cardType !== 'red' && isYesterdayHighlight(c.daysSince, period);
      const highlightBg = highlight
        ? `<rect x="${COL1_W + 4}" y="${rowTop + 6}" width="${COL2_W - 8}" height="${ROW_H - 10}" rx="6" fill="#fef9c3"/>`
        : '';
      const rowLine =
        i < counsellors.length - 1
          ? `<line x1="0" y1="${rowTop + ROW_H}" x2="${CARD_W}" y2="${rowTop + ROW_H}" stroke="#f1f5f9"/>`
          : '';

      return `
        ${rowLine}
        <text x="${12 * SCALE}" y="${textY}" font-size="${20}" font-weight="600" fill="#0f172a" font-family="${FONT}">${esc(truncateName(c.name))}</text>
        ${highlightBg}
        <text x="${COL1_W + 8}" y="${textY}" font-size="${highlight ? 19 : 18}" font-weight="${highlight ? 700 : 600}" fill="${highlight ? '#a16207' : lastColor}" font-family="${FONT}">${esc(lastText)}</text>
      `;
    })
    .join('');
}

function cardBlock(x, y, title, count, total, headerColor, counsellors, cardType, period, bodyH) {
  const h = HEADER_H + bodyH;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const barW = CARD_W - 28 * SCALE;
  const fillW = Math.max(0, (barW * pct) / 100);
  const midLabel = cardType === 'red' ? 'RISK' : 'LAST';

  return `
    <g transform="translate(${x}, ${y})">
      <rect width="${CARD_W}" height="${h}" rx="${10 * SCALE}" fill="#ffffff" stroke="#e2e8f0"/>
      <rect width="${CARD_W}" height="${HEADER_H}" rx="${10 * SCALE}" fill="${headerColor}"/>
      <rect y="${68 * SCALE}" width="${CARD_W}" height="${10 * SCALE}" fill="${headerColor}"/>
      <text x="${14 * SCALE}" y="${28 * SCALE}" font-size="${22}" font-weight="800" fill="#ffffff" font-family="${FONT}">${esc(title)}</text>
      <text x="${CARD_W - 14 * SCALE}" y="${30 * SCALE}" font-size="${44}" font-weight="800" fill="#ffffff" text-anchor="end" font-family="${FONT}">${count}</text>
      <rect x="${14 * SCALE}" y="${48 * SCALE}" width="${barW}" height="${8 * SCALE}" rx="999" fill="rgba(255,255,255,0.28)"/>
      <rect x="${14 * SCALE}" y="${48 * SCALE}" width="${fillW}" height="${8 * SCALE}" rx="999" fill="rgba(255,255,255,0.92)"/>
      ${tableHead(midLabel)}
      ${tableRows(counsellors, cardType, period, 'None in this bucket')}
    </g>
  `;
}

function buildDashboardSvg(data) {
  const period = data.reportWindow?.period === 'morning' ? 'morning' : 'evening';
  const total = data.totals?.counsellors || 10;

  const maxBodyH = Math.max(
    cardBodyHeight(data.green),
    cardBodyHeight(data.yellow),
    cardBodyHeight(data.red)
  );

  let topY = 32 * SCALE;
  const titleLine = `<text x="${16 * SCALE}" y="${topY}" font-size="${34}" font-weight="700" fill="#0f172a" font-family="${FONT}">Counsellor Performance Dashboard</text>`;
  topY += 28 * SCALE;

  const subtitle = `${data.totals.enrollmentsScanned} Enrollments This Week · ${total} watched`;
  const subtitleLine = `<text x="${16 * SCALE}" y="${topY}" font-size="${20}" fill="#64748b" font-family="${FONT}">${esc(subtitle)}</text>`;
  const cardTop = topY + 18 * SCALE;

  const width = CARD_W * 3 + CARD_GAP * 2 + 32 * SCALE;
  const height = cardTop + HEADER_H + maxBodyH + 16 * SCALE;

  const green = cardBlock(
    16 * SCALE, cardTop, 'Excellence In Action', data.green.length, total,
    '#16a34a', data.green, 'green', period, maxBodyH
  );
  const yellow = cardBlock(
    16 * SCALE + CARD_W + CARD_GAP, cardTop, 'Nurturing Required', data.yellow.length, total,
    '#d97706', data.yellow, 'yellow', period, maxBodyH
  );
  const red = cardBlock(
    16 * SCALE + (CARD_W + CARD_GAP) * 2, cardTop, 'Critical Engagement', data.red.length, total,
    '#dc2626', data.red, 'red', period, maxBodyH
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  ${titleLine}
  ${subtitleLine}
  ${green}
  ${yellow}
  ${red}
</svg>`;
}

async function renderDashboardPng(data) {
  const svg = buildDashboardSvg(data);
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'Arial',
    },
  });
  return Buffer.from(resvg.render().asPng());
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
