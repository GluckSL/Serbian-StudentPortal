/**
 * Sends the Sales Dashboard counsellor snapshot to the Google Chat space
 * configured via SalesChat env var.
 *
 * Uploads a PNG to R2 (public URL) and posts a card with the image.
 */

const axios = require('axios');
const { buildSalesDashboard } = require('./crmSalesDashboard');
const {
  renderDashboardPng,
  pngBufferFromBase64,
  uploadDashboardPng,
} = require('./crmSalesDashboardSnapshot');

const CHAT_WEBHOOK = (process.env.SalesChat || '').trim();

const REPORT_TZ = 'Asia/Colombo';

/** e.g. "2 July 2026" */
function formatChatDate(d) {
  return d.toLocaleDateString('en-GB', {
    timeZone: REPORT_TZ,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Enrollment report window: today − 7 days → today (Asia/Colombo). */
function buildEnrollmentReportText() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 7);
  return `Enrollment report from ${formatChatDate(start)} to ${formatChatDate(now)}`;
}

function buildChatPayload(_data, imageUrl) {
  const text = buildEnrollmentReportText();

  if (!imageUrl) {
    return { text };
  }

  return {
    text,
    cardsV2: [
      {
        cardId: 'sales-dashboard-snapshot',
        card: {
          sections: [
            {
              widgets: [
                {
                  image: {
                    imageUrl,
                    altText: 'Counsellor performance dashboard — tap to open full size',
                    onClick: {
                      openLink: {
                        url: imageUrl,
                        openAs: 'FULL_SIZE',
                      },
                    },
                  },
                },
                {
                  buttonList: {
                    buttons: [
                      {
                        text: 'View full image',
                        onClick: {
                          openLink: {
                            url: imageUrl,
                            openAs: 'FULL_SIZE',
                          },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

/**
 * Fetch fresh dashboard data, build/upload PNG, post to Google Chat.
 * @param {{ simple?: object, advanced?: object, imagePngBase64?: string }} [query]
 */
async function sendSalesDashboardToChat(query = {}) {
  if (!CHAT_WEBHOOK) {
    console.warn('[SalesChatNotify] SalesChat env var not set — skipping.');
    return { success: false, message: 'SalesChat webhook URL not configured.' };
  }

  const data = await buildSalesDashboard(query);

  let pngBuffer = null;
  if (query.imagePngBase64) {
    pngBuffer = pngBufferFromBase64(query.imagePngBase64);
  }
  if (!pngBuffer) {
    pngBuffer = await renderDashboardPng(data);
  }

  const { publicUrl } = await uploadDashboardPng(pngBuffer);
  const payload = buildChatPayload(data, publicUrl);

  await axios.post(CHAT_WEBHOOK, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  console.log(
    `[SalesChatNotify] Sent with image — Green: ${data.green.length}, Yellow: ${data.yellow.length}, Red: ${data.red.length}`
  );

  return {
    success: true,
    message: `Sent to Google Chat with snapshot (Green: ${data.green.length}, Yellow: ${data.yellow.length}, Red: ${data.red.length})`,
    imageUrl: publicUrl,
    totals: data.totals,
    generatedAt: data.generatedAt,
  };
}

module.exports = { sendSalesDashboardToChat };
