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
import { MatMenuModule } from '@angular/material/menu';
import { PaymentHubApiService, DashboardStats, PaymentPaidSlotBadge, StudentTableRow } from './payment-hub-api.service';
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
import {
  defaultPaymentHubExportFormatters,
  downloadPaymentHubCsv,
  downloadPaymentHubXlsx,
  paymentHubRowsToCsv,
} from './payment-hub-export.util';
import { TestAccountBadgeComponent } from '../../shared/test-account-badge/test-account-badge.component';

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
    MatMenuModule,
    MatCheckboxModule,
    PaymentCurrencyTotalsComponent,
    PaymentCurrencyPendingTotalsComponent,
    PaymentCurrencyOverdueTotalsComponent,
    TestAccountBadgeComponent,
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
  exporting = false;

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
  /** Off by default — test accounts excluded from table and summary counts. */
  includeTestAccounts = false;
  searchQuery = '';
  /** Clickable summary filter: paid_full | have_balance | overdue | paid_docs | paid_visa */
  filterStudentInsight = '';

  readonly studentInsightOptions = [
    { value: '', key: 'all', label: 'Svi učenici', icon: 'groups', hint: 'Prikaži sve učenike', color: 'slate' },
    { value: 'paid_full', key: 'paid_full', label: 'Potpuno plaćeno', icon: 'check_circle', hint: 'Jezička naknada potpuno plaćena', color: 'green' },
    { value: 'have_balance', key: 'have_balance', label: 'Imaju saldo', icon: 'account_balance_wallet', hint: 'Preostali saldo', color: 'amber' },
    { value: 'overdue', key: 'overdue', label: 'Zakašnjelo', icon: 'warning_amber', hint: 'Plaćanja van roka', color: 'red' },
    { value: 'paid_docs', key: 'paid_docs', label: 'Plaćeni dokumenti', icon: 'description', hint: 'Plaćanje dokumenata odobreno', color: 'teal' },
    { value: 'paid_visa', key: 'paid_visa', label: 'Plaćena viza', icon: 'flight', hint: 'Plaćanje vize odobreno', color: 'indigo' },
  ] as const;

  readonly levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  readonly currencies = ['LKR', 'INR', 'USD'];
  readonly languageFeeStatusOptions = LANGUAGE_FEE_STATUS_OPTIONS;
  readonly studentStatusOptions = [
    { value: '', label: 'Svi statusi učenika' },
    { value: 'ONGOING', label: 'U toku' },
    { value: 'COMPLETED', label: 'Završeno' },
    { value: 'WITHDREW', label: 'Povukao se' },
    { value: 'UNCERTAIN', label: 'Neizvesno' },
  ];
  readonly subscriptionOptions = [
    { value: '', label: 'Svi planovi' },
    { value: 'PLATINUM', label: 'Platinum' },
    { value: 'SILVER', label: 'Silver' },
    { value: 'VISA_DOC_ONLY', label: 'Samo viza/dokumenti' },
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
      this.filterDateTo ||
      this.includeTestAccounts
    );
  }

  get hasTableInsightFilter(): boolean {
    return !!this.filterStudentInsight;
  }

  fmtCompact = fmtPaymentAmountCompact;
  fmtFull = fmtPaymentAmount;

  get activeFilterLabel(): string {
    if (this.stats?.filterSummary) return this.stats.filterSummary;
    const parts: string[] = [];
    if (this.filterBatch) parts.push(`Grupa ${this.filterBatch}`);
    if (this.filterLevel) parts.push(`Nivo ${this.filterLevel}`);
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
    if (this.includeTestAccounts) parts.push('Uklj. test naloge');
    else parts.push('Iskl. test naloge');
    return parts.length ? parts.join(' · ') : 'Iskl. test naloge';
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
        this.snack.open('Greška pri učitavanju statistike plaćanja', 'Zatvori', { duration: 4000 });
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
          this.snack.open('Greška pri učitavanju tabele učenika', 'Zatvori', { duration: 4000 });
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
      includeTestAccounts: this.includeTestAccounts ? 'true' : undefined,
      studentInsight: this.filterStudentInsight || undefined,
    };
  }

  applyInsightFilter(insight: string): void {
    const next = this.filterStudentInsight === insight ? '' : insight;
    this.filterStudentInsight = next;
    this.page = 1;
    this.loadTable();
    if (next) {
      setTimeout(() => {
        document.getElementById('ph-students-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }

  clearInsightFilter(): void {
    if (!this.filterStudentInsight) return;
    this.filterStudentInsight = '';
    this.page = 1;
    this.loadTable();
  }

  insightCount(key: string): number {
    if (!this.stats) return 0;
    switch (key) {
      case 'all':
        return this.stats.totalStudents;
      case 'paid_full':
        return this.stats.fullyPaidStudents;
      case 'have_balance':
        return this.stats.balanceStudents;
      case 'overdue':
        return this.stats.overdueStudents;
      case 'paid_docs':
        return this.stats.docsPaidStudents;
      case 'paid_visa':
        return this.stats.visaPaidStudents;
      default:
        return 0;
    }
  }

  isInsightActive(value: string): boolean {
    return this.filterStudentInsight === value;
  }

  activeInsightLabel(): string {
    const opt = this.studentInsightOptions.find((o) => o.value === this.filterStudentInsight);
    return opt?.label || this.filterStudentInsight;
  }

  studentPct(count: number, total: number): string {
    if (!total) return '0%';
    return `${Math.round((count / total) * 100)}%`;
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
    this.includeTestAccounts = false;
    this.filterStudentInsight = '';
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
          this.snack.open(`Izabrano ${res.data?.length || 0} učenik(a) koji odgovaraju filteru`, 'OK', { duration: 4000 });
        },
        error: () => {
          this.selectingAllMatching = false;
          this.snack.open('Greška pri učitavanju učenika za izbor', 'Zatvori', { duration: 4000 });
        },
      });
  }

  clearSelection(): void {
    this.selectedStudentIds = new Set();
  }

  exportPayments(format: 'xlsx' | 'csv', scope: 'all' | 'selected'): void {
    if (this.exporting) return;
    if (scope === 'selected' && this.selectedCount === 0) {
      this.snack.open('Izaberite najmanje jednog učenika za izvoz.', 'Zatvori', { duration: 3500 });
      return;
    }
    if (scope === 'all' && this.total === 0) {
      this.snack.open('Nema učenika za izvoz za trenutne filtere.', 'Zatvori', { duration: 3500 });
      return;
    }

    this.exporting = true;
    const filters = this.buildFilters();
    const limit = Math.min(this.total, 10000);

    this.api
      .getStudentTable({
        ...filters,
        page: 1,
        limit,
        sort: '-lastRebuiltAt',
        search: this.searchQuery || undefined,
      })
      .subscribe({
        next: (res) => {
          let rows = res.data || [];
          if (scope === 'selected') {
            const ids = this.selectedStudentIds;
            rows = rows.filter((r) => ids.has(this.rowStudentId(r)));
            if (rows.length < ids.size) {
              this.fetchSelectedForExport(format, ids);
              return;
            }
          }
          this.finishExport(format, rows, scope);
        },
        error: () => {
          this.exporting = false;
          this.snack.open('Greška pri učitavanju učenika za izvoz', 'Zatvori', { duration: 4000 });
        },
      });
  }

  /** Selected students may span pages — load full matching set then filter by selection. */
  private fetchSelectedForExport(format: 'xlsx' | 'csv', ids: Set<string>): void {
    const filters = this.buildFilters();
    this.api
      .getStudentTable({
        ...filters,
        page: 1,
        limit: Math.min(this.total, 10000),
        sort: '-lastRebuiltAt',
        search: this.searchQuery || undefined,
      })
      .subscribe({
        next: (res) => {
          const rows = (res.data || []).filter((r) => ids.has(this.rowStudentId(r)));
          this.finishExport(format, rows, 'selected');
        },
        error: () => {
          this.exporting = false;
          this.snack.open('Greška pri učitavanju izabranih učenika za izvoz', 'Zatvori', { duration: 4000 });
        },
      });
  }

  private finishExport(format: 'xlsx' | 'csv', rows: StudentTableRow[], scope: 'all' | 'selected'): void {
    this.exporting = false;
    if (!rows.length) {
      this.snack.open('Nema redova za izvoz.', 'Zatvori', { duration: 3500 });
      return;
    }
    const formatters = defaultPaymentHubExportFormatters((r) => this.languageFeeStatusLabel(r));
    const date = new Date().toISOString().slice(0, 10);
    const filterSlug = this.activeFilterLabel.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'all';
    const base = `payment-hub-${scope}-${filterSlug}-${date}`;

    if (format === 'xlsx') {
      downloadPaymentHubXlsx(base, rows, formatters);
    } else {
      downloadPaymentHubCsv(base, paymentHubRowsToCsv(rows, formatters));
    }
    this.snack.open(`Izvezeno ${rows.length} učenik(a) kao ${format === 'xlsx' ? 'Excel' : 'CSV'}`, 'OK', { duration: 4000 });
  }

  resetSelectedPayments(): void {
    const ids = Array.from(this.selectedStudentIds);
    if (!ids.length) {
      this.snack.open('Izaberite najmanje jednog učenika.', 'Zatvori', { duration: 4000 });
      return;
    }

    const msg =
      `Resetovati podatke o plaćanju za ${ids.length} izabrani(h) učenik(a)?\n\n` +
      'Ovo briše ukupno primljeno, na čekanju i zakašnjelo na 0 arhiviranjem svih njihovih zapisa o plaćanju. ' +
      'Koristite ovo pre ponovnog uvoza iz Excel-a. Ova radnja se ne može poništiti.';
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
          this.snack.open(res.message || 'Podaci o plaćanju resetovani', 'OK', { duration: 5000 });
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
      this.snack.open('Izaberite tačno jednog učenika za ispravku ukupno primljenog.', 'Zatvori', { duration: 4000 });
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
        'Neki izabrani učenici su na drugoj stranici. Otvaraju se samo redovi sa ove stranice — koristite Sledeća/Prethodna i ponovite, ili suzite filtere.',
        'OK',
        { duration: 8000 },
      );
    }
    if (!picked.length) {
      this.snack.open('Izaberite najmanje jednog učenika na ovoj stranici.', 'Zatvori', { duration: 4000 });
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
        this.snack.open('Detekcija zakašnjelih završena', 'OK', { duration: 3000 });
        this.loadStats();
        this.loadTable();
      },
      error: () => {
        this.runningOverdue = false;
        this.snack.open('Zadatak za zakašnjela plaćanja nije uspeo', 'Zatvori', { duration: 4000 });
      },
    });
  }

  fmt(val: number | undefined | null): string {
    if (val === undefined || val === null) return '0';
    return val.toLocaleString('sr-Latn-RS');
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
    return d ? new Date(d).toLocaleDateString('sr-Latn-RS', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
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

  paidSlots(row: StudentTableRow): PaymentPaidSlotBadge[] {
    return row.paidSlots ?? [];
  }

  paidSlotLabel(slot: PaymentPaidSlotBadge): string {
    if (slot === 'ALL') return 'All';
    if (slot === 'DOCS') return 'Docs';
    if (slot === 'VISA') return 'Visa';
    return slot.toLowerCase();
  }

  paidSlotClass(slot: PaymentPaidSlotBadge): string {
    const map: Record<PaymentPaidSlotBadge, string> = {
      ALL: 'ph-paid-slot--all',
      A1: 'ph-paid-slot--a1',
      A2: 'ph-paid-slot--a2',
      B1: 'ph-paid-slot--b1',
      B2: 'ph-paid-slot--b2',
      DOCS: 'ph-paid-slot--docs',
      VISA: 'ph-paid-slot--visa',
    };
    return map[slot] || 'ph-paid-slot';
  }

  currencyLabel(currency: string | null | undefined): string {
    return String(currency || '').toUpperCase() === 'USD' ? 'EURO' : String(currency || '');
  }
}
