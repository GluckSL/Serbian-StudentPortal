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
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';

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

function normalizeImportCurrency(value: string): string {
  const c = String(value || '').trim().toUpperCase();
  if (c === 'EUR' || c === 'EURO') return 'USD';
  return c;
}

function displayCurrency(value: string): string {
  return String(value || '').toUpperCase() === 'USD' ? 'EURO' : value;
}

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
    PaymentCurrencyTotalsComponent,
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
  selectedRow: PreviewRow | null = null;

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
      ['Currency', 'Recommended', 'LKR | INR | EURO — inferred from student if blank'],
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
    this.selectedRow = null;

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
      const currencyRaw = normalizeImportCurrency(this.findCurrency(r));
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

  openRowDetail(row: PreviewRow): void {
    this.selectedRow = row;
  }

  closeRowDetail(): void {
    this.selectedRow = null;
  }

  navigateRowDetail(delta: number): void {
    if (!this.selectedRow || !this.previewRows.length) return;
    const idx = this.previewRows.findIndex((r) => r.rowIndex === this.selectedRow!.rowIndex);
    if (idx < 0) return;
    const next = (idx + delta + this.previewRows.length) % this.previewRows.length;
    this.selectedRow = this.previewRows[next];
  }

  openFullPreviewTab(): void {
    if (!this.previewRows.length) {
      this.snack.open('No rows to display.', 'OK', { duration: 3000 });
      return;
    }

    const esc = (v: string | number | null | undefined): string => {
      if (v === null || v === undefined) return '';
      return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const statusCell = (row: PreviewRow): string => {
      const pills: string[] = [`<span class="pill ${esc(this.rowStatusClass(row).replace('ei-pill-', 'pill-'))}">${esc(this.rowStatusLabel(row))}</span>`];
      if (row.possibleDuplicate) pills.push('<span class="pill pill-dup">Duplicate</span>');
      if (row.currencyInferred) pills.push('<span class="pill pill-ccy">CCY inferred</span>');
      return pills.join(' ');
    };

    const issueText = (row: PreviewRow): string => {
      const issues = this.issueDetails(row);
      if (!issues.length) return '—';
      return issues.map((i) => i.reason).join(' · ');
    };

    const rowClass = (row: PreviewRow): string => {
      if (row.parseError) return 'row-bad';
      if (!row.matchedStudent) return 'row-warn';
      return 'row-ok';
    };

    const tableRows = this.previewRows
      .map(
        (row) => `<tr class="${rowClass(row)}">
      <td>${row.rowIndex}</td>
      <td class="status-cell">${statusCell(row)}</td>
      <td>${esc(row.name) || '—'}</td>
      <td>${esc(row.resolvedName) || '—'}</td>
      <td class="wrap">${esc(row.email) || '—'}</td>
      <td>${esc(row.level) || '—'}</td>
      <td>${esc(row.resolvedLevel) || '—'}</td>
      <td>${esc(row.type || 'Language')}</td>
      <td>${esc(row.customLabel) || '—'}</td>
      <td class="num">${esc(this.fmt(row.amount))}</td>
      <td class="num">${esc(this.fmt(row.totalAmount))}</td>
      <td class="num">${esc(this.fmt(row.balance))}</td>
      <td>${esc(displayCurrency(row.currency || row.effectiveCurrency))}</td>
      <td>${esc(this.fmtDate(row.dateOfPayment))}</td>
      <td class="num">${esc(this.fmt(row.documentQuotation))}</td>
      <td class="num">${esc(this.fmt(row.documentReceived))}</td>
      <td class="num">${esc(this.fmt(row.visaQuotation))}</td>
      <td class="num">${esc(this.fmt(row.visaReceived))}</td>
      <td class="wrap note">${esc(row.note) || '—'}</td>
      <td class="wrap issues">${esc(issueText(row))}</td>
    </tr>`,
      )
      .join('');

    const title = this.fileName ? `Payment import — ${this.fileName}` : 'Payment import preview';
    const generated = new Date().toLocaleString();

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px 28px 40px;
      font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #0f172a;
      background: #f1f5f9;
    }
    h1 { margin: 0 0 6px; font-size: 1.35rem; font-weight: 700; }
    .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 20px; }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 20px;
    }
    .stat {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 14px;
      min-width: 100px;
    }
    .stat label {
      display: block;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .stat strong { font-size: 1.2rem; font-variant-numeric: tabular-nums; }
    .stat.ok strong { color: #059669; }
    .stat.warn strong { color: #d97706; }
    .stat.bad strong { color: #dc2626; }
    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 200px);
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 4px 24px rgba(15, 23, 42, 0.06);
    }
    table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: #f8fafc;
      border-bottom: 2px solid #e2e8f0;
      padding: 10px 12px;
      text-align: left;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
      white-space: nowrap;
    }
    tbody td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }
    tbody tr:hover td { background: #f8fafc; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .wrap { max-width: 280px; word-break: break-word; white-space: normal; }
    .note { min-width: 200px; max-width: 360px; }
    .issues { min-width: 180px; max-width: 320px; font-size: 0.8rem; color: #b45309; }
    .status-cell { white-space: nowrap; }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.68rem;
      font-weight: 700;
      margin-right: 4px;
    }
    .pill-ok { background: #d1fae5; color: #047857; }
    .pill-err { background: #fee2e2; color: #b91c1c; }
    .pill-warn { background: #fef3c7; color: #b45309; }
    .pill-dup { background: #ffedd5; color: #c2410c; }
    .pill-ccy { background: #cffafe; color: #0e7490; }
    tr.row-ok td { background: #f0fdf4; }
    tr.row-warn td { background: #fffbeb; }
    tr.row-bad td { background: #fef2f2; }
    @media print {
      body { background: #fff; padding: 12px; }
      .table-wrap { max-height: none; box-shadow: none; }
    }
  </style>
</head>
<body>
  <h1>Bulk payment import — full preview</h1>
  <p class="meta">${esc(title)} · Generated ${esc(generated)} · ${this.previewRows.length} row(s)</p>
  <div class="stats">
    <div class="stat"><label>Total</label><strong>${this.previewRows.length}</strong></div>
    <div class="stat ok"><label>Matched</label><strong>${this.matchedCount}</strong></div>
    <div class="stat warn"><label>Unmatched</label><strong>${this.unmatchedCount}</strong></div>
    <div class="stat warn"><label>Warnings</label><strong>${this.warningRowCount}</strong></div>
    <div class="stat"><label>Duplicates</label><strong>${this.duplicateRowCount}</strong></div>
    <div class="stat bad"><label>Invalid</label><strong>${this.invalidCount}</strong></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Row</th>
          <th>Status</th>
          <th>Name (sheet)</th>
          <th>Name (portal)</th>
          <th>Email</th>
          <th>Level (sheet)</th>
          <th>Level (portal)</th>
          <th>Type</th>
          <th>Custom label</th>
          <th>Amount</th>
          <th>Total</th>
          <th>Balance</th>
          <th>CCY</th>
          <th>Date</th>
          <th>Doc quote</th>
          <th>Doc recv</th>
          <th>Visa quo</th>
          <th>Visa recv</th>
          <th>Note</th>
          <th>Issues</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, '_blank');
    if (!tab) {
      URL.revokeObjectURL(url);
      this.snack.open('Pop-up blocked. Allow pop-ups for this site to open the full preview.', 'Dismiss', {
        duration: 6000,
      });
      return;
    }
    tab.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  }

  rowStatusLabel(row: PreviewRow): string {
    if (row.parseError) return 'Invalid';
    if (!row.matchedStudent) return 'No match';
    return 'Matched';
  }

  rowStatusClass(row: PreviewRow): string {
    if (row.parseError) return 'ei-pill-err';
    if (!row.matchedStudent) return 'ei-pill-warn';
    return 'ei-pill-ok';
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
        reason: `Currency was blank; using student profile currency (${displayCurrency(row.effectiveCurrency)}).`,
        fix: 'Add an explicit Currency column value (LKR, INR, EURO) if the default is wrong.',
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
        Currency: displayCurrency(r.currency || r.effectiveCurrency),
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
    this.selectedRow = null;
  }

  close(): void {
    this.dialogRef.close(false);
  }

  fmtDate(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  fmt(n: number | null): string {
    if (n === null || n === undefined) return '—';
    return n.toLocaleString('sr-Latn-RS', { maximumFractionDigits: 0 });
  }

  totalPaymentRowsQueued(): number {
    return this.validMappableRows.length;
  }
}
