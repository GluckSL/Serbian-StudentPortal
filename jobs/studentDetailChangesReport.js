/**
 * Student Detail Changes Report — runs every day at 8:00 PM (Asia/Kolkata / IST).
 *
 * Collects every StudentChangeHistory record created since midnight today,
 * expands them into one row per changed field, and emails an Excel attachment to:
 *   To:  admissions@gluckglobal.com
 *   CC:  lawson@gluckglobal.com, aiswarya@gluckglobal.com, sourav@gluckglobal.com
 */

const cron = require('node-cron');
const ExcelJS = require('exceljs');
const StudentChangeHistory = require('../models/StudentChangeHistory');
const User = require('../models/User');
const transporter = require('../config/emailConfig');

const TZ = 'Asia/Kolkata';

const TO = 'admissions@gluckglobal.com';
const CC = [
  'lawson@gluckglobal.com',
  'aiswarya@gluckglobal.com',
  'sourav@gluckglobal.com',
].join(', ');

// Human-readable field name mapping
const FIELD_LABELS = {
  batch: 'Batch',
  level: 'Level',
  subscription: 'Subscription',
  studentStatus: 'Student Status',
  assignedTeacher: 'Assigned Teacher',
  medium: 'Medium',
  name: 'Name',
  email: 'Email',
  phoneNumber: 'Phone Number',
  whatsappNumber: 'WhatsApp Number',
  address: 'Address',
  age: 'Age',
  nationality: 'Nationality',
  enrollmentDate: 'Enrollment Date',
  leadSource: 'Lead Source',
  languageLevelOpted: 'Language Level Opted',
  servicesOpted: 'Services Opted',
  stream: 'Stream',
  qualifications: 'Qualifications',
  languageExamStatus: 'Language Exam Status',
  examPassedDate: 'Exam Passed Date',
  dateWithdrew: 'Date Withdrew',
  reasonForWithdrawing: 'Reason for Withdrawing',
  goStatus: 'GO Status',
  goLanguage: 'GO Language',
  goJoiningDate: 'GO Joining Date',
  isActive: 'Active?',
  batchStartedOn: 'Batch Started On',
  teacherIncharge: 'Teacher In-charge',
  currentCourseDay: 'Current Course Day',
  documentationPaymentStatus: 'Documentation Payment Status',
  candidateStatus: 'Candidate Status',
};

function fieldLabel(field) {
  return FIELD_LABELS[field] || field;
}

function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatDateTime(date) {
  if (!date) return '—';
  return new Date(date).toLocaleString('en-IN', {
    timeZone: TZ,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function todayMidnightIST() {
  // Returns midnight of today in IST, expressed as a UTC Date
  const now = new Date();
  const nowIST = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const midnightIST = new Date(nowIST);
  midnightIST.setHours(0, 0, 0, 0);
  const offsetMs = now - nowIST;
  return new Date(midnightIST.getTime() + offsetMs);
}

/**
 * @param {Date} [fromOverride] - Optional custom start date (defaults to midnight IST today).
 */
async function fetchChanges(fromOverride) {
  const from = fromOverride || todayMidnightIST();
  const to = new Date();

  const records = await StudentChangeHistory.find({
    changedAt: { $gte: from, $lte: to },
    changedFields: { $exists: true, $not: { $size: 0 } },
  })
    .sort({ changedAt: 1 })
    .lean();

  if (!records.length) return [];

  // Fetch student info for all unique studentIds
  const studentIds = [...new Set(records.map((r) => String(r.studentId)))];
  const students = await User.find(
    { _id: { $in: studentIds } },
    { name: 1, regNo: 1, email: 1, phoneNumber: 1, batch: 1, level: 1, studentStatus: 1 }
  ).lean();

  const studentMap = new Map(students.map((s) => [String(s._id), s]));

  // Expand: one row per changed field per record
  const rows = [];
  records.forEach((rec) => {
    const student = studentMap.get(String(rec.studentId)) || {};
    (rec.changedFields || []).forEach((cf) => {
      rows.push({
        studentName: student.name || '—',
        regNo: student.regNo || '—',
        email: student.email || '—',
        phone: student.phoneNumber || '—',
        currentBatch: student.batch || '—',
        currentStatus: student.studentStatus || '—',
        fieldChanged: fieldLabel(cf.field),
        oldValue: formatValue(cf.oldValue),
        newValue: formatValue(cf.newValue),
        changedBy: rec.changedByName || '—',
        changedByRole: rec.changedByRole || '—',
        source: rec.source || '—',
        changedAt: formatDateTime(rec.changedAt),
      });
    });
  });

  return rows;
}

async function buildExcel(rows, reportDate) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Gluck Portal';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Student Changes');

  sheet.columns = [
    { header: '#',               key: 'sno',           width: 6  },
    { header: 'Student Name',    key: 'studentName',   width: 28 },
    { header: 'Reg No',          key: 'regNo',         width: 16 },
    { header: 'Email',           key: 'email',         width: 32 },
    { header: 'Phone',           key: 'phone',         width: 18 },
    { header: 'Current Batch',   key: 'currentBatch',  width: 20 },
    { header: 'Status',          key: 'currentStatus', width: 16 },
    { header: 'Field Changed',   key: 'fieldChanged',  width: 24 },
    { header: 'Old Value',       key: 'oldValue',      width: 28 },
    { header: 'New Value',       key: 'newValue',      width: 28 },
    { header: 'Changed By',      key: 'changedBy',     width: 22 },
    { header: 'Role',            key: 'changedByRole', width: 14 },
    { header: 'Source',          key: 'source',        width: 26 },
    { header: 'Changed At',      key: 'changedAt',     width: 26 },
  ];

  // Header row style
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F4F8C' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top:    { style: 'thin' }, bottom: { style: 'thin' },
      left:   { style: 'thin' }, right:  { style: 'thin' },
    };
  });
  headerRow.height = 28;

  if (!rows.length) {
    const noDataRow = sheet.addRow({ sno: '', studentName: 'No student detail changes recorded today.' });
    noDataRow.getCell(2).font = { italic: true, color: { argb: 'FF888888' } };
  } else {
    rows.forEach((row, idx) => {
      const r = sheet.addRow({ sno: idx + 1, ...row });

      // Highlight changed values: old = light red, new = light green
      r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.alignment = { vertical: 'middle', wrapText: false };
        cell.border = {
          top:    { style: 'thin' }, bottom: { style: 'thin' },
          left:   { style: 'thin' }, right:  { style: 'thin' },
        };
        // Column 9 = Old Value, Column 10 = New Value
        if (colNumber === 9) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD6D6' } }; // light red
        } else if (colNumber === 10) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6F5D6' } }; // light green
        } else {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: idx % 2 === 0 ? 'FFFFFFFF' : 'FFF5F7FA' } };
        }
      });
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: 1, column: sheet.columns.length },
  };

  return workbook.xlsx.writeBuffer();
}

function buildEmailHtml(rows, reportDate) {
  const changeCount = rows.length;
  const uniqueStudents = new Set(rows.map((r) => r.regNo)).size;

  const summaryRows = rows.slice(0, 20).map((row, i) => `
    <tr style="background:${i % 2 === 0 ? '#ffffff' : '#f5f7fa'}">
      <td style="padding:8px 12px; border:1px solid #dee2e6;">${row.studentName}</td>
      <td style="padding:8px 12px; border:1px solid #dee2e6;">${row.regNo}</td>
      <td style="padding:8px 12px; border:1px solid #dee2e6;">${row.fieldChanged}</td>
      <td style="padding:8px 12px; border:1px solid #dee2e6; background:#fff0f0;">${row.oldValue}</td>
      <td style="padding:8px 12px; border:1px solid #dee2e6; background:#f0fff0;">${row.newValue}</td>
      <td style="padding:8px 12px; border:1px solid #dee2e6; color:#666; font-size:12px;">${row.changedAt}</td>
    </tr>`).join('');

  const moreNote = rows.length > 20
    ? `<p style="margin:8px 0 0; color:#888; font-size:13px; font-style:italic;">
         … and ${rows.length - 20} more changes — see the full Excel attachment.
       </p>`
    : '';

  const noChangesBlock = changeCount === 0
    ? `<p style="margin:16px 0; padding:16px; background:#f8f9fa; border-radius:6px;
                color:#666; text-align:center; font-style:italic;">
         No student detail changes were recorded today.
       </p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Student Detail Changes Report</title>
</head>
<body style="margin:0; padding:0; background:#f4f6fa; font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa; padding:32px 0;">
    <tr><td align="center">
      <table width="680" cellpadding="0" cellspacing="0"
             style="background:#fff; border-radius:10px; overflow:hidden;
                    box-shadow:0 4px 16px rgba(0,0,0,0.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#2F4F8C,#1a73e8);
                     padding:28px 32px; text-align:center;">
            <h1 style="margin:0; color:#fff; font-size:22px; letter-spacing:0.5px;">
              📋 Student Detail Changes Report
            </h1>
            <p style="margin:6px 0 0; color:#cce0ff; font-size:14px;">${reportDate}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">

            <p style="margin:0 0 20px; color:#444; font-size:15px;">
              Hi Team,<br /><br />
              Here is the end-of-day summary of student detail changes made today on the
              <strong>Gluck Student Portal</strong>.
              The complete change log is attached as an Excel file.
            </p>

            <!-- Stat badges -->
            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="padding-right:16px;">
                  <div style="background:#e8f0fe; border-radius:8px; padding:14px 24px; text-align:center;">
                    <div style="font-size:28px; font-weight:700; color:#2F4F8C;">${uniqueStudents}</div>
                    <div style="font-size:12px; color:#555; margin-top:4px;">Students Affected</div>
                  </div>
                </td>
                <td>
                  <div style="background:#e6f4ea; border-radius:8px; padding:14px 24px; text-align:center;">
                    <div style="font-size:28px; font-weight:700; color:#1a7340;">${changeCount}</div>
                    <div style="font-size:12px; color:#555; margin-top:4px;">Total Field Changes</div>
                  </div>
                </td>
              </tr>
            </table>

            ${noChangesBlock}

            ${changeCount > 0 ? `
            <!-- Preview table -->
            <p style="margin:0 0 10px; font-weight:600; color:#333; font-size:14px;">
              Change Preview ${rows.length > 20 ? '(first 20 of ' + rows.length + ')' : ''}:
            </p>
            <table width="100%" cellpadding="0" cellspacing="0"
                   style="border-collapse:collapse; font-size:13px; margin-bottom:8px;">
              <thead>
                <tr style="background:#2F4F8C;">
                  <th style="padding:9px 12px; color:#fff; text-align:left; border:1px solid #2F4F8C;">Student</th>
                  <th style="padding:9px 12px; color:#fff; text-align:left; border:1px solid #2F4F8C;">Reg No</th>
                  <th style="padding:9px 12px; color:#fff; text-align:left; border:1px solid #2F4F8C;">Field Changed</th>
                  <th style="padding:9px 12px; color:#fff; text-align:left; border:1px solid #2F4F8C; background:#c0392b;">Old Value</th>
                  <th style="padding:9px 12px; color:#fff; text-align:left; border:1px solid #2F4F8C; background:#1a7340;">New Value</th>
                  <th style="padding:9px 12px; color:#fff; text-align:left; border:1px solid #2F4F8C;">Changed At</th>
                </tr>
              </thead>
              <tbody>
                ${summaryRows}
              </tbody>
            </table>
            ${moreNote}
            ` : ''}

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
 * @param {Object} [opts]
 * @param {Date}   [opts.from]  - Custom start date. Defaults to midnight IST today.
 * @param {string} [opts.rangeLabel] - Human label shown in email subject, e.g. "Last 24 Hours".
 */
async function sendStudentDetailChangesReport({ from, rangeLabel } = {}) {
  const label = '[Student Detail Changes Report]';
  console.log(`${label} Starting …`);

  try {
    const rows = await fetchChanges(from);

    const reportDate = new Date().toLocaleDateString('en-IN', {
      timeZone: TZ,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const excelBuffer = await buildExcel(rows, reportDate);
    const html = buildEmailHtml(rows, reportDate);

    const dateShort = new Date().toLocaleDateString('en-IN', {
      timeZone: TZ,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const subjectSuffix = rangeLabel ? `${rangeLabel} — ${dateShort}` : dateShort;

    await transporter.sendMail({
      from: `"Gluck Portal" <${process.env.EMAIL_USER}>`,
      to: TO,
      cc: CC,
      subject: `📋 Student Detail Changes Report — ${subjectSuffix}`,
      html,
      attachments: [
        {
          filename: `student-changes-${new Date().toISOString().slice(0, 10)}.xlsx`,
          content: excelBuffer,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    });

    console.log(
      `${label} Email sent to ${TO} (CC: ${CC}) — ` +
      `${rows.length} field change(s) across ${new Set(rows.map((r) => r.regNo)).size} student(s).`
    );
  } catch (err) {
    console.error(`${label} Failed:`, err.message);
  }
}

function scheduleStudentDetailChangesReport() {
  // 8:00 PM every day, IST — uses default (midnight-to-now window)
  cron.schedule('0 20 * * *', () => sendStudentDetailChangesReport(), { timezone: TZ });
  console.log('[Student Detail Changes Report] Scheduled at 8:00 PM (IST) daily.');
}

module.exports = { scheduleStudentDetailChangesReport, sendStudentDetailChangesReport };
