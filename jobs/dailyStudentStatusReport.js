/**
 * Daily Student Status Report — runs every morning at 10:00 AM (Asia/Colombo).
 *
 * Sends an email to aiswarya@gluckglobal.com with:
 *  • A summary of student counts by status (ONGOING, UNCERTAIN, WITHDREW)
 *  • An Excel attachment listing every such student with key details
 */

const cron = require('node-cron');
const ExcelJS = require('exceljs');
const User = require('../models/User');
const transporter = require('../config/emailConfig');

const REPORT_RECIPIENT = 'aiswarya@gluckglobal.com';
const TZ = 'Asia/Colombo';
const STATUSES = ['ONGOING', 'UNCERTAIN', 'WITHDREW'];

// Status display labels
const STATUS_LABELS = {
  ONGOING: 'Ongoing',
  UNCERTAIN: 'Uncertain',
  WITHDREW: 'Withdrew',
};

// Column background colours (ARGB) per status group in the Excel sheet
const STATUS_COLOURS = {
  ONGOING: 'FFD6F5D6',    // light green
  UNCERTAIN: 'FFFFF3CD',  // light amber
  WITHDREW: 'FFFFD6D6',   // light red
};

/**
 * Fetch all non-test students whose status is ONGOING, UNCERTAIN, or WITHDREW.
 * Returns a plain object array sorted by status then name.
 */
async function fetchStudents() {
  const students = await User.find(
    {
      role: 'STUDENT',
      studentStatus: { $in: STATUSES },
      isTestAccount: { $ne: true },
    },
    {
      name: 1,
      regNo: 1,
      email: 1,
      phoneNumber: 1,
      whatsappNumber: 1,
      batch: 1,
      level: 1,
      subscription: 1,
      medium: 1,
      studentStatus: 1,
      enrollmentDate: 1,
      dateWithdrew: 1,
      reasonForWithdrawing: 1,
      assignedTeacher: 1,
      isActive: 1,
      createdAt: 1,
    }
  )
    .populate('assignedTeacher', 'name')
    .lean();

  // Sort: ONGOING → UNCERTAIN → WITHDREW, then alphabetically by name
  const ORDER = { ONGOING: 0, UNCERTAIN: 1, WITHDREW: 2 };
  students.sort((a, b) => {
    const diff = (ORDER[a.studentStatus] ?? 9) - (ORDER[b.studentStatus] ?? 9);
    return diff !== 0 ? diff : (a.name || '').localeCompare(b.name || '');
  });

  return students;
}

/**
 * Build an in-memory Excel workbook and return it as a Buffer.
 */
async function buildExcel(students, counts) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gluck Portal';
  workbook.created = new Date();

  /* ── Summary sheet ─────────────────────────────────────────────── */
  const summarySheet = workbook.addWorksheet('Summary');

  summarySheet.columns = [
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Student Count', key: 'count', width: 18 },
  ];

  // Header style
  summarySheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F4F8C' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  });
  summarySheet.getRow(1).height = 24;

  const summaryData = STATUSES.map((s) => ({
    status: STATUS_LABELS[s],
    count: counts[s] || 0,
  }));
  summaryData.push({ status: 'TOTAL', count: students.length });

  summaryData.forEach((row, idx) => {
    const r = summarySheet.addRow([row.status, row.count]);
    const isTotalRow = row.status === 'TOTAL';
    r.eachCell((cell) => {
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
      if (isTotalRow) {
        cell.font = { bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      }
    });
  });

  /* ── Students sheet ─────────────────────────────────────────────── */
  const sheet = workbook.addWorksheet('All Students');

  sheet.columns = [
    { header: '#', key: 'sno', width: 6 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Reg No', key: 'regNo', width: 16 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'WhatsApp', key: 'whatsapp', width: 18 },
    { header: 'Batch', key: 'batch', width: 18 },
    { header: 'Level', key: 'level', width: 10 },
    { header: 'Subscription', key: 'subscription', width: 20 },
    { header: 'Medium', key: 'medium', width: 20 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Assigned Teacher', key: 'teacher', width: 24 },
    { header: 'Active?', key: 'active', width: 10 },
    { header: 'Enrollment Date', key: 'enrollmentDate', width: 20 },
    { header: 'Date Withdrew', key: 'dateWithdrew', width: 20 },
    { header: 'Reason for Withdrawing', key: 'reason', width: 36 },
  ];

  // Header row style
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F4F8C' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin' }, bottom: { style: 'thin' },
      left: { style: 'thin' }, right: { style: 'thin' },
    };
  });
  headerRow.height = 28;

  const fmt = (d) => (d ? new Date(d).toLocaleDateString('sr-Latn-RS', { timeZone: TZ }) : '—');

  students.forEach((s, i) => {
    const row = sheet.addRow({
      sno: i + 1,
      name: s.name || '',
      regNo: s.regNo || '',
      email: s.email || '',
      phone: s.phoneNumber || '',
      whatsapp: s.whatsappNumber || '',
      batch: s.batch || '—',
      level: s.level || '',
      subscription: s.subscription || '',
      medium: Array.isArray(s.medium) ? s.medium.join(', ') : (s.medium || ''),
      status: STATUS_LABELS[s.studentStatus] || s.studentStatus,
      teacher: s.assignedTeacher?.name || '—',
      active: s.isActive ? 'Yes' : 'No',
      enrollmentDate: fmt(s.enrollmentDate || s.createdAt),
      dateWithdrew: s.dateWithdrew ? fmt(s.dateWithdrew) : '—',
      reason: s.reasonForWithdrawing || '',
    });

    const colour = STATUS_COLOURS[s.studentStatus] || 'FFFFFFFF';
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
      cell.alignment = { vertical: 'middle', wrapText: false };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
  });

  // Freeze the header row and enable auto-filter
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columns.length },
  };

  /* ── Per-status sheets ──────────────────────────────────────────── */
  for (const status of STATUSES) {
    const subset = students.filter((s) => s.studentStatus === status);
    if (!subset.length) continue;

    const ws = workbook.addWorksheet(STATUS_LABELS[status]);
    ws.columns = sheet.columns; // same column definitions

    // Header
    const hr = ws.getRow(1);
    hr.values = sheet.getRow(1).values; // copy header text
    hr.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F4F8C' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    hr.height = 28;

    subset.forEach((s, i) => {
      const row = ws.addRow({
        sno: i + 1,
        name: s.name || '',
        regNo: s.regNo || '',
        email: s.email || '',
        phone: s.phoneNumber || '',
        whatsapp: s.whatsappNumber || '',
        batch: s.batch || '—',
        level: s.level || '',
        subscription: s.subscription || '',
        medium: Array.isArray(s.medium) ? s.medium.join(', ') : (s.medium || ''),
        status: STATUS_LABELS[s.studentStatus] || s.studentStatus,
        teacher: s.assignedTeacher?.name || '—',
        active: s.isActive ? 'Yes' : 'No',
        enrollmentDate: fmt(s.enrollmentDate || s.createdAt),
        dateWithdrew: s.dateWithdrew ? fmt(s.dateWithdrew) : '—',
        reason: s.reasonForWithdrawing || '',
      });
      const colour = STATUS_COLOURS[status];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
        cell.alignment = { vertical: 'middle' };
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      });
    });

    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: ws.columns.length },
    };
  }

  return workbook.xlsx.writeBuffer();
}

/**
 * Build the HTML body for the daily report email.
 */
function buildEmailHtml(counts, students) {
  const today = new Date().toLocaleDateString('sr-Latn-RS', {
    timeZone: TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const statusRows = STATUSES.map((s) => {
    const colourMap = { ONGOING: '#28a745', UNCERTAIN: '#ffc107', WITHDREW: '#dc3545' };
    const bgMap = { ONGOING: '#d4edda', UNCERTAIN: '#fff3cd', WITHDREW: '#f8d7da' };
    return `
      <tr>
        <td style="padding:10px 16px; border:1px solid #dee2e6;">${STATUS_LABELS[s]}</td>
        <td style="padding:10px 16px; border:1px solid #dee2e6; text-align:center;">
          <span style="
            background:${bgMap[s]};
            color:${colourMap[s]};
            font-weight:700;
            padding:3px 12px;
            border-radius:12px;
            font-size:15px;
          ">${counts[s] || 0}</span>
        </td>
      </tr>`;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily Student Status Report</title>
</head>
<body style="margin:0; padding:0; background:#f4f6fa; font-family: 'Segoe UI', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa; padding:32px 0;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0"
             style="background:#ffffff; border-radius:10px; overflow:hidden;
                    box-shadow:0 4px 16px rgba(0,0,0,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2F4F8C,#1a73e8);
                     padding:28px 32px; text-align:center;">
            <h1 style="margin:0; color:#fff; font-size:22px; letter-spacing:0.5px;">
              📊 Daily Student Status Report
            </h1>
            <p style="margin:6px 0 0; color:#cce0ff; font-size:14px;">${today}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">

            <p style="margin:0 0 18px; color:#444; font-size:15px;">
              Hi Aiswarya,<br /><br />
              Here is your morning snapshot of student statuses on the
              <strong>Gluck Student Portal</strong>.
              The full student list is attached as an Excel file.
            </p>

            <!-- Summary table -->
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="border-collapse:collapse; margin-bottom:24px;">
              <thead>
                <tr style="background:#2F4F8C;">
                  <th style="padding:10px 16px; color:#fff; text-align:left; border:1px solid #2F4F8C;">
                    Status
                  </th>
                  <th style="padding:10px 16px; color:#fff; text-align:center; border:1px solid #2F4F8C;">
                    Total Students
                  </th>
                </tr>
              </thead>
              <tbody>
                ${statusRows}
                <tr style="background:#f4f6fa;">
                  <td style="padding:10px 16px; border:1px solid #dee2e6; font-weight:700;">
                    Grand Total
                  </td>
                  <td style="padding:10px 16px; border:1px solid #dee2e6; text-align:center;
                             font-weight:700; font-size:16px;">
                    ${students.length}
                  </td>
                </tr>
              </tbody>
            </table>

            <p style="margin:0; color:#666; font-size:13px;">
              The attached Excel file (<em>student-status-report.xlsx</em>) contains four sheets:
              <strong>Summary</strong>, <strong>All Students</strong>,
              <strong>Ongoing</strong>, <strong>Uncertain</strong>, and <strong>Withdrew</strong>.
            </p>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fa; padding:16px 32px; text-align:center;
                     border-top:1px solid #e9ecef;">
            <p style="margin:0; color:#aaa; font-size:12px;">
              This is an automated daily report from the Gluck Student Portal.
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
 * Main function: fetch data, build Excel, send email.
 */
async function sendDailyStudentStatusReport() {
  const label = '[Daily Student Status Report]';
  console.log(`${label} Starting …`);

  try {
    const students = await fetchStudents();

    // Count per status
    const counts = {};
    STATUSES.forEach((s) => { counts[s] = 0; });
    students.forEach((s) => { if (counts[s.studentStatus] !== undefined) counts[s.studentStatus]++; });

    const excelBuffer = await buildExcel(students, counts);
    const html = buildEmailHtml(counts, students);

    const today = new Date().toLocaleDateString('sr-Latn-RS', {
      timeZone: TZ,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    await transporter.sendMail({
      from: `"Gluck Portal" <${process.env.EMAIL_USER}>`,
      to: REPORT_RECIPIENT,
      subject: `📊 Daily Student Status Report — ${today}`,
      html,
      attachments: [
        {
          filename: 'student-status-report.xlsx',
          content: excelBuffer,
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    });

    console.log(
      `${label} Email sent to ${REPORT_RECIPIENT} ` +
      `(Ongoing: ${counts.ONGOING}, Uncertain: ${counts.UNCERTAIN}, Withdrew: ${counts.WITHDREW})`
    );
  } catch (err) {
    console.error(`${label} Failed:`, err.message);
  }
}

/**
 * Register the cron job (called once from app.js after DB connects).
 */
function scheduleDailyStudentStatusReport() {
  // 10:00 AM every day, Asia/Colombo time
  cron.schedule('0 10 * * *', sendDailyStudentStatusReport, { timezone: TZ });
  console.log('[Daily Student Status Report] Scheduled at 10:00 AM (Asia/Colombo) daily.');
}

module.exports = { scheduleDailyStudentStatusReport, sendDailyStudentStatusReport };
