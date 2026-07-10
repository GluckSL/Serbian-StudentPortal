const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { JWT } = require('google-auth-library');
const transporter = require('../config/emailConfig');

const TZ = 'Asia/Colombo';
const LOG = '[PendingTracker]';

function loadPrivateKey() {
  const keyPath = process.env.GOOGLE_PRIVATE_KEY_PATH;
  if (keyPath) {
    const resolved = path.resolve(keyPath);
    if (fs.existsSync(resolved)) return fs.readFileSync(resolved, 'utf8');
  }
  let key = process.env.GOOGLE_PRIVATE_KEY || '';
  key = key.replace(/\\n/g, '\n').trim();
  return key;
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = loadPrivateKey();
  const auth = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const res = await auth.getAccessToken();
  return res.token;
}

async function checkPendingItems() {
  const spreadsheetId = (process.env.GOOGLE_SPREADSHEET_ID_DAILY_TRACKER || '').trim();
  if (!spreadsheetId) return { skipped: true };

  const sheetName = encodeURIComponent('Daily');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const values = data.values || [];

  if (values.length < 1) throw new Error('Sheet is empty');
  if (values[0].length < 2) throw new Error('Sheet needs at least 2 columns');

  const headers = values[0];
  const lastColIdx = headers.length - 1;
  const lastCol = headers[lastColIdx];
  const dataRows = values.slice(1);

  const rows = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const label = row[0] || '(no label)';
    const val = row[lastColIdx];
    const strVal = String(val || '').trim().toLowerCase();
    const isPending = !strVal || strVal === 'pending';
    rows.push({ label, isPending });
  }

  const pendingCount = rows.filter(r => r.isPending).length;
  return { rows, pendingCount, lastCol, totalRows: rows.length };
}

function buildEmailHtml(rows, dateHeader, totalRows, pendingCount) {
  const today = new Date().toLocaleDateString('sr-Latn-RS', {
    timeZone: TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const isAllClear = pendingCount === 0;
  const statusColor = isAllClear ? '#28a745' : '#dc3545';
  const statusBg = isAllClear ? '#d4edda' : '#f8d7da';
  const statusIcon = isAllClear ? '✅' : '⚠️';
  const statusText = isAllClear
    ? 'All items are complete!'
    : `${pendingCount} item(s) still pending for ${dateHeader}`;

  const tableRows = rows
    .map(
      (r, i) => `
      <tr${i % 2 === 0 ? '' : ' style="background:#f8f9fa;"'}>
        <td style="padding:8px 14px; border:1px solid #dee2e6; text-align:center;">${i + 1}</td>
        <td style="padding:8px 14px; border:1px solid #dee2e6;">${r.label}</td>
        <td style="padding:8px 14px; border:1px solid #dee2e6; text-align:center;">
          ${r.isPending
            ? '<span style="background:#f8d7da; color:#dc3545; font-weight:700; padding:2px 10px; border-radius:10px; font-size:13px;">Pending</span>'
            : '<span style="background:#d4edda; color:#28a745; font-weight:700; padding:2px 10px; border-radius:10px; font-size:13px;">Completed</span>'}
        </td>
      </tr>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily Pending Tracker</title>
</head>
<body style="margin:0; padding:0; background:#f4f6fa; font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa; padding:32px 0;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0"
             style="background:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 4px 16px rgba(0,0,0,0.10);">
        <tr>
          <td style="background:linear-gradient(135deg,#2F4F8C,#1a73e8); padding:28px 32px; text-align:center;">
            <h1 style="margin:0; color:#fff; font-size:22px; letter-spacing:0.5px;">📋 Daily Pending Tracker</h1>
            <p style="margin:6px 0 0; color:#cce0ff; font-size:14px;">${today}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 18px; color:#444; font-size:15px;">
              Hi Team,<br /><br />
              Here is the daily status report for the <strong>Daily</strong> worksheet.
            </p>
            <div style="background:${statusBg}; color:${statusColor}; padding:12px 18px; border-radius:8px; font-size:16px; font-weight:600; margin-bottom:20px; text-align:center;">
              ${statusIcon} ${statusText}
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:20px;">
              <thead>
                <tr style="background:#2F4F8C;">
                  <th style="padding:10px 14px; color:#fff; text-align:center; border:1px solid #2F4F8C; width:50px;">#</th>
                  <th style="padding:10px 14px; color:#fff; text-align:left; border:1px solid #2F4F8C;">Task</th>
                  <th style="padding:10px 14px; color:#fff; text-align:center; border:1px solid #2F4F8C; width:140px;">Status for ${dateHeader}</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
            <p style="margin:0 0 6px; color:#666; font-size:13px;">
              <strong>${pendingCount}</strong> of <strong>${totalRows}</strong> row(s) are pending for <strong>${dateHeader}</strong>.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8f9fa; padding:16px 32px; text-align:center; border-top:1px solid #e9ecef;">
            <p style="margin:0; color:#aaa; font-size:12px;">
              This is an automated daily report from the Gluck Student Portal. Please do not reply to this email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function processPendingTracker() {
  try {
    const result = await checkPendingItems();

    if (result.skipped) {
      console.log(`${LOG} GOOGLE_SPREADSHEET_ID_DAILY_TRACKER not set — skipping`);
      return;
    }

    const { rows, pendingCount, lastCol, totalRows } = result;
    const recipientEmail = process.env.DAILY_TRACKER_RECIPIENT_EMAIL || 'prabhat@gluckglobal.com';

    const html = buildEmailHtml(rows, lastCol, totalRows, pendingCount);
    const today = new Date().toLocaleDateString('sr-Latn-RS', {
      timeZone: TZ,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const countLabel = pendingCount > 0 ? `⏳ ${pendingCount} Pending` : '✅ All Complete';

    await transporter.sendMail({
      from: `"Gluck Portal" <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: `📋 Daily Pending Tracker — ${today} (${countLabel})`,
      html,
    });

    console.log(`${LOG} Email sent to ${recipientEmail} — ${pendingCount} pending, ${totalRows} total rows`);
  } catch (err) {
    console.error(`${LOG} Failed:`, err.message);
  }
}

function schedulePendingTracker() {
  cron.schedule('0 19 * * *', () => {
    processPendingTracker().catch((err) =>
      console.error(`${LOG} ❌ Job error:`, err.message)
    );
  }, { timezone: TZ });
  console.log(`📅 ${LOG} Scheduled — runs at 7:00 PM Asia/Colombo daily`);
}

module.exports = { schedulePendingTracker, processPendingTracker };
