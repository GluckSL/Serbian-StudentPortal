import { Component, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { from, of } from 'rxjs';
import { catchError, concatMap, finalize, tap } from 'rxjs/operators';
import * as XLSX from 'xlsx';

import {
  PaymentHubApiService,
  StudentTableRow,
  MapLegacyPaymentsBody,
  LegacyLineItem,
  LegacyCustomPayment,
} from './payment-hub-api.service';
import { AuthService } from '../../services/auth.service';
import { PaymentImportHistoryService } from './payment-import-history.service';

export interface ExcelImportRow {
  name: string;
  email: string;
  level: string;
  amount: number | null;
  type: string;
  customLabel: string;
  dateOfPayment: string;
  totalAmount: number | null;
  balance: number | null;
  note: string;
  currency: string;
  /** Optional: quoted documentation fee (informational, stored in remarks for Docs rows). */
  documentQuotation: number | null;
  /** Optional: amount received for documents (informational, stored in remarks for Docs rows). */
  documentReceived: number | null;
  /** Optional: quoted visa fee (informational, stored in remarks for Visa rows). */
  visaQuotation: number | null;
  /** Optional: amount received for visa (informational, stored in remarks for Visa rows). */
  visaReceived: number | null;
}

export interface PreviewRow extends ExcelImportRow {
  rowIndex: number;
  matchedStudent: StudentTableRow | null;
  resolvedName: string;
  resolvedLevel: string;
  effectiveCurrency: string;
  currencyInferred: boolean;
  nameMismatch: boolean;
  levelMismatch: boolean;
  balanceWarning: boolean;
  parseError: string;
  possibleDuplicate: boolean;
}

export type ImportStep = 'upload' | 'preview' | 'mapping';

const TYPE_ALIASES: Record<string, string> = {
  language: 'Language',
  'language fee': 'Language',
  languagefee: 'Language',
  docs: 'Docs',
  document: 'Docs',
  documents: 'Docs',
  visa: 'Visa',
  custom: 'Custom',
};

const VALID_CURRENCIES = new Set(['LKR', 'INR', 'USD']);

function pickByAliases(row: Record<string, unknown>, aliases: string[], normalize: (h: string) => string): string {
  const keyByNorm = new Map<string, string>();
  for (const k of Object.keys(row)) {
    keyByNorm.set(normalize(k), k);
  }
  for (const a of aliases) {
    const rawKey = keyByNorm.get(normalize(a));
    if (rawKey !== undefined) return String(row[rawKey] ?? '').trim();
  }
  return '';
}

@Component({
  selector: 'app-payment-excel-import-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  templateUrl: './payment-excel-import-dialog.component.html',
  styleUrls: ['./payment-excel-import-dialog.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class PaymentExcelImportDialogComponent implements OnInit {
  step: ImportStep = 'upload';

  loadingStudents = false;
  saving = false;

  fileName = '';
  parseErrors: string[] = [];
  previewRows: PreviewRow[] = [];
  expandedRowKeys = new Set<number>();

  mappingTotalSteps = 0;
  mappingCompletedSteps = 0;
  mappingCurrentStudentName = '';
  mappingSuccessCount = 0;
  mappingFailCount = 0;
  mappingPaymentRowsSucceeded = 0;
  mappingPaymentRowsFailed = 0;

  private emailMap = new Map<string, StudentTableRow>();

  constructor(
    private readonly dialogRef: MatDialogRef<PaymentExcelImportDialogComponent, boolean>,
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly auth: AuthService,
    private readonly importHistory: PaymentImportHistoryService,
  ) {}

  ngOnInit(): void {
    this.loadingStudents = true;
    this.api.getAllStudentsForMatching().subscribe({
      next: (res) => {
        const list = res.data || [];
        for (const s of list) {
          const email = (s.studentId?.email || '').toLowerCase().trim();
          if (email) this.emailMap.set(email, s);
        }
        this.loadingStudents = false;
      },
      error: () => {
        this.loadingStudents = false;
        this.snack.open('Could not load student list for matching', 'Dismiss', { duration: 5000 });
      },
    });
  }

  private normalizeHeader(h: string): string {
    return h.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private findName(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Name', 'Full name', 'Student name', 'Student Name'], (k) => this.normalizeHeader(k));
  }

  private findEmail(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Email', 'email', 'student_email', 'student email', 'mail', 'e-mail'], (k) => this.normalizeHeader(k));
  }

  private findLevel(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Level', 'CEFR', 'Course level'], (k) => this.normalizeHeader(k));
  }

  private findAmount(row: Record<string, unknown>): string {
    return pickByAliases(
      row,
      [
        'Amount',
        'amount',
        'Amount paid',
        'Paid amount',
        'paid amount',
        'Payment amount',
        'Lng Received',
        'lng received',
        'Language received',
      ],
      (k) => this.normalizeHeader(k),
    );
  }

  private findType(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Type', 'Payment type', 'Category'], (k) => this.normalizeHeader(k));
  }

  private findCustomLabel(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Custom Label', 'Custom label', 'Label', 'custom_type', 'Custom type'], (k) => this.normalizeHeader(k));
  }

  private findDate(row: Record<string, unknown>): unknown {
    const keyByNorm = new Map<string, string>();
    for (const k of Object.keys(row)) {
      keyByNorm.set(this.normalizeHeader(k), k);
    }
    const dateAliases = [
      'Date of payment',
      'date of payment',
      'Payment Date',
      'payment date',
      'Payment date',
      'Date',
      'date',
      'Paid date',
    ];
    for (const a of dateAliases) {
      const rawKey = keyByNorm.get(this.normalizeHeader(a));
      if (rawKey !== undefined) return row[rawKey];
    }
    return '';
  }

  private findTotalAmount(row: Record<string, unknown>): string {
    return pickByAliases(
      row,
      [
        'Total amount',
        'total amount',
        'Total course fee',
        'Total',
        'Course fee',
        'Lng Quoted',
        'lng quoted',
        'Language quoted',
      ],
      (k) => this.normalizeHeader(k),
    );
  }

  private findBalance(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Balance', 'Bal', 'Remaining balance'], (k) => this.normalizeHeader(k));
  }

  private findNote(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Note', 'Notes', 'Remarks', 'Remark', 'Comment'], (k) => this.normalizeHeader(k));
  }

  private findCurrency(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Currency', 'CCY', 'Curr'], (k) => this.normalizeHeader(k));
  }

  private findDocumentQuotation(row: Record<string, unknown>): string {
    return pickByAliases(
      row,
      [
        'Document quotation',
        'document quotation',
        'Doc quotation',
        'Doc Quoted',
        'doc quoted',
        'Documentation quotation',
        'Document Quotation',
        'Docs quotation',
      ],
      (k) => this.normalizeHeader(k),
    );
  }

  private findDocumentReceived(row: Record<string, unknown>): string {
    return pickByAliases(
      row,
      [
        'Document received',
        'document received',
        'Docs received',
        'Doc Paid',
        'doc paid',
        'Documentation received',
        'Document Received',
      ],
      (k) => this.normalizeHeader(k),
    );
  }

  private findVisaQuotation(row: Record<string, unknown>): string {
    return pickByAliases(
      row,
      ['Visa Quo', 'visa quo', 'Visa Quoted', 'visa quoted', 'Visa quotation', 'Visa Quotation'],
      (k) => this.normalizeHeader(k),
    );
  }

  private findVisaReceived(row: Record<string, unknown>): string {
    return pickByAliases(
      row,
      ['Visa Re', 'visa re', 'Visa Received', 'visa received', 'Visa paid', 'Visa Paid'],
      (k) => this.normalizeHeader(k),
    );
  }

  /** Optional context from legacy wide sheets (merged into Note when present). */
  private findPlanTier(row: Record<string, unknown>): string {
    return pickByAliases(
      row,
      ['PLATINUM / Silver', 'Platinum / Silver', 'Platinum/Silver', 'Subscription', 'Plan', 'Tier'],
      (k) => this.normalizeHeader(k),
    );
  }

  private findBatch(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Batch', 'batch', 'Batch number', 'Batch no'], (k) => this.normalizeHeader(k));
  }

  private findStudentStatus(row: Record<string, unknown>): string {
    return pickByAliases(row, ['Status', 'Student status', 'Current status'], (k) => this.normalizeHeader(k));
  }

  private mergeLegacyContextNote(base: string, plan: string, batch: string, status: string): string {
    const bits: string[] = [];
    if (plan.trim()) bits.push(`Plan: ${plan.trim()}`);
    if (batch.trim()) bits.push(`Batch: ${batch.trim()}`);
    if (status.trim()) bits.push(`Status: ${status.trim()}`);
    const prefix = bits.length ? bits.join(' · ') : '';
    const rest = base.trim();
    if (prefix && rest) return `${prefix} — ${rest}`;
    return prefix || rest;
  }

  downloadTemplate(): void {
    // Matches common legacy workbook layout (one payment per row).
    const headers = [
      '',
      'Name',
      'Email',
      'Level',
      'PLATINUM / Silver',
      'Batch',
      'Status',
      'Currency',
      'Lng Quoted',
      'Lng Received',
      'Bal',
      'Doc Quoted',
      'Doc Paid',
      'Visa Quo',
      'Visa Re',
      'Payment date',
      'Type',
      'Custom Label',
      'Note',
    ];
    const sample = [
      '',
      'John Silva',
      'john@example.com',
      'A1',
      'PLATINUM',
      '27',
      'ONGOING',
      'LKR',
      '150000',
      '75000',
      '75000',
      '300000',
      '300000',
      '400000',
      '200000',
      '2026-01-15',
      'Language',
      '',
      'First payment',
    ];

    const dataSheet = XLSX.utils.aoa_to_sheet([headers, sample]);
    dataSheet['!cols'] = headers.map((h, i) => ({ wch: i === 0 ? 4 : h.length > 12 ? 22 : 14 }));

    const notesData = [
      ['Field', 'Required', 'Notes'],
      ['(first column)', 'Optional', 'Reserved for row numbers or IDs from your sheet — ignored on import'],
      ['Name', 'Recommended', 'Student full name — warning if it does not match portal'],
      ['Email', 'YES', 'Aliases: student_email, mail'],
      ['Level', 'Optional', 'E.g. A1, A2, B1'],
      ['PLATINUM / Silver', 'Optional', 'Merged into Note as context (Plan: …)'],
      ['Batch', 'Optional', 'Merged into Note as context'],
      ['Status', 'Optional', 'Merged into Note as context'],
      ['Currency', 'Recommended', 'LKR | INR | USD — inferred from student if blank'],
      ['Lng Quoted', 'Optional', 'Aliases: Total amount, Language quoted'],
      ['Lng Received', 'Optional', 'Aliases: Amount, Paid amount (language payment amount)'],
      ['Bal', 'Optional', 'Aliases: Balance'],
      ['Doc Quoted', 'Optional', 'Aliases: Document quotation — for Docs rows, stored in remarks'],
      ['Doc Paid', 'Optional', 'Aliases: Document received — for Docs rows, stored in remarks'],
      ['Visa Quo', 'Optional', 'For Visa rows: quoted visa fee (stored in remarks)'],
      ['Visa Re', 'Optional', 'For Visa rows: visa amount received (stored in remarks)'],
      ['Payment date', 'Optional', 'Defaults to today if blank. Aliases: Date of payment, Payment Date'],
      ['Type', 'Optional', 'Language | Docs | Visa | Custom — defaults to Language if blank'],
      ['Custom Label', 'Custom only', 'When Type is Custom'],
      ['Note', 'Optional', 'Saved as remarks (after Plan/Batch/Status prefix when those columns are filled)'],
    ];
    const notesSheet = XLSX.utils.aoa_to_sheet(notesData);
    notesSheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 60 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Payments');
    XLSX.utils.book_append_sheet(wb, notesSheet, 'Notes');
    XLSX.writeFile(wb, 'payment-import-template.xlsx');
  }

  onFileChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.fileName = file.name;
    this.parseErrors = [];
    this.previewRows = [];
    this.expandedRowKeys.clear();

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
        this.processRawRows(raw);
      } catch {
        this.parseErrors = ['Could not read the file. Make sure it is a valid .xlsx file.'];
      }
    };
    reader.readAsArrayBuffer(file);
    input.value = '';
  }

  private parseDate(raw: unknown): string {
    if (!raw) return '';
    if (raw instanceof Date) return raw.toISOString();
    const s = String(raw).trim();
    if (!s) return '';
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
    return '';
  }

  private parseNum(raw: unknown): number | null {
    if (raw === '' || raw === null || raw === undefined) return null;
    const n = Number(raw);
    return isNaN(n) ? null : n;
  }

  private normalizeType(raw: string): string {
    const key = raw.toLowerCase().trim().replace(/\s+/g, ' ');
    return TYPE_ALIASES[key] || raw.trim();
  }

  private dateKey(iso: string): string {
    if (!iso) return '';
    return iso.slice(0, 10);
  }

  private processRawRows(rows: Record<string, unknown>[]): void {
    if (!rows.length) {
      this.parseErrors = ['The sheet has no data rows.'];
      return;
    }

    const errors: string[] = [];
    const preview: PreviewRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2;

      const name = this.findName(r);
      const email = this.findEmail(r);
      const level = this.findLevel(r);
      const amountRaw = this.findAmount(r);
      const type = this.normalizeType(this.findType(r));
      const customLabel = this.findCustomLabel(r);
      const dateOfPayment = this.parseDate(this.findDate(r));
      const totalAmountRaw = this.findTotalAmount(r);
      const balanceRaw = this.findBalance(r);
      const plan = this.findPlanTier(r);
      const batch = this.findBatch(r);
      const studentStatus = this.findStudentStatus(r);
      const note = this.mergeLegacyContextNote(this.findNote(r), plan, batch, studentStatus);
      const currencyRaw = this.findCurrency(r).toUpperCase();
      const documentQuotation = this.parseNum(this.findDocumentQuotation(r));
      const documentReceived = this.parseNum(this.findDocumentReceived(r));
      const visaQuotation = this.parseNum(this.findVisaQuotation(r));
      const visaReceived = this.parseNum(this.findVisaReceived(r));

      const amount = this.parseNum(amountRaw);
      const totalAmount = this.parseNum(totalAmountRaw);
      const balance = this.parseNum(balanceRaw);
      const sheetCurrency = VALID_CURRENCIES.has(currencyRaw) ? currencyRaw : '';

      let parseError = '';
      if (!email) parseError = `Row ${rowNum}: Email is required`;
      else if (amount === null || amount <= 0) parseError = `Row ${rowNum}: Amount must be a positive number`;

      if (parseError) errors.push(parseError);

      const matchedStudent = email ? (this.emailMap.get(email.toLowerCase()) ?? null) : null;
      const resolvedName = matchedStudent?.studentId?.name ?? '';
      const resolvedLevel = matchedStudent?.studentId?.level ?? '';
      const fallbackCurrency = (matchedStudent?.inferredCurrency || 'LKR').toUpperCase();
      const effectiveCurrency = sheetCurrency || (VALID_CURRENCIES.has(fallbackCurrency) ? fallbackCurrency : 'LKR');
      const currencyInferred = !sheetCurrency && !!matchedStudent;

      const nameMismatch = !!(name && resolvedName && name.toLowerCase() !== resolvedName.toLowerCase());
      const levelMismatch = !!(level && resolvedLevel && level.toUpperCase() !== resolvedLevel.toUpperCase());

      let balanceWarning = false;
      if (totalAmount !== null && amount !== null && balance !== null) {
        const expected = totalAmount - amount;
        balanceWarning = Math.abs(expected - balance) > 1;
      }

      preview.push({
        rowIndex: rowNum,
        name,
        email,
        level,
        amount,
        type,
        customLabel,
        dateOfPayment,
        totalAmount,
        balance,
        note,
        currency: sheetCurrency,
        documentQuotation,
        documentReceived,
        visaQuotation,
        visaReceived,
        matchedStudent,
        resolvedName,
        resolvedLevel,
        effectiveCurrency,
        currencyInferred,
        nameMismatch,
        levelMismatch,
        balanceWarning,
        parseError,
        possibleDuplicate: false,
      });
    }

    this.markDuplicates(preview);

    this.parseErrors = errors;
    this.previewRows = preview;

    if (preview.length > 0) {
      this.step = 'preview';
    }
  }

  private markDuplicates(rows: PreviewRow[]): void {
    const key = (r: PreviewRow): string | null => {
      if (!r.matchedStudent || r.parseError || r.amount == null) return null;
      const sid = r.matchedStudent.studentId._id;
      const effectiveType = r.type || 'Language';
      const effectiveDate = this.dateKey(r.dateOfPayment) || new Date().toISOString().slice(0, 10);
      return `${sid}|${r.amount}|${effectiveDate}|${effectiveType}`;
    };
    const groups = new Map<string, PreviewRow[]>();
    for (const r of rows) {
      const k = key(r);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    for (const list of groups.values()) {
      if (list.length > 1) {
        for (const r of list) r.possibleDuplicate = true;
      }
    }
  }

  get matchedCount(): number {
    return this.previewRows.filter((r) => r.matchedStudent).length;
  }

  get unmatchedCount(): number {
    return this.previewRows.filter((r) => !r.matchedStudent && !r.parseError).length;
  }

  get invalidCount(): number {
    return this.previewRows.filter((r) => !!r.parseError).length;
  }

  get duplicateRowCount(): number {
    return this.previewRows.filter((r) => r.possibleDuplicate).length;
  }

  get warningRowCount(): number {
    return this.previewRows.filter((r) => r.nameMismatch || r.levelMismatch || r.balanceWarning || r.currencyInferred).length;
  }

  get validMappableRows(): PreviewRow[] {
    return this.previewRows.filter((r) => r.matchedStudent && !r.parseError);
  }

  get canMap(): boolean {
    return this.validMappableRows.length > 0 && !this.saving;
  }

  get currencyTotalsPreview(): { LKR: number; INR: number; USD: number } {
    const t = { LKR: 0, INR: 0, USD: 0 };
    for (const r of this.validMappableRows) {
      const ccy = r.effectiveCurrency;
      if (ccy === 'LKR' || ccy === 'INR' || ccy === 'USD') {
        t[ccy] += r.amount ?? 0;
      }
    }
    return t;
  }

  mappingProgressFraction(): number {
    if (this.mappingTotalSteps <= 0) return 0;
    return Math.min(1, this.mappingCompletedSteps / this.mappingTotalSteps);
  }

  toggleExpand(row: PreviewRow): void {
    if (!this.rowHasExpandableIssues(row)) return;
    if (this.expandedRowKeys.has(row.rowIndex)) this.expandedRowKeys.delete(row.rowIndex);
    else this.expandedRowKeys.add(row.rowIndex);
    this.expandedRowKeys = new Set(this.expandedRowKeys);
  }

  isExpanded(row: PreviewRow): boolean {
    return this.expandedRowKeys.has(row.rowIndex);
  }

  rowHasExpandableIssues(row: PreviewRow): boolean {
    return !!(
      row.parseError ||
      !row.matchedStudent ||
      row.nameMismatch ||
      row.levelMismatch ||
      row.balanceWarning ||
      row.currencyInferred ||
      row.possibleDuplicate
    );
  }

  issueDetails(row: PreviewRow): { reason: string; fix: string }[] {
    const out: { reason: string; fix: string }[] = [];
    if (row.parseError) {
      out.push({ reason: row.parseError, fix: 'Correct the cell values for this row and re-upload the file.' });
    }
    if (!row.matchedStudent && !row.parseError) {
      out.push({
        reason: `No student found for email "${row.email}".`,
        fix: 'Confirm the email matches a student in the portal, or add the student first.',
      });
    }
    if (row.nameMismatch) {
      out.push({
        reason: `Name on sheet ("${row.name}") does not match portal ("${row.resolvedName}").`,
        fix: 'If the email is correct, you can still map; otherwise fix the name or email for clarity.',
      });
    }
    if (row.levelMismatch) {
      out.push({
        reason: `Level on sheet ("${row.level}") differs from portal ("${row.resolvedLevel}").`,
        fix: 'Update the sheet or verify the student level in admin records.',
      });
    }
    if (row.balanceWarning) {
      out.push({
        reason: 'Balance does not equal Total amount minus Amount (within tolerance).',
        fix: 'Recalculate balance or leave Balance blank if it is informational only.',
      });
    }
    if (row.currencyInferred) {
      out.push({
        reason: `Currency was blank; using student profile currency (${row.effectiveCurrency}).`,
        fix: 'Add an explicit Currency column value (LKR, INR, USD) if the default is wrong.',
      });
    }
    if (row.possibleDuplicate) {
      out.push({
        reason: 'Possible duplicate: another row has the same student, amount, payment date, and type.',
        fix: 'Remove one row if this is the same payment recorded twice; otherwise you may still map both.',
      });
    }
    return out;
  }

  downloadFailedRows(): void {
    const rows: Record<string, unknown>[] = [];
    for (const r of this.previewRows) {
      const issues = this.issueDetails(r);
      if (!issues.length) continue;
      const primary = issues.map((i) => i.reason).join(' | ');
      const fixes = issues.map((i) => i.fix).join(' | ');
      let category = 'Warning';
      if (r.parseError) category = 'Invalid';
      else if (!r.matchedStudent) category = 'Unmatched';
      else if (r.possibleDuplicate) category = 'Duplicate';
      else if (r.nameMismatch || r.levelMismatch || r.balanceWarning || r.currencyInferred) category = 'Warning';

      rows.push({
        Row: r.rowIndex,
        Category: category,
        Reason: primary,
        'Suggested fix': fixes,
        Name: r.name,
        Email: r.email,
        Level: r.level,
        Type: r.type,
        'Custom Label': r.customLabel,
        Amount: r.amount ?? '',
        'Total amount': r.totalAmount ?? '',
        Balance: r.balance ?? '',
        Currency: r.currency || r.effectiveCurrency,
        'Date of payment': r.dateOfPayment ? r.dateOfPayment.slice(0, 10) : '',
        Note: r.note,
        'Document quotation': r.documentQuotation ?? '',
        'Document received': r.documentReceived ?? '',
        'Visa Quo': r.visaQuotation ?? '',
        'Visa Re': r.visaReceived ?? '',
        'Portal name': r.resolvedName,
        'Portal level': r.resolvedLevel,
      });
    }

    if (!rows.length) {
      this.snack.open('No rows with issues to export.', 'OK', { duration: 3500 });
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 6 },
      { wch: 20 },
      { wch: 48 },
      { wch: 36 },
      { wch: 18 },
      { wch: 26 },
      { wch: 8 },
      { wch: 12 },
      { wch: 14 },
      { wch: 12 },
      { wch: 12 },
      { wch: 10 },
      { wch: 12 },
      { wch: 24 },
      { wch: 22 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 10 },
      { wch: 10 },
      { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'FailedRows');
    XLSX.writeFile(wb, 'FailedRows.xlsx');
  }

  /** Merge free-text note with optional document quotation / received (Docs rows). */
  private buildDocsRemarks(row: PreviewRow, baseNote?: string): string | undefined {
    const parts: string[] = [];
    if (baseNote?.trim()) parts.push(baseNote.trim());
    if (row.documentQuotation != null) {
      parts.push(`Document quotation: ${row.documentQuotation}`);
    }
    if (row.documentReceived != null) {
      parts.push(`Document received: ${row.documentReceived}`);
    }
    const out = parts.join(' · ');
    return out || undefined;
  }

  /** Merge free-text note with optional visa quotation / received (Visa rows). */
  private buildVisaRemarks(row: PreviewRow, baseNote?: string): string | undefined {
    const parts: string[] = [];
    if (baseNote?.trim()) parts.push(baseNote.trim());
    if (row.visaQuotation != null) {
      parts.push(`Visa quotation: ${row.visaQuotation}`);
    }
    if (row.visaReceived != null) {
      parts.push(`Visa received: ${row.visaReceived}`);
    }
    const out = parts.join(' · ');
    return out || undefined;
  }

  mapPayments(): void {
    const mappable = this.validMappableRows;
    if (!mappable.length) return;

    const byStudent = new Map<string, PreviewRow[]>();
    for (const row of mappable) {
      const id = row.matchedStudent!.studentId._id;
      if (!byStudent.has(id)) byStudent.set(id, []);
      byStudent.get(id)!.push(row);
    }

    const payloads: { body: MapLegacyPaymentsBody; rowCount: number; displayName: string }[] = [];
    for (const [, rows] of byStudent.entries()) {
      const student = rows[0].matchedStudent!;
      const fallbackCurrency = (student.inferredCurrency || 'LKR').toUpperCase();

      const body: MapLegacyPaymentsBody = { studentId: student.studentId._id };
      const docsPayments: LegacyLineItem[] = [];
      const visaPayments: LegacyLineItem[] = [];
      const customPayments: LegacyCustomPayment[] = [];

      for (const row of rows) {
        const currency = row.currency || (VALID_CURRENCIES.has(fallbackCurrency) ? fallbackCurrency : 'LKR');
        const amount = row.amount!;
        const paymentDate = row.dateOfPayment || new Date().toISOString();
        const remarks = row.note || undefined;
        const t = row.type || 'Language';

        if (t === 'Language') {
          body.languagePayment = {
            totalCourseFee: row.totalAmount ?? amount,
            amountPaid: amount,
            currency,
            paymentDate,
            remarks,
          };
        } else if (t === 'Docs') {
          docsPayments.push({
            amount,
            currency,
            paymentDate,
            remarks: this.buildDocsRemarks(row, row.note),
          });
        } else if (t === 'Visa') {
          visaPayments.push({
            amount,
            currency,
            paymentDate,
            remarks: this.buildVisaRemarks(row, row.note),
          });
        } else {
          const paymentType = row.customLabel || row.type || 'Custom';
          customPayments.push({ amount, currency, paymentDate, remarks, paymentType });
        }
      }

      if (docsPayments.length) body.docsPayments = docsPayments;
      if (visaPayments.length) body.visaPayments = visaPayments;
      if (customPayments.length) body.customPayments = customPayments;

      payloads.push({
        body,
        rowCount: rows.length,
        displayName: student.studentId.name || student.studentId.email,
      });
    }

    this.saving = true;
    this.step = 'mapping';
    this.mappingTotalSteps = payloads.length;
    this.mappingCompletedSteps = 0;
    this.mappingCurrentStudentName = '';
    this.mappingSuccessCount = 0;
    this.mappingFailCount = 0;
    this.mappingPaymentRowsSucceeded = 0;
    this.mappingPaymentRowsFailed = 0;

    const user = this.auth.getSnapshotUser();
    const uploadedBy = {
      name: user?.name || 'Unknown',
      email: user?.email || '',
    };

    from(payloads)
      .pipe(
        concatMap((item) => {
          this.mappingCurrentStudentName = item.displayName;
          return this.api.mapLegacyPayments(item.body).pipe(
            tap(() => {
              this.mappingSuccessCount++;
              this.mappingPaymentRowsSucceeded += item.rowCount;
            }),
            catchError(() => {
              this.mappingFailCount++;
              this.mappingPaymentRowsFailed += item.rowCount;
              return of(null);
            }),
            finalize(() => {
              this.mappingCompletedSteps++;
            }),
          );
        }),
      )
      .subscribe({
        complete: () => {
          this.saving = false;
          const currencyTotals = this.currencyTotalsPreview;
          this.importHistory.append({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            uploadedBy,
            uploadedAt: new Date().toISOString(),
            sourceFileName: this.fileName || 'upload.xlsx',
            totalRows: this.previewRows.length,
            mappedRows: this.mappingPaymentRowsSucceeded,
            failedRows: this.mappingPaymentRowsFailed,
            warningRows: this.warningRowCount,
            duplicateRows: this.duplicateRowCount,
            currencyTotals,
          });

          if (this.mappingFailCount > 0) {
            this.snack.open(
              `Mapped ${this.mappingSuccessCount} student group(s); ${this.mappingFailCount} failed. Export FailedRows.xlsx for details.`,
              'Dismiss',
              { duration: 9000 },
            );
          } else {
            this.snack.open(
              `Successfully mapped payments for ${this.mappingSuccessCount} student${this.mappingSuccessCount !== 1 ? 's' : ''}.`,
              'OK',
              { duration: 6000 },
            );
          }
          this.dialogRef.close(true);
        },
        error: () => {
          this.saving = false;
          this.step = 'preview';
          this.snack.open('Mapping aborted unexpectedly.', 'Dismiss', { duration: 6000 });
        },
      });
  }

  backToUpload(): void {
    this.step = 'upload';
    this.fileName = '';
    this.parseErrors = [];
    this.previewRows = [];
    this.expandedRowKeys.clear();
  }

  close(): void {
    this.dialogRef.close(false);
  }

  fmtDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  fmt(n: number | null): string {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  totalPaymentRowsQueued(): number {
    return this.validMappableRows.length;
  }
}
