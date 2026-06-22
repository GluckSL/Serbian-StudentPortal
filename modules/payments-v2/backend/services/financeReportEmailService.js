/**
 * Finance Daily Report Email Service
 *
 * 10:00 AM IST — Morning Pending Report
 *   Current-level language fees for visible ONGOING batches (matches dashboard "Current Level").
 *
 * 06:00 PM IST — Evening Received Report
 *   Current-level language fees received today + remaining balance per visible batch.
 */

const mongoose = require('mongoose');
const nodemailer = require('nodemailer');
const FinanceDashboardSettings = require('../models/FinanceDashboardSettings');

// ─── Recipients ───────────────────────────────────────────────────────────────
const TO_ADDRESS = 'lawson@gluckglobal.com';
const BCC_ADDRESSES = 'ceo@gluckglobal.com,admissions@gluckglobal.com,sourav@gluckglobal.com';

// ─── Mailer ────────────────────────────────────────────────────────────────────
let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.EMAIL_HOST || process.env.SMTP_HOST;
  const user = process.env.EMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  _transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.EMAIL_PORT || process.env.SMTP_PORT) || 587,
    secure: (process.env.EMAIL_SECURE || process.env.SMTP_SECURE) === 'true',
    auth: { user, pass },
  });
  return _transporter;
}

async function sendReport({ subject, html }) {
  const t = getTransporter();
  const from = process.env.EMAIL_FROM || '"Gluck Global Finance" <no-reply@gluckglobal.com>';
  if (!t) {
    console.log(`[FinanceReport] ⚠️ No mailer configured. Subject: ${subject}`);
    console.log('[FinanceReport] HTML preview (first 400 chars):', html.slice(0, 400));
    return;
  }
  await t.sendMail({ from, to: TO_ADDRESS, bcc: BCC_ADDRESSES, subject, html });
  console.log(`[FinanceReport] ✅ Sent: ${subject}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (!n) return '0';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function todayIST() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  d.setHours(0, 0, 0, 0);
  return d;
}

function overdueDays(isoDate) {
  if (!isoDate) return null;
  const since = new Date(isoDate);
  const today = new Date();
  const ms = today - since;
  const days = Math.floor(ms / 86400000);
  return days >= 0 ? days : null;
}

function overdueDaysLabel(isoDate) {
  const d = overdueDays(isoDate);
  if (d == null) return '—';
  if (d === 0) return 'Today';
  return `${d} day${d === 1 ? '' : 's'}`;
}

// ─── Core: fetch per-batch data for visible batches ──────────────────────────
async function fetchVisibleBatchData() {
  const PaymentHubCatalog = require('../models/PaymentHubCatalog');
  const {
    aggregateBatchPaymentInsights,
    currentLevelTotalsForBatchRow,
  } = require('../helpers/paymentHubStatsAggregator');
  const { computeCommencementForBatch } = require('../helpers/financeCommencementHelper');

  const settings = await FinanceDashboardSettings.getOrCreate();
  const visibleBatches = (settings.visibleBatches || []).filter(Boolean);
  if (!visibleBatches.length) return [];

  const manualDates =
    settings.manualNextPaymentDates instanceof Map
      ? Object.fromEntries(settings.manualNextPaymentDates)
      : settings.manualNextPaymentDates || {};

  const [allData, catalog] = await Promise.all([
    aggregateBatchPaymentInsights({
      batches: visibleBatches,
      studentStatus: 'ONGOING',
    }),
    PaymentHubCatalog.getOrCreate(),
  ]);
  const batchRows = allData.batches || [];

  const visibleSet = new Set(visibleBatches.map((b) => String(b).toLowerCase()));
  const rows = batchRows.filter((r) => visibleSet.has(String(r.batch || '').toLowerCase()));

  return rows.map((r) => {
    const scoped = currentLevelTotalsForBatchRow(r);
    const scopedOverdueTotal = (scoped.overdueLKR || 0) + (scoped.overdueINR || 0) + (scoped.overdueUSD || 0);
    const scopedPendingTotal = (scoped.pendingLKR || 0) + (scoped.pendingINR || 0) + (scoped.pendingUSD || 0);
    const commencement = computeCommencementForBatch(r, catalog, manualDates[r.batch]);
    return {
      batch: r.batch,
      dominantLevel: scoped.dominantLevel,
      studentCount: r.studentCount || 0,
      balanceStudents: r.balanceStudents || 0,
      overdueStudents: r.overdueStudents || 0,
      pendingLKR: scoped.pendingLKR,
      pendingINR: scoped.pendingINR,
      receivedLKR: scoped.receivedLKR,
      receivedINR: scoped.receivedINR,
      expectedLKR: scoped.expectedLKR,
      expectedINR: scoped.expectedINR,
      overdueLKR: scoped.overdueLKR,
      overdueINR: scoped.overdueINR,
      overdueSince: scopedOverdueTotal > 0 || scopedPendingTotal > 0 ? (r.overdueSince || null) : null,
      commencement,
    };
  });
}

function formatCommencementCell(commencement) {
  if (!commencement) return '—';
  const near = commencement.isNear;
  const dateClass = near ? 'commence-near' : '';
  const amtClass = near ? 'commence-near' : 'amber';
  const parts = [`<span class="${dateClass}" style="font-weight:700">${commencement.dateStr}</span>`];
  const amounts = [];
  if (commencement.amountLKR > 0) amounts.push(`LKR ${fmtNum(commencement.amountLKR)}`);
  if (commencement.amountINR > 0) amounts.push(`INR ${fmtNum(commencement.amountINR)}`);
  if (amounts.length) {
    parts.push(`<span class="${amtClass}" style="font-size:12px">${amounts.join(' · ')}</span>`);
  }
  return parts.join('<br/>');
}

function commencementSummaryHtml(rows) {
  const upcoming = rows
    .filter((r) => r.commencement && !r.commencement.isPast)
    .sort((a, b) => (a.commencement.daysUntil ?? 999) - (b.commencement.daysUntil ?? 999));
  if (!upcoming.length) return '';

  const nearCount = upcoming.filter((r) => r.commencement.isNear).length;
  let listRows = '';
  for (const r of upcoming.slice(0, 12)) {
    const c = r.commencement;
    const rowStyle = c.isNear ? 'background:#fff1f2' : '';
    listRows += `
      <tr style="${rowStyle}">
        <td class="batch-name">${r.batch}</td>
        <td>${c.currentLevel || '—'} → ${c.nextLevel || '—'}</td>
        <td class="num ${c.isNear ? 'commence-near' : ''}">${c.dateStr}</td>
        <td class="num ${c.isNear ? 'commence-near' : 'amber'}">${c.amountLKR > 0 ? 'LKR ' + fmtNum(c.amountLKR) : '—'}</td>
        <td class="num ${c.isNear ? 'commence-near' : 'amber'}">${c.amountINR > 0 ? 'INR ' + fmtNum(c.amountINR) : '—'}</td>
        <td class="num">${r.studentCount}</td>
      </tr>`;
  }

  return `
    <h2>📅 Upcoming Level Commencements${nearCount ? ` <span style="color:#dc2626;font-size:13px">(${nearCount} within 5 days)</span>` : ''}</h2>
    <table>
      <thead>
        <tr>
          <th>Batch</th>
          <th>Level change</th>
          <th style="text-align:right">Commencement</th>
          <th style="text-align:right">Projected (LKR)</th>
          <th style="text-align:right">Projected (INR)</th>
          <th style="text-align:right">Students</th>
        </tr>
      </thead>
      <tbody>${listRows}</tbody>
    </table>`;
}

// ─── Approved today: per-batch breakdown (current-level language fees only) ───
async function fetchTodayReceivedByBatch() {
  const User = mongoose.model('User');
  const PaymentFlowSubmission = require('../models/PaymentSubmission');
  const PaymentRequest = require('../models/PaymentRequest');
  const { slotForRequest, normalizeLevel, LANGUAGE_LEVELS } = require('../utils/levelSlotHelper');

  const todayStart = todayIST();
  const tomorrowStart = new Date(todayStart.getTime() + 86400000);

  const approvedToday = await PaymentFlowSubmission.find({
    status: 'APPROVED',
    approvedAt: { $gte: todayStart, $lt: tomorrowStart },
    isArchived: { $ne: true },
  })
    .select('studentId paymentRequestId paidAmount currency approvedAt')
    .lean();

  if (!approvedToday.length) return {};

  const studentIds = [...new Set(approvedToday.map((s) => String(s.studentId)))];
  const requestIds = [...new Set(approvedToday.map((s) => String(s.paymentRequestId)).filter(Boolean))];

  const [students, requests] = await Promise.all([
    User.find({ _id: { $in: studentIds } })
      .select('batch level studentStatus')
      .lean(),
    PaymentRequest.find({ _id: { $in: requestIds } })
      .select('paymentType customType remarks')
      .lean(),
  ]);

  const batchByStudent = {};
  const levelByStudent = {};
  for (const s of students) {
    if (String(s.studentStatus || '').toUpperCase() !== 'ONGOING') continue;
    batchByStudent[String(s._id)] = s.batch || 'Unknown';
    levelByStudent[String(s._id)] = normalizeLevel(s.level);
  }

  const requestById = {};
  for (const req of requests) requestById[String(req._id)] = req;

  const byBatch = {};
  for (const sub of approvedToday) {
    const sid = String(sub.studentId);
    const batch = batchByStudent[sid];
    if (!batch) continue;

    const req = requestById[String(sub.paymentRequestId)];
    const studentLevel = levelByStudent[sid];
    const slot = slotForRequest(req, studentLevel);
    if (!slot || !LANGUAGE_LEVELS.includes(slot)) continue;
    if (studentLevel !== slot) continue;

    if (!byBatch[batch]) byBatch[batch] = { lkr: 0, inr: 0, usd: 0, count: 0 };
    const ccy = String(sub.currency || 'LKR').toUpperCase();
    if (ccy === 'INR') byBatch[batch].inr += sub.paidAmount || 0;
    else if (ccy === 'USD') byBatch[batch].usd += sub.paidAmount || 0;
    else byBatch[batch].lkr += sub.paidAmount || 0;
    byBatch[batch].count += 1;
  }
  return byBatch;
}

// ─── Shared email chrome ──────────────────────────────────────────────────────
function emailWrapper(title, badge, badgeColor, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6f9;margin:0;padding:0}
  .wrap{max-width:860px;margin:0 auto;padding:24px 16px}
  .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.07)}
  .header{background:linear-gradient(135deg,#03396c 0%,#005b96 100%);padding:28px 32px}
  .header h1{margin:0 0 6px;color:#fff;font-size:22px;font-weight:800}
  .header p{margin:0;color:rgba(255,255,255,.78);font-size:13px}
  .badge{display:inline-block;padding:4px 14px;border-radius:20px;font-size:11px;font-weight:800;
         text-transform:uppercase;letter-spacing:.06em;background:${badgeColor};color:#fff;margin-top:10px}
  .body{padding:28px 32px}
  h2{margin:0 0 14px;font-size:15px;font-weight:700;color:#03396c;border-left:4px solid #005b96;padding-left:12px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:28px}
  th{background:#03396c;color:#fff;padding:10px 12px;text-align:left;font-size:11px;
     text-transform:uppercase;letter-spacing:.05em;font-weight:700}
  td{padding:10px 12px;border-bottom:1px solid #f0f4f8;vertical-align:middle}
  tr:last-child td{border-bottom:none}
  tr:nth-child(even) td{background:#f8fafc}
  .num{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
  .batch-name{font-weight:700;color:#03396c}
  .overdue-hot{color:#dc2626;font-weight:700}
  .overdue-ok{color:#64748b}
  .green{color:#16a34a;font-weight:700}
  .amber{color:#d97706;font-weight:700}
  .commence-near{color:#dc2626;font-weight:800}
  .footer-note{font-size:11px;color:#94a3b8;margin-top:20px;text-align:center}
  .summary-row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}
  .stat-box{flex:1;min-width:140px;background:#f8fafc;border:1px solid #e2e8f0;
            border-radius:10px;padding:14px 16px;border-top:3px solid #005b96}
  .stat-label{font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em}
  .stat-val{font-size:20px;font-weight:800;color:#0f172a;margin-top:4px}
  .stat-sub{font-size:11px;color:#94a3b8;margin-top:2px}
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="header">
      <h1>${title}</h1>
      <p>Glück Global — Finance Dashboard Automated Report</p>
      <span class="badge">${badge}</span>
    </div>
    <div class="body">
      ${bodyHtml}
    </div>
  </div>
  <p class="footer-note">This is an automated report from the Glück Global Finance System. Do not reply to this email.</p>
</div>
</body>
</html>`;
}

// ─── 10 AM Morning Report ─────────────────────────────────────────────────────
async function sendMorningReport() {
  const rows = await fetchVisibleBatchData();

  const now = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const totalPendingLKR = rows.reduce((s, r) => s + r.pendingLKR, 0);
  const totalPendingINR = rows.reduce((s, r) => s + r.pendingINR, 0);
  const totalOverdueStudents = rows.reduce((s, r) => s + r.overdueStudents, 0);
  const totalBalanceStudents = rows.reduce((s, r) => s + r.balanceStudents, 0);

  const summaryBoxes = `
    <div class="summary-row">
      <div class="stat-box">
        <div class="stat-label">Active Batches</div>
        <div class="stat-val">${rows.length}</div>
        <div class="stat-sub">on this dashboard</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">Students with Balance</div>
        <div class="stat-val">${totalBalanceStudents}</div>
        <div class="stat-sub">across all batches</div>
      </div>
      <div class="stat-box" style="border-top-color:#dc2626">
        <div class="stat-label">Overdue Students</div>
        <div class="stat-val" style="color:#dc2626">${totalOverdueStudents}</div>
        <div class="stat-sub">payment past schedule</div>
      </div>
      ${totalPendingLKR > 0 ? `<div class="stat-box" style="border-top-color:#d97706">
        <div class="stat-label">Total Pending (LKR)</div>
        <div class="stat-val" style="color:#d97706">LKR ${fmtNum(totalPendingLKR)}</div>
        <div class="stat-sub">all active batches</div>
      </div>` : ''}
      ${totalPendingINR > 0 ? `<div class="stat-box" style="border-top-color:#d97706">
        <div class="stat-label">Total Pending (INR)</div>
        <div class="stat-val" style="color:#d97706">INR ${fmtNum(totalPendingINR)}</div>
        <div class="stat-sub">all active batches</div>
      </div>` : ''}
    </div>`;

  let tableRows = '';
  for (const r of rows) {
    const overdayLabel = overdueDaysLabel(r.overdueSince);
    const isHot = overdueDays(r.overdueSince) != null && overdueDays(r.overdueSince) >= 7;
    tableRows += `
      <tr>
        <td class="batch-name">${r.batch}</td>
        <td class="num">${r.balanceStudents} / ${r.studentCount}</td>
        <td class="num amber">${r.pendingLKR > 0 ? 'LKR ' + fmtNum(r.pendingLKR) : '—'}</td>
        <td class="num amber">${r.pendingINR > 0 ? 'INR ' + fmtNum(r.pendingINR) : '—'}</td>
        <td class="num overdue-${isHot ? 'hot' : 'ok'}">${r.overdueStudents > 0 ? r.overdueStudents + ' student' + (r.overdueStudents > 1 ? 's' : '') : '—'}</td>
        <td class="num ${isHot ? 'overdue-hot' : 'overdue-ok'}">${overdayLabel}</td>
        <td class="num">${formatCommencementCell(r.commencement)}</td>
      </tr>`;
  }

  const tableHtml = rows.length
    ? `<table>
        <thead>
          <tr>
            <th>Batch</th>
            <th style="text-align:right">Students (balance / total)</th>
            <th style="text-align:right">Pending LKR</th>
            <th style="text-align:right">Pending INR</th>
            <th style="text-align:right">Overdue Students</th>
            <th style="text-align:right">Overdue Since</th>
            <th style="text-align:right">Commencement</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>`
    : `<p style="color:#64748b;font-size:13px;">No batches configured on the Finance Dashboard.</p>`;

  const bodyHtml = `
    <h2>📋 Morning Pending Summary — ${now}</h2>
    ${summaryBoxes}
    ${commencementSummaryHtml(rows)}
    <h2>Batch-wise Pending Balance</h2>
    ${tableHtml}
    <p style="font-size:12px;color:#94a3b8;margin-top:8px">
      Only batches added to the Finance Dashboard are included. Amounts use the <strong>Current Level</strong> language-fee scope
      (dominant batch level), for <strong>ongoing</strong> students only — matching the finance dashboard view.
      <strong>Commencement</strong> = next level start date (auto for new batches, manual for old) with projected collection
      (students × next-level catalog fee). Rows within <strong>5 days</strong> are highlighted in red.
    </p>`;

  const dateStr = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  await sendReport({
    subject: `🌅 Morning Finance Summary — ${dateStr} | Pending LKR ${fmtNum(totalPendingLKR)}${totalPendingINR > 0 ? ' + INR ' + fmtNum(totalPendingINR) : ''}`,
    html: emailWrapper(
      '🌅 Morning Finance Report',
      '10:00 AM Daily Summary',
      '#0369a1',
      bodyHtml,
    ),
  });
}

// ─── 6 PM Evening Report ──────────────────────────────────────────────────────
async function sendEveningReport() {
  const [rows, todayReceived] = await Promise.all([
    fetchVisibleBatchData(),
    fetchTodayReceivedByBatch(),
  ]);

  const now = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Merge today received into batch rows
  const batchMap = new Map(rows.map((r) => [String(r.batch).toLowerCase(), r]));
  const allBatchKeys = new Set([
    ...rows.map((r) => String(r.batch).toLowerCase()),
    ...Object.keys(todayReceived).map((b) => b.toLowerCase()),
  ]);

  // Total received today
  let totalTodayLKR = 0;
  let totalTodayINR = 0;
  let totalTodayCount = 0;
  for (const key of allBatchKeys) {
    const rec = todayReceived[key] || {};
    totalTodayLKR += rec.lkr || 0;
    totalTodayINR += rec.inr || 0;
    totalTodayCount += rec.count || 0;
  }

  const totalPendingLKR = rows.reduce((s, r) => s + r.pendingLKR, 0);
  const totalPendingINR = rows.reduce((s, r) => s + r.pendingINR, 0);

  // Summary boxes
  const summaryBoxes = `
    <div class="summary-row">
      <div class="stat-box" style="border-top-color:#16a34a">
        <div class="stat-label">Received Today (LKR)</div>
        <div class="stat-val green">LKR ${fmtNum(totalTodayLKR)}</div>
        <div class="stat-sub">${totalTodayCount} payment(s) approved</div>
      </div>
      ${totalTodayINR > 0 ? `<div class="stat-box" style="border-top-color:#16a34a">
        <div class="stat-label">Received Today (INR)</div>
        <div class="stat-val green">INR ${fmtNum(totalTodayINR)}</div>
        <div class="stat-sub">approved today</div>
      </div>` : ''}
      <div class="stat-box" style="border-top-color:#d97706">
        <div class="stat-label">Still Pending (LKR)</div>
        <div class="stat-val amber">LKR ${fmtNum(totalPendingLKR)}</div>
        <div class="stat-sub">as of 6 PM</div>
      </div>
      ${totalPendingINR > 0 ? `<div class="stat-box" style="border-top-color:#d97706">
        <div class="stat-label">Still Pending (INR)</div>
        <div class="stat-val amber">INR ${fmtNum(totalPendingINR)}</div>
        <div class="stat-sub">as of 6 PM</div>
      </div>` : ''}
    </div>`;

  // Table 1: Payments received today per batch
  let receivedRows = '';
  const batchesWithReceived = [...allBatchKeys].filter((k) => todayReceived[k]);
  if (batchesWithReceived.length) {
    for (const key of batchesWithReceived) {
      const row = batchMap.get(key);
      const rec = todayReceived[key] || {};
      receivedRows += `
        <tr>
          <td class="batch-name">${row ? row.batch : key}</td>
          <td class="num">${row ? row.balanceStudents : '—'}</td>
          <td class="num green">${rec.lkr > 0 ? 'LKR ' + fmtNum(rec.lkr) : '—'}</td>
          <td class="num green">${rec.inr > 0 ? 'INR ' + fmtNum(rec.inr) : '—'}</td>
          <td class="num">${rec.count || 0} payment(s)</td>
        </tr>`;
    }
  } else {
    receivedRows = `<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No payments were approved today.</td></tr>`;
  }

  const table1Html = `<table>
    <thead>
      <tr>
        <th>Batch</th>
        <th style="text-align:right">Students with Balance</th>
        <th style="text-align:right">Received Today (LKR)</th>
        <th style="text-align:right">Received Today (INR)</th>
        <th style="text-align:right">Submissions</th>
      </tr>
    </thead>
    <tbody>${receivedRows}</tbody>
  </table>`;

  // Table 2: Remaining balance per batch
  let balanceRows = '';
  for (const r of rows) {
    const rec = todayReceived[String(r.batch).toLowerCase()] || {};
    const todayLKR = rec.lkr || 0;
    const todayINR = rec.inr || 0;
    balanceRows += `
      <tr>
        <td class="batch-name">${r.batch}</td>
        <td class="num">${r.balanceStudents} / ${r.studentCount}</td>
        <td class="num green">${todayLKR > 0 ? 'LKR ' + fmtNum(todayLKR) : '—'}</td>
        <td class="num amber">${r.pendingLKR > 0 ? 'LKR ' + fmtNum(r.pendingLKR) : '—'}</td>
        <td class="num amber">${r.pendingINR > 0 ? 'INR ' + fmtNum(r.pendingINR) : '—'}</td>
        <td class="num ${(r.overdueStudents || 0) > 0 ? 'overdue-hot' : 'overdue-ok'}">${r.overdueStudents > 0 ? r.overdueStudents : '—'}</td>
        <td class="num">${formatCommencementCell(r.commencement)}</td>
      </tr>`;
  }

  const table2Html = rows.length
    ? `<table>
        <thead>
          <tr>
            <th>Batch</th>
            <th style="text-align:right">Students (balance / total)</th>
            <th style="text-align:right">Received Today (LKR)</th>
            <th style="text-align:right">Still Pending (LKR)</th>
            <th style="text-align:right">Still Pending (INR)</th>
            <th style="text-align:right">Overdue</th>
            <th style="text-align:right">Commencement</th>
          </tr>
        </thead>
        <tbody>${balanceRows}</tbody>
      </table>`
    : `<p style="color:#64748b;font-size:13px;">No batches on the Finance Dashboard.</p>`;

  const dateStr = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const bodyHtml = `
    <h2>📊 Evening Collection Summary — ${now}</h2>
    ${summaryBoxes}
    ${commencementSummaryHtml(rows)}
    <h2>💰 Table 1 — Payments Received Today (by Batch)</h2>
    ${table1Html}
    <h2>📋 Table 2 — Full Balance Status as of 6 PM</h2>
    ${table2Html}
    <p style="font-size:12px;color:#94a3b8;margin-top:8px">
      "Received today" = current-level language-fee payments approved between midnight and 6 PM IST today.
      "Still pending" = current-level remaining balance for ongoing students (matches dashboard "Current Level").
      <strong>Commencement</strong> shows the next level payment date and projected batch collection; within 5 days is red.
    </p>`;

  await sendReport({
    subject: `🌆 Evening Finance Summary — ${dateStr} | Received LKR ${fmtNum(totalTodayLKR)}${totalTodayINR > 0 ? ' + INR ' + fmtNum(totalTodayINR) : ''} today`,
    html: emailWrapper(
      '🌆 Evening Finance Report',
      '6:00 PM Daily Summary',
      '#16a34a',
      bodyHtml,
    ),
  });
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
function scheduleFinanceDailyReports() {
  const cron = require('node-cron');

  // 10:00 AM IST = 04:30 UTC
  cron.schedule('30 4 * * *', () => {
    sendMorningReport().catch((err) =>
      console.error('[FinanceReport] ❌ Morning report failed:', err.message),
    );
  });

  // 6:00 PM IST = 12:30 UTC
  cron.schedule('30 12 * * *', () => {
    sendEveningReport().catch((err) =>
      console.error('[FinanceReport] ❌ Evening report failed:', err.message),
    );
  });

  console.log('📊 [FinanceReport] Scheduled: morning (10 AM IST) + evening (6 PM IST) batch reports');
}

module.exports = {
  scheduleFinanceDailyReports,
  sendMorningReport,
  sendEveningReport,
};
