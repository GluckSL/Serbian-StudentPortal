import * as XLSX from 'xlsx';

/** Batch row shape for export (matches PaymentHubBatchInsights table). */
export interface BatchExportRow {
  batch: string;
  batchType: 'new' | 'old';
  level: string | null;
  levelSummary: string;
  studentCount: number;
  totalExpectedLKR: number;
  totalExpectedINR: number;
  totalExpectedUSD: number;
  totalPaidLKR: number;
  totalPaidINR: number;
  totalPaidUSD: number;
  totalPendingLKR: number;
  totalPendingINR: number;
  totalPendingUSD: number;
  totalOverdueLKR: number;
  totalOverdueINR: number;
  totalOverdueUSD: number;
  collectionRateLKR: number | null;
  fullyPaidStudents: number;
  balanceStudents: number;
  overdueStudents: number;
  docsPaidStudents: number;
  visaPaidStudents: number;
}

const HEADERS = [
  'Batch',
  'Type',
  'Main level',
  'Level breakdown',
  'Students',
  'Expected LKR',
  'Expected INR',
  'Expected Euro',
  'Received LKR',
  'Received INR',
  'Received Euro',
  'Pending LKR',
  'Pending INR',
  'Pending Euro',
  'Overdue LKR',
  'Overdue INR',
  'Overdue Euro',
  'LKR collection %',
  'Paid full',
  'Have balance',
  'Overdue students',
  'Paid docs',
  'Paid visa',
  'Journey day',
] as const;

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToRecord(r: BatchExportRow, journeyDay: string, batchType: string): Record<string, string | number> {
  return {
    Batch: r.batch,
    Type: batchType,
    'Main level': r.level || '',
    'Level breakdown': r.levelSummary === '—' ? '' : r.levelSummary,
    Students: r.studentCount,
    'Expected LKR': r.totalExpectedLKR,
    'Expected INR': r.totalExpectedINR,
    'Expected Euro': r.totalExpectedUSD,
    'Received LKR': r.totalPaidLKR,
    'Received INR': r.totalPaidINR,
    'Received Euro': r.totalPaidUSD,
    'Pending LKR': r.totalPendingLKR,
    'Pending INR': r.totalPendingINR,
    'Pending Euro': r.totalPendingUSD,
    'Overdue LKR': r.totalOverdueLKR,
    'Overdue INR': r.totalOverdueINR,
    'Overdue Euro': r.totalOverdueUSD,
    'LKR collection %': r.collectionRateLKR ?? '',
    'Paid full': r.fullyPaidStudents,
    'Have balance': r.balanceStudents,
    'Overdue students': r.overdueStudents,
    'Paid docs': r.docsPaidStudents,
    'Paid visa': r.visaPaidStudents,
    'Journey day': journeyDay,
  };
}

export function batchRowsToCsv<T extends BatchExportRow>(
  rows: T[],
  formatters: { journeyDay: (r: T) => string; batchType: (t: 'new' | 'old') => string },
): string {
  const lines = [
    HEADERS.join(','),
    ...rows.map((r) => {
      const rec = rowToRecord(r, formatters.journeyDay(r), formatters.batchType(r.batchType));
      return HEADERS.map((h) => csvCell(rec[h])).join(',');
    }),
  ];
  return lines.join('\n');
}

export function downloadBatchInsightsCsv(filename: string, csv: string): void {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(filename.endsWith('.csv') ? filename : `${filename}.csv`, blob);
}

export function downloadBatchInsightsXlsx<T extends BatchExportRow>(
  filename: string,
  rows: T[],
  formatters: { journeyDay: (r: T) => string; batchType: (t: 'new' | 'old') => string },
): void {
  const sheetRows = rows.map((r) => rowToRecord(r, formatters.journeyDay(r), formatters.batchType(r.batchType)));
  const ws = XLSX.utils.json_to_sheet(sheetRows, { header: [...HEADERS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Batches');
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
