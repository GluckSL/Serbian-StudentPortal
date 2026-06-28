'use strict';
/**
 * Crucial Students Email Service
 *
 * Sends a daily 9:00 AM IST email with PDF attachment listing Platinum
 * (new-batch) students with < 1 hour engagement on their last 3 exercise days
 * (journey positions 2, 4, 5 per week, rolling across weeks).
 */

const nodemailer = require('nodemailer');
const { getCrucialStudents } = require('./crucialStudentsService');
const { generateCrucialStudentsPdf } = require('./crucialStudentsPdfService');

// ── Recipients ────────────────────────────────────────────────────────────────
const TO_ADDRESS = 'aiswarya@gluckglobal.com';
const CC_ADDRESSES = 'sourav@gluckglobal.com';

// ── Mailer ────────────────────────────────────────────────────────────────────
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

// ── Email HTML builder ────────────────────────────────────────────────────────
function buildEmailHtml({ students, summary }) {
  const count = summary.total;
  const avgMin = summary.avgMinutes;
  const dateStr = summary.generatedAt || '';

  function fmtDuration(secs) {
    const s = Math.max(0, Math.floor(secs || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  function exerciseDaysLabel(days) {
    if (!days || !days.length) return '—';
    return `Days ${days.join(', ')}`;
  }

  const windowLabel = summary.windowLabel || 'Last 3 exercise days (positions 2, 4, 5 per week)';

  const tableRows = students.slice(0, 50).map((s, i) => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #f0f4f8;font-size:12px">${i + 1}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #f0f4f8;font-weight:700;color:#03396c;font-size:12px">${s.name}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #f0f4f8;font-size:12px">${s.batch}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #f0f4f8;font-size:12px">${s.phone}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #f0f4f8;font-size:12px;text-align:center;font-weight:700;color:#03396c">${s.currentCourseDay || '—'}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #f0f4f8;font-size:12px;text-align:center">${exerciseDaysLabel(s.exerciseDays)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #f0f4f8;font-weight:700;color:#dc2626;font-size:12px;text-align:right">${fmtDuration(s.totalSeconds)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #f0f4f8;font-size:12px;text-align:center;color:${(s.liveClassesAttended ?? 0) === 0 ? '#d97706' : '#16a34a'};font-weight:600">${s.liveClassesAttended ?? 0}/${s.liveClassesTotal ?? 0}</td>
    </tr>`).join('');

  const moreNote = students.length > 50
    ? `<p style="font-size:12px;color:#64748b;margin-top:8px">Showing first 50 of ${count} students. Full list is in the PDF attachment.</p>`
    : '';

  const noStudentsHtml = `
    <div style="text-align:center;padding:40px 20px">
      <div style="font-size:40px">🎉</div>
      <div style="font-size:16px;font-weight:700;color:#16a34a;margin-top:8px">All Clear!</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px">All Platinum students are well-engaged. No crucial students today.</div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6f9;margin:0;padding:0}
  .wrap{max-width:860px;margin:0 auto;padding:20px 12px}
  .card{background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.07)}
  .header{background:linear-gradient(135deg,#7f1d1d 0%,#991b1b 50%,#03396c 100%);padding:26px 24px}
  table{width:100%;border-collapse:collapse}
  th{background:#03396c;color:#fff;padding:10px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;font-weight:700}
  tr:nth-child(even) td{background:#f8fafc}
</style>
</head>
<body>
<div class="wrap">
<div class="card">
  <div class="header">
    <h1 style="margin:0 0 6px;color:#fff;font-size:20px;font-weight:800">⚠️ Crucial Students Alert</h1>
    <p style="margin:0;color:rgba(255,255,255,.78);font-size:12px">
      Platinum New Batch · Less than 1 hour on last 3 exercise days (pos 2, 4, 5) · ${dateStr}
    </p>
    <span style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:10px;font-weight:800;
                 text-transform:uppercase;background:#dc2626;color:#fff;margin-top:10px">
      🌅 9:00 AM Daily Report
    </span>
  </div>

  <div style="padding:24px 20px;background:#fff">

    <!-- Banner -->
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px 16px;margin-bottom:20px;
                display:flex;align-items:flex-start;gap:10px">
      <span style="font-size:22px;line-height:1">📎</span>
      <div>
        <div style="font-size:14px;font-weight:700;color:#991b1b;margin-bottom:4px">Full report attached as PDF</div>
        <div style="font-size:12px;color:#64748b;line-height:1.45">
          The PDF attachment contains the complete formatted student table with all details.
          The preview below shows the first 50 students.
        </div>
      </div>
    </div>

    <!-- Summary cards -->
    <table style="border-collapse:separate;border-spacing:8px;margin:0 -8px 20px -8px">
      <tr>
        <td style="vertical-align:top;width:25%;padding:0">
          <div style="background:#fff;border:1px solid #e8ecf4;border-radius:10px;padding:14px;border-top:3px solid #dc2626">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Crucial Students</div>
            <div style="font-size:26px;font-weight:800;color:#dc2626;margin-top:6px">${count}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px">Platinum · New Batch</div>
          </div>
        </td>
        <td style="vertical-align:top;width:25%;padding:0">
          <div style="background:#fff;border:1px solid #e8ecf4;border-radius:10px;padding:14px;border-top:3px solid #ea580c">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Avg. Engagement</div>
            <div style="font-size:22px;font-weight:800;color:#ea580c;margin-top:6px">${avgMin} min</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px">On last 3 exercise days</div>
          </div>
        </td>
        <td style="vertical-align:top;width:25%;padding:0">
          <div style="background:#fff;border:1px solid #e8ecf4;border-radius:10px;padding:14px;border-top:3px solid #d97706">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Threshold</div>
            <div style="font-size:22px;font-weight:800;color:#d97706;margin-top:6px">&lt; 1 Hour</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px">Per student exercise-day window</div>
          </div>
        </td>
        <td style="vertical-align:top;width:25%;padding:0">
          <div style="background:#fff;border:1px solid #e8ecf4;border-radius:10px;padding:14px;border-top:3px solid #005b96">
            <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.06em">Exercise Days</div>
            <div style="font-size:14px;font-weight:800;color:#03396c;margin-top:6px">Last 3</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:4px">Positions 2, 4, 5 · last 2 live classes</div>
          </div>
        </td>
      </tr>
    </table>

    ${count === 0 ? noStudentsHtml : `
    <!-- Table -->
    <h2 style="margin:0 0 12px;font-size:14px;font-weight:700;color:#03396c;border-left:4px solid #dc2626;padding-left:10px">
      ⚠️ Crucial Students — ${count} total
    </h2>
    <div style="overflow-x:auto;border-radius:8px;border:1px solid #e8ecf4;margin-bottom:12px">
      <table>
        <thead>
          <tr>
            <th style="width:32px">#</th>
            <th>Student Name</th>
            <th>Batch</th>
            <th>Phone</th>
            <th style="text-align:center">Journey Day</th>
            <th style="text-align:center">Exercise Days<br/><span style="font-weight:400;font-size:9px">(last 3)</span></th>
            <th style="text-align:right">Total Time<br/><span style="font-weight:400;font-size:9px">(exercise days)</span></th>
            <th style="text-align:center">Live Classes<br/><span style="font-weight:400;font-size:9px">(last 2)</span></th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${moreNote}
    `}

    <p style="font-size:11px;color:#94a3b8;margin-top:16px;text-align:center">
      ${windowLabel}. Live classes = last 2 scheduled meetings for the batch.
      This is an automated report from the Glück Global Language Tracking System. Do not reply to this email.
    </p>
  </div>
</div>
</div>
</body>
</html>`;
}

// ── Core send function ────────────────────────────────────────────────────────
async function sendCrucialStudentsReport() {
  console.log('[CrucialStudents] 🔍 Fetching crucial students data...');
  const data = await getCrucialStudents();

  const { students, summary } = data;
  const count = summary.total;

  const dateStr = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const pdfBuffer = generateCrucialStudentsPdf({ students, summary });
  const html = buildEmailHtml({ students, summary });

  const t = getTransporter();
  const from = process.env.EMAIL_FROM || '"Glück Global" <no-reply@gluckglobal.com>';

  if (!t) {
    console.log(`[CrucialStudents] ⚠️ No mailer configured. Would send: ${count} crucial students on ${dateStr}`);
    return { students, summary };
  }

  await t.sendMail({
    from,
    to: TO_ADDRESS,
    cc: CC_ADDRESSES,
    subject: count > 0
      ? `⚠️ Crucial Students Alert — ${count} student${count !== 1 ? 's' : ''} need attention · ${dateStr}`
      : `✅ All Clear — No Crucial Students Today · ${dateStr}`,
    html,
    attachments: [{
      filename: `Crucial-Students-Report-${dateStr.replace(/\s/g, '-')}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });

  console.log(`[CrucialStudents] ✅ Report sent: ${count} crucial students on ${dateStr}`);
  return { students, summary };
}

// ── Cron scheduler ────────────────────────────────────────────────────────────
function scheduleCrucialStudentsReport() {
  const cron = require('node-cron');

  // 9:00 AM IST every day
  cron.schedule('0 9 * * *', () => {
    sendCrucialStudentsReport().catch((err) =>
      console.error('[CrucialStudents] ❌ Daily report failed:', err.message),
    );
  }, { timezone: 'Asia/Kolkata' });

  console.log('⚠️  [CrucialStudents] Scheduled: daily 9:00 AM IST crucial students report');
}

module.exports = {
  scheduleCrucialStudentsReport,
  sendCrucialStudentsReport,
};
