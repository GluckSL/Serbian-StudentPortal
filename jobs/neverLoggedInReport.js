/**
 * Never-Logged-In Student Report — runs every day at 8:00 AM IST.
 *
 * Finds all students whose lastLogin is null (never logged in to the portal).
 * Sends an HTML email to aiswarya@gluckglobal.com and sourav@gluckglobal.com
 * listing:
 *   • ONGOING students first (sorted by name)
 *   • Then all other statuses (UNCERTAIN, WITHDREW, COMPLETED) sorted by
 *     status then name
 *
 * Columns shown: Name · Email · Phone · Batch
 */

const cron = require('node-cron');
const User = require('../models/User');
const transporter = require('../config/emailConfig');

const TZ = 'Asia/Kolkata';

const REPORT_RECIPIENTS = ['aiswarya@gluckglobal.com', 'sourav@gluckglobal.com'];

/** Status display labels and colour palette used in the HTML table. */
const STATUS_META = {
  ONGOING:   { label: 'Ongoing',   bg: '#d4edda', color: '#155724', badge: '#28a745' },
  UNCERTAIN: { label: 'Uncertain', bg: '#fff3cd', color: '#856404', badge: '#ffc107' },
  WITHDREW:  { label: 'Withdrew',  bg: '#f8d7da', color: '#721c24', badge: '#dc3545' },
  COMPLETED: { label: 'Completed', bg: '#d1ecf1', color: '#0c5460', badge: '#17a2b8' },
};

/** Order for non-ONGOING statuses in the table. */
const STATUS_ORDER = { ONGOING: 0, UNCERTAIN: 1, WITHDREW: 2, COMPLETED: 3 };

/**
 * Fetch all non-test students that have never logged in (lastLogin is null).
 * Returns plain objects, ONGOING first, then other statuses alphabetically.
 */
async function fetchNeverLoggedIn() {
  const students = await User.find(
    {
      role: 'STUDENT',
      isTestAccount: { $ne: true },
      lastLogin: null,
    },
    {
      name: 1,
      email: 1,
      phoneNumber: 1,
      whatsappNumber: 1,
      batch: 1,
      studentStatus: 1,
    }
  ).lean();

  students.sort((a, b) => {
    const oa = STATUS_ORDER[a.studentStatus] ?? 9;
    const ob = STATUS_ORDER[b.studentStatus] ?? 9;
    if (oa !== ob) return oa - ob;
    return (a.name || '').localeCompare(b.name || '');
  });

  return students;
}

/**
 * Build an HTML <tr> row for one student.
 */
function buildRow(student, index, isOdd) {
  const meta = STATUS_META[student.studentStatus] || { label: student.studentStatus, bg: '#ffffff', color: '#333', badge: '#666' };
  const rowBg = isOdd ? '#f9f9f9' : '#ffffff';
  const phone = student.phoneNumber || student.whatsappNumber || '—';
  const batch = student.batch || '—';

  return `
    <tr style="background:${rowBg};">
      <td style="padding:10px 12px; border:1px solid #dee2e6; text-align:center; color:#555; font-size:13px;">${index}</td>
      <td style="padding:10px 12px; border:1px solid #dee2e6; font-weight:600; color:#222; font-size:13px;">${escHtml(student.name || '')}</td>
      <td style="padding:10px 12px; border:1px solid #dee2e6; color:#444; font-size:13px;">${escHtml(student.email || '')}</td>
      <td style="padding:10px 12px; border:1px solid #dee2e6; color:#444; font-size:13px;">${escHtml(phone)}</td>
      <td style="padding:10px 12px; border:1px solid #dee2e6; color:#444; font-size:13px;">${escHtml(batch)}</td>
      <td style="padding:10px 12px; border:1px solid #dee2e6; text-align:center;">
        <span style="
          background:${meta.bg};
          color:${meta.color};
          border:1px solid ${meta.badge};
          padding:3px 10px;
          border-radius:12px;
          font-size:12px;
          font-weight:600;
          white-space:nowrap;
        ">${meta.label}</span>
      </td>
    </tr>`;
}

/** Escape HTML special characters. */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build the full HTML email body.
 */
function buildEmailHtml(students, counts, today) {
  const total = students.length;

  /* ── Status summary badges ── */
  const summaryBadges = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([status, count]) => {
      const meta = STATUS_META[status] || { label: status, bg: '#eee', color: '#333', badge: '#999' };
      return `
        <td style="padding:0 8px; text-align:center;">
          <div style="
            background:${meta.bg};
            border:1px solid ${meta.badge};
            border-radius:8px;
            padding:10px 18px;
            min-width:100px;
          ">
            <div style="font-size:22px; font-weight:700; color:${meta.color};">${count}</div>
            <div style="font-size:12px; color:${meta.color}; margin-top:2px;">${meta.label}</div>
          </div>
        </td>`;
    })
    .join('');

  /* ── Table rows (with section dividers between status groups) ── */
  let tableRows = '';
  let currentStatus = null;
  let globalIndex = 0;

  for (const student of students) {
    if (student.studentStatus !== currentStatus) {
      currentStatus = student.studentStatus;
      const meta = STATUS_META[currentStatus] || { label: currentStatus, bg: '#f0f0f0', badge: '#ccc', color: '#333' };
      tableRows += `
        <tr>
          <td colspan="6" style="
            padding:8px 12px;
            background:${meta.bg};
            border:1px solid ${meta.badge};
            font-weight:700;
            color:${meta.color};
            font-size:13px;
            letter-spacing:0.3px;
          ">
            ${meta.label.toUpperCase()} — ${counts[currentStatus]} student(s) never logged in
          </td>
        </tr>`;
    }
    globalIndex++;
    tableRows += buildRow(student, globalIndex, globalIndex % 2 === 0);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Never Logged-In Students Report</title>
</head>
<body style="margin:0; padding:0; background:#f4f6fa; font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa; padding:32px 0;">
    <tr><td align="center">
      <table width="700" cellpadding="0" cellspacing="0"
             style="background:#fff; border-radius:10px; overflow:hidden;
                    box-shadow:0 4px 16px rgba(0,0,0,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2F4F8C,#1a73e8);
                     padding:28px 32px; text-align:center;">
            <h1 style="margin:0; color:#fff; font-size:22px; letter-spacing:0.5px;">
              🚫 Never Logged-In Students
            </h1>
            <p style="margin:6px 0 0; color:#cce0ff; font-size:14px;">${today}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">

            <p style="margin:0 0 20px; color:#444; font-size:15px;">
              Hi team,<br /><br />
              Here is today's list of students who have <strong>never logged in</strong>
              to the <strong>Gluck Student Portal</strong>.
              ONGOING students are listed first, followed by other statuses.
            </p>

            <!-- Summary -->
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
              <tr>
                <td style="padding:0 8px; text-align:center;">
                  <div style="
                    background:#f0f0f0;
                    border:1px solid #ccc;
                    border-radius:8px;
                    padding:10px 18px;
                    min-width:100px;
                  ">
                    <div style="font-size:22px; font-weight:700; color:#333;">${total}</div>
                    <div style="font-size:12px; color:#555; margin-top:2px;">Total</div>
                  </div>
                </td>
                ${summaryBadges}
              </tr>
            </table>

            ${total === 0 ? `
              <p style="text-align:center; color:#28a745; font-size:15px; font-weight:600; padding:20px;">
                ✅ All students have logged in at least once. Great job!
              </p>
            ` : `
            <!-- Students table -->
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="border-collapse:collapse; font-size:13px;">
              <thead>
                <tr style="background:#2F4F8C;">
                  <th style="padding:11px 12px; color:#fff; border:1px solid #2F4F8C; width:40px;">#</th>
                  <th style="padding:11px 12px; color:#fff; border:1px solid #2F4F8C; text-align:left;">Name</th>
                  <th style="padding:11px 12px; color:#fff; border:1px solid #2F4F8C; text-align:left;">Email</th>
                  <th style="padding:11px 12px; color:#fff; border:1px solid #2F4F8C; text-align:left;">Phone</th>
                  <th style="padding:11px 12px; color:#fff; border:1px solid #2F4F8C; text-align:left;">Batch</th>
                  <th style="padding:11px 12px; color:#fff; border:1px solid #2F4F8C; text-align:center;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
            `}

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fa; padding:16px 32px; text-align:center;
                     border-top:1px solid #e9ecef;">
            <p style="margin:0; color:#aaa; font-size:12px;">
              Automated daily report from the Gluck Student Portal · Sent every morning at 8:00 AM IST.
              Please do not reply to this email.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Main function: fetch data, build email, send.
 */
async function sendNeverLoggedInReport() {
  const label = '[NeverLoggedInReport]';
  console.log(`${label} Starting …`);

  try {
    const students = await fetchNeverLoggedIn();

    /* Count per status */
    const counts = {};
    for (const s of students) {
      counts[s.studentStatus] = (counts[s.studentStatus] || 0) + 1;
    }

    if (students.length === 0) {
      console.log(`${label} No students with lastLogin = null — skipping email.`);
      return;
    }

    const today = new Date().toLocaleDateString('en-IN', {
      timeZone: TZ,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const html = buildEmailHtml(students, counts, today);

    const ongoingCount = counts['ONGOING'] || 0;
    const subject = `🚫 Never Logged-In Students — ${students.length} total (${ongoingCount} Ongoing) · ${today}`;

    await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'Glück Global Portal'}" <${process.env.EMAIL_USER}>`,
      to: REPORT_RECIPIENTS.join(', '),
      subject,
      html,
    });

    console.log(
      `${label} ✅ Email sent to ${REPORT_RECIPIENTS.join(', ')} — ` +
      `${students.length} student(s) never logged in ` +
      `(${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')})`
    );
  } catch (err) {
    console.error(`${label} ❌ Failed:`, err.message);
  }
}

/**
 * Register the cron job (called once from app.js after DB connects).
 * Runs every day at 08:00 AM IST (Asia/Kolkata).
 */
function scheduleNeverLoggedInReport() {
  cron.schedule('0 8 * * *', sendNeverLoggedInReport, { timezone: TZ });
  console.log('[NeverLoggedInReport] Scheduled — daily 8:00 AM IST; never-logged-in students report.');
}

module.exports = { scheduleNeverLoggedInReport, sendNeverLoggedInReport };
