import * as XLSX from 'xlsx';
import { StudentTableRow } from './payment-hub-api.service';
import { formatJourneyDayCurrentTotal } from './payment-journey-metrics.util';
import { LANGUAGE_FEE_STATUS_LABELS } from './payment-language-fee-status.util';

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export interface PaymentHubExportFormatters {
  name: (row: StudentTableRow) => string;
  email: (row: StudentTableRow) => string;
  batch: (row: StudentTableRow) => string;
  level: (row: StudentTableRow) => string;
  dateJoined: (row: StudentTableRow) => string;
  journeyDay: (row: StudentTableRow) => string;
  languageFeeStatus: (row: StudentTableRow) => string;
}

const EXPORT_HEADERS = [
  'Name',
  'Email',
  'Batch',
  'Level',
  'Date joined',
  'Journey day',
  'Received LKR',
  'Received INR',
  'Received Euro',
  'Pending LKR',
  'Pending INR',
  'Pending Euro',
  'Overdue LKR',
  'Overdue INR',
  'Overdue Euro',
  'Language fee status',
  'Overall status',
  'Inferred currency',
] as const;

function rowToExportRecord(row: StudentTableRow, fmt: PaymentHubExportFormatters): Record<string, string | number> {
  return {
    Name: fmt.name(row),
    Email: fmt.email(row),
    Batch: fmt.batch(row),
    Level: fmt.level(row),
    'Date joined': fmt.dateJoined(row),
    'Journey day': fmt.journeyDay(row),
    'Received LKR': row.totalPaidLKR ?? 0,
    'Received INR': row.totalPaidINR ?? 0,
    'Received Euro': row.totalPaidUSD ?? 0,
    'Pending LKR': row.pendingApprovalAmountLKR ?? 0,
    'Pending INR': row.pendingApprovalAmountINR ?? 0,
    'Pending Euro': row.pendingApprovalAmountUSD ?? 0,
    'Overdue LKR': row.overdueAmountLKR ?? 0,
    'Overdue INR': row.overdueAmountINR ?? 0,
    'Overdue Euro': row.overdueAmountUSD ?? 0,
    'Language fee status': fmt.languageFeeStatus(row),
    'Overall status': row.overallStatus || '',
    'Inferred currency': row.inferredCurrency || '',
  };
}

export function defaultPaymentHubExportFormatters(
  languageFeeLabel: (row: StudentTableRow) => string,
): PaymentHubExportFormatters {
  return {
    name: (r) => r.studentId?.name || '',
    email: (r) => r.studentId?.email || '',
    batch: (r) => r.studentId?.batch || '',
    level: (r) => r.studentId?.level || '',
    dateJoined: (r) => {
      const d = r.studentId?.dateJoined || r.studentId?.enrollmentDate || r.studentId?.createdAt;
      return d ? new Date(d).toISOString().slice(0, 10) : '';
    },
    journeyDay: (r) => formatJourneyDayCurrentTotal(r.studentId, r.studentId?.level),
    languageFeeStatus: languageFeeLabel,
  };
}

export function paymentHubRowsToCsv(rows: StudentTableRow[], formatters: PaymentHubExportFormatters): string {
  const lines = [
    EXPORT_HEADERS.join(','),
    ...rows.map((row) => {
      const rec = rowToExportRecord(row, formatters);
      return EXPORT_HEADERS.map((h) => csvCell(rec[h])).join(',');
    }),
  ];
  return lines.join('\n');
}

export function downloadPaymentHubCsv(filename: string, csv: string): void {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(filename.endsWith('.csv') ? filename : `${filename}.csv`, blob);
}

export function downloadPaymentHubXlsx(filename: string, rows: StudentTableRow[], formatters: PaymentHubExportFormatters): void {
  const sheetRows = rows.map((row) => rowToExportRecord(row, formatters));
  const ws = XLSX.utils.json_to_sheet(sheetRows, { header: [...EXPORT_HEADERS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  const outName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, outName);
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Re-export labels for tests / consistency */
export { LANGUAGE_FEE_STATUS_LABELS };
