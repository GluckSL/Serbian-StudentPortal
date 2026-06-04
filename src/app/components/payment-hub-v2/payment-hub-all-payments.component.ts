import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { PaymentHubApiService, DashboardStats, StudentTableRow } from './payment-hub-api.service';
import { fmtPaymentAmount, fmtPaymentAmountCompact } from './payment-currency.util';
import { PaymentCurrencyTotalsComponent } from './payment-currency-totals.component';
import { PaymentCurrencyPendingTotalsComponent } from './payment-currency-pending-totals.component';
import { PaymentCurrencyOverdueTotalsComponent } from './payment-currency-overdue-totals.component';
import { StudentLogService } from '../../services/student-log.service';
import { PaymentLegacyMapperDialogComponent } from './payment-legacy-mapper-dialog.component';
import { PaymentBulkLanguagePaidDialogComponent } from './payment-bulk-language-paid-dialog.component';
import { PaymentCorrectReceivedDialogComponent } from './payment-correct-received-dialog.component';
import { PaymentExcelImportDialogComponent } from './payment-excel-import-dialog.component';
import {
  currentJourneyDayFromStudent,
  formatJourneyDayCurrentTotal,
} from './payment-journey-metrics.util';
import {
  LANGUAGE_FEE_STATUS_LABELS,
  LANGUAGE_FEE_STATUS_OPTIONS,
  languageFeeStatusClass,
  computeLanguageFeeStatus,
} from './payment-language-fee-status.util';

@Component({
  selector: 'app-payment-hub-all-payments',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
    MatTooltipModule,
    MatDialogModule,
    MatCheckboxModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyOverdueTotalsComponent,
  ],
  templateUrl: './payment-hub-all-payments.component.html',
  styleUrls: ['./payment-hub-all-payments.component.scss'],
})
export class PaymentHubAllPaymentsComponent implements OnInit {
  loadingStats = true;
  loadingTable = true;
  runningOverdue = false;
  resettingPayments = false;
  selectingAllMatching = false;

  stats: DashboardStats | null = null;
  rows: StudentTableRow[] = [];
  total = 0;
  page = 1;
  readonly pageSize = 20;

  // Filters
  filterBatch = '';
  filterLevel = '';
  filterCurrency = '';
  filterLanguageFeeStatus = '';
  filterStudentStatus = '';
  filterSubscription = '';
  filterDateFrom: Date | null = null;
  filterDateTo: Date | null = null;
  searchQuery = '';

  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly currencies = ['LKR', 'INR', 'USD'];
  readonly languageFeeStatusOptions = LANGUAGE_FEE_STATUS_OPTIONS;
  readonly studentStatusOptions = [
    { value: '', label: 'All student statuses' },
    { value: 'ONGOING', label: 'Ongoing' },
    { value: 'COMPLETED', label: 'Completed' },
    { value: 'WITHDREW', label: 'Withdrew' },
    { value: 'UNCERTAIN', label: 'Uncertain' },
  ];
  readonly subscriptionOptions = [
    { value: '', label: 'All plans' },
    { value: 'PLATINUM', label: 'Platinum' },
    { value: 'SILVER', label: 'Silver' },
    { value: 'VISA_DOC_ONLY', label: 'Visa doc only' },
  ];
  /** Distinct student `batch` values from `/api/studentLog/batch-options` */
  batchOptions: string[] = [];

  /** Student `_id`s selected for bulk language fee (may span pages). */
  private selectedStudentIds = new Set<string>();

  get hasActiveFilters(): boolean {
    return !!(
      this.filterBatch ||
      this.filterLevel ||
      this.filterCurrency ||
      this.filterLanguageFeeStatus ||
      this.filterStudentStatus ||
      this.filterSubscription ||
      this.filterDateFrom ||
      this.filterDateTo
    );
  }

  fmtCompact = fmtPaymentAmountCompact;
  fmtFull = fmtPaymentAmount;

  get activeFilterLabel(): string {
    if (this.stats?.filterSummary) return this.stats.filterSummary;
    const parts: string[] = [];
    if (this.filterBatch) parts.push(`Batch ${this.filterBatch}`);
    if (this.filterLevel) parts.push(`Level ${this.filterLevel}`);
    if (this.filterSubscription) {
      const o = this.subscriptionOptions.find((x) => x.value === this.filterSubscription);
      parts.push(o?.label || this.filterSubscription);
    }
    if (this.filterStudentStatus) {
      const o = this.studentStatusOptions.find((x) => x.value === this.filterStudentStatus);
      parts.push(o?.label || this.filterStudentStatus);
    }
    if (this.filterLanguageFeeStatus) {
      const o = this.languageFeeStatusOptions.find((x) => x.value === this.filterLanguageFeeStatus);
      parts.push(o?.label || this.filterLanguageFeeStatus);
    }
    if (this.filterCurrency) parts.push(this.filterCurrency);
    return parts.length ? parts.join(' · ') : 'All students';
  }

  constructor(
    private readonly api: PaymentHubApiService,
    private readonly snack: MatSnackBar,
    private readonly studentLog: StudentLogService,
    private readonly dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.studentLog.getBatchOptions().subscribe({
      next: (r) => {
        this.batchOptions = r.data || [];
      },
      error: () => {
        this.batchOptions = [];
      },
    });
    this.loadStats();
    this.loadTable();
  }

  loadStats(): void {
    this.loadingStats = true;
    const filters = this.buildFilters();
    this.api.getDashboardStats(filters).subscribe({
      next: (r) => {
        this.stats = r.data;
        this.loadingStats = false;
      },
      error: () => {
        this.loadingStats = false;
        this.stats = null;
        this.snack.open('Could not load payment stats', 'Dismiss', { duration: 4000 });
      },
    });
  }

  loadTable(): void {
    this.loadingTable = true;
    const filters = this.buildFilters();
    this.api
      .getStudentTable({ ...filters, page: this.page, limit: this.pageSize, sort: '-lastRebuiltAt', search: this.searchQuery || undefined })
      .subscribe({
        next: (res) => {
          this.rows = res.data || [];
          this.total = res.total || 0;
          this.loadingTable = false;
        },
        error: () => {
          this.loadingTable = false;
          this.snack.open('Could not load student table', 'Dismiss', { duration: 4000 });
        },
      });
  }

  private buildFilters(): Record<string, string | undefined> {
    return {
      batch: this.filterBatch || undefined,
      level: this.filterLevel || undefined,
      currency: this.filterCurrency || undefined,
      languageFeeStatus: this.filterLanguageFeeStatus || undefined,
      studentStatus: this.filterStudentStatus || undefined,
      subscription: this.filterSubscription || undefined,
      dateFrom: this.filterDateFrom ? this.filterDateFrom.toISOString() : undefined,
      dateTo: this.filterDateTo ? this.filterDateTo.toISOString() : undefined,
    };
  }

  applyFilters(): void {
    this.page = 1;
    this.loadStats();
    this.loadTable();
  }

  resetFilters(): void {
    this.filterBatch = '';
    this.filterLevel = '';
    this.filterCurrency = '';
    this.filterLanguageFeeStatus = '';
    this.filterStudentStatus = '';
    this.filterSubscription = '';
    this.filterDateFrom = null;
    this.filterDateTo = null;
    this.searchQuery = '';
    this.page = 1;
    this.loadStats();
    this.loadTable();
  }

  onSearch(): void {
    this.page = 1;
    this.loadTable();
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page--;
      this.loadTable();
    }
  }

  nextPage(): void {
    if (this.page * this.pageSize < this.total) {
      this.page++;
      this.loadTable();
    }
  }

  openStudentDetail(row: StudentTableRow): void {
    const studentId = row.studentId?._id || row._id;
    window.open(`/admin/payment-hub/student/${studentId}`, '_blank');
  }

  get selectedCount(): number {
    return this.selectedStudentIds.size;
  }

  get allOnPageSelected(): boolean {
    if (!this.rows.length) return false;
    return this.rows.every((r) => this.selectedStudentIds.has(this.rowStudentId(r)));
  }

  get someOnPageSelected(): boolean {
    if (!this.rows.length) return false;
    const n = this.rows.filter((r) => this.selectedStudentIds.has(this.rowStudentId(r))).length;
    return n > 0 && n < this.rows.length;
  }

  private rowStudentId(row: StudentTableRow): string {
    return row.studentId?._id || row._id;
  }

  isRowSelected(row: StudentTableRow): boolean {
    return this.selectedStudentIds.has(this.rowStudentId(row));
  }

  toggleRowSelection(row: StudentTableRow, checked: boolean): void {
    const id = this.rowStudentId(row);
    const next = new Set(this.selectedStudentIds);
    if (checked) next.add(id);
    else next.delete(id);
    this.selectedStudentIds = next;
  }

  toggleSelectAllOnPage(checked: boolean): void {
    const next = new Set(this.selectedStudentIds);
    for (const r of this.rows) {
      const id = this.rowStudentId(r);
      if (checked) next.add(id);
      else next.delete(id);
    }
    this.selectedStudentIds = next;
  }

  selectAllMatchingFilter(): void {
    if (this.selectingAllMatching) return;
    this.selectingAllMatching = true;
    const filters = this.buildFilters();
    this.api
      .getStudentTable({
        ...filters,
        page: 1,
        limit: 9999,
        sort: '-lastRebuiltAt',
        search: this.searchQuery || undefined,
      })
      .subscribe({
        next: (res) => {
          const next = new Set(this.selectedStudentIds);
          for (const r of res.data || []) {
            next.add(this.rowStudentId(r));
          }
          this.selectedStudentIds = next;
          this.selectingAllMatching = false;
          this.snack.open(`Selected ${res.data?.length || 0} student(s) matching current filters`, 'OK', { duration: 4000 });
        },
        error: () => {
          this.selectingAllMatching = false;
          this.snack.open('Could not load students for selection', 'Dismiss', { duration: 4000 });
        },
      });
  }

  clearSelection(): void {
    this.selectedStudentIds = new Set();
  }

  resetSelectedPayments(): void {
    const ids = Array.from(this.selectedStudentIds);
    if (!ids.length) {
      this.snack.open('Select at least one student.', 'Dismiss', { duration: 4000 });
      return;
    }

    const msg =
      `Reset payment data for ${ids.length} selected student(s)?\n\n` +
      'This clears total received, pending, and overdue to 0 by archiving all their payment records. ' +
      'Use this before re-importing from Excel. This cannot be undone.';
    if (!window.confirm(msg)) return;

    this.resettingPayments = true;
    this.api
      .bulkResetStudentPayments({
        studentIds: ids,
        reason: 'Admin bulk reset before Excel re-import',
      })
      .subscribe({
        next: (res) => {
          this.resettingPayments = false;
          this.selectedStudentIds = new Set();
          this.snack.open(res.message || 'Payment data reset', 'OK', { duration: 5000 });
          this.loadStats();
          this.loadTable();
        },
        error: (err) => {
          this.resettingPayments = false;
          const message = err?.error?.message || 'Reset failed';
          this.snack.open(message, 'Dismiss', { duration: 6000 });
        },
      });
  }

  openCorrectReceived(): void {
    const picked = this.rows.filter((r) => this.isRowSelected(r));
    if (picked.length !== 1) {
      this.snack.open('Select exactly one student to correct total received.', 'Dismiss', { duration: 4000 });
      return;
    }
    const ref = this.dialog.open(PaymentCorrectReceivedDialogComponent, {
      width: '520px',
      maxWidth: '100vw',
      panelClass: 'lm-dialog-panel',
      autoFocus: false,
      data: { row: picked[0] },
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.selectedStudentIds = new Set();
        this.loadStats();
        this.loadTable();
      }
    });
  }

  openBulkLanguagePaid(): void {
    const picked = this.rows.filter((r) => this.isRowSelected(r));
    if (this.selectedCount > picked.length) {
      this.snack.open(
        'Some checked students are on another page. Only rows on this page are opened — use Next/Previous and repeat, or narrow filters.',
        'OK',
        { duration: 8000 },
      );
    }
    if (!picked.length) {
      this.snack.open('Select at least one student on this page.', 'Dismiss', { duration: 4000 });
      return;
    }
    const ref = this.dialog.open(PaymentBulkLanguagePaidDialogComponent, {
      width: '960px',
      maxWidth: '100vw',
      maxHeight: '92vh',
      panelClass: 'lm-dialog-panel',
      autoFocus: false,
      data: { rows: picked },
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.selectedStudentIds = new Set();
        this.loadStats();
        this.loadTable();
      }
    });
  }

  openExcelImport(): void {
    const ref = this.dialog.open(PaymentExcelImportDialogComponent, {
      width: '1120px',
      maxWidth: '100vw',
      maxHeight: '92vh',
      panelClass: ['lm-dialog-panel', 'ei-import-dialog-panel'],
      autoFocus: false,
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.loadStats();
        this.loadTable();
      }
    });
  }

  openLegacyMapper(): void {
    const ref = this.dialog.open(PaymentLegacyMapperDialogComponent, {
      width: '1000px',
      maxWidth: '100vw',
      maxHeight: '92vh',
      panelClass: 'lm-dialog-panel',
      autoFocus: false,
    });
    ref.afterClosed().subscribe((saved) => {
      if (saved) {
        this.loadStats();
        this.loadTable();
      }
    });
  }

  runOverdue(): void {
    this.runningOverdue = true;
    this.api.runOverdueDetection().subscribe({
      next: () => {
        this.runningOverdue = false;
        this.snack.open('Overdue detection finished', 'OK', { duration: 3000 });
        this.loadStats();
        this.loadTable();
      },
      error: () => {
        this.runningOverdue = false;
        this.snack.open('Overdue job failed', 'Dismiss', { duration: 4000 });
      },
    });
  }

  fmt(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0';
    return val.toLocaleString('en-IN');
  }

  studentName(row: StudentTableRow): string {
    return row.studentId?.name || '—';
  }

  studentEmail(row: StudentTableRow): string {
    return row.studentId?.email || '—';
  }

  studentBatch(row: StudentTableRow): string {
    return row.studentId?.batch || '—';
  }

  studentLevel(row: StudentTableRow): string {
    return row.studentId?.level || '—';
  }

  studentDateJoined(row: StudentTableRow): string {
    const d = row.studentId?.dateJoined || row.studentId?.enrollmentDate || row.studentId?.createdAt;
    return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  journeyDayDisplay(row: StudentTableRow): string {
    return formatJourneyDayCurrentTotal(row.studentId, row.studentId?.level);
  }

  rowLanguageFeeStatus(row: StudentTableRow): string {
    if (row.languageFeeStatus) return row.languageFeeStatus;
    const day = currentJourneyDayFromStudent(row.studentId);
    const bal = row.languageFeeBalance ?? 0;
    return computeLanguageFeeStatus(bal, day);
  }

  languageFeeStatusLabel(row: StudentTableRow): string {
    const key = this.rowLanguageFeeStatus(row) as keyof typeof LANGUAGE_FEE_STATUS_LABELS;
    return LANGUAGE_FEE_STATUS_LABELS[key] || key || '—';
  }

  languageFeePillClass(row: StudentTableRow): string {
    return languageFeeStatusClass(this.rowLanguageFeeStatus(row));
  }
}
